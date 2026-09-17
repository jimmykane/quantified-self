import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
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
  const command = async (action: TrainingDeliveryCommandV1['action']) => {
    const setting = await user().collection('trainingDeliverySettings').doc('workout_w_wahoo').get();
    return trainingDeliveryCommand(runtime, uid, { schemaVersion: 1, mutationId: randomUUID(), scope: 'workout', scopeId: 'w', provider: 'wahoo',
      action, expectedScheduleRevision: 1, expectedScopeRevision: 1, expectedSettingsRevision: setting.data()?.revision ?? 0,
      ...(action === 'send' ? { timeZone: 'Europe/Helsinki' } : {}) }, false);
  };
  const send = async () => { await command('send'); await drain(); const row = await ledger(); await processTrainingDelivery(runtime, uid, row.id); await drain(); return ledger(); };
  beforeEach(async () => {
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
