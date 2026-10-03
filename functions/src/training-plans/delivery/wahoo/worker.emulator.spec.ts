import { randomUUID } from 'node:crypto';
import * as logger from 'firebase-functions/logger';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityTypes, ServiceNames } from '@sports-alliance/sports-lib';
import { trainingDeliveryCommand } from '../commands';
import { reconcileTrainingDeliveryPage } from '../store';
import { processTrainingDelivery } from '../worker';
import { processTrainingVerification } from '../verification-worker';
import { stageTrainingDeliveryReconciliation } from '../marker';
import { readTrainingDeliveryAuthority } from '../connection';
import { DELIVERY_LEDGER, DELIVERY_QUEUE, type DeliveryLedgerV1, type DeliveryRuntime } from '../contracts';
import { WahooTrainingTransport } from './transport';
import { WahooTrainingHttpError } from './http';
import { WahooHttpFixture, wahooFixtureWorkout } from '../test-support/wahoo-http-fixture';
import { WAHOO_API_SCOPES } from '../../../wahoo/constants';
import type { TrainingDeliveryCommandV1 } from '../../../../../shared/training-provider-delivery';
import { projectStrengthWorkoutToV1 } from '../../../../../shared/strength-workout';
import { wahooFixtureStrengthDetails } from '../test-support/wahoo-http-fixture';
import { WAHOO_SPORT_FIXTURES } from '../test-support/wahoo-sport-fixtures';
import { retainWahooTrainingCompletion } from '../../../wahoo/training-completion';
import { mutateTrainingScheduleForUser } from '../../persistence';
import { cleanupEventFile } from '../../../events/cleanup';

// Exercise the real event-deletion handler against only this demo Firestore.
// Storage is a synthetic empty bucket; neither ADC nor production data is used.
const cleanupBinding = vi.hoisted(() => ({ db: null as Firestore | null }));
vi.mock('firebase-admin', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase-admin')>();
  const firestore = Object.assign(() => {
    if (!cleanupBinding.db) throw new Error('Demo cleanup database is not bound');
    return cleanupBinding.db;
  }, actual.firestore);
  const storage = () => ({ bucket: () => ({ name: 'synthetic-empty-bucket', getFiles: async () => [[]] }) });
  return { ...actual, default: { ...actual, firestore, storage }, firestore, storage };
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Wahoo worker with real Firestore and synthetic provider only', { timeout: 30_000 }, () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback required');
  const db = new Firestore({ projectId: 'demo-training-wahoo' }); const users: string[] = [];
  let uid: string; let runtime: DeliveryRuntime; let server: WahooHttpFixture; let now: number; let pro: boolean;
  const user = () => db.collection('users').doc(uid);
  const tokenRoot = () => db.collection('wahooAPIAccessTokens').doc(uid);
  const ledger = async () => (await user().collection(DELIVERY_LEDGER).get()).docs[0].data() as DeliveryLedgerV1;
  const drain = async () => { for (let i = 0; i < 100; i++) if (!await reconcileTrainingDeliveryPage(runtime, uid)) return; throw new Error('scan'); };
  const mark = async () => { await db.runTransaction(async tx => stageTrainingDeliveryReconciliation(tx, db, uid)); await drain(); };
  const command = async (action: TrainingDeliveryCommandV1['action'], timeZone = 'Europe/Helsinki', approvalDigest?: string) => {
    const setting = await user().collection('trainingDeliverySettings').doc('workout_w_wahoo').get();
    return trainingDeliveryCommand(runtime, uid, { schemaVersion: 1, mutationId: randomUUID(), scope: 'workout', scopeId: 'w', provider: 'wahoo',
      action, expectedScheduleRevision: 1, expectedScopeRevision: 1, expectedSettingsRevision: setting.data()?.revision ?? 0,
      ...(action === 'send' ? { timeZone } : {}), ...(approvalDigest ? { approvalDigest } : {}) }, false);
  };
  const send = async () => { await command('send'); await drain(); const row = await ledger(); await processTrainingDelivery(runtime, uid, row.id); await drain(); return ledger(); };
  const absentPair = async () => {
    const accepted = await send();
    server.plans.clear(); server.workouts.clear(); server.calls.length = 0;
    await command('stop'); await drain(); vi.mocked(logger.info).mockClear();
    return accepted;
  };
  const checkpointFault = (phase: 'observation' | 'final', inject: () => Promise<void>) => {
    const run = db.runTransaction.bind(db); let injected = false;
    const interrupted = new Error('Synthetic aborted checkpoint boundary');
    return vi.spyOn(db, 'runTransaction').mockImplementation(async (callback, options) => {
      try {
        return await run(async tx => {
          let target = false;
          const set = tx.set.bind(tx);
          vi.spyOn(tx, 'set').mockImplementation((ref, data, options) => {
            const value = data as Record<string, unknown>;
            if (ref.parent.id === 'attempts') {
              const progress = value.progress as Record<string, unknown> | undefined;
              target ||= phase === 'final' ? value.state === 'accepted'
                : progress?.step === 'finished' && progress.removalOutcome === 'already_absent';
            }
            return options ? set(ref, data, options) : set(ref, data);
          });
          const result = await callback(tx);
          // Abort before injecting a competing write: an out-of-transaction write
          // inside a pessimistic transaction would wait on its own read locks.
          if (target && !injected) { injected = true; throw interrupted; }
          return result;
        }, options);
      } catch (error) {
        if (error !== interrupted) throw error;
        await inject();
        return run(callback, options);
      }
    });
  };
  const expectRemovalComplete = async (id: string) => {
    const row = await ledger();
    expect(row).toMatchObject({ desired: 'absent', actual: null, attempt: null, lease: null, retries: 0, retryAtMs: 0 });
    expect((await db.collection(DELIVERY_QUEUE).doc(id).get()).exists).toBe(false);
    expect((await user().collection('trainingDeliveryStatuses').doc(id).get()).data())
      .toMatchObject({ hasRemoteCopy: false, differsFromQS: false, retryCount: 0, nextRetryAtMs: null });
    expect((await user().collection('trainingDeliveryVerifications').doc(id).get()).data())
      .toMatchObject({ canCheck: false, missing: false });
    expect(server.calls.every(call => call.method === 'GET')).toBe(true);
    const history = await user().collection(DELIVERY_LEDGER).doc(id).collection('attempts').get();
    expect(history.docs.some(doc => doc.data().state === 'accepted'
      && doc.data().progress?.removalOutcome === 'already_absent')).toBe(true);
    const diagnostics = vi.mocked(logger.info).mock.calls.filter(([message]) => message === '[TrainingDelivery]');
    expect(diagnostics).toContainEqual(['[TrainingDelivery]', expect.objectContaining({ provider: 'wahoo', outcome: 'already_absent' })]);
    expect(JSON.stringify(diagnostics)).not.toContain(uid);
  };
  beforeEach(async () => {
    vi.mocked(logger.warn).mockClear(); vi.mocked(logger.info).mockClear(); cleanupBinding.db = db;
    uid = `wahoo-test-${randomUUID()}`; users.push(uid); now = Date.parse('2026-10-24T22:30:00Z'); pro = true;
    server = new WahooHttpFixture(); const transport = new WahooTrainingTransport(server.request, () => now);
    runtime = { db, now: () => now, hasPro: async () => pro, transport: provider => provider === 'wahoo' ? transport : null,
      connection: async (tx, id, provider) => provider === 'wahoo' ? (await readTrainingDeliveryAuthority(db, tx, id, provider)).connection
        : { state: 'reconnect_required', destinationKey: '', generation: '', epoch: 0 } };
    await user().set({ test: true });
    await user().collection('meta').doc(ServiceNames.WahooAPI).set({ connectionState: 'connected', connectionStateGeneration: 'connection', providerUserId: '123' });
    await tokenRoot().set({ activeOAuthCredentialGeneration: 'credential' });
    await tokenRoot().collection('tokens').doc('123').set({ wahooUserID: '123', tokenCredentialGeneration: 'credential', scope: WAHOO_API_SCOPES });
    await user().collection('trainingPlanState').doc('current').set({ schemaVersion: 1, revision: 1, activePlanId: null, currentWorkoutCount: 1, updatedAtMs: now });
    await user().collection('scheduledWorkouts').doc('w').set(wahooFixtureWorkout());
  });
  afterAll(async () => {
    for (const id of users) {
      await db.recursiveDelete(db.collection('users').doc(id)); await db.recursiveDelete(db.collection('wahooAPIAccessTokens').doc(id));
      await db.recursiveDelete(db.collection('userDeletionTombstones').doc(id));
      for (const doc of (await db.collection(DELIVERY_QUEUE).where('uid', '==', id).get()).docs) await db.recursiveDelete(doc.ref);
    }
    await db.terminate();
  });
  it('converges the deleted-workout/deleted-recording incident with an existing null REMOVE journal', async () => {
    const accepted = await send(); const ids = accepted.actual!.ids;
    const eventRef = user().collection('events').doc('synthetic-recording');
    await eventRef.set({ test: true });
    const result = await retainWahooTrainingCompletion(db, uid, eventRef.id, {
      providerUserId: '123', connectionStateGeneration: 'connection', activeCredentialGeneration: 'credential', credential: null,
    }, ids.workout, ids.plan, ids.workoutToken!, '999', [{ id: 'synthetic-activity', startTimeMs: now }], now);
    expect(result.retained).toBe(true);
    server.plans.clear(); server.workouts.clear(); server.calls.length = 0;
    await mutateTrainingScheduleForUser(uid, { mutationId: randomUUID(), expectedRevisions: [
      { scope: 'state', id: 'current', revision: 1 }, { scope: 'workout', id: 'w', revision: 1 },
    ], operation: { kind: 'delete-workout', workoutId: 'w' } }, { db, nowMs: now });
    await drain(); await processTrainingDelivery(runtime, uid, accepted.id);
    expect(await ledger()).toMatchObject({ desired: 'preserve', status: 'completed', actual: { ids, completed: true } });
    expect(server.calls).toHaveLength(0);
    const deletedEvent = await eventRef.get(); await eventRef.delete();
    await cleanupEventFile.run({ params: { userId: uid, eventId: eventRef.id }, data: deletedEvent,
      time: new Date(now).toISOString() } as Parameters<typeof cleanupEventFile.run>[0]);
    await drain();
    expect((await user().collection('trainingWorkoutCompletions').doc('w').get()).exists).toBe(false);
    expect((await user().collection('trainingActivityCompletionLinks').get()).empty).toBe(true);
    const row = await ledger(); expect(row).toMatchObject({ desired: 'absent', actual: { ids, completed: false } });
    expect(row.completionLinkId ?? null).toBeNull();
    const operation = { id: 'existing-remove', deliveryId: row.id, generation: row.desiredGeneration, kind: 'remove' as const,
      destinationKey: row.destinationKey, connectionGeneration: 'connection', timeZone: row.timeZone, digest: row.desiredDigest,
      contentDigest: row.contentDigest, workout: null, artifact: row.actual, progress: null };
    await user().collection(DELIVERY_LEDGER).doc(row.id).update({ attempt: operation, retries: 3, retryAtMs: 0 });
    await user().collection(DELIVERY_LEDGER).doc(row.id).collection('attempts').doc(operation.id)
      .set({ schemaVersion: 1, operation, state: 'started', startedAtMs: now });
    vi.mocked(logger.info).mockClear(); vi.mocked(logger.warn).mockClear();
    await processTrainingDelivery(runtime, uid, row.id); await expectRemovalComplete(row.id);
    expect(logger.warn).not.toHaveBeenCalled();
    const attempt = await user().collection(DELIVERY_LEDGER).doc(row.id).collection('attempts').doc(operation.id).get();
    expect(attempt.data()).toMatchObject({ operation: { artifact: { ids }, progress: null }, state: 'accepted', artifact: null });
    expect((await attempt.ref.collection('acceptances').get()).size).toBeGreaterThan(0);
    await drain(); await mark();
    await Promise.all([processTrainingDelivery(runtime, uid, row.id), processTrainingDelivery(runtime, uid, row.id)]); await drain();
    await expectRemovalComplete(row.id);
    expect((await user().collection('scheduledWorkouts').doc('w').get()).data()?.lifecycle).toBe('deleted');
  });
  it('completes a fresh already-absent Stop once under duplicate workers', async () => {
    const row = await absentPair();
    await Promise.all([processTrainingDelivery(runtime, uid, row.id), processTrainingDelivery(runtime, uid, row.id)]);
    await expectRemovalComplete(row.id); expect(['removed', 'stopped']).toContain((await ledger()).status);
    await drain(); await mark(); await processTrainingDelivery(runtime, uid, row.id);
    await expectRemovalComplete(row.id);
  });
  it.each(['workout-remove', 'plan-remove'] as const)('recovers a lost %s DELETE receipt with bounded reads, no duplicate DELETE or POST', async step => {
    const accepted = await send();
    await command('stop'); await drain(); server.calls.length = 0;
    server.afterHandle = async request => {
      if (request.method === 'DELETE' && request.path.includes(step === 'workout-remove' ? '/workouts/' : '/plans/')) {
        server.afterHandle = null; throw new WahooTrainingHttpError('uncertain', false);
      }
    };
    await processTrainingDelivery(runtime, uid, accepted.id);
    const interrupted = await ledger(); expect(interrupted).toMatchObject({ status: 'retrying', attempt: { progress: { step, state: 'started' } } });
    const callsBefore = server.calls.length; now = interrupted.retryAtMs + 1;
    await processTrainingDelivery(runtime, uid, accepted.id);
    const row = await ledger();
    expect(row).toMatchObject({ actual: null, attempt: null, lease: null, retries: 0, retryAtMs: 0 });
    expect(server.plans.size).toBe(0); expect(server.workouts.size).toBe(0);
    expect(server.calls.filter(call => call.method === 'DELETE')).toHaveLength(2);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(0);
    if (step === 'plan-remove') expect(server.calls.slice(callsBefore).every(call => call.method === 'GET')).toBe(true);
    expect((await db.collection(DELIVERY_QUEUE).doc(accepted.id).get()).exists).toBe(false);
  });
  it.each(['observation', 'final'] as const)('cannot log durable absence when the %s transaction fails; its retry converges', async phase => {
    const accepted = await absentPair();
    const spy = checkpointFault(phase, async () => { throw new Error('Synthetic checkpoint persistence failure'); });
    try { await processTrainingDelivery(runtime, uid, accepted.id); } finally { spy.mockRestore(); }
    const failed = await ledger(); expect(failed).toMatchObject({ status: 'retrying', retries: 1 });
    expect((await db.collection(DELIVERY_QUEUE).doc(accepted.id).get()).exists).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({ event: 'checkpoint_failed', provider: 'wahoo' }));
    expect(vi.mocked(logger.info).mock.calls).not.toContainEqual(['[TrainingDelivery]', expect.objectContaining({ outcome: 'already_absent' })]);
    now = failed.retryAtMs + 1; await processTrainingDelivery(runtime, uid, accepted.id); await expectRemovalComplete(accepted.id);
  });
  it.each(['observation', 'final'] as const)('discards stale %s evidence rather than quarantining a newer lease, copy and queue', async phase => {
    const accepted = await absentPair(); const ref = user().collection(DELIVERY_LEDGER).doc(accepted.id);
    let newer: DeliveryLedgerV1; const job = { uid, kind: 'delivery', deliveryId: accepted.id, dueAtMs: now + 60_000, dispatchToken: 'new-worker' };
    const spy = checkpointFault(phase, async () => {
      const current = await ledger();
      newer = { ...current, actual: { ...accepted.actual!, ids: { ...accepted.actual!.ids, plan: '333', workout: '444', association: '444:333' } },
        status: 'pending', lease: { id: 'new-lease', expiresAtMs: now + 60_000 }, attempt: { ...current.attempt!, id: 'new-attempt' } };
      const batch = db.batch(); batch.set(ref, newer); batch.set(db.collection(DELIVERY_QUEUE).doc(accepted.id), job); await batch.commit();
    });
    try { await processTrainingDelivery(runtime, uid, accepted.id); } finally { spy.mockRestore(); }
    expect(await ledger()).toEqual(newer!); expect((await db.collection(DELIVERY_QUEUE).doc(accepted.id).get()).data()).toEqual(job);
    for (const attempt of (await ref.collection('attempts').get()).docs) expect((await attempt.ref.collection('lateAcceptances').get()).empty).toBe(true);
    expect(vi.mocked(logger.info).mock.calls).not.toContainEqual(['[TrainingDelivery]', expect.objectContaining({ outcome: 'already_absent' })]);
    expect(server.calls.every(call => call.method === 'GET')).toBe(true);
  });
  it.each(['authority', 'epoch', 'lease-expired', 'tombstone', 'new-send', 'completed'] as const)(
    'does not persist absence after %s changes at the observation transaction boundary', async condition => {
      const accepted = await absentPair();
      const spy = checkpointFault('observation', async () => {
        if (condition === 'authority') await user().collection('meta').doc(ServiceNames.WahooAPI).update({ connectionStateGeneration: 'new-authority' });
        if (condition === 'epoch') await user().collection('trainingDeliveryState').doc('current').set({ connectionEpochs: { wahoo: 1 } }, { merge: true });
        if (condition === 'lease-expired') now += 24 * 60 * 60_000;
        if (condition === 'tombstone') await db.collection('userDeletionTombstones').doc(uid).set({ status: 'pending' });
        if (condition === 'new-send') await command('send');
        if (condition === 'completed') await user().collection(DELIVERY_LEDGER).doc(accepted.id).update({ 'actual.completed': true });
      });
      try { await processTrainingDelivery(runtime, uid, accepted.id); } finally { spy.mockRestore(); }
      expect((await ledger()).actual?.ids).toEqual(accepted.actual!.ids);
      expect(vi.mocked(logger.info).mock.calls).not.toContainEqual(['[TrainingDelivery]', expect.objectContaining({ outcome: 'already_absent' })]);
      expect(server.calls.every(call => call.method === 'GET')).toBe(true);
    });
  it.each(['send', 'completion'] as const)('recovers missing DELETE evidence without erasing a newer %s decision', async decision => {
    const accepted = await send(); await command('stop'); await drain();
    server.afterHandle = async request => {
      if (request.method === 'DELETE' && request.path.includes('/workouts/')) {
        server.afterHandle = null; throw new WahooTrainingHttpError('uncertain', false);
      }
    };
    await processTrainingDelivery(runtime, uid, accepted.id);
    const interrupted = await ledger(); expect(interrupted.attempt?.progress).toMatchObject({ step: 'workout-remove', state: 'started' });
    server.plans.clear(); server.calls.length = 0; now = interrupted.retryAtMs + 1;
    const spy = checkpointFault('observation', async () => {
      if (decision === 'completion') {
        await user().collection(DELIVERY_LEDGER).doc(accepted.id).update({ 'actual.completed': true });
      } else { await command('send'); await drain(); }
    });
    try { await processTrainingDelivery(runtime, uid, accepted.id); } finally { spy.mockRestore(); }
    if (decision === 'completion') {
      expect(await ledger()).toMatchObject({ actual: { ids: accepted.actual!.ids, completed: true } });
      expect(vi.mocked(logger.info).mock.calls).not.toContainEqual(['[TrainingDelivery]', expect.objectContaining({ outcome: 'already_absent' })]);
    } else {
      expect(await ledger()).toMatchObject({ desired: 'present', status: 'pending', actual: null, attempt: null, retries: 0 });
      const setting = await user().collection('trainingDeliverySettings').doc('workout_w_wahoo').get();
      expect(setting.data()?.enabled).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({ event: 'recovered_acceptance', outcome: 'already_absent' }));
      await drain();
      expect((await db.collection(DELIVERY_QUEUE).doc(accepted.id).get()).exists).toBe(true);
    }
    expect(server.calls.every(call => call.method === 'GET')).toBe(true);
  });
  it('logs the removal safety check while retaining the copy and existing retry state', async () => {
    const accepted = await send(); const ids = accepted.actual!.ids;
    delete server.workouts.get(ids.workout)!.workout_summary;
    await command('stop'); await drain();
    const writes = server.calls.filter(call => call.method !== 'GET').length;
    await processTrainingDelivery(runtime, uid, accepted.id);
    expect(logger.warn).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'failure', provider: 'wahoo', category: 'uncertain', retryCount: 1,
      failurePhase: 'contract', wahooContractCheck: 'workout_completion_unknown',
    }));
    const row = await ledger();
    expect(row).toMatchObject({ status: 'retrying', desired: 'absent', actual: { ids }, retries: 1 });
    expect(JSON.stringify(row)).not.toContain('wahooContractCheck');
    expect(server.calls.filter(call => call.method !== 'GET')).toHaveLength(writes);
    const logs = JSON.stringify(vi.mocked(logger.warn).mock.calls);
    expect(logs).not.toContain(uid); expect(logs).not.toContain(ids.externalId); expect(logs).not.toContain(ids.workoutToken);
  });
  it('sends full timed strength with normal consent, serializes concurrent workers and updates load/rest/date in place before Stop', async () => {
    const details = wahooFixtureStrengthDetails();
    const ref = user().collection('scheduledWorkouts').doc('w');
    await ref.update({ structure: projectStrengthWorkoutToV1(details), title: 'Synthetic timed strength' });
    await ref.collection('strengthDetails').doc('current').set(details);
    await command('send'); await drain(); const row = await ledger();
    await Promise.all([processTrainingDelivery(runtime, uid, row.id), processTrainingDelivery(runtime, uid, row.id)]); await drain();
    const first = await ledger();
    expect(first.status).toBe('delivered'); expect(first.approvalDigest).toBeNull();
    expect(first.issues.join(' ')).toContain('not native rep/load tracking');
    const ids = first.actual!.ids;
    expect(server.plans.get(ids.plan)).toMatchObject({ workout_type_family_id: 6, workout_type_location_id: 0 });
    expect(server.workouts.get(ids.workout)).toMatchObject({ workout_type_id: 42, minutes: 5 });
    details.exercises[0].sets[0].externalLoadKg = 2.5;
    await ref.collection('strengthDetails').doc('current').set(details); await mark();
    await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect((await ledger()).acceptedDigest).not.toBe(first.acceptedDigest);
    expect(JSON.stringify(server.plans.get(ids.plan)?.fixtureRecipe)).toContain('load guidance: 2.5 kg');
    details.exercises[0].sets[0].restAfterSeconds = 45;
    const batch = db.batch(); batch.update(ref, { structure: projectStrengthWorkoutToV1(details), localDate: '2026-10-31', updatedAtMs: now });
    batch.set(ref.collection('strengthDetails').doc('current'), details); await batch.commit(); await mark();
    await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect(await ledger()).toMatchObject({ status: 'delivered', actual: { ids, localDate: '2026-10-31' } });
    expect(server.workouts.get(ids.workout)).toMatchObject({ minutes: 5.25, starts: '2026-10-31T10:00:00.000Z' });
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
    await command('stop'); await drain(); await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect(server.workouts.size).toBe(0); expect(server.plans.size).toBe(0);
  });
  it.each(WAHOO_SPORT_FIXTURES)('delivers $sport, updates/reschedules retained identities, and withdraws on Stop after any required mapping review', async ({ sport, family, type, location, level }) => {
    const ref = user().collection('scheduledWorkouts').doc('w');
    const workout = wahooFixtureWorkout(); workout.structure.sport = sport;
    await ref.set(workout);
    await command('send'); await drain(); const row = await ledger();
    if (level === 'degraded') {
      expect(row.status).toBe('approval_required');
      await processTrainingDelivery(runtime, uid, row.id);
      expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(0);
      await command('approve', 'Europe/Helsinki', row.approvalDigest!); await drain();
    }
    await Promise.all([processTrainingDelivery(runtime, uid, row.id), processTrainingDelivery(runtime, uid, row.id)]); await drain();
    const ids = (await ledger()).actual!.ids;
    expect((await ledger()).status).toBe('delivered');
    expect(server.plans.get(ids.plan)).toMatchObject({ workout_type_family_id: family, workout_type_location_id: location });
    expect(server.workouts.get(ids.workout)).toMatchObject({ workout_type_id: type, minutes: 1.5 });
    workout.title = 'Edited synthetic walk'; workout.localDate = '2026-10-31'; workout.updatedAtMs = now;
    workout.structure.nodes = [{ kind: 'step', id: 'longer', purpose: 'work', ending: { kind: 'time', seconds: 300 }, targets: [] }];
    await ref.set(workout); await mark();
    if (level === 'degraded') {
      const pending = await ledger(); expect(pending.status).toBe('approval_required');
      await expect(command('approve', 'Europe/Helsinki', row.approvalDigest!)).rejects.toThrow();
      await command('approve', 'Europe/Helsinki', pending.approvalDigest!); await drain();
    }
    await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect(await ledger()).toMatchObject({ status: 'delivered', actual: { ids, localDate: '2026-10-31' } });
    expect(server.workouts.get(ids.workout)).toMatchObject({ workout_type_id: type, minutes: 5, starts: '2026-10-31T10:00:00.000Z' });
    await processTrainingDelivery(runtime, uid, row.id);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
    await command('stop'); await drain(); await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect(server.workouts.size).toBe(0); expect(server.plans.size).toBe(0);
    expect((await ref.get()).data()?.structure.sport).toBe(sport);
  });
  it('fences a strength load-only edit after Plan acceptance before creating the dated Workout', async () => {
    const details = wahooFixtureStrengthDetails(); const ref = user().collection('scheduledWorkouts').doc('w');
    await ref.update({ structure: projectStrengthWorkoutToV1(details) });
    await ref.collection('strengthDetails').doc('current').set(details);
    server.afterHandle = async request => { if (request.method === 'POST' && request.path === '/v1/plans') {
      server.afterHandle = null; details.exercises[0].sets[0].externalLoadKg = 2.5;
      await ref.collection('strengthDetails').doc('current').set(details);
    } };
    await send(); expect(server.plans.size).toBe(1); expect(server.workouts.size).toBe(0);
  });
  it.each([ActivityTypes.Walking, ActivityTypes.Hiking, ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming,
    ActivityTypes.Rowing, ActivityTypes.IndoorRowing, ActivityTypes.StrengthTraining])(
    'recovers %s without duplicates, retains IDs after same-account reconnect and protects the exact linked completion on Stop', async sport => {
      const ref = user().collection('scheduledWorkouts').doc('w');
      if (sport === ActivityTypes.StrengthTraining) {
        const details = wahooFixtureStrengthDetails();
        await ref.update({ structure: projectStrengthWorkoutToV1(details) });
        await ref.collection('strengthDetails').doc('current').set(details);
      } else await ref.update({ 'structure.sport': sport });
      server.afterHandle = async request => {
        if (request.method === 'POST' && request.path === '/v1/workouts') {
          server.afterHandle = null;
          throw new WahooTrainingHttpError('uncertain', false);
        }
      };
      const row = await send(); expect(row.status).toBe('retrying');
      await command('retry'); await drain(); await processTrainingDelivery(runtime, uid, row.id); await drain();
      const accepted = await ledger(); expect(accepted.status).toBe('delivered');
      const ids = accepted.actual!.ids;
      const batch = db.batch();
      batch.update(tokenRoot(), { activeOAuthCredentialGeneration: 'reconnected' });
      batch.update(tokenRoot().collection('tokens').doc('123'), { tokenCredentialGeneration: 'reconnected' });
      batch.update(user().collection('meta').doc(ServiceNames.WahooAPI), { connectionStateGeneration: 'reconnected' });
      await batch.commit(); await mark(); await processTrainingDelivery(runtime, uid, row.id); await drain();
      expect(await ledger()).toMatchObject({ status: 'delivered', actual: { ids } });
      expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
      await user().collection('events').doc('recording').set({ test: true });
      const result = await retainWahooTrainingCompletion(db, uid, 'recording', {
        providerUserId: '123', connectionStateGeneration: 'reconnected', activeCredentialGeneration: 'reconnected', credential: null,
      }, ids.workout, ids.plan, ids.workoutToken!, '999', [{ id: 'activity', startTimeMs: now }], now);
      expect(result).toMatchObject({ retained: true, linkedWorkoutIds: ['w'] });
      expect((await user().collection('trainingWorkoutCompletions').doc('w').get()).data())
        .toMatchObject({ provider: 'wahoo', eventId: 'recording', activityId: 'activity', matchMethod: 'provider_marker' });
      const writes = server.calls.filter(call => call.method !== 'GET').length;
      await command('stop'); await drain(); await processTrainingDelivery(runtime, uid, row.id); await drain();
      expect(await ledger()).toMatchObject({ status: 'completed', desired: 'preserve', actual: { ids, completed: true } });
      expect(server.calls.filter(call => call.method !== 'GET')).toHaveLength(writes);
      expect(server.workouts.size).toBe(1); expect(server.plans.size).toBe(1);
    });
  it.each([ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming, ActivityTypes.Rowing, ActivityTypes.IndoorRowing])(
    'refreshes a stale %s validation warning without replacing an already delivered copy', async sport => {
      await user().collection('scheduledWorkouts').doc('w').update({ 'structure.sport': sport });
      const accepted = await send(); expect(accepted.status).toBe('delivered');
      await user().collection(DELIVERY_LEDGER).doc(accepted.id).update({ status: 'approval_required',
        approvalDigest: accepted.desiredDigest, issues: ['Obsolete profile validation warning'] });
      await mark(); await processTrainingDelivery(runtime, uid, accepted.id); await drain();
      expect(await ledger()).toMatchObject({ status: 'delivered', actual: { ids: accepted.actual!.ids }, issues: [] });
      expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
    });
  it('admits one worker, checkpoints both resources, and verifies all three cloud keys', async () => {
    await command('send'); await drain(); const row = await ledger();
    await Promise.all([processTrainingDelivery(runtime, uid, row.id), processTrainingDelivery(runtime, uid, row.id)]); await drain();
    expect((await ledger()).status).toBe('delivered'); expect(server.plans.size).toBe(1); expect(server.workouts.size).toBe(1);
    await processTrainingVerification(runtime, uid, row.id); expect((await ledger()).verification?.state).toBe('present');
  });
  it('shows missing Training grants without changing existing imports or issuing provider requests', async () => {
    const oldScopes = 'user_read workouts_read workouts_write routes_read routes_write offline_data';
    await tokenRoot().collection('tokens').doc('123').update({ scope: oldScopes });
    const authority = await db.runTransaction(tx => readTrainingDeliveryAuthority(db, tx, uid, 'wahoo'));
    expect(authority.connection).toMatchObject({ state: 'connection_repair', issues: [expect.stringContaining('Reconnect Wahoo')] });
    await expect(command('send')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(server.calls).toHaveLength(0);
    expect((await tokenRoot().collection('tokens').doc('123').get()).data()?.scope).toBe(oldScopes);
    await tokenRoot().collection('tokens').doc('123').update({ scope: WAHOO_API_SCOPES });
    expect((await send()).status).toBe('delivered');
  });
  it('withdraws outside the rolling horizon and sends latest content when the date enters', async () => {
    const first = await send();
    await user().collection('scheduledWorkouts').doc('w').update({ localDate: '2026-11-05', title: 'Later run', updatedAtMs: now }); await mark();
    expect((await ledger()).desired).toBe('absent'); await processTrainingDelivery(runtime, uid, first.id); await drain();
    expect((await ledger()).status).toBe('outside_horizon'); expect(server.plans.size).toBe(0); expect(server.workouts.size).toBe(0);
    now = Date.parse('2026-10-30T12:00:00Z'); await mark(); await processTrainingDelivery(runtime, uid, first.id); await drain();
    const current = await ledger(); expect(current.status).toBe('delivered');
    expect(current.actual!.ids.externalId).toBe(first.actual!.ids.externalId);
    expect([...server.workouts.values()][0].name).toBe('Later run');
  });
  it.each(['/v1/plans', '/v1/workouts'])('recovers lost %s creation via explicit Retry without duplicate POST', async path => {
    server.afterHandle = async request => { if (request.method === 'POST' && request.path === path) {
      server.afterHandle = null; throw new WahooTrainingHttpError('uncertain', false);
    } };
    const row = await send(); expect(row.status).toBe('retrying');
    await command('retry'); await drain(); await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect((await ledger()).status).toBe('delivered'); expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
  });
  it('does not turn provider application access errors into a reconnect loop', async () => {
    server.beforeHandle = async request => { if (request.method === 'POST') throw new WahooTrainingHttpError('provider_access', true); };
    const row = await send(); expect(row.status).toBe('provider_unavailable'); expect(row.blockedConnectionGeneration).toBeNull();
    expect(row.issues).toEqual([expect.stringContaining('Reconnecting may not resolve')]);
    const calls = server.calls.length; now = row.retryAtMs + 1; await mark(); await processTrainingDelivery(runtime, uid, row.id);
    expect(server.calls).toHaveLength(calls); expect((await ledger()).status).toBe('provider_unavailable');
    server.beforeHandle = null; await command('retry'); await drain(); await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect((await ledger()).status).toBe('delivered');
  });
  it('reschedules retained IDs after a date-line time-zone settings edit', async () => {
    await user().collection('scheduledWorkouts').doc('w').update({ localDate: '2026-10-29' });
    await command('send', 'Pacific/Pago_Pago'); await drain();
    const row = await ledger(); await processTrainingDelivery(runtime, uid, row.id); await drain();
    const ids = (await ledger()).actual!.ids;
    await command('send', 'Pacific/Kiritimati'); await drain();
    await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect(await ledger()).toMatchObject({ status: 'delivered', actual: { ids, timeZone: 'Pacific/Kiritimati' } });
    expect(server.workouts.get(ids.workout)?.starts).toBe('2026-10-28T22:00:00.000Z');
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
  });
  it.each(['completed', 'past'])('retires lost-response creation after the provider copy becomes %s', async status => {
    server.afterHandle = async request => { if (request.method === 'POST' && request.path === '/v1/workouts') {
      server.afterHandle = null; throw new WahooTrainingHttpError('uncertain', false);
    } };
    const row = await send();
    if (status === 'completed') [...server.workouts.values()][0].workout_summary = { id: 42 };
    else now = Date.parse('2026-10-26T12:00:00Z');
    const writes = server.calls.filter(call => call.method !== 'GET').length;
    await command('retry'); await drain(); await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect(await ledger()).toMatchObject({ status, desired: 'preserve', attempt: null });
    expect((await ledger()).completionLinkId).toBeFalsy();
    expect(server.calls.filter(call => call.method !== 'GET')).toHaveLength(writes);
    expect(server.workouts.size).toBe(1); expect(server.plans.size).toBe(1);
  });
  it.each(['stop', 'edit', 'deletion', 'disconnect'])('guards %s between Plan acceptance and Workout creation', async change => {
    server.afterHandle = async request => { if (request.method === 'POST' && request.path === '/v1/plans') {
      server.afterHandle = null;
      if (change === 'stop') await command('stop');
      if (change === 'edit') await user().collection('scheduledWorkouts').doc('w').update({ title: 'Changed mid-flight' });
      if (change === 'deletion') await db.collection('userDeletionTombstones').doc(uid).set({});
      if (change === 'disconnect') await user().collection('meta').doc(ServiceNames.WahooAPI).update({ connectionState: 'reconnect_required' });
    } };
    await send(); expect(server.workouts.size).toBe(0); expect(server.plans.size).toBe(1);
  });
  it('preserves on Pro loss, but explicit Stop removes owned future copies', async () => {
    const row = await send(); pro = false;
    await user().collection('scheduledWorkouts').doc('w').update({ title: 'Paused edit' }); await mark();
    await processTrainingDelivery(runtime, uid, row.id); expect((await ledger()).status).toBe('paused_pro'); expect(server.workouts.size).toBe(1);
    await command('stop'); await drain(); await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect(server.workouts.size).toBe(0); expect(server.plans.size).toBe(0);
  });
  it('preserves a provider-confirmed completion without creating a QS activity link', async () => {
    const row = await send(); server.workouts.get(row.actual!.ids.workout)!.workout_summary = { id: 42 };
    await processTrainingVerification(runtime, uid, row.id); await drain();
    const completed = await ledger(); expect(completed.actual?.completed).toBe(true); expect(completed.completionLinkId).toBeFalsy();
    await command('stop'); await drain(); await processTrainingDelivery(runtime, uid, row.id);
    expect(server.workouts.size).toBe(1); expect(server.plans.size).toBe(1);
  });
});
