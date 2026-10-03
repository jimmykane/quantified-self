import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import type { DeliveryCheckpoint, DeliveryOperation } from '../contracts';
import { projectStrengthWorkoutToV1 } from '../../../../../shared/strength-workout';
import { WahooHttpFixture, wahooFixtureWorkout, wahooFixtureStrengthDetails } from '../test-support/wahoo-http-fixture';
import { WahooTrainingTransport } from './transport';
import { createWahooTrainingClient, WahooTrainingHttpError } from './http';
import { WAHOO_SPORT_FIXTURES } from '../test-support/wahoo-sport-fixtures';

describe('Wahoo Plan + dated Workout lifecycle', () => {
  const now = Date.parse('2026-10-24T22:30:00Z'); // October 25 in saved zone; DST ends that day.
  let server: WahooHttpFixture; let transport: WahooTrainingTransport; let op: DeliveryOperation; let checkpoint: DeliveryCheckpoint;
  const guard = vi.fn(async () => {});
  const execute = () => transport.execute(op, checkpoint, guard);
  const recover = () => transport.recover(op, checkpoint, guard);
  const next = (patch: Partial<ScheduledWorkoutV1> = {}) => {
    op = { ...op, id: `${op.id}-next`, progress: null, generation: op.generation + 1, workout: { ...op.workout!, ...patch } };
    op.digest = transport.assess(op.workout!, op.destinationKey, op.timeZone, op.strength).digest;
  };
  beforeEach(() => {
    guard.mockReset(); guard.mockResolvedValue(undefined); checkpoint = vi.fn(async () => {});
    server = new WahooHttpFixture(); transport = new WahooTrainingTransport(server.request, () => now);
    const workout = wahooFixtureWorkout();
    op = { id: 'attempt', deliveryId: 'delivery', generation: 1, kind: 'upsert', destinationKey: 'destination', connectionGeneration: 'generation',
      timeZone: 'Europe/Helsinki', workout, artifact: null, progress: null, contentDigest: 'content', digest: transport.assess(workout, 'destination', 'Europe/Helsinki').digest };
  });
  const timedStrength = () => {
    op.strength = wahooFixtureStrengthDetails();
    next({ title: 'Timed strength', structure: projectStrengthWorkoutToV1(op.strength) });
  };
  it('keeps a renewed Plan identity through create, edit and reschedule, with stable completion correlation', async () => {
    op.wahooPlanGeneration = 1;
    const artifact = (await execute())!;
    expect(artifact.ids.planGeneration).toBe('1');
    next({ localDate: '2026-10-26', title: 'Renewed' });
    expect((await execute())!.ids).toEqual(artifact.ids);
    expect(server.calls.filter(call => call.method === 'POST' && call.path === '/v1/plans')).toHaveLength(1);
    const body = new URLSearchParams(server.calls.find(call => call.method === 'POST' && call.path === '/v1/plans')!.body);
    expect(body.get('plan[external_id]')).toBe(artifact.ids.externalId);
  });
  it('rejects a changed reserved incarnation before any request', async () => {
    op.wahooPlanGeneration = 1; await execute(); next(); op.wahooPlanGeneration = 2; server.calls.length = 0;
    await expect(execute()).rejects.toMatchObject({ diagnostics: { wahooContractCheck: 'artifact_invalid' } });
    expect(server.calls).toHaveLength(0);
  });
  it.each([null, -1, 0.5, '1'])('rejects malformed reserved incarnation %s before a fresh send', async generation => {
    op.wahooPlanGeneration = generation as unknown as number;
    await expect(execute()).rejects.toMatchObject({ diagnostics: { wahooContractCheck: 'operation_invalid' } });
    expect(server.calls).toHaveLength(0);
  });
  it.each([false, true])('confirms an owned deleted Plan and absent Workout without another DELETE (recovery=%s)', async recovery => {
    const artifact = (await execute())!; server.plans.get(artifact.ids.plan)!.deleted = true; server.workouts.clear(); server.calls.length = 0;
    op = { ...op, kind: 'remove', workout: null, progress: recovery ? { version: 1, step: 'plan-remove', state: 'started' } : null };
    // A partial Plan-delete journal must already have retired the Workout.
    if (recovery) { delete artifact.ids.workout; delete artifact.ids.association; }
    if (recovery) expect(await recover()).toEqual({ kind: 'accepted', artifact: null });
    else expect(await execute()).toBeNull();
    expect(op.progress).toMatchObject({ step: 'finished', state: 'accepted', removalOutcome: 'already_absent' });
    expect(server.calls.every(call => call.method === 'GET')).toBe(true);
  });
  it.each(['surviving-workout', 'unknown-summary', 'completed', 'wrong-id', 'wrong-external-id', 'unknown-deletion', 'duplicate-catalog'])(
    'does not treat a deleted Plan as safe withdrawal with %s', async reason => {
      const artifact = (await execute())!; const plan = server.plans.get(artifact.ids.plan)!;
      plan.deleted = true;
      if (!['surviving-workout', 'unknown-summary', 'completed'].includes(reason)) server.workouts.clear();
      if (reason === 'unknown-summary') delete server.workouts.get(artifact.ids.workout)!.workout_summary;
      if (reason === 'completed') server.workouts.get(artifact.ids.workout)!.workout_summary = { id: 999 };
      if (reason === 'wrong-id') plan.id = '999';
      if (reason === 'wrong-external-id') plan.external_id = 'foreign';
      if (reason === 'unknown-deletion') plan.deleted = 'true';
      if (reason === 'duplicate-catalog') server.plans.set('999', { ...plan, id: '999' });
      server.calls.length = 0; op = { ...op, kind: 'remove', workout: null, progress: null };
      await expect(execute()).rejects.toThrow();
      expect(server.calls.every(call => call.method === 'GET')).toBe(true);
      expect(op.artifact).not.toBeNull();
    });
  it.each([false, true])('finishes an already-absent removal without DELETEs (existing null journal=%s)', async existing => {
    const artifact = (await execute())!;
    server.plans.clear(); server.workouts.clear(); server.calls.length = 0;
    op = { ...op, kind: 'remove', workout: null, progress: null };
    if (existing) expect(await recover()).toEqual({ kind: 'resume' });
    expect(await execute()).toBeNull();
    expect(server.calls.map(request => [request.method, request.path])).toEqual([
      ['GET', `/v1/plans/${artifact.ids.plan}`], ['GET', `/v1/workouts/${artifact.ids.workout}`],
      ['GET', '/v1/user'], ['GET', `/v1/plans?external_id=${artifact.ids.externalId}`],
    ]);
    expect(checkpoint).toHaveBeenLastCalledWith(null, {
      version: 1, step: 'finished', state: 'accepted', removalOutcome: 'already_absent',
    });
    expect(transport.inspection.policy.authoritativeAbsenceKeys).toEqual([]);
    expect(transport.inspection.policy.repairReadyKeys).toEqual([]);
  });
  it('removes only the verified Plan when its retained Workout is already absent', async () => {
    const artifact = (await execute())!; server.workouts.clear(); server.calls.length = 0;
    op = { ...op, kind: 'remove', workout: null, progress: null };
    expect(await execute()).toBeNull();
    expect(server.calls.filter(request => request.method === 'DELETE').map(request => request.path))
      .toEqual([`/v1/plans/${artifact.ids.plan}`]);
    expect(checkpoint).toHaveBeenCalledWith(expect.objectContaining({ ids: {
      plan: artifact.ids.plan, externalId: artifact.ids.externalId, workoutToken: artifact.ids.workoutToken,
    } }), { version: 1, step: 'workout-remove', state: 'accepted', removalOutcome: 'already_absent' });
    expect(checkpoint).toHaveBeenLastCalledWith(null, { version: 1, step: 'finished', state: 'accepted' });
  });
  it('keeps a missing Plan / present Workout unresolved without a live owned association', async () => {
    const artifact = (await execute())!; server.plans.clear(); server.calls.length = 0;
    op = { ...op, kind: 'remove', workout: null, progress: null };
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain', diagnostics: { wahooContractCheck: 'association_not_confirmed' } });
    expect(server.calls.map(request => request.path)).toContain(`/v1/workouts/${artifact.ids.workout}`);
    expect(server.calls.every(request => request.method === 'GET')).toBe(true);
    expect(op.artifact).toEqual(artifact);
  });
  it.each([
    [401, '{"error":"fixture"}'], [403, '{}'], [429, '{}'], [500, '{}'], [408, '{}'],
    [200, 'not json'], [200, 'null'], [200, '{}'], [200, '[{"id":321}]'], [404, '{}'],
  ] as const)('does not accept missing copies when the catalog probe returns %s / %s', async (status, body) => {
    const artifact = (await execute())!; server.plans.clear(); server.workouts.clear(); server.calls.length = 0;
    op = { ...op, kind: 'remove', workout: null, progress: null }; vi.mocked(checkpoint).mockClear();
    const fetcher = vi.fn<typeof fetch>(async input => {
      const path = new URL(String(input)).pathname;
      return path === '/v1/user' ? new Response('{"id":123}', { status: 200 })
        : new URL(String(input)).search ? new Response(body, { status }) : new Response(null, { status: 404 });
    });
    transport = new WahooTrainingTransport(createWahooTrainingClient(async () => ({
      account: '123', accessToken: 'synthetic', assertCurrent: async () => {},
    }), fetcher), () => now);
    await expect(execute()).rejects.toThrow();
    expect(op.artifact).toEqual(artifact); expect(op.progress).toBeNull(); expect(checkpoint).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });
  it.each(['different-account', 'network', 'credential-rotated'] as const)('rejects absence after %s without changing retained evidence', async failure => {
    const artifact = (await execute())!; server.plans.clear(); server.workouts.clear();
    op = { ...op, kind: 'remove', workout: null, progress: null }; vi.mocked(checkpoint).mockClear();
    const fetcher = vi.fn<typeof fetch>(async input => {
      if (new URL(String(input)).pathname === '/v1/user') {
        if (failure === 'network') throw new Error('Synthetic connection failure');
        return new Response('{"id":321}', { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    transport = new WahooTrainingTransport(createWahooTrainingClient(async () => ({
      account: '123', accessToken: 'synthetic', assertCurrent: async () => {
        if (failure === 'credential-rotated') throw new WahooTrainingHttpError('retryable', true);
      },
    }), fetcher), () => now);
    await expect(execute()).rejects.toThrow();
    expect(op.artifact).toEqual(artifact); expect(checkpoint).not.toHaveBeenCalled();
  });
  it('requires a previously confirmed pair, not an incomplete upload receipt', async () => {
    const artifact = (await execute())!; server.plans.clear(); server.workouts.clear();
    delete artifact.ids.association; op = { ...op, kind: 'remove', workout: null, progress: null }; vi.mocked(checkpoint).mockClear();
    await expect(execute()).rejects.toMatchObject({ diagnostics: { wahooContractCheck: 'retained_ownership_unknown' } });
    expect(checkpoint).not.toHaveBeenCalled(); expect(op.artifact).toEqual(artifact);
  });
  it.each(['completed', 'unknown-summary', 'moved-date', 'wrong-token', 'wrong-plan'] as const)(
    'keeps a surviving Workout protected or unresolved with %s even when its Plan is missing', async condition => {
      const artifact = (await execute())!; const workout = server.workouts.get(artifact.ids.workout)!;
      server.plans.clear(); server.calls.length = 0;
      if (condition === 'completed') workout.workout_summary = { id: 999 };
      if (condition === 'unknown-summary') delete workout.workout_summary;
      if (condition === 'moved-date') workout.starts = '2026-10-26T10:00:00Z';
      if (condition === 'wrong-token') workout.workout_token = 'unowned';
      if (condition === 'wrong-plan') workout.plan_id = '999';
      op = { ...op, kind: 'remove', workout: null, progress: null };
      await expect(execute()).rejects.toThrow();
      expect(server.calls.every(request => request.method === 'GET')).toBe(true);
      expect(op.artifact?.ids).toEqual(artifact.ids);
      if (condition === 'completed') expect(op.artifact?.completed).toBe(true);
    });
  it.each(['cached-completion', 'past', 'unknown-journal', 'upload-journal', 'quarantined'] as const)(
    'cannot turn %s into already-absent success', async condition => {
      const artifact = (await execute())!; server.plans.clear(); server.workouts.clear(); server.calls.length = 0;
      op = { ...op, kind: 'remove', workout: null, progress: null }; vi.mocked(checkpoint).mockClear();
      if (condition === 'cached-completion') artifact.completed = true;
      if (condition === 'past') artifact.localDate = '2026-10-24';
      if (condition === 'unknown-journal') op.progress = undefined;
      if (condition === 'upload-journal') op.progress = { version: 1, step: 'workout-create', state: 'started' };
      if (condition === 'quarantined') op.recoveryBlocked = true;
      await expect(execute()).rejects.toThrow();
      expect(checkpoint).not.toHaveBeenCalled(); expect(server.calls).toHaveLength(0);
    });
  it('does not use missing retained copies to create an upsert replacement', async () => {
    const artifact = (await execute())!; server.plans.clear(); server.workouts.clear(); server.calls.length = 0;
    next();
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(op.artifact).toEqual(artifact); expect(server.calls.every(request => request.method === 'GET')).toBe(true);
  });
  it.each(['workout', 'plan'] as const)('rechecks a %s DELETE that was not applied before retrying the same owned resource', async resource => {
    const artifact = (await execute())!; server.calls.length = 0;
    op = { ...op, kind: 'remove', workout: null, progress: null };
    server.beforeHandle = async request => {
      if (request.method === 'DELETE' && request.path.includes(`/${resource}s/`)) {
        server.beforeHandle = null; throw new WahooTrainingHttpError('uncertain', false);
      }
    };
    await expect(execute()).rejects.toThrow();
    expect(op.progress).toMatchObject({ step: `${resource}-remove`, state: 'started' });
    expect(await recover()).toEqual({ kind: 'resume' });
    expect(op.progress).toMatchObject({ step: `${resource}-remove`, state: 'ready' });
    expect(op.progress?.removalOutcome).toBeUndefined();
    expect(await execute()).toBeNull();
    expect(server.calls.filter(request => request.method === 'DELETE').map(request => request.path))
      .toEqual([`/v1/workouts/${artifact.ids.workout}`, `/v1/plans/${artifact.ids.plan}`]);
    expect(server.plans.size).toBe(0); expect(server.workouts.size).toBe(0);
  });
  it.each(WAHOO_SPORT_FIXTURES)('confirms $sport family/location independently of Workout type, preserving IDs through edit/reschedule', async ({ sport, family, type, location }) => {
    next({ structure: { ...op.workout!.structure, sport } });
    const first = (await execute())!;
    expect(server.plans.get(first.ids.plan)).toMatchObject({ workout_type_family_id: family, workout_type_location_id: location });
    expect(server.workouts.get(first.ids.workout)?.workout_type_id).toBe(type);
    next({ title: 'Edited walk', localDate: '2026-10-31', updatedAtMs: now });
    expect((await execute())!.ids).toEqual(first.ids);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
  });
  it.each(WAHOO_SPORT_FIXTURES)('rejects $sport Plan readback with the wrong family before Workout creation', async ({ sport, family }) => {
    next({ structure: { ...op.workout!.structure, sport } });
    server.afterHandle = async request => { if (request.method === 'POST' && request.path === '/v1/plans') {
      server.afterHandle = null; [...server.plans.values()][0].workout_type_family_id = family === 6 ? 1 : 6;
    } };
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(op.artifact?.ids.plan).toBeTruthy();
    expect(server.workouts.size).toBe(0);
  });
  it.each(WAHOO_SPORT_FIXTURES)('rejects $sport Plan readback with the wrong location before Workout creation', async ({ sport, location }) => {
    next({ structure: { ...op.workout!.structure, sport } });
    server.afterHandle = async request => { if (request.method === 'POST' && request.path === '/v1/plans') {
      server.afterHandle = null; [...server.plans.values()][0].workout_type_location_id = location === 0 ? 1 : 0;
    } };
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(server.workouts.size).toBe(0);
  });
  it.each(WAHOO_SPORT_FIXTURES.flatMap(row => ['/v1/plans', '/v1/workouts'].map(path => ({ ...row, path }))))('recovers $sport after lost $path acceptance without a replacement POST', async ({ sport, family, location, path }) => {
    next({ structure: { ...op.workout!.structure, sport } });
    server.afterHandle = async request => { if (request.method === 'POST' && request.path === path) {
      server.afterHandle = null; throw new WahooTrainingHttpError('uncertain', false);
    } };
    await expect(execute()).rejects.toThrow();
    if ((await recover()).kind === 'resume') await execute();
    expect(server.plans.size).toBe(1); expect(server.workouts.size).toBe(1);
    expect(server.plans.values().next().value).toMatchObject({ workout_type_family_id: family, workout_type_location_id: location });
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
  });
  it('delivers Gym strength, updates load instructions and reschedules without changing identities, then stops both resources', async () => {
    timedStrength();
    const first = (await execute())!;
    expect(server.plans.get(first.ids.plan)).toMatchObject({ workout_type_family_id: 6, workout_type_location_id: 0 });
    expect(server.workouts.get(first.ids.workout)).toMatchObject({ workout_type_id: 42, minutes: 5 });
    op.strength!.exercises[0].sets[0].externalLoadKg = 2.5;
    next({ localDate: '2026-10-31', updatedAtMs: now });
    expect((await execute())!.ids).toEqual(first.ids);
    expect(JSON.stringify(server.plans.get(first.ids.plan)?.fixtureRecipe)).toContain('load guidance: 2.5 kg');
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
    op = { ...op, kind: 'remove', workout: null, strength: null, progress: null };
    expect(await execute()).toBeNull();
    expect(server.plans.size).toBe(0); expect(server.workouts.size).toBe(0);
  });
  it.each(['/v1/plans', '/v1/workouts'])('recovers timed strength after a lost %s POST response without duplicates', async path => {
    timedStrength();
    server.afterHandle = async request => { if (request.method === 'POST' && request.path === path) {
      server.afterHandle = null; throw new WahooTrainingHttpError('uncertain', false);
    } };
    await expect(execute()).rejects.toThrow();
    if ((await recover()).kind === 'resume') await execute();
    expect(server.plans.size).toBe(1); expect(server.workouts.size).toBe(1);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
    expect([...server.workouts.values()][0].workout_type_id).toBe(42);
  });
  it('rejects a load-only stale digest, missing companion and repetition sets before execute or recovery I/O', async () => {
    timedStrength();
    op.strength!.exercises[0].sets[0].externalLoadKg = 2.5;
    await expect(execute()).rejects.toMatchObject({ kind: 'terminal' });
    await expect(recover()).rejects.toMatchObject({ kind: 'terminal' });
    next(); op.strength = null;
    await expect(execute()).rejects.toMatchObject({ kind: 'terminal' });
    await expect(recover()).rejects.toMatchObject({ kind: 'terminal' });
    timedStrength(); op.strength!.exercises[0].sets[0].ending = { kind: 'repetitions', repetitions: 5 };
    next({ structure: projectStrengthWorkoutToV1(op.strength) });
    await expect(execute()).rejects.toMatchObject({ kind: 'terminal' });
    expect(server.calls).toHaveLength(0);
  });
  it('does not accept a Gym Plan rewritten as running, even with the correct retained identity', async () => {
    timedStrength();
    server.afterHandle = async request => { if (request.method === 'POST' && request.path === '/v1/plans') {
      server.afterHandle = null; [...server.plans.values()][0].workout_type_family_id = 1;
    } };
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(server.workouts.size).toBe(0);
    expect(op.artifact?.ids.plan).toBeTruthy();
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
  it('accepts Plan readback that truncates provider_updated_at to whole seconds', async () => {
    op.workout = { ...op.workout!, updatedAtMs: 1_700_000_000_503 };
    op.digest = transport.assess(op.workout, op.destinationKey, op.timeZone).digest;
    server.afterHandle = async request => {
      if (request.method !== 'POST' || request.path !== '/v1/plans') return;
      const plan = [...server.plans.values()][0];
      plan.provider_updated_at = new Date(Math.trunc(op.workout!.updatedAtMs / 1000) * 1000).toISOString();
      server.afterHandle = null;
    };
    const accepted = await execute();
    expect(accepted?.ids.association).toBe(`${accepted?.ids.workout}:${accepted?.ids.plan}`);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
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
  it.each(['workout', 'plan'])('recovers observed absence after a lost %s DELETE acknowledgement without asserting a fresh DELETE', async resource => {
    await execute(); op = { ...op, kind: 'remove', workout: null, progress: null };
    server.afterHandle = async request => { if (request.method === 'DELETE' && request.path.includes(`/${resource}s/`)) {
      server.afterHandle = null; throw new WahooTrainingHttpError('uncertain', false);
    } };
    await expect(execute()).rejects.toThrow();
    if (resource === 'workout') {
      expect(await recover()).toEqual({ kind: 'resume' });
      expect(op.progress).toMatchObject({ step: 'workout-remove', state: 'accepted', removalOutcome: 'already_absent' });
      expect(server.plans.size).toBe(1);
      expect(await execute()).toBeNull();
    } else {
      expect(await recover()).toEqual({ kind: 'accepted', artifact: null });
      expect(op.progress).toMatchObject({ step: 'finished', state: 'accepted', removalOutcome: 'already_absent' });
    }
    expect(server.calls.filter(request => request.method === 'DELETE')).toHaveLength(2);
    expect(server.plans.size).toBe(0); expect(server.workouts.size).toBe(0);
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
  it.each([
    ['plan-missing', 'association_not_confirmed'], ['plan-id', 'plan_identity_mismatch'], ['plan-id-invalid', 'plan_response_invalid'],
    ['plan-owner', 'plan_ownership_mismatch'], ['plan-deleted', 'plan_deleted'], ['plan-state-unknown', 'plan_deletion_state_unknown'],
    ['workout-id', 'workout_identity_mismatch'], ['workout-id-invalid', 'workout_response_invalid'],
    ['token', 'workout_ownership_mismatch'], ['summary-missing', 'workout_completion_unknown'], ['summary-invalid', 'workout_completion_unknown'],
    ['completed', 'workout_completed'], ['past', 'workout_in_past'], ['date-invalid', 'workout_date_invalid'], ['moved', 'workout_date_changed'],
    ['association', 'workout_plan_mismatch'], ['association-invalid', 'workout_plan_mismatch'], ['association-missing', 'association_not_confirmed'],
  ])('labels the %s removal guard without changing uncertainty or making a destructive request', async (scenario, reason) => {
    const artifact = (await execute())!;
    const plan = server.plans.get(artifact.ids.plan)!; const workout = server.workouts.get(artifact.ids.workout)!;
    if (scenario === 'plan-missing') server.plans.delete(artifact.ids.plan);
    if (scenario === 'plan-id') plan.id = '999';
    if (scenario === 'plan-id-invalid') plan.id = 'private-id';
    if (scenario === 'plan-owner') plan.external_id = 'private-owner';
    if (scenario === 'plan-deleted') plan.deleted = true;
    if (scenario === 'plan-state-unknown') delete plan.deleted;
    if (scenario === 'workout-id') workout.id = '999';
    if (scenario === 'workout-id-invalid') workout.id = 'private-id';
    if (scenario === 'token') workout.workout_token = 'private-token';
    if (scenario === 'summary-missing') delete workout.workout_summary;
    if (scenario === 'summary-invalid') workout.workout_summary = { id: 'private-summary' };
    if (scenario === 'completed') workout.workout_summary = { id: 42 };
    if (scenario === 'past') workout.starts = '2026-10-24T10:00:00Z';
    if (scenario === 'date-invalid') workout.starts = 'private-date';
    if (scenario === 'moved') workout.starts = '2026-10-30T10:00:00Z';
    if (scenario === 'association') workout.plan_id = '999';
    if (scenario === 'association-invalid') workout.plan_ids = ['private-plan'];
    const client: typeof server.request = scenario === 'association-missing'
      ? async (request, beforeSend) => {
        if (request.path.endsWith('/plans')) { await beforeSend(); return { status: 200, body: [] }; }
        return server.request(request, beforeSend);
      } : server.request;
    transport = new WahooTrainingTransport(client, () => now);
    const writes = server.calls.filter(call => call.method !== 'GET').length;
    op = { ...op, kind: 'remove', workout: null, progress: null };
    let failure: unknown;
    try { await execute(); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ kind: 'uncertain', diagnostics: { failurePhase: 'contract', wahooContractCheck: reason } });
    expect(JSON.stringify(failure)).not.toContain('private');
    expect(server.calls.filter(call => call.method !== 'GET')).toHaveLength(writes);
    expect(op.artifact?.ids).toEqual(artifact.ids);
    expect(op.progress).toBeNull();
  });
  it.each(['workout', 'plan'])('labels ambiguous %s DELETE 404 without assuming successful removal', async resource => {
    const artifact = (await execute())!;
    server.beforeHandle = async request => {
      if (request.method === 'DELETE' && request.path === `/v1/${resource}s/${artifact.ids[resource]}`) {
        (resource === 'workout' ? server.workouts : server.plans).delete(artifact.ids[resource]);
      }
    };
    op = { ...op, kind: 'remove', workout: null, progress: null };
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain', diagnostics: {
      failurePhase: 'contract', wahooContractCheck: `${resource}_delete_not_found`,
    } });
    expect(op.artifact?.ids[resource]).toBe(artifact.ids[resource]);
    if (resource === 'workout') {
      expect(await recover()).toEqual({ kind: 'resume' });
      expect(server.plans.size).toBe(1);
    } else expect(await recover()).toEqual({ kind: 'accepted', artifact: null });
  });
  it('preserves HTTP failure diagnostics instead of relabeling them as contract checks', async () => {
    await execute(); op = { ...op, kind: 'remove', workout: null, progress: null };
    const error = new WahooTrainingHttpError('retryable', false, 60_000, { httpStatus: 500, failurePhase: 'response' });
    transport = new WahooTrainingTransport(async () => { throw error; }, () => now);
    await expect(execute()).rejects.toBe(error);
    expect(error.diagnostics).toEqual({ httpStatus: 500, failurePhase: 'response' });
  });
  it('removes an exactly owned past Workout and Plan after explicit authorization', async () => {
    const artifact = (await execute())!;
    transport = new WahooTrainingTransport(server.request, () => Date.parse('2026-10-28T12:00:00Z'));
    op = { ...op, kind: 'remove', workout: null, progress: null, allowPastRemoval: true };
    expect(await execute()).toBeNull();
    expect(server.workouts.has(artifact.ids.workout)).toBe(false);
    expect(server.plans.has(artifact.ids.plan)).toBe(false);
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
