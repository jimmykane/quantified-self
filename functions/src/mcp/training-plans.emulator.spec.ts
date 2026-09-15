import { randomUUID } from 'node:crypto';
import { Firestore, DocumentReference, Query } from 'firebase-admin/firestore';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { createFirestoreTrainingReads, readTrainingPlans, type TrainingReadCodec } from './training-plans.service';
import { trainingDeliverySummaryIdentity } from '../../../shared/training-delivery-summary';
import { TRAINING_READ_OUTPUTS, type TrainingReadTool } from './training-plans.schemas';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Training MCP loopback Firestore read transactions', () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw Error('Loopback emulator required');
  const db = new Firestore({ projectId: 'demo-mcp-training-reads' });
  afterAll(async () => { vi.restoreAllMocks(); await db.terminate(); });
  it('reads a full 400-workout, four-service plan in bounded Firestore pages and detects retained-record overflow', async () => {
    const uid = `training-scale-${randomUUID()}`, user = db.collection('users').doc(uid);
    const reads = createFirestoreTrainingReads(() => db);
    const codec: TrainingReadCodec = { encode: value => JSON.stringify(value), decode: value => JSON.parse(value) };
    const run = () => readTrainingPlans({ tool: 'get_training_sync_status',
      arguments: { scope: 'plan', reference: JSON.stringify({ kind: 'plan', id: 'plan', createdAtMs: 1 }) },
      uid, connectionId: 'connection', scopes: ['training-plans:read'] }, reads, codec);
    await user.set({});
    await user.collection('mcpConnections').doc('connection').set({ scopes: ['training-plans:read'], status: 'active' });
    await user.collection('trainingPlanState').doc('current').set({ revision: 1, activePlanId: 'plan' });
    await user.collection('trainingPlans').doc('plan').set({ schemaVersion: 1, name: 'Scale fixture', lifecycle: 'active',
      startLocalDate: '2026-12-01', endLocalDate: '2027-01-31', revision: 1, workoutCount: 400, createdAtMs: 1, updatedAtMs: 1 });
    let batch = db.batch(), pending = 0;
    const queue = async (collection: string, id: string, data: Record<string, unknown>) => {
      batch.set(user.collection(collection).doc(id), data);
      if (++pending === 400) { await batch.commit(); batch = db.batch(); pending = 0; }
    };
    for (let index = 0; index < 400; index++) {
      await queue('scheduledWorkouts', `w${index}`, { schemaVersion: 1, planId: 'plan', localDate: '2027-01-01',
        lifecycle: 'planned', title: 'Scale fixture', revision: 1, createdAtMs: 1, updatedAtMs: 1, structure: { privateCanary: 'PRIVATE' } });
    }
    const status = { planId: 'plan', status: 'delivered', hasRemoteCopy: true, differsFromQS: false,
      timeZone: 'Europe/Helsinki', lastAttemptAtMs: 1, lastAcceptedAtMs: 1, updatedAtMs: 1,
      issues: [{ message: 'PRIVATE' }], approvalDigest: 'PRIVATE', remoteArtifactIds: ['PRIVATE'] };
    for (const provider of ['garmin', 'coros', 'wahoo', 'suunto'] as const) {
      await queue('trainingDeliverySettings', provider, { scope: 'plan', scopeId: 'plan', provider, enabled: true, suppressed: false,
        timeZone: 'Europe/Helsinki', destinationKey: 'private-destination', associationPlanId: null, updatedAtMs: 1, approvedDigest: 'PRIVATE' });
      for (let index = 0; index < 400; index++) {
        const workoutId = `w${index}`;
        const id = await trainingDeliverySummaryIdentity(uid, provider, 'private-destination', workoutId);
        await queue('trainingDeliveryStatuses', id, { ...status, provider, workoutId });
      }
    }
    if (pending) await batch.commit();
    const limit = vi.spyOn(Query.prototype, 'limit');
    const complete = TRAINING_READ_OUTPUTS.get_training_sync_status.parse(await run());
    expect(complete.scanComplete).toBe(true); expect(complete.services).toHaveLength(4);
    expect(complete.services.every(service => service.totalWorkouts === 400 && service.syncedWorkouts === 400)).toBe(true);
    expect(JSON.stringify(complete)).not.toMatch(/PRIVATE|private-destination|issues|Artifact|Digest/);
    expect(limit.mock.calls.every(([size]) => size <= 25)).toBe(true);
    limit.mockRestore();
    await user.collection('trainingDeliveryStatuses').doc('retained').set({ ...status, provider: 'garmin', workoutId: 'previous' });
    const incomplete = TRAINING_READ_OUTPUTS.get_training_sync_status.parse(await run());
    expect(incomplete.scanComplete).toBe(false);
    expect(incomplete.services.every(service => service.syncedWorkouts === null && service.totalWorkouts === null)).toBe(true);
  }, 60_000);

  it('uses masked owner reads, snapshot paging and live consent/deletion fences with no Training writes', async () => {
    const uid = `training-read-${randomUUID()}`, user = db.collection('users').doc(uid);
    const reference = { kind: 'plan', id: 'private-plan-id', createdAtMs: 1 };
    const codec: TrainingReadCodec = { encode: value => JSON.stringify(value), decode: value => JSON.parse(value) };
    const reads = createFirestoreTrainingReads(() => db);
    const run = (tool: TrainingReadTool, args: unknown) => readTrainingPlans({ tool, arguments: args, uid,
      connectionId: 'connection', scopes: ['training-plans:read'] }, reads, codec);
    await user.set({ settings: { unitSettings: {} }, email: 'PRIVATE' });
    await user.collection('mcpConnections').doc('connection').set({ status: 'active', scopes: ['training-plans:read'], grantId: 'grant1', revokedAtMs: null });
    await user.collection('trainingPlanState').doc('current').set({ revision: 1, activePlanId: 'private-plan-id', receipt: 'PRIVATE' });
    await user.collection('trainingPlans').doc('private-plan-id').set({ schemaVersion: 1, id: 'private-plan-id', name: 'Fixture plan', lifecycle: 'active',
      startLocalDate: '2026-12-01', endLocalDate: '2027-01-31', revision: 1, workoutCount: 26,
      createdAtMs: 1, updatedAtMs: 1, lastCheckpointRevision: 1, privateCanary: 'PRIVATE' });
    const batch = db.batch();
    for (let i = 0; i < 26; i++) batch.set(user.collection('scheduledWorkouts').doc(`workout-${i.toString().padStart(2,'0')}`), {
      schemaVersion: 1, planId: 'private-plan-id', localDate: '2027-01-01', lifecycle: 'planned', title: 'Fixture workout',
      revision: 1, createdAtMs: 1, updatedAtMs: 1, privateCanary: 'PRIVATE', structure: { version: 1, sport: ActivityTypes.Running,
        nodes: [{ id: 'step', kind: 'step', purpose: 'work', ending: { kind: 'manual' }, targets: [], note: '日本語 🏃' }] },
    });
    await batch.commit();
    const set = vi.spyOn(DocumentReference.prototype, 'set'), update = vi.spyOn(DocumentReference.prototype, 'update');
    const select = vi.spyOn(Query.prototype, 'select');
    const args = { startDate: '2026-12-31', endDate: '2027-01-01' };
    const first = TRAINING_READ_OUTPUTS.query_planned_workouts.parse(await run('query_planned_workouts', args));
    expect(first.workouts).toHaveLength(25); expect(first.scanComplete).toBe(false);
    const next = TRAINING_READ_OUTPUTS.query_planned_workouts.parse(await run('query_planned_workouts', { ...args, cursor: first.nextCursor }));
    expect(next.workouts).toHaveLength(1); expect(next.scanComplete).toBe(true);
    expect(select.mock.calls.flat()).not.toContain('structure');
    const detail = await run('get_planned_workout', { workoutRef: first.workouts[0].workoutRef });
    expect(JSON.stringify(detail)).toContain('日本語'); expect(JSON.stringify(detail)).not.toContain('PRIVATE');
    const sync = TRAINING_READ_OUTPUTS.get_training_sync_status.parse(await run('get_training_sync_status', { scope:'plan', reference: JSON.stringify(reference) }));
    expect(sync.scanComplete).toBe(true); expect(sync.services).toEqual([]);
    expect(set).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
    set.mockRestore(); update.mockRestore();
    await user.collection('mcpConnections').doc('connection').update({ revokedAtMs: 2 });
    await expect(run('list_training_plans', {})).rejects.toThrow();
    await user.collection('mcpConnections').doc('connection').update({ revokedAtMs: null });
    await user.collection('trainingPlanState').doc('current').collection('planDeletionLocks').doc('lock').set({ privateCanary:'PRIVATE' });
    await expect(run('list_training_plans', {})).rejects.toThrow();
    // Fixtures live only in this disposable emulator; no production cleanup or user data is touched.
  }, 30_000);
});
