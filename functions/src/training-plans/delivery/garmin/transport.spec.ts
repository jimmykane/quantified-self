import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import { GarminTrainingTransport } from './transport';
import { GarminTrainingHttpError } from './http';
import { GarminHttpFixture } from '../test-support/garmin-http-fixture';
import type { DeliveryArtifact, DeliveryCheckpoint, DeliveryOperation, DeliveryTransportProgress } from '../contracts';
import { GARMIN_INSPECTION_POLICY } from './inspection';
import * as logger from 'firebase-functions/logger';
import { observeDeliveryCheckpoint } from '../diagnostics';

describe('Garmin workout/schedule lifecycle, synthetic HTTP only', () => {
  let server: GarminHttpFixture;
  let transport: GarminTrainingTransport;
  let operation: DeliveryOperation;
  let journal: Array<{ artifact: DeliveryArtifact | null; progress?: DeliveryTransportProgress | null }>;
  let checkpoint: DeliveryCheckpoint;
  const guard = vi.fn(async () => {});
  const now = Date.parse('2026-09-14T10:00:00Z');
  const nextOperation = (previous: DeliveryOperation, patch: Partial<ScheduledWorkoutV1> = {}): DeliveryOperation => {
    const workout = { ...previous.workout!, ...patch };
    return { ...previous, id: `${previous.id}-next`, workout, generation: previous.generation + 1, progress: null,
      digest: transport.assess(workout, previous.destinationKey, previous.timeZone).digest };
  };
  beforeEach(() => {
    server = new GarminHttpFixture(); transport = new GarminTrainingTransport(server.request, () => now); journal = [];
    const workout: ScheduledWorkoutV1 = { schemaVersion: 1, id: 'fixture-workout', planId: null, title: 'Synthetic intervals', localDate: '2026-09-15',
      lifecycle: 'planned', revision: 1, createdAtMs: 1, updatedAtMs: 1,
      structure: { version: 1, sport: ActivityTypes.Running,
        nodes: [{ kind: 'step', id: 'step', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [] }] } };
    operation = { id: 'attempt-1', kind: 'upsert', deliveryId: 'stable-delivery', generation: 1, connectionGeneration: 'connection-1',
      destinationKey: 'opaque-account', timeZone: 'Europe/Helsinki', workout, artifact: null, progress: null, contentDigest: 'content',
      digest: transport.assess(workout, 'opaque-account', 'Europe/Helsinki').digest };
    checkpoint = async (artifact, progress) => { journal.push(structuredClone({ artifact, progress })); };
    guard.mockClear();
    vi.mocked(logger.info).mockClear(); vi.mocked(logger.warn).mockClear();
  });
  const execute = () => transport.execute(operation, checkpoint, guard);
  const recover = () => transport.recover(operation, checkpoint, guard);
  const writes = () => server.calls.filter(call => call.method !== 'GET');
  const repair = async (missing: string[]) => {
    const original = structuredClone(operation.artifact!);
    transport = new GarminTrainingTransport(server.request, () => now,
      { ...GARMIN_INSPECTION_POLICY, authoritativeAbsence: true, repairReady: true });
    operation = { ...nextOperation(operation), repair: { policyVersion: GARMIN_INSPECTION_POLICY.version,
      binding: 'synthetic-authority', missing, original } };
  };
  const interruptReplacement = async () => {
    const original = (await execute())!;
    const oldWorkout = structuredClone(server.workouts.get(original.ids.workout)!);
    server.workouts.delete(original.ids.workout); await repair(['workout']);
    server.afterHandle = async request => {
      if (request.method !== 'POST' || !request.path.includes('workout')) return;
      server.afterHandle = null;
      guard.mockRejectedValueOnce(new Error('interrupted before relinking'));
    };
    await expect(execute()).rejects.toThrow('interrupted before relinking');
    expect(operation.artifact!.ids.workout).not.toBe(original.ids.workout);
    expect(operation.artifact!.ids.schedule).toBeUndefined();
    return { original, oldWorkout };
  };
  it('recovers a lost retired-schedule DELETE without losing either workout identity', async () => {
    const { original, oldWorkout } = await interruptReplacement();
    server.workouts.set(original.ids.workout, oldWorkout); // Original copy also reappeared.
    operation = { ...operation, id: 'withdraw-repair', kind: 'remove', workout: null, progress: null };
    server.afterHandle = async request => {
      if (request.method !== 'DELETE') return;
      server.afterHandle = null; throw new GarminTrainingHttpError('uncertain', false);
    };
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(operation.progress).toMatchObject({ step: 'retired-schedule-delete', state: 'started' });
    expect(await recover()).toEqual({ kind: 'resume' });
    expect(await execute()).toBeNull();
    expect(server.workouts.size + server.schedules.size).toBe(0);
    expect(writes().filter(row => row.method === 'DELETE' && row.path.endsWith(original.ids.schedule))).toHaveLength(1);
  });
  it('does not withdraw a retained original association that changed externally', async () => {
    const { original } = await interruptReplacement();
    server.schedules.get(original.ids.schedule)!.date = '2026-09-17';
    operation = { ...operation, id: 'withdraw-repair', kind: 'remove', workout: null, progress: null };
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(writes().filter(row => row.method === 'DELETE')).toHaveLength(0);
  });
  it('never repeats a root POST when a superseded partial repair loses its accepted replacement', async () => {
    await interruptReplacement();
    server.workouts.delete(operation.artifact!.ids.workout);
    operation = { ...nextOperation(operation, { title: 'Latest edit' }), repair: { ...operation.repair!, continuation: true } };
    const before = writes().length;
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(writes()).toHaveLength(before);
  });
  it.each([['schedule'], ['workout'], ['workout', 'schedule']])('repairs confirmed missing %j without replacing surviving identities', async (...missing) => {
    const original = (await execute())!;
    const keys = missing.flat();
    if (keys.includes('workout')) server.workouts.delete(original.ids.workout);
    if (keys.includes('schedule')) server.schedules.delete(original.ids.schedule);
    await repair(keys);
    const result = (await execute())!;
    expect(result.ids.workout === original.ids.workout).toBe(!keys.includes('workout'));
    expect(result.ids.schedule === original.ids.schedule).toBe(!keys.includes('schedule'));
    expect(server.schedules.get(result.ids.schedule)?.workoutId).toBe(result.ids.workout);
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(1);
  });
  it('does not overwrite a provider-side workout edit while repairing only its calendar entry', async () => {
    const original = (await execute())!;
    server.workouts.get(original.ids.workout)!.workoutName = 'Edited in Garmin';
    server.schedules.delete(original.ids.schedule);
    await repair(['schedule']); await execute();
    expect(writes().filter(request => request.method === 'PUT' && request.path.includes('workout'))).toHaveLength(0);
    expect(server.workouts.get(original.ids.workout)!.workoutName).toBe('Edited in Garmin');
  });
  it('blocks unknown replacement POST acceptance, including explicit repeated recovery', async () => {
    const original = (await execute())!; server.workouts.delete(original.ids.workout);
    await repair(['workout']);
    server.afterHandle = async request => { if (request.method === 'POST') throw new GarminTrainingHttpError('uncertain', false); };
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(await recover()).toEqual({ kind: 'uncertain' }); expect(await recover()).toEqual({ kind: 'uncertain' });
    expect(server.workouts.size).toBe(1);
    expect(writes().filter(request => request.method === 'POST' && request.path.includes('workout'))).toHaveLength(2);
  });
  it('does not repair a surviving calendar entry moved externally', async () => {
    const original = (await execute())!; server.workouts.delete(original.ids.workout);
    server.schedules.get(original.ids.schedule)!.date = '2026-09-16';
    await repair(['workout']);
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(writes()).toHaveLength(2);
  });
  it('rechecks the original identity before retrying a rejected replacement create', async () => {
    const original = (await execute())!;
    const oldWorkout = server.workouts.get(original.ids.workout)!; server.workouts.delete(original.ids.workout);
    await repair(['workout']);
    server.beforeHandle = async request => { if (request.method === 'POST') throw new GarminTrainingHttpError('retryable', true, 9000); };
    await expect(execute()).rejects.toMatchObject({ kind: 'retryable' });
    expect(operation.progress?.state).toBe('rejected');
    server.beforeHandle = null; server.workouts.set(original.ids.workout, oldWorkout);
    expect(await recover()).toEqual({ kind: 'not-accepted' });
    const before = writes().length;
    expect(await execute()).toEqual(original); expect(writes()).toHaveLength(before);
    expect(server.workouts.size).toBe(1);
  });
  it('keeps unproved production 404s non-authoritative and reports ownership conflicts separately', async () => {
    const artifact = (await execute())!;
    const inspect = () => transport.inspection.inspect({ artifact, destinationKey: 'opaque-account',
      connectionGeneration: 'connection-1', timeZone: 'Europe/Helsinki', cursor: null }, guard);
    expect((await inspect()).artifacts.every(item => item.state === 'present')).toBe(true);
    const noOwner = { ...artifact, ids: { workout: artifact.ids.workout, schedule: artifact.ids.schedule } };
    expect((await transport.inspection.inspect({ artifact: noOwner, destinationKey: 'opaque-account',
      connectionGeneration: 'connection-1', timeZone: 'Europe/Helsinki', cursor: null }, guard)).conflict).toBe(false);
    server.schedules.delete(artifact.ids.schedule);
    expect((await inspect()).artifacts.find(item => item.key === 'schedule')).toEqual({ key: 'schedule', state: 'absent', authoritative: false });
    server.workouts.get(artifact.ids.workout)!.ownerId = '1234';
    expect((await inspect()).conflict).toBe(true);
    expect(transport.inspection.policy.repairReady).toBe(false);
  });
  it('reuses a reappearing original schedule after a rejected replacement POST', async () => {
    const original = (await execute())!;
    const oldSchedule = server.schedules.get(original.ids.schedule)!;
    server.schedules.delete(original.ids.schedule); await repair(['schedule']);
    server.beforeHandle = async request => { if (request.method === 'POST') throw new GarminTrainingHttpError('retryable', true); };
    await expect(execute()).rejects.toMatchObject({ kind: 'retryable' });
    expect(operation.progress).toMatchObject({ step: 'schedule-create', state: 'rejected' });
    server.beforeHandle = null; server.schedules.set(original.ids.schedule, oldSchedule);
    expect(await recover()).toEqual({ kind: 'resume' });
    const count = writes().length;
    expect((await execute())?.ids).toEqual(original.ids);
    expect(operation.progress).toMatchObject({ state: 'accepted', repairApplied: false });
    expect(writes()).toHaveLength(count);
    expect(server.schedules.size).toBe(1);
  });
  it('keeps malformed lookup identities inconclusive instead of requiring conflict resolution', async () => {
    const artifact = (await execute())!;
    const malformed = new GarminTrainingTransport(async () => ({ status: 200, body: {} }), () => now);
    expect(await malformed.inspection.inspect({ artifact, destinationKey: 'opaque-account', connectionGeneration: 'connection-1',
      timeZone: 'Europe/Helsinki', cursor: null }, guard)).toEqual({ conflict: false, artifacts: [
      { key: 'workout', state: 'unknown', authoritative: false }, { key: 'schedule', state: 'unknown', authoritative: false },
    ] });
  });

  it('creates two artifacts with durable checkpoints and reuses both identities through edits, reschedule and removal', async () => {
    const first = await execute();
    expect(Object.keys(first!.ids).sort()).toEqual(['owner', 'schedule', 'workout']);
    expect(journal.some(entry => entry.progress?.step === 'workout-create' && entry.progress.state === 'accepted' && !entry.artifact?.ids.schedule)).toBe(true);
    operation = nextOperation(operation, { title: 'Changed', localDate: '2027-01-01' });
    expect((await execute())?.ids).toEqual(first!.ids);
    expect(writes().map(call => call.method)).toEqual(['POST', 'POST', 'PUT', 'PUT']);
    operation = { ...operation, id: 'remove', kind: 'remove', workout: null, progress: null };
    await execute();
    expect(writes().slice(-2).map(call => call.path)).toEqual([`/training-api/schedule/${first!.ids.schedule}`, `/training-api/workout/v2/${first!.ids.workout}`]);
    expect(server.workouts.size + server.schedules.size).toBe(0);
    expect(await recover()).toEqual({ kind: 'accepted', artifact: null });
  });
  it('reschedules without rewriting unchanged content; duplicate completion has no duplicate POST', async () => {
    await execute();
    operation = nextOperation(operation, { localDate: '2026-10-25' });
    await execute(); await execute();
    expect(writes().map(call => call.method)).toEqual(['POST', 'POST', 'PUT']);
    expect([...server.schedules.values()][0].date).toBe('2026-10-25');
    expect(server.workouts.size).toBe(1);
  });
  it('fails closed after a lost first-create response, including repeated recovery', async () => {
    server.afterHandle = async request => { if (request.method === 'POST') throw new GarminTrainingHttpError('uncertain', false); };
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(operation.progress).toMatchObject({ step: 'workout-create', state: 'started' });
    expect(await recover()).toEqual({ kind: 'uncertain' });
    expect(await recover()).toEqual({ kind: 'uncertain' });
    expect(server.workouts.size).toBe(1); expect(writes()).toHaveLength(1);
  });
  it('never continues after provider acceptance when its artifact checkpoint fails', async () => {
    const original = checkpoint;
    checkpoint = (artifact, progress) => observeDeliveryCheckpoint('garmin', false, progress, async () => {
      if (progress?.step === 'workout-create' && progress.state === 'accepted') throw new Error('persistence unavailable');
      return original(artifact, progress);
    });
    await expect(execute()).rejects.toThrow('persistence unavailable');
    expect(operation.artifact).toBeNull(); expect(await recover()).toEqual({ kind: 'uncertain' });
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(0);
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({ event: 'garmin_response', resource: 'workout', httpStatus: 200 }));
    expect(logger.warn).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({ event: 'checkpoint_failed', checkpointState: 'accepted', complete: false }));
  });
  it('recovers an accepted schedule by exact workout ID and local date without repeating either POST', async () => {
    server.afterHandle = async request => { if (request.method === 'POST' && request.path.includes('schedule')) throw new GarminTrainingHttpError('uncertain', false); };
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    server.afterHandle = null;
    expect(await recover()).toEqual({ kind: 'resume' });
    await execute();
    expect(writes().map(call => call.method)).toEqual(['POST', 'POST']);
    expect(operation.artifact?.ids.schedule).toBeDefined();
  });
  it('finishes a documented empty schedule-create success through immediate exact-ID inspection', async () => {
    transport = new GarminTrainingTransport(async (request, beforeSend) => {
      const result = await server.request(request, beforeSend);
      return request.method === 'POST' && request.path === '/training-api/schedule/' ? { status: 204, body: null } : result;
    }, () => now);
    const result = await execute();
    expect(result?.ids.schedule).toBeDefined();
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(1);
    expect(writes()).toHaveLength(2);
    expect(server.calls.at(-1)?.path).toBe('/training-api/schedule?startDate=2026-09-15&endDate=2026-09-15');
    expect(operation.progress).toMatchObject({ step: 'finished', state: 'accepted' });
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({ event: 'garmin_response', resource: 'schedule', httpStatus: 204, responseShape: 'null' }));
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', { event: 'garmin_schedule_lookup', provider: 'garmin', outcome: 'matched' });
  });
  it.each(['empty', 'duplicate'] as const)('retains an empty-success POST journal when immediate inspection is %s, never repeating create', async mode => {
    transport = new GarminTrainingTransport(async (request, beforeSend) => {
      const result = await server.request(request, beforeSend);
      if (request.method === 'POST' && request.path === '/training-api/schedule/') {
        if (mode === 'empty') server.schedules.clear();
        else server.schedules.set('123', { ...[...server.schedules.values()][0], scheduleId: '123' });
        return { status: 204, body: null };
      }
      return result;
    }, () => now);
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(operation.progress).toMatchObject({ step: 'schedule-create', state: 'started' });
    expect(await recover()).toEqual({ kind: 'uncertain' });
    expect(writes()).toHaveLength(2);
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', { event: 'garmin_schedule_lookup', provider: 'garmin', outcome: mode === 'empty' ? 'no_match' : 'multiple_matches' });
  });
  it.each(['empty', 'duplicate'] as const)('does not infer schedule POST nonacceptance from an %s lookup', async mode => {
    server.afterHandle = async request => { if (request.path === '/training-api/schedule/') throw new GarminTrainingHttpError('uncertain', false); };
    await expect(execute()).rejects.toThrow();
    const row = [...server.schedules.values()][0]; server.afterHandle = null;
    if (mode === 'empty') server.schedules.clear(); else server.schedules.set('42', { ...row, scheduleId: '42' });
    expect(await recover()).toEqual({ kind: 'uncertain' });
    expect(writes()).toHaveLength(2);
  });
  it.each([401, 412, 429])('journals definitive rejection %s and can resume the same intent safely', async status => {
    server.beforeHandle = async () => { throw new GarminTrainingHttpError(status === 401 ? 'auth' : status === 412 ? 'permission' : 'retryable', true); };
    await expect(execute()).rejects.toThrow();
    expect(operation.progress?.state).toBe('rejected');
    expect(await recover()).toEqual({ kind: 'not-accepted' });
    server.beforeHandle = null; await execute();
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(1);
  });
  it('retains a workout-only checkpoint after schedule rejection and resumes without a replacement workout', async () => {
    server.beforeHandle = async request => { if (request.path === '/training-api/schedule/') throw new GarminTrainingHttpError('retryable', true); };
    await expect(execute()).rejects.toThrow();
    expect(operation.artifact?.ids.workout).toBeDefined(); expect(operation.artifact?.ids.schedule).toBeUndefined();
    expect(await recover()).toEqual({ kind: 'resume' });
    server.beforeHandle = null; await execute();
    expect(server.workouts.size).toBe(1);
    expect(server.calls.filter(call => call.path === '/workoutportal/workout/v2')).toHaveLength(1);
  });
  it('recovers lost PUT and DELETE acknowledgements using retained IDs', async () => {
    await execute(); operation = nextOperation(operation, { title: 'Updated' });
    server.afterHandle = async request => { if (request.method === 'PUT') throw new GarminTrainingHttpError('uncertain', false); };
    await expect(execute()).rejects.toThrow(); server.afterHandle = null;
    expect(await recover()).toEqual({ kind: 'resume' }); await execute();
    expect(writes().filter(call => call.method === 'PUT')).toHaveLength(1);
    operation = { ...operation, id: 'remove', kind: 'remove', workout: null, progress: null };
    server.afterHandle = async request => { if (request.method === 'DELETE') throw new GarminTrainingHttpError('uncertain', false); };
    await expect(execute()).rejects.toThrow(); server.afterHandle = null;
    expect(await recover()).toEqual({ kind: 'resume' }); await execute();
    expect(writes().filter(call => call.method === 'DELETE')).toHaveLength(2);
  });
  it('recovers final journal acceptance without another provider call', async () => {
    await execute(); const count = server.calls.length;
    expect(await recover()).toEqual({ kind: 'accepted', artifact: operation.artifact });
    expect(server.calls).toHaveLength(count);
  });
  it.each(['schedule', 'workout'] as const)('retains the %s identity when a successful lookup has no record body', async target => {
    await execute();
    if (target === 'workout') delete operation.artifact!.ids.schedule;
    operation = { ...operation, kind: 'remove', workout: null, progress: null };
    const artifact = structuredClone(operation.artifact);
    const client = vi.fn(async () => ({ status: 200, body: null }));
    transport = new GarminTrainingTransport(client, () => now);
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(operation.artifact).toEqual(artifact);
    operation.progress = { version: 1, step: `${target}-delete`, state: 'started' };
    await expect(recover()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(operation.artifact).toEqual(artifact);
    expect(client.mock.calls).toHaveLength(2);
  });
  it('requires a schedule record for PUT 200 and only accepts an empty PUT 204', async () => {
    await execute(); operation = nextOperation(operation, { localDate: '2026-10-25' });
    const artifact = structuredClone(operation.artifact);
    transport = new GarminTrainingTransport(async (request, beforeSend) => {
      if (request.method === 'PUT') { await beforeSend(); return { status: 200, body: null }; }
      return server.request(request, beforeSend);
    }, () => now);
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(operation.artifact).toEqual(artifact);
    expect(operation.progress).toMatchObject({ step: 'schedule-update', state: 'started' });
    expect(logger.warn).toHaveBeenCalledWith('[TrainingDelivery]', { event: 'garmin_contract_failure', provider: 'garmin', reason: 'expected_object' });
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({ event: 'garmin_response', method: 'PUT', resource: 'schedule', httpStatus: 200, responseShape: 'null' }));
  });
  it.each(['invalid', 'mismatched'] as const)('diagnoses a %s schedule response while retaining the started journal', async mode => {
    transport = new GarminTrainingTransport(async (request, beforeSend) => {
      const response = await server.request(request, beforeSend);
      return request.path === '/training-api/schedule/' ? { status: 200, body: mode === 'invalid'
        ? { scheduleId: 'private-invalid-id', workoutId: operation.artifact!.ids.workout, date: operation.workout!.localDate }
        : { scheduleId: '1', workoutId: '2', date: operation.workout!.localDate } } : response;
    }, () => now);
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain', diagnostics: { failurePhase: 'contract' } });
    expect(operation.progress).toMatchObject({ step: 'schedule-create', state: 'started' });
    expect(logger.warn).toHaveBeenCalledWith('[TrainingDelivery]', { event: 'garmin_contract_failure', provider: 'garmin',
      reason: mode === 'invalid' ? 'invalid_schedule' : 'schedule_identity_mismatch' });
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('private');
    expect(await recover()).toEqual({ kind: 'resume' });
    await execute(); expect(writes()).toHaveLength(2);
  });
  it('treats legacy operations without a transport journal as uncertain', async () => {
    delete operation.progress;
    expect(await recover()).toEqual({ kind: 'uncertain' });
    await expect(execute()).rejects.toThrow(); expect(server.calls).toHaveLength(0);
  });
  it.each(['past', 'completed'] as const)('does not touch %s copies', async state => {
    await execute(); server.calls = [];
    operation = { ...operation, kind: 'remove', workout: null, progress: null };
    if (state === 'past') operation.artifact!.localDate = '2026-09-13'; else operation.artifact!.completed = true;
    await expect(execute()).rejects.toThrow(); expect(server.calls).toHaveLength(0);
  });
  it('detects provider rescheduling into the past before updating content', async () => {
    await execute(); server.calls = [];
    server.schedules.get(operation.artifact!.ids.schedule)!.date = '2026-09-13';
    operation = nextOperation(operation, { title: 'New title' });
    await expect(execute()).rejects.toThrow(); expect(writes()).toHaveLength(0);
    expect(journal.at(-1)?.artifact?.localDate).toBe('2026-09-13');
  });
  it('stops between artifact operations when admission changes', async () => {
    let allow = true;
    server.afterHandle = async request => { if (request.path === '/workoutportal/workout/v2') allow = false; };
    await expect(transport.execute(operation, checkpoint, async () => { if (!allow) throw new Error('stale intent'); })).rejects.toThrow('stale intent');
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(0);
    expect(operation.artifact?.ids.workout).toBeDefined();
  });
  it('rejects changed ownership, unsupported recipes and mismatched approval digests', async () => {
    await execute(); server.calls = [];
    server.workouts.get(operation.artifact!.ids.workout)!.ownerId = '999';
    operation = nextOperation(operation, { title: 'Changed' });
    await expect(execute()).rejects.toThrow(); expect(writes()).toHaveLength(0);
    operation.artifact = null; operation.digest = 'unapproved-digest';
    await expect(execute()).rejects.toMatchObject({ kind: 'terminal' }); expect(writes()).toHaveLength(0);
  });
});
