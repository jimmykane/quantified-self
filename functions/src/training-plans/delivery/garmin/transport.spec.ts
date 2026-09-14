import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import { GarminTrainingTransport } from './transport';
import { GarminTrainingHttpError } from './http';
import { GarminHttpFixture } from '../test-support/garmin-http-fixture';
import type { DeliveryArtifact, DeliveryCheckpoint, DeliveryOperation, DeliveryTransportProgress } from '../contracts';

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
  });
  const execute = () => transport.execute(operation, checkpoint, guard);
  const recover = () => transport.recover(operation, checkpoint, guard);
  const writes = () => server.calls.filter(call => call.method !== 'GET');

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
    checkpoint = async (artifact, progress) => {
      if (progress?.step === 'workout-create' && progress.state === 'accepted') throw new Error('persistence unavailable');
      return original(artifact, progress);
    };
    await expect(execute()).rejects.toThrow('persistence unavailable');
    expect(operation.artifact).toBeNull(); expect(await recover()).toEqual({ kind: 'uncertain' });
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(0);
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
