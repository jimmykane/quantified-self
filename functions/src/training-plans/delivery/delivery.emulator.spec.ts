import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { ExpectedTrainingScheduleRevision, ScheduledWorkoutV1, TrainingScheduleMutationOperationV1 } from '../../../../shared/training-plans';
import { parseTrainingDeliveryStatusV1, type TrainingDeliveryCommandV1, type TrainingDeliverySettingsV1 } from '../../../../shared/training-provider-delivery';
import { DELIVERY_LEDGER, DELIVERY_QUEUE, TrainingDeliveryTransportError, type DeliveryLedgerV1, type DeliveryRuntime } from './contracts';
import { trainingDeliveryCommand } from './commands';
import { reconcileTrainingDeliveryPage } from './store';
import { processTrainingDelivery } from './worker';
import { stageTrainingDeliveryReconciliation, stageTrainingDeliveryDisconnect } from './marker';
import { FakeTrainingTransport } from './test-support/fake-transport';
import { mutateTrainingScheduleForUser } from '../persistence';
import { restoreTrainingScheduleRevisionForUser } from '../restore';
import { deleteTrainingPlanForUser } from '../delete-training-plan';
import { dispatchTrainingDeliveryJob } from './tasks';
import { DELIVERY_SERVICES, productionDeliveryRuntime } from './runtime';
import { deliveryIdentity } from './intent';
import { projectDelivery } from './store';
import { processTrainingVerification } from './verification-worker';
import { productionRequestCapacity } from './request-capacity';
import type { InspectionObservation } from './verification-contracts';
import { createGarminTrainingClient } from './garmin/http';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Training delivery real Firestore transactions', { timeout: 30_000 }, () => {
  // Never accept a production project or a non-loopback emulator endpoint.
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback emulator required.');
  const db = new Firestore({ projectId: 'demo-training-delivery' });
  const users: string[] = [];
  let uid: string;
  let transport: FakeTrainingTransport;
  let runtime: DeliveryRuntime;
  let now: number;
  let pro: boolean;
  let account: string;
  let connectionState: 'connected' | 'reconnect_required';
  let connectionGeneration: string;
  const workout = (id = 'w'): ScheduledWorkoutV1 => ({ schemaVersion: 1, id, planId: null, revision: 1,
    title: 'Easy run', localDate: '2026-09-10', lifecycle: 'planned', createdAtMs: 1, updatedAtMs: 1,
    structure: { version: 1, sport: ActivityTypes.Running,
      nodes: [{ id: 'step', kind: 'step', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [] }] } });
  const command = (patch: Partial<TrainingDeliveryCommandV1> = {}): TrainingDeliveryCommandV1 => ({ schemaVersion: 1,
    mutationId: randomUUID(), scope: 'workout', scopeId: 'w', provider: 'garmin', action: 'send',
    expectedScheduleRevision: 1, expectedScopeRevision: 1, expectedSettingsRevision: 0, timeZone: 'Europe/Helsinki', ...patch });
  const drain = async () => { for (let i = 0; i < 150; i++) if (!await reconcileTrainingDeliveryPage(runtime, uid)) return; throw new Error('Unbounded scan'); };
  const ledgers = async () => (await db.collection('users').doc(uid).collection(DELIVERY_LEDGER).get()).docs.map(doc => doc.data() as DeliveryLedgerV1);
  const send = async () => { await trainingDeliveryCommand(runtime, uid, command(), false); await drain(); return (await ledgers())[0]; };
  const mark = () => db.runTransaction(async tx => { stageTrainingDeliveryReconciliation(tx, db, uid); });
  const revisions = async (): Promise<ExpectedTrainingScheduleRevision[]> => {
    const user = db.collection('users').doc(uid);
    const state = await user.collection('trainingPlanState').doc('current').get();
    const plans = await user.collection('trainingPlans').get();
    const w = await user.collection('scheduledWorkouts').doc('w').get();
    return [{ scope: 'state', id: 'current', revision: state.data()!.revision },
      ...plans.docs.map(doc => ({ scope: 'plan' as const, id: doc.id, revision: doc.data().revision })),
      ...(w.exists ? [{ scope: 'workout' as const, id: 'w', revision: w.data()!.revision }] : [])];
  };
  const editSchedule = async (operation: TrainingScheduleMutationOperationV1) => mutateTrainingScheduleForUser(uid, {
    mutationId: randomUUID(), expectedRevisions: await revisions(), operation,
  }, { db, nowMs: now });
  const currentCommand = async (patch: Partial<TrainingDeliveryCommandV1>) => {
    const value = command(patch); const user = db.collection('users').doc(uid);
    const [state, scope, setting] = await Promise.all([
      user.collection('trainingPlanState').doc('current').get(),
      user.collection(value.scope === 'plan' ? 'trainingPlans' : 'scheduledWorkouts').doc(value.scopeId).get(),
      user.collection('trainingDeliverySettings').doc(`${value.scope}_${value.scopeId}_${value.provider}`).get(),
    ]);
    return { ...value, expectedScheduleRevision: state.data()!.revision, expectedScopeRevision: scope.data()!.revision,
      expectedSettingsRevision: setting.data()?.revision ?? 0 };
  };
  const createPlan = async (id = 'p') => editSchedule({ kind: 'create-plan', planId: id, name: id,
    startLocalDate: '2026-09-01', endLocalDate: '2026-10-31', activate: true });
  const moveToPlan = async (id: string | null) => editSchedule({ kind: 'move-workout', workoutId: 'w', planId: id,
    localDate: '2026-09-10', confirmPlanRangeExtension: false });
  const configurePlan = async (id = 'p') => trainingDeliveryCommand(runtime, uid,
    await currentCommand({ scope: 'plan', scopeId: id, action: 'configure' }), false);
  const inspection = (before?: () => Promise<void>) => {
    transport.inspection = { policy: { version: 'synthetic-proof', mode: 'retained-ids', required: ['workout', 'schedule'],
      confirmationDelayMs: 900_000, authoritativeAbsenceKeys: ['workout', 'schedule'], repairReadyKeys: ['workout', 'schedule'] },
      inspect: vi.fn(async (request, guard): Promise<InspectionObservation> => {
        await guard(false); await before?.();
        return { conflict: false, artifacts: ['workout', 'schedule'].map(key => ({ key, authoritative: true,
          state: [...transport.artifacts.values()].some(value => value.ids[key] === request.artifact.ids[key]) ? 'present' : 'absent' })) };
      }) };
  };
  const checkCommand = async () => {
    const request = await currentCommand({ action: 'check' }); delete request.timeZone;
    return request;
  };
  const delivered = async () => {
    const ledger = await send(); await processTrainingDelivery(runtime, uid, ledger.id); await drain(); return ledger;
  };
  beforeEach(async () => {
    uid = `delivery-test-${randomUUID()}`; users.push(uid); now = Date.parse('2026-09-10T10:00:00Z');
    transport = new FakeTrainingTransport(); pro = true; account = 'account-a'; connectionState = 'connected'; connectionGeneration = 'connection-1';
    runtime = { db, now: () => now, hasPro: async () => pro, transport: () => transport,
      connection: async (tx, id, provider) => {
        const state = await tx.get(db.collection('users').doc(id).collection('trainingDeliveryState').doc('current'));
        return { state: connectionState, destinationKey: account, generation: connectionGeneration, epoch: state.data()?.connectionEpochs?.[provider] ?? 0 };
      } };
    const user = db.collection('users').doc(uid);
    await user.set({ test: true });
    await user.collection('trainingPlanState').doc('current').set({ schemaVersion: 1, revision: 1, activePlanId: null, currentWorkoutCount: 1, updatedAtMs: 1 });
    await user.collection('scheduledWorkouts').doc('w').set(workout());
  });
  afterAll(async () => {
    for (const id of users) {
      await db.recursiveDelete(db.collection('users').doc(id));
      const jobs = await db.collection(DELIVERY_QUEUE).where('uid', '==', id).get();
      for (let offset = 0; offset < jobs.size; offset += 25) {
        await Promise.all(jobs.docs.slice(offset, offset + 25).map(job => db.recursiveDelete(job.ref)));
      }
      await db.recursiveDelete(db.collection('userDeletionTombstones').doc(id));
      for (const service of Object.values(DELIVERY_SERVICES)) await db.recursiveDelete(db.collection(service.tokens).doc(id));
    }
    await db.terminate();
  }, 120_000);
  it('checks caller authority inside the delivery mutation transaction', async () => {
    const transactionPrecondition = vi.fn().mockRejectedValue(new Error('grant revoked'));

    await expect(trainingDeliveryCommand(runtime, uid, command(), false, transactionPrecondition))
      .rejects.toThrow('grant revoked');

    expect(transactionPrecondition).toHaveBeenCalledTimes(1);
    expect((await db.collection('users').doc(uid).collection('trainingDeliverySettings').get()).empty).toBe(true);
  });
  it('queues/coalesces manual checks without changing settings and replays the typed receipt', async () => {
    inspection(); const ledger = await delivered();
    const user = db.collection('users').doc(uid);
    const before = (await user.collection('trainingDeliverySettings').doc('workout_w_garmin').get()).data();
    const request = await checkCommand();
    expect(await trainingDeliveryCommand(runtime, uid, request, false)).toMatchObject({ action: 'check', result: 'queued' });
    expect(await trainingDeliveryCommand(runtime, uid, request, false)).toMatchObject({ action: 'check', result: 'queued' });
    expect(await trainingDeliveryCommand(runtime, uid, await checkCommand(), false)).toMatchObject({ result: 'coalesced' });
    expect((await user.collection('trainingDeliverySettings').doc('workout_w_garmin').get()).data()).toEqual(before);
    await drain(); await Promise.all([processTrainingVerification(runtime, uid, ledger.id), processTrainingVerification(runtime, uid, ledger.id)]);
    expect(transport.inspection!.inspect).toHaveBeenCalledTimes(1);
    expect((await ledgers())[0].verification?.state).toBe('present');
  });
  it('restores only after two negatives, retains identity, and pauses after two successful repair cycles', async () => {
    inspection(); const ledger = await delivered();
    for (let i = 0; i < 3; i++) {
      transport.artifacts.clear();
      await processTrainingVerification(runtime, uid, ledger.id);
      expect((await ledgers())[0].verification?.state).toBe('suspected_missing');
      now += 900_000;
      await processTrainingVerification(runtime, uid, ledger.id);
      const missing = (await ledgers())[0];
      expect(projectDelivery(missing).hasRemoteCopy).toBe(false);
      if (i === 2) {
        expect(missing.verification?.state).toBe('deferred');
        expect(projectDelivery(missing).issues.join(' ')).toContain('two repairs in 24 hours');
        const fullProjection = projectDelivery({ ...missing, issues: Array.from({ length: 20 }, (_, index) => `Mapping warning ${index}`) });
        expect(parseTrainingDeliveryStatusV1(fullProjection).issues).toHaveLength(20);
        expect(fullProjection.issues[0]).toContain('two repairs in 24 hours');
        break;
      }
      expect(missing.verification?.state).toBe('restoring');
      await processTrainingDelivery(runtime, uid, ledger.id); await drain();
      expect((await ledgers())[0].id).toBe(ledger.id);
      expect((await ledgers())[0].verification?.repairTimes).toHaveLength(i + 1);
    }
    expect(transport.calls).toHaveLength(3); // initial delivery plus two repair cycles
  });
  it.each(['stop', 'pro', 'account', 'generation', 'deletion', 'edit', 'lease', 'inspection-disabled', 'policy-changed'] as const)(
    'suppresses stale inspection evidence after %s during I/O', async change => {
      let changed = false;
      inspection(async () => {
        if (changed) return; changed = true;
        if (change === 'stop') { const request = await currentCommand({ action: 'stop' }); delete request.timeZone; await trainingDeliveryCommand(runtime, uid, request, false); }
        if (change === 'pro') pro = false;
        if (change === 'account') account = 'other-account';
        if (change === 'generation') connectionGeneration = 'connection-2';
        if (change === 'deletion') await db.collection('userDeletionTombstones').doc(uid).set({ uid, status: 'deleting' });
        if (change === 'edit') await editSchedule({ kind: 'update-workout', workoutId: 'w', planId: null,
          localDate: workout().localDate, title: 'Updated', structure: workout().structure, confirmPlanRangeExtension: false });
        if (change === 'lease') now += 180_001;
        if (change === 'inspection-disabled') transport.inspection = { ...transport.inspection!, policy: { ...transport.inspection!.policy, mode: 'unavailable' } };
        if (change === 'policy-changed') transport.inspection = { ...transport.inspection!, policy: {
          ...transport.inspection!.policy, authoritativeAbsenceKeys: [], repairReadyKeys: [],
        } };
      });
      const ledger = await delivered(); transport.artifacts.clear();
      await processTrainingVerification(runtime, uid, ledger.id);
      expect((await ledgers())[0].verification?.missing).not.toBe(true);
      if (change === 'inspection-disabled' || change === 'policy-changed') {
        expect((await ledgers())[0].verification?.state).toBe('pending');
        expect((await db.collection('users').doc(uid).collection(DELIVERY_LEDGER).doc(ledger.id).collection('inspections').get()).empty).toBe(true);
      }
      expect((await ledgers())[0].repair).toBeFalsy();
      expect(transport.calls).toHaveLength(1);
    });
  it('keeps quota deferrals pending and shares account capacity between checking and delivery', async () => {
    const capacity = productionRequestCapacity(db, uid, 'garmin', account,
      [{ scope: 'account', limit: 1, windowMs: 60_000, bucketMs: 1000 }], () => now);
    inspection(async () => capacity.reserve());
    const ledger = await delivered();
    await trainingDeliveryCommand(runtime, uid, await checkCommand(), false);
    await drain();
    await capacity.reserve();
    await processTrainingVerification(runtime, uid, ledger.id);
    const deferred = (await ledgers())[0];
    expect(deferred.verification?.state).toBe('deferred'); expect(deferred.retries).toBe(0);
    expect((await db.collection(DELIVERY_QUEUE).doc(ledger.id).get()).data()?.priority).toBe('manual');
    now = deferred.verification!.nextCheckAtMs;
    await processTrainingVerification(runtime, uid, ledger.id);
    expect((await ledgers())[0].verification?.state).toBe('present');
    expect((await db.collection(DELIVERY_QUEUE).doc(ledger.id).get()).data()?.priority).toBe('ordinary');
  });
  it('persists an unknown check and releases the lease for a malformed inspection response', async () => {
    inspection(); const ledger = await delivered();
    vi.mocked(transport.inspection!.inspect).mockResolvedValueOnce(null as never);
    await processTrainingVerification(runtime, uid, ledger.id);
    expect((await ledgers())[0]).toMatchObject({ lease: null, verification: { state: 'unknown', missing: false } });
    expect(transport.calls).toHaveLength(1);
  });
  it('keeps provider HTTP 429 checks deferred without charging failure retries', async () => {
    const client = createGarminTrainingClient(async () => 'synthetic-token',
      vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } })), () => now);
    inspection(async () => { await client({ method: 'GET', path: '/training-api/workout/v2/1' }, async () => {}); });
    const ledger = await delivered();
    for (let i = 0; i < 3; i++) {
      await processTrainingVerification(runtime, uid, ledger.id);
      expect((await ledgers())[0]).toMatchObject({ retries: 0, verification: { state: 'deferred', nextCheckAtMs: now + 120_000 } });
      now += 120_000;
    }
  });
  it('does not bypass a received Retry-After with a manual check after quota persistence failed', async () => {
    const capacity = { reserve: vi.fn().mockResolvedValue(undefined), defer: vi.fn().mockRejectedValue(new Error('quota write failed')) };
    const fetcher = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '7200' } }));
    const client = createGarminTrainingClient(async () => 'synthetic-token', fetcher, () => now, capacity);
    inspection(async () => { await client({ method: 'GET', path: '/training-api/workout/v2/1' }, async () => {}); });
    const ledger = await delivered();
    await processTrainingVerification(runtime, uid, ledger.id);
    const deadline = now + 7_200_000;
    now += 900_001;
    await trainingDeliveryCommand(runtime, uid, await checkCommand(), false); await drain();
    await processTrainingVerification(runtime, uid, ledger.id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await ledgers())[0].verification).toMatchObject({ state: 'deferred', nextCheckAtMs: deadline });
  });
  it('preserves consent and exposes permission repair when a remote check is denied', async () => {
    inspection(async () => { throw new TrainingDeliveryTransportError('permission'); });
    const ledger = await delivered();
    await processTrainingVerification(runtime, uid, ledger.id);
    expect((await ledgers())[0]).toMatchObject({ status: 'connection_repair', verification: { state: 'unknown', missing: false } });
    expect((await db.collection('users').doc(uid).collection('trainingDeliverySettings').doc('workout_w_garmin').get()).data()?.enabled).toBe(true);
  });
  it.each(['pause', 'transfer', 'delete-plan'] as const)('suppresses an in-flight check after plan %s', async change => {
    await createPlan(); await moveToPlan('p'); await configurePlan();
    inspection(async () => {
      if (change === 'pause') await db.collection('users').doc(uid).collection('trainingPlans').doc('p').update({ lifecycle: 'paused' });
      if (change === 'transfer') await moveToPlan(null);
      if (change === 'delete-plan') await deleteTrainingPlanForUser(uid, { mutationId: randomUUID(), planId: 'p',
        expectedRevisions: await revisions(), workoutDisposition: 'convert-to-standalone', confirmPlanDeletion: true }, { db, nowMs: now });
    });
    await drain(); const ledger = (await ledgers())[0];
    await processTrainingDelivery(runtime, uid, ledger.id); await drain(); transport.artifacts.clear();
    await processTrainingVerification(runtime, uid, ledger.id);
    expect((await ledgers())[0].verification?.missing).not.toBe(true);
    expect((await ledgers())[0].repair).toBeFalsy(); expect(transport.calls).toHaveLength(1);
  });
  it('returns a typed deferred receipt without bypassing shared application/account capacity', async () => {
    inspection(); await delivered();
    runtime.requestNotBefore = async () => now + 60_000;
    expect(await trainingDeliveryCommand(runtime, uid, await checkCommand(), false)).toMatchObject({ result: 'deferred', notBeforeMs: now + 60_000 });
    const other = `delivery-test-${randomUUID()}`; users.push(other);
    await db.collection('users').doc(other).set({ test: true });
    const windows = [{ scope: 'application' as const, limit: 2, windowMs: 123_000, bucketMs: 1000 },
      { scope: 'account' as const, limit: 1, windowMs: 123_000, bucketMs: 1000 }];
    const first = productionRequestCapacity(db, uid, 'wahoo', 'a', windows, () => now);
    const second = productionRequestCapacity(db, other, 'wahoo', 'b', windows, () => now);
    await Promise.all([first.reserve(), second.reserve()]);
    await expect(first.reserve()).rejects.toMatchObject({ kind: 'deferred' });
    await expect(second.reserve()).rejects.toMatchObject({ kind: 'deferred' });
    now += 124_000;
    await first.reserve();
  });
  it('rechecks an authored edit before a confirmed-missing repair instead of replaying stale content', async () => {
    inspection(); const ledger = await delivered(); transport.artifacts.clear();
    await processTrainingVerification(runtime, uid, ledger.id); now += 900_000;
    await processTrainingVerification(runtime, uid, ledger.id);
    await editSchedule({ kind: 'update-workout', workoutId: 'w', planId: null, localDate: workout().localDate,
      title: 'Updated repair', structure: workout().structure, confirmPlanRangeExtension: false });
    await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.calls).toHaveLength(1);
    expect((await db.collection(DELIVERY_QUEUE).doc(ledger.id).get()).data()?.kind).toBe('verification');
    expect((await ledgers())[0].verification).toMatchObject({ state: 'pending', missing: false,
      missingKeys: [], checkedAtMs: null, cursor: null });
    await processTrainingVerification(runtime, uid, ledger.id); now += 900_000;
    await processTrainingVerification(runtime, uid, ledger.id);
    await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.calls.at(-1)?.workout?.title).toBe('Updated repair');
  });
  it('counts a proven recovered repair toward the rolling limit without repeating its create', async () => {
    inspection(); const ledger = await delivered(); transport.artifacts.clear();
    await processTrainingVerification(runtime, uid, ledger.id); now += 900_000;
    await processTrainingVerification(runtime, uid, ledger.id);
    transport.afterAccept = async () => { throw new Error('simulated lost acceptance checkpoint'); };
    await processTrainingDelivery(runtime, uid, ledger.id);
    const failed = (await ledgers())[0];
    expect(failed.status).toBe('retrying');
    expect(failed.verification?.repairTimes).toHaveLength(0);
    transport.afterAccept = null; now = failed.retryAtMs + 1;
    await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.calls).toHaveLength(2); // Initial send and one repair only.
    expect((await ledgers())[0]).toMatchObject({ status: 'delivered', verification: { repairTimes: [now] } });
  });
  it('does not charge an adapter-proved no-op repair, including recovery of its acceptance', async () => {
    inspection(); const ledger = await delivered(); transport.artifacts.clear();
    const lastSent = (await ledgers())[0].lastAcceptedAtMs;
    await processTrainingVerification(runtime, uid, ledger.id); now += 900_000;
    await processTrainingVerification(runtime, uid, ledger.id);
    vi.spyOn(transport, 'execute').mockImplementationOnce(async (operation, checkpoint) => {
      await checkpoint(operation.repair!.original, { version: 1, step: 'finished', state: 'accepted', repairApplied: false });
      transport.accepted.set(operation.id, operation.repair!.original);
      throw new Error('lost final completion');
    });
    await processTrainingDelivery(runtime, uid, ledger.id);
    now = (await ledgers())[0].retryAtMs + 1;
    await processTrainingDelivery(runtime, uid, ledger.id);
    expect((await ledgers())[0]).toMatchObject({ status: 'delivered', lastAcceptedAtMs: lastSent,
      verification: { repairTimes: [] } });
  });
  it('admits non-allowlisted opt-in and stages reconciliation without contacting a provider during consent', async () => {
    runtime.transport = productionDeliveryRuntime(db).transport;
    expect(await trainingDeliveryCommand(runtime, uid, command(), true)).toMatchObject({ available: true });
    expect(await trainingDeliveryCommand(runtime, uid, command(), false)).toMatchObject({ provider: 'garmin', enabled: true });
    expect((await db.collection('users').doc(uid).collection('trainingDeliverySettings').get()).empty).toBe(false);
    expect((await db.collection(DELIVERY_QUEUE).where('uid', '==', uid).get()).empty).toBe(false);
    expect(await ledgers()).toEqual([]);
  });
  it('replays receipts, rejects conflicts/reused IDs, and performs one create for duplicate concurrent tasks', async () => {
    const request = command();
    const setting = await trainingDeliveryCommand(runtime, uid, request, false);
    expect(await trainingDeliveryCommand(runtime, uid, request, false)).toEqual(setting);
    await expect(trainingDeliveryCommand(runtime, uid, { ...request, timeZone: 'UTC' }, false)).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(trainingDeliveryCommand(runtime, uid, command(), false)).rejects.toMatchObject({ code: 'aborted' });
    await drain(); const ledger = (await ledgers())[0];
    await Promise.all([processTrainingDelivery(runtime, uid, ledger.id), processTrainingDelivery(runtime, uid, ledger.id)]);
    expect(transport.calls).toHaveLength(1);
    expect((await ledgers())[0]).toMatchObject({ status: 'delivered', attempt: null });
    expect(projectDelivery((await ledgers())[0])).toMatchObject({ lastAttemptAtMs: now, lastAcceptedAtMs: now, retryCount: 0, nextRetryAtMs: null });
  }, 30_000);
  it('retains accepted IDs after an edit during transport and updates that same remote identity', async () => {
    const ledger = await send();
    transport.beforeAccept = async () => {
      await db.collection('users').doc(uid).collection('scheduledWorkouts').doc('w').update({ title: 'New title', revision: 2 });
      await mark(); await drain();
    };
    await processTrainingDelivery(runtime, uid, ledger.id);
    const accepted = (await ledgers())[0];
    expect(accepted.actual?.ids.workout).toBe(`fake-${ledger.id}`);
    transport.beforeAccept = null;
    await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.calls).toHaveLength(2);
    expect((await ledgers())[0]).toMatchObject({ id: ledger.id, status: 'delivered' });
    expect(transport.artifacts.size).toBe(1);
  });
  it.each(['upsert-null', 'remove-artifact', 'empty-ids'] as const)('does not publish success for inconsistent transport acceptance: %s', async response => {
    const ledger = await send();
    if (response === 'remove-artifact') {
      await processTrainingDelivery(runtime, uid, ledger.id);
      await trainingDeliveryCommand(runtime, uid, await currentCommand({ action: 'stop' }), false);
      await drain();
    }
    const before = (await ledgers())[0];
    vi.spyOn(transport, 'execute').mockResolvedValueOnce(response === 'upsert-null' ? null : response === 'empty-ids'
      ? { ids: {}, localDate: '2026-09-10', completed: false } : before.actual);
    await processTrainingDelivery(runtime, uid, ledger.id);
    const failed = (await ledgers())[0];
    expect(failed.status).toBe('retrying');
    expect(failed.attempt).not.toBeNull();
    expect(failed.actual).toEqual(before.actual);
    now = failed.retryAtMs + 1;
    await processTrainingDelivery(runtime, uid, ledger.id);
    expect((await ledgers())[0].status).toBe(response === 'remove-artifact' ? 'removed' : 'delivered');
  });
  it('recovers accepted-but-unrecorded creates without repeating them, including explicit Retry', async () => {
    const ledger = await send();
    transport.afterAccept = async () => { throw new Error('simulated lost persistence'); };
    await processTrainingDelivery(runtime, uid, ledger.id);
    expect((await ledgers())[0].status).toBe('retrying');
    const settings = (await db.collection('users').doc(uid).collection('trainingDeliverySettings').doc('workout_w_garmin').get()).data()!;
    await trainingDeliveryCommand(runtime, uid, command({ action: 'retry', expectedSettingsRevision: settings.revision }), false);
    transport.afterAccept = null;
    await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.calls).toHaveLength(1);
    expect((await ledgers())[0].status).toBe('delivered');
  });
  it('pauses on expiry, allows Stop removal without Pro, and never deletes completed copies', async () => {
    const ledger = await send(); await processTrainingDelivery(runtime, uid, ledger.id);
    pro = false;
    await mark(); await drain();
    expect((await ledgers())[0].status).toBe('paused_pro');
    expect(projectDelivery((await ledgers())[0]).differsFromQS).toBe(false);
    await trainingDeliveryCommand(runtime, uid, command({ action: 'stop', expectedSettingsRevision: 1 }), false);
    await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.artifacts.size).toBe(0);
    expect((await ledgers())[0].status).toBe('removed');
  });
  it('preserves remote copies and invalidates consent on explicit disconnect', async () => {
    const ledger = await send(); await processTrainingDelivery(runtime, uid, ledger.id);
    await db.runTransaction(async tx => stageTrainingDeliveryDisconnect(tx, db, uid, 'garmin'));
    await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect((await ledgers())[0].status).toBe('fresh_consent_required');
    expect(transport.calls).toHaveLength(1);
    expect(transport.artifacts.size).toBe(1);
  });
  it('preserves consent on auth loss; requires fresh consent for a different account', async () => {
    await send(); connectionState = 'reconnect_required'; await mark(); await drain();
    expect((await ledgers())[0].status).toBe('reconnect_required');
    connectionState = 'connected'; account = 'account-b'; await mark(); await drain();
    expect((await ledgers()).every(item => item.status === 'fresh_consent_required')).toBe(true);
    expect(transport.calls).toHaveLength(0);
  });
  it('fences acceptance persistence and queue recreation during account deletion', async () => {
    const ledger = await send();
    transport.beforeAccept = async () => {
      await db.collection('userDeletionTombstones').doc(uid).set({ deleting: true });
      await db.recursiveDelete(db.collection('users').doc(uid));
    };
    await processTrainingDelivery(runtime, uid, ledger.id);
    expect(await ledgers()).toEqual([]);
    await mark(); // Simulates a preexisting delayed message, not a production writer.
    expect(await reconcileTrainingDeliveryPage(runtime, uid)).toBe(false);
    expect(await ledgers()).toEqual([]);
  });
  it('recovers a lost enqueue acknowledgement and skips duplicate reservations', async () => {
    const ledger = await send();
    const enqueue = vi.fn(async () => { throw new Error('Lost acknowledgement'); });
    await expect(dispatchTrainingDeliveryJob(runtime, ledger.id, enqueue)).rejects.toThrow('Lost acknowledgement');
    expect(await dispatchTrainingDeliveryJob(runtime, ledger.id, enqueue)).toBe(false);
    now += 61_000;
    const recovered = vi.fn(async () => true);
    expect(await dispatchTrainingDeliveryJob(runtime, ledger.id, recovered)).toBe(true);
    expect(recovered.mock.calls[0][1]).not.toBe(enqueue.mock.calls[0][1]);
  });
  it('restarts a partial scan after a schedule edit and respects deletion locks', async () => {
    await send();
    const lock = db.collection('users').doc(uid).collection('trainingPlanState').doc('current').collection('planDeletionLocks').doc('p');
    await lock.set({ deleting: true }); await mark();
    expect(await reconcileTrainingDeliveryPage(runtime, uid)).toBe(false);
    await lock.delete();
    await editSchedule({ kind: 'move-workout', workoutId: 'w', planId: null, localDate: '2026-09-11', confirmPlanRangeExtension: false });
    await drain(); const ledger = (await ledgers())[0]; await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.calls[0].workout?.localDate).toBe('2026-09-11');
  });
  it('does not inherit consent on copies or revive standalone consent after plan transfers', async () => {
    const ledger = await send(); await processTrainingDelivery(runtime, uid, ledger.id);
    await editSchedule({ kind: 'copy-workout', sourceWorkoutId: 'w', workoutId: 'copy', planId: null, localDate: '2026-09-10', confirmPlanRangeExtension: false });
    await drain(); expect(await ledgers()).toHaveLength(1);
    await createPlan(); await moveToPlan('p'); await configurePlan(); await drain();
    expect((await ledgers())[0].id).toBe(ledger.id);
    await processTrainingDelivery(runtime, uid, ledger.id); expect(transport.calls).toHaveLength(1);
    await createPlan('q'); await configurePlan('q'); await moveToPlan('q'); await drain();
    await processTrainingDelivery(runtime, uid, ledger.id); expect(transport.calls).toHaveLength(1);
    await moveToPlan(null); await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.artifacts.size).toBe(0);
    await trainingDeliveryCommand(runtime, uid, await currentCommand({ action: 'send' }), false);
    await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.artifacts.size).toBe(1);
  });
  it('withdraws paused plans and reactivates only the current active plan after Pro restoration', async () => {
    await createPlan(); await moveToPlan('p'); await configurePlan(); await drain();
    const ledger = (await ledgers())[0]; await processTrainingDelivery(runtime, uid, ledger.id);
    await editSchedule({ kind: 'set-plan-lifecycle', planId: 'p', lifecycle: 'paused' });
    await editSchedule({ kind: 'set-plan-lifecycle', planId: 'p', lifecycle: 'active' });
    await drain(); await processTrainingDelivery(runtime, uid, ledger.id); expect(transport.calls).toHaveLength(1);
    pro = false; await createPlan('q'); await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.artifacts.size).toBe(0);
    pro = true; await mark(); await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.artifacts.size).toBe(0);
    await editSchedule({ kind: 'set-plan-lifecycle', planId: 'p', lifecycle: 'active' });
    await drain(); await processTrainingDelivery(runtime, uid, ledger.id); expect(transport.artifacts.size).toBe(1);
  });
  it.each(['convert-to-standalone', 'delete-workouts'] as const)('retains remote identities through plan deletion: %s', async workoutDisposition => {
    await createPlan(); await moveToPlan('p'); await configurePlan(); await drain();
    const ledger = (await ledgers())[0]; await processTrainingDelivery(runtime, uid, ledger.id);
    await deleteTrainingPlanForUser(uid, { mutationId: randomUUID(), planId: 'p', expectedRevisions: await revisions(),
      workoutDisposition, confirmPlanDeletion: true }, { db, nowMs: now });
    expect((await ledgers())[0].actual?.ids).toEqual(ledger.actual?.ids ?? transport.artifacts.get(ledger.id)?.ids);
    await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.artifacts.size).toBe(0);
    expect((await db.collection('users').doc(uid).collection('trainingDeliverySettings').doc('plan_p_garmin').get()).exists).toBe(false);
    if (workoutDisposition === 'convert-to-standalone') {
      await expect(createPlan()).rejects.toMatchObject({ code: 'already-exists' });
      await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
      expect(transport.artifacts.size).toBe(0); // Existing authoring retirement and consent cleanup agree.
    }
  });
  it.each(['soft', 'permanent'] as const)('withdraws a past uncompleted standalone copy only with explicit %s deletion opt-in', async deletion => {
    const ledger = await delivered();
    now = Date.parse('2026-09-12T10:00:00Z');
    await editSchedule({ kind: 'delete-workout', workoutId: 'w', removePastProviderCopies: true });
    if (deletion === 'permanent') await editSchedule({ kind: 'permanently-delete-workout', workoutId: 'w',
      confirmPermanentDeletion: true, removePastProviderCopies: true });
    await drain();
    expect((await ledgers())[0].desired).toBe('absent');
    await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.calls.at(-1)).toMatchObject({ kind: 'remove', allowPastRemoval: true });
    expect(transport.artifacts.size).toBe(0);
  });
  it('keeps a past copy when deletion did not opt in, even after a prior opt-in was revoked', async () => {
    const ledger = await delivered();
    now = Date.parse('2026-09-12T10:00:00Z');
    await editSchedule({ kind: 'move-workout', workoutId: 'w', planId: null,
      localDate: '2026-09-11', confirmPlanRangeExtension: false });
    await editSchedule({ kind: 'delete-workout', workoutId: 'w', removePastProviderCopies: true });
    await restoreTrainingScheduleRevisionForUser(uid, { mutationId: randomUUID(), scope: { kind: 'workout', id: 'w' },
      targetRevision: 2, expectedRevisions: await revisions() }, { db, nowMs: now });
    await editSchedule({ kind: 'delete-workout', workoutId: 'w' });
    await drain();
    expect((await ledgers())[0]).toMatchObject({ desired: 'preserve', status: 'past' });
    await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.calls.filter(call => call.kind === 'remove')).toHaveLength(0);
  });
  it.each(['convert-to-standalone', 'delete-workouts'] as const)('withdraws an old plan copy after explicit %s opt-in', async workoutDisposition => {
    await createPlan(); await moveToPlan('p'); await configurePlan(); await drain();
    const ledger = (await ledgers())[0]; await processTrainingDelivery(runtime, uid, ledger.id);
    now = Date.parse('2026-09-12T10:00:00Z');
    const request = { mutationId: randomUUID(), planId: 'p', expectedRevisions: await revisions(),
      workoutDisposition, confirmPlanDeletion: true as const, removePastProviderCopies: true };
    const first = await deleteTrainingPlanForUser(uid, request, { db, nowMs: now });
    expect(await deleteTrainingPlanForUser(uid, request, { db, nowMs: now })).toEqual(first);
    await drain();
    expect((await ledgers())[0].desired).toBe('absent');
    await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.artifacts.size).toBe(0);
    expect(transport.calls.at(-1)).toMatchObject({ kind: 'remove', allowPastRemoval: true });
  });
  it('never withdraws a copy already marked completed despite past deletion opt-in', async () => {
    const ledger = await delivered();
    const ref = db.collection('users').doc(uid).collection(DELIVERY_LEDGER).doc(ledger.id);
    await ref.update({ 'actual.completed': true });
    now = Date.parse('2026-09-12T10:00:00Z');
    await editSchedule({ kind: 'delete-workout', workoutId: 'w', removePastProviderCopies: true });
    await drain();
    expect((await ledgers())[0]).toMatchObject({ desired: 'preserve', status: 'completed' });
    await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.calls.filter(call => call.kind === 'remove')).toHaveLength(0);
  });
  it('restores authored content without restoring revoked provider consent', async () => {
    const ledger = await send(); await processTrainingDelivery(runtime, uid, ledger.id);
    await editSchedule({ kind: 'move-workout', workoutId: 'w', planId: null, localDate: '2026-09-11', confirmPlanRangeExtension: false });
    await trainingDeliveryCommand(runtime, uid, await currentCommand({ action: 'stop' }), false);
    await editSchedule({ kind: 'move-workout', workoutId: 'w', planId: null, localDate: '2026-09-12', confirmPlanRangeExtension: false });
    await restoreTrainingScheduleRevisionForUser(uid, { mutationId: randomUUID(), scope: { kind: 'workout', id: 'w' },
      targetRevision: 2, expectedRevisions: await revisions() }, { db, nowMs: now });
    await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect((await db.collection('users').doc(uid).collection('scheduledWorkouts').doc('w').get()).data()?.localDate).toBe('2026-09-11');
    expect(transport.artifacts.size).toBe(0);
  });
  it.each(['soft-workout', 'permanent-workout', 'deleted-plan'] as const)('recovers failed withdrawal after deleting its authored source: %s', async source => {
    if (source === 'deleted-plan') { await createPlan(); await moveToPlan('p'); await configurePlan(); await drain(); }
    else await send();
    const ledger = (await ledgers())[0]; await processTrainingDelivery(runtime, uid, ledger.id);
    if (source === 'deleted-plan') await deleteTrainingPlanForUser(uid, { mutationId: randomUUID(), planId: 'p',
      expectedRevisions: await revisions(), workoutDisposition: 'delete-workouts', confirmPlanDeletion: true }, { db, nowMs: now });
    else {
      await editSchedule({ kind: 'delete-workout', workoutId: 'w' });
      if (source === 'permanent-workout') await editSchedule({ kind: 'permanently-delete-workout', workoutId: 'w', confirmPermanentDeletion: true });
    }
    await drain();
    transport.beforeAccept = async () => { throw new TrainingDeliveryTransportError('terminal'); };
    await processTrainingDelivery(runtime, uid, ledger.id);
    expect((await ledgers())[0].status).toBe('failed');
    const user = db.collection('users').doc(uid);
    const recoveryCommand = async (action: 'retry' | 'stop' | 'send') => command({ action,
      expectedScheduleRevision: (await user.collection('trainingPlanState').doc('current').get()).data()!.revision,
      expectedScopeRevision: (await user.collection('scheduledWorkouts').doc('w').get()).data()?.revision ?? 0,
      expectedSettingsRevision: (await user.collection('trainingDeliverySettings').doc('workout_w_garmin').get()).data()?.revision ?? 0 });
    await expect(trainingDeliveryCommand(runtime, uid, await recoveryCommand('send'), false)).rejects.toBeDefined();
    pro = false;
    await trainingDeliveryCommand(runtime, uid, await recoveryCommand('stop'), false);
    await trainingDeliveryCommand(runtime, uid, await recoveryCommand('retry'), false);
    transport.beforeAccept = null;
    await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.artifacts.size).toBe(0);
    expect((await ledgers())[0].status).toBe('removed');
    expect(transport.calls.filter(call => call.kind === 'upsert')).toHaveLength(1);
    await expect(trainingDeliveryCommand(runtime, uid, { ...await recoveryCommand('retry'), scopeId: 'unknown',
      expectedScopeRevision: 0, expectedSettingsRevision: 0 }, false))
      .rejects.toMatchObject({ code: 'not-found' });
    await db.runTransaction(async tx => stageTrainingDeliveryDisconnect(tx, db, uid, 'garmin'));
    await expect(trainingDeliveryCommand(runtime, uid, await recoveryCommand('retry'), false))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('keeps individual plan-workout stops until an explicit resume', async () => {
    await createPlan(); await moveToPlan('p'); await configurePlan(); await drain();
    const ledger = (await ledgers())[0]; await processTrainingDelivery(runtime, uid, ledger.id);
    await trainingDeliveryCommand(runtime, uid, await currentCommand({ action: 'stop' }), false);
    await drain(); await processTrainingDelivery(runtime, uid, ledger.id); expect(transport.artifacts.size).toBe(0);
    await editSchedule({ kind: 'shift-plan', planId: 'p', days: 1 }); await drain();
    expect((await ledgers())[0].desired).toBe('absent');
    pro = false;
    const retried = await trainingDeliveryCommand(runtime, uid, await currentCommand({ action: 'retry' }), false) as TrainingDeliverySettingsV1;
    expect(retried).toMatchObject({ enabled: false, suppressed: true, timeZone: 'Europe/Helsinki' });
    await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.artifacts.size).toBe(0);
    pro = true;
    const resume = await currentCommand({ action: 'resume' });
    delete resume.timeZone;
    const resumed = await trainingDeliveryCommand(runtime, uid, resume, false) as TrainingDeliverySettingsV1;
    expect(resumed.timeZone).toBe('Europe/Helsinki');
    await drain(); await processTrainingDelivery(runtime, uid, ledger.id); expect(transport.artifacts.size).toBe(1);
  });
  it('freezes auth failures until a verified same-account reconnect and recovers the same operation', async () => {
    const ledger = await send();
    const recover = vi.spyOn(transport, 'recover');
    transport.beforeAccept = async () => { throw new TrainingDeliveryTransportError('auth'); };
    await processTrainingDelivery(runtime, uid, ledger.id);
    const operationId = (await ledgers())[0].attempt!.id;
    now += 60 * 60_000; // A dispatcher/reconciliation cycle after backoff is still blocked.
    await mark(); await drain();
    await processTrainingDelivery(runtime, uid, ledger.id); expect(transport.calls).toHaveLength(1);
    expect(recover).not.toHaveBeenCalled();
    expect((await ledgers())[0].attempt?.id).toBe(operationId);
    transport.beforeAccept = null; connectionGeneration = 'connection-2';
    await mark(); await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect((await ledgers())[0].status).toBe('delivered'); expect(transport.artifacts.size).toBe(1);
    expect(transport.calls[1].id).toBe(operationId);
  });
  it.each(['stop', 'edit', 'pro-expiry', 'disconnect', 'deletion'] as const)(
    'rechecks admission after recovery before repeating an operation: %s', async change => {
      const ledger = await send();
      transport.beforeAccept = async () => { throw new TrainingDeliveryTransportError('retryable'); };
      await processTrainingDelivery(runtime, uid, ledger.id);
      now = (await ledgers())[0].retryAtMs + 1;
      transport.beforeAccept = null;
      vi.spyOn(transport, 'recover').mockImplementationOnce(async () => {
        if (change === 'stop') await trainingDeliveryCommand(runtime, uid, await currentCommand({ action: 'stop' }), false);
        if (change === 'edit') await editSchedule({ kind: 'move-workout', workoutId: 'w', planId: null,
          localDate: '2026-09-11', confirmPlanRangeExtension: false });
        if (change === 'pro-expiry') pro = false;
        if (change === 'disconnect') await db.runTransaction(async tx => stageTrainingDeliveryDisconnect(tx, db, uid, 'garmin'));
        if (change === 'deletion') await db.collection('userDeletionTombstones').doc(uid).set({ deleting: true });
        return { kind: 'not-accepted' };
      });
      await processTrainingDelivery(runtime, uid, ledger.id);
      expect(transport.calls).toHaveLength(1);
      expect(transport.artifacts.size).toBe(0);
      if (change === 'edit') {
        await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
        expect(transport.calls[1].workout?.localDate).toBe('2026-09-11');
      }
    });
  it('inspects an ambiguous operation after persistence failure; never repeats an uncertain create', async () => {
    const ledger = await send(); let spy: ReturnType<typeof vi.spyOn> | undefined;
    transport.afterAccept = async () => { spy = vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(new Error('Firestore unavailable')); };
    await processTrainingDelivery(runtime, uid, ledger.id); spy?.mockRestore();
    expect((await ledgers())[0].attempt).not.toBeNull();
    transport.afterAccept = null; transport.unknownRecovery = true;
    await trainingDeliveryCommand(runtime, uid, await currentCommand({ action: 'retry' }), false);
    await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect((await ledgers())[0].status).toBe('needs_attention'); expect(transport.calls).toHaveLength(1);
  });
  it('honors adapter retry delays and stops at the shared retry limit', async () => {
    await db.collection('users').doc(uid).collection('scheduledWorkouts').doc('w').update({ localDate: '2026-09-15' });
    const ledger = await send();
    transport.beforeAccept = async () => { throw new TrainingDeliveryTransportError('retryable', 3_600_000); };
    for (let i = 0; i < 10; i++) {
      await processTrainingDelivery(runtime, uid, ledger.id);
      const current = (await ledgers())[0];
      expect(current.retryAtMs - now).toBeGreaterThanOrEqual(3_600_000);
      now = current.retryAtMs + 1;
    }
    expect((await ledgers())[0].status).toBe('failed');
    await processTrainingDelivery(runtime, uid, ledger.id); expect(transport.calls).toHaveLength(10);
    expect(new Set(transport.calls.map(call => call.id)).size).toBe(1);
  });
  it('requires new approval after content changes, retains the old artifact on unsupported updates, and rejects completed deletion', async () => {
    transport.level = 'degraded'; const ledger = await send();
    const pending = (await ledgers())[0]; expect(pending.status).toBe('approval_required');
    await trainingDeliveryCommand(runtime, uid, await currentCommand({ action: 'approve', approvalDigest: pending.approvalDigest! }), false);
    await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.artifacts.size).toBe(1);
    await editSchedule({ kind: 'move-workout', workoutId: 'w', planId: null, localDate: '2026-09-11', confirmPlanRangeExtension: false });
    await drain(); expect((await ledgers())[0].status).toBe('approval_required');
    transport.level = 'unsupported'; await mark(); await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect((await ledgers())[0].status).toBe('unsupported'); expect(transport.calls).toHaveLength(1);
    await db.collection('users').doc(uid).collection(DELIVERY_LEDGER).doc(ledger.id).update({ 'actual.completed': true });
    await trainingDeliveryCommand(runtime, uid, await currentCommand({ action: 'stop' }), false);
    await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect((await ledgers())[0].status).toBe('completed'); expect(transport.artifacts.size).toBe(1);
  });
  it('resolves only current authoritative provider credentials; ambiguous or stale account metadata requires repair', async () => {
    const service = DELIVERY_SERVICES.garmin; const user = db.collection('users').doc(uid);
    const root = db.collection(service.tokens).doc(uid);
    await user.collection('meta').doc(service.name).set({ connectionState: 'connected', connectionStateGeneration: 'g1' });
    await root.set({ activeOAuthCredentialGeneration: 'credential' });
    await root.collection('tokens').doc('first').set({ userID: 'provider-a', tokenCredentialGeneration: 'credential', accessToken: 'fixture-only', serviceName: service.name, permissions: ['WORKOUT_IMPORT'] });
    const actual = productionDeliveryRuntime(db);
    const resolve = () => db.runTransaction(tx => actual.connection(tx, uid, 'garmin'));
    expect((await resolve()).state).toBe('connected');
    await root.collection('tokens').doc('second').set({ userID: 'provider-b', tokenCredentialGeneration: 'credential' });
    expect((await resolve()).state).toBe('connection_repair');
    await root.collection('tokens').doc('second').update({ tokenCredentialGeneration: 'old-credential' });
    await user.collection('meta').doc(service.name).update({ providerUserId: 'provider-b' });
    expect((await resolve()).state).toBe('connection_repair');
  });
  it('recovers expired leases using the original operation, and removes deletion-fenced jobs on recovery', async () => {
    const ledger = await send();
    transport.beforeAccept = async () => { throw new TrainingDeliveryTransportError('retryable'); };
    await processTrainingDelivery(runtime, uid, ledger.id);
    const ref = db.collection('users').doc(uid).collection(DELIVERY_LEDGER).doc(ledger.id);
    await ref.update({ lease: { id: 'crashed-worker', expiresAtMs: now + 180_000 }, retryAtMs: 0 });
    transport.beforeAccept = null;
    await processTrainingDelivery(runtime, uid, ledger.id); expect(transport.calls).toHaveLength(1);
    now += 180_001; await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.calls).toHaveLength(2); expect(transport.calls[0].id).toBe(transport.calls[1].id);
    await db.collection('userDeletionTombstones').doc(uid).set({ deleting: true });
    await db.collection(DELIVERY_QUEUE).doc(ledger.id).set({ uid, dueAtMs: 0, kind: 'delivery', deliveryId: ledger.id });
    const enqueue = vi.fn(async () => true);
    expect(await dispatchTrainingDeliveryJob(runtime, ledger.id, enqueue)).toBe(false);
    expect((await db.collection(DELIVERY_QUEUE).doc(ledger.id).get()).exists).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('rejects new opt-in without Pro and releases only the latest workout when Pro returns', async () => {
    pro = false;
    await expect(trainingDeliveryCommand(runtime, uid, command(), false)).rejects.toMatchObject({ code: 'permission-denied' });
    pro = true; const ledger = await send(); pro = false;
    await editSchedule({ kind: 'move-workout', workoutId: 'w', planId: null, localDate: '2026-09-11', confirmPlanRangeExtension: false });
    await drain(); await processTrainingDelivery(runtime, uid, ledger.id); expect(transport.calls).toHaveLength(0);
    pro = true; await mark(); await drain(); await processTrainingDelivery(runtime, uid, ledger.id);
    expect(transport.calls[0].workout?.localDate).toBe('2026-09-11');
  });
  it('holds workouts outside the adapter horizon and automatically admits them on the saved-zone day boundary', async () => {
    transport.horizonDays = 0;
    await db.collection('users').doc(uid).collection('scheduledWorkouts').doc('w').update({ localDate: '2026-09-11' });
    const ledger = await send(); expect(ledger.status).toBe('outside_horizon');
    now = Date.parse('2026-09-10T21:01:00Z'); await mark(); await drain();
    await processTrainingDelivery(runtime, uid, ledger.id); expect(transport.calls).toHaveLength(1);
  });
  it('pages 400 workouts across all four providers without oversized transactions', async () => {
    const user = db.collection('users').doc(uid);
    await user.collection('scheduledWorkouts').doc('w').delete(); // Synthetic seed has no descendants.
    await user.collection('trainingPlans').doc('p').set({ id: 'p', lifecycle: 'active', revision: 1 });
    const batch = db.batch();
    for (let i = 0; i < 400; i++) batch.set(user.collection('scheduledWorkouts').doc(`w${i}`), { ...workout(`w${i}`), planId: 'p' });
    await batch.commit();
    let revision = 0;
    for (const provider of ['garmin', 'coros', 'wahoo', 'suunto'] as const) {
      const setting = await trainingDeliveryCommand(runtime, uid, command({ scope: 'plan', scopeId: 'p', provider,
        action: 'configure', expectedSettingsRevision: 0 }), false) as TrainingDeliverySettingsV1;
      revision = setting.revision;
    }
    expect(revision).toBe(4);
    await drain();
    const current = await ledgers(); expect(current).toHaveLength(1600);
    // Synthetic acceptance seeds allow the same bounded reconciler to schedule all
    // 1600 remote checks without issuing 1600 provider requests in a unit fixture.
    inspection();
    for (let offset = 0; offset < current.length; offset += 25) {
      const accepted = db.batch();
      for (const row of current.slice(offset, offset + 25)) accepted.update(user.collection(DELIVERY_LEDGER).doc(row.id), {
        status: 'delivered', acceptedDigest: row.desiredDigest, acceptedContentDigest: row.contentDigest,
        actual: { ids: { workout: row.id, schedule: row.id }, localDate: '2026-09-10', completed: false },
      });
      await accepted.commit();
    }
    await mark(); await drain();
    const checks = await db.collection(DELIVERY_QUEUE).where('uid', '==', uid).where('kind', '==', 'verification').get();
    expect(checks.size).toBe(1600);
    expect(new Set(checks.docs.map(doc => doc.data().deliveryId)).size).toBe(1600);
    const history = db.batch();
    for (let i = 0; i < 26; i++) {
      const id = deliveryIdentity(uid, 'garmin', 'account-a', `historical-${i}`);
      history.set(user.collection(DELIVERY_LEDGER).doc(id), { ...current[0], id, workoutId: `historical-${i}`, planId: null,
        actual: { ids: { workout: `historical-${i}` }, localDate: '2026-09-01', completed: false } });
    }
    await history.commit();
    // Historical ledger sweep remains independent from current workout count.
    await user.collection('trainingPlans').doc('p').update({ lifecycle: 'paused' });
    await mark(); await drain();
    const final = await ledgers(); expect(final).toHaveLength(1626);
    expect(final.filter(record => !record.workoutId.startsWith('historical')).every(record => record.desired === 'absent')).toBe(true);
    expect(final.filter(record => record.workoutId.startsWith('historical')).every(record => record.status === 'past')).toBe(true);
  }, 180_000);
});
