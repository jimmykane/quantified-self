import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import type { DeliveryCheckpoint, DeliveryOperation } from '../contracts';
import { WahooHttpFixture, wahooFixtureWorkout } from '../test-support/wahoo-http-fixture';
import { WahooTrainingTransport } from './transport';
import { WahooTrainingHttpError } from './http';

describe('Wahoo Plan + dated Workout lifecycle', () => {
  const now = Date.parse('2026-10-24T22:30:00Z'); // October 25 in saved zone; DST ends that day.
  let server: WahooHttpFixture; let transport: WahooTrainingTransport; let op: DeliveryOperation; let checkpoint: DeliveryCheckpoint;
  const guard = vi.fn(async () => {});
  const execute = () => transport.execute(op, checkpoint, guard);
  const recover = () => transport.recover(op, checkpoint, guard);
  const next = (patch: Partial<ScheduledWorkoutV1> = {}) => {
    op = { ...op, id: `${op.id}-next`, progress: null, generation: op.generation + 1, workout: { ...op.workout!, ...patch } };
    op.digest = transport.assess(op.workout!, op.destinationKey, op.timeZone).digest;
  };
  beforeEach(() => {
    guard.mockReset(); guard.mockResolvedValue(undefined); checkpoint = vi.fn(async () => {});
    server = new WahooHttpFixture(); transport = new WahooTrainingTransport(server.request, () => now);
    const workout = wahooFixtureWorkout();
    op = { id: 'attempt', deliveryId: 'delivery', generation: 1, kind: 'upsert', destinationKey: 'destination', connectionGeneration: 'generation',
      timeZone: 'Europe/Helsinki', workout, artifact: null, progress: null, contentDigest: 'content', digest: transport.assess(workout, 'destination', 'Europe/Helsinki').digest };
  });
  it('creates two resources, checkpoints partial acceptance, verifies the association, edits and reschedules in place', async () => {
    const first = (await execute())!;
    expect(first.ids.association).toBe(`${first.ids.workout}:${first.ids.plan}`);
    expect(checkpoint).toHaveBeenCalledWith(expect.objectContaining({ ids: expect.objectContaining({ plan: first.ids.plan }) }), { version: 1, step: 'plan-create', state: 'accepted' });
    next({ title: 'Edited run', localDate: '2026-10-31', updatedAtMs: now });
    const second = (await execute())!;
    expect(second.ids).toEqual(first.ids); expect(second.localDate).toBe('2026-10-31');
    expect(server.plans.get(first.ids.plan)?.name).toBe('Edited run');
    expect(server.workouts.get(first.ids.workout)?.name).toBe('Edited run');
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
    op = { ...op, kind: 'remove', workout: null, progress: null };
    expect(await execute()).toBeNull(); expect(server.plans.size).toBe(0); expect(server.workouts.size).toBe(0);
    expect(server.calls.filter(call => call.method === 'DELETE').map(call => call.path)).toEqual([`/v1/workouts/${first.ids.workout}`, `/v1/plans/${first.ids.plan}`]);
  });
  it('gives duplicated QS workouts independent recipes and dated records', async () => {
    const first = (await execute())!;
    op.artifact = null; next({ id: 'copy' });
    const second = (await execute())!;
    expect(second.ids.plan).not.toBe(first.ids.plan); expect(second.ids.workout).not.toBe(first.ids.workout);
    expect(server.plans.size).toBe(2); expect(server.workouts.size).toBe(2);
  });
  it('updates the same owned Workout when a time-zone edit crosses the date line', async () => {
    op.timeZone = 'Pacific/Pago_Pago'; next({ localDate: '2026-10-29' });
    const first = (await execute())!;
    op.timeZone = 'Pacific/Kiritimati'; next();
    const updated = (await execute())!;
    expect(updated.ids).toEqual(first.ids);
    expect(server.workouts.get(first.ids.workout)?.starts).toBe('2026-10-28T22:00:00.000Z');
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
  });
  it('does not accept a time-zone edit when readback retains the old instant on the same day', async () => {
    const first = (await execute())!;
    const starts = server.workouts.get(first.ids.workout)!.starts;
    op.timeZone = 'Europe/London'; next();
    server.afterHandle = async request => { if (request.method === 'PUT' && request.path.includes('/workouts/')) {
      server.afterHandle = null; server.workouts.get(first.ids.workout)!.starts = starts;
    } };
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(op.artifact?.timeZone).toBe('Europe/Helsinki');
    expect(await recover()).toEqual({ kind: 'resume' });
    expect((await execute())!.timeZone).toBe('Europe/London');
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
  });
  it.each(['before', 'after'])('recovers a time-zone edit interrupted %s Workout acceptance', async phase => {
    op.timeZone = 'Pacific/Pago_Pago'; next({ localDate: '2026-10-29' });
    const first = (await execute())!;
    op.timeZone = 'Pacific/Kiritimati'; next();
    const hook = phase === 'before' ? 'beforeHandle' : 'afterHandle';
    server[hook] = async request => { if (request.method === 'PUT' && request.path.includes('/workouts/')) {
      server[hook] = null; throw new WahooTrainingHttpError('uncertain', false);
    } };
    await expect(execute()).rejects.toThrow();
    expect(await recover()).toEqual({ kind: 'resume' });
    expect((await execute())!.ids).toEqual(first.ids);
    expect(op.artifact?.timeZone).toBe('Pacific/Kiritimati');
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
  });
  it('inspects and removes the retained copy in its own zone after settings change', async () => {
    op.timeZone = 'Pacific/Pago_Pago'; next({ localDate: '2026-10-29' });
    const artifact = (await execute())!;
    const result = await transport.inspection.inspect({ artifact, destinationKey: op.destinationKey,
      connectionGeneration: op.connectionGeneration, timeZone: 'Pacific/Kiritimati', cursor: null }, guard);
    expect(result).toMatchObject({ conflict: false, artifacts: ['plan', 'workout', 'association'].map(key => ({ key, state: 'present', authoritative: true })) });
    op = { ...op, timeZone: 'Pacific/Kiritimati', kind: 'remove', workout: null, progress: null };
    expect(await execute()).toBeNull();
  });
  it('retires uncertain creation safely when readback proves the Workout completed', async () => {
    server.afterHandle = async request => { if (request.method === 'POST' && request.path === '/v1/workouts') {
      server.afterHandle = null; throw new WahooTrainingHttpError('uncertain', false);
    } };
    await expect(execute()).rejects.toThrow();
    [...server.workouts.values()][0].workout_summary = { id: 42 };
    expect(await recover()).toEqual({ kind: 'resume' });
    expect(op.artifact?.completed).toBe(true);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
    await expect(execute()).rejects.toThrow();
  });
  it('never creates another Workout when only its existing Plan can be rediscovered', async () => {
    const accepted = (await execute())!;
    op.artifact = null; next();
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(await recover()).toMatchObject({ kind: 'accepted', artifact: accepted });
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
    op.artifact = null; next(); server.workouts.clear();
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(await recover()).toMatchObject({ kind: 'uncertain' });
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
  });
  it.each(['/v1/plans', '/v1/workouts'])('recovers a lost POST response for %s without another create', async path => {
    server.afterHandle = async request => { if (request.method === 'POST' && request.path === path) {
      server.afterHandle = null; throw new WahooTrainingHttpError('uncertain', false);
    } };
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    const recovery = await recover();
    if (recovery.kind === 'resume') await execute();
    else expect(recovery.kind).toBe('accepted');
    expect(server.plans.size).toBe(1); expect(server.workouts.size).toBe(1);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
  });
  it.each(['plan-create', 'finished'])('recovers %s acceptance when checkpoint persistence fails', async step => {
    checkpoint = async (_artifact, progress) => { if (progress?.step === step && progress.state === 'accepted') throw new Error('persistence'); };
    await expect(execute()).rejects.toThrow('persistence'); checkpoint = vi.fn();
    if ((await recover()).kind === 'resume') await execute();
    expect(server.plans.size).toBe(1); expect(server.workouts.size).toBe(1);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
  });
  it('never repeats an uncertain Plan POST after an empty lookup', async () => {
    op.progress = { version: 1, step: 'plan-create', state: 'started' };
    expect(await recover()).toEqual({ kind: 'uncertain' });
    await expect(execute()).rejects.toThrow(); expect(server.calls.every(call => call.method === 'GET')).toBe(true);
  });
  it.each(['empty', 'duplicate', 'oversized', 'unstable'])('blocks uncertain Workout acceptance on %s inventory', async scenario => {
    server.afterHandle = async request => { if (request.method === 'POST' && request.path === '/v1/workouts') {
      server.afterHandle = null; throw new WahooTrainingHttpError('uncertain', false);
    } };
    await expect(execute()).rejects.toThrow();
    const created = [...server.workouts.values()][0];
    if (scenario === 'empty') server.workouts.clear();
    if (scenario === 'duplicate') server.workouts.set('99', { ...created, id: '99' });
    if (scenario === 'oversized') for (let i = 1000; i < 1501; i++) server.workouts.set(String(i), { ...created, id: String(i), workout_token: `unrelated-${i}` });
    if (scenario === 'unstable') server.afterHandle = async request => { if (request.path.includes('page=')) {
      server.afterHandle = null; server.workouts.set('99', { ...created, id: '99', workout_token: 'other' });
    } };
    try { expect(await recover()).toEqual({ kind: 'uncertain' }); } catch (error) { expect(error).toMatchObject({ kind: 'uncertain' }); }
    await expect(execute()).rejects.toThrow(); expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
  });
  it('traverses complete inventory pages and checks the candidate by retained ID', async () => {
    server.afterHandle = async request => { if (request.method === 'POST' && request.path === '/v1/workouts') { server.afterHandle = null; throw new WahooTrainingHttpError('uncertain', false); } };
    await expect(execute()).rejects.toThrow();
    for (let i = 1000; i < 1150; i++) server.workouts.set(String(i), { id: String(i), starts: '2026-12-01T00:00:00Z', workout_token: `unrelated-${i}` });
    expect(await recover()).toMatchObject({ kind: 'accepted' });
    expect(server.calls.filter(call => call.path.includes('page='))).toHaveLength(4);
  });
  it.each(['plan', 'workout'])('retries an uncertain %s PUT in place', async resource => {
    await execute(); next({ title: 'Updated', localDate: '2026-10-26', updatedAtMs: now });
    server.afterHandle = async request => { if (request.method === 'PUT' && request.path.includes(`/${resource}s/`)) {
      server.afterHandle = null; throw new WahooTrainingHttpError('uncertain', false);
    } };
    await expect(execute()).rejects.toThrow(); expect(await recover()).toEqual({ kind: 'resume' }); await execute();
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
    expect(op.artifact?.localDate).toBe('2026-10-26');
  });
  it.each(['workout', 'plan'])('does not infer deletion after losing the %s DELETE acknowledgement', async resource => {
    await execute(); op = { ...op, kind: 'remove', workout: null, progress: null };
    server.afterHandle = async request => { if (request.method === 'DELETE' && request.path.includes(`/${resource}s/`)) {
      server.afterHandle = null; throw new WahooTrainingHttpError('uncertain', false);
    } };
    await expect(execute()).rejects.toThrow(); expect(await recover()).toEqual({ kind: 'uncertain' });
    await expect(execute()).rejects.toThrow();
    if (resource === 'workout') expect(server.plans.size).toBe(1);
  });
  it.each(['completed', 'past', 'moved', 'token', 'association', 'plan-owner'])('protects %s provider records before any update or delete', async scenario => {
    const artifact = (await execute())!; const workout = server.workouts.get(artifact.ids.workout)!;
    if (scenario === 'completed') workout.workout_summary = { id: 42 };
    if (scenario === 'past') workout.starts = '2026-10-24T10:00:00Z';
    if (scenario === 'moved') workout.starts = '2026-10-30T10:00:00Z';
    if (scenario === 'token') workout.workout_token = 'another-app';
    if (scenario === 'association') workout.plan_id = '999';
    if (scenario === 'plan-owner') server.plans.get(artifact.ids.plan)!.external_id = 'another-app';
    const count = server.calls.filter(call => call.method !== 'GET').length;
    next({ title: 'Edit' }); await expect(execute()).rejects.toThrow();
    op = { ...op, kind: 'remove', workout: null, progress: null }; await expect(execute()).rejects.toThrow();
    expect(server.calls.filter(call => call.method !== 'GET')).toHaveLength(count);
    if (scenario === 'completed') expect(op.artifact?.completed).toBe(true);
  });
  it.each(['2026-10-24', '2026-11-01'])('does not send outside the seven-day saved-zone horizon: %s', async localDate => {
    next({ localDate }); await expect(execute()).rejects.toThrow(); expect(server.calls).toHaveLength(0);
  });
  it('checks three independent presence keys and never reports absence/repair from 404', async () => {
    const artifact = (await execute())!;
    const inspect = () => transport.inspection.inspect({ artifact, destinationKey: op.destinationKey, connectionGeneration: op.connectionGeneration,
      timeZone: op.timeZone, cursor: null }, guard);
    expect(await inspect()).toMatchObject({ conflict: false, artifacts: ['plan', 'workout', 'association'].map(key => ({ key, state: 'present', authoritative: true })) });
    server.plans.delete(artifact.ids.plan);
    const result = await inspect();
    expect(result.artifacts.find(value => value.key === 'plan')?.state).toBe('unknown');
    expect(result.artifacts.find(value => value.key === 'association')?.state).toBe('unknown');
    expect(transport.inspection.policy.repairReadyKeys).toEqual([]);
    expect(transport.inspection.policy.authoritativeAbsenceKeys).toEqual([]);
  });
  it('fails closed on legacy or corrupt journals and final guard failures', async () => {
    op.progress = undefined; await expect(execute()).rejects.toThrow(); expect(await recover()).toEqual({ kind: 'uncertain' });
    op.progress = null; guard.mockRejectedValue(new Error('stop')); await expect(execute()).rejects.toThrow('stop');
    expect(server.calls).toHaveLength(0);
  });
});
