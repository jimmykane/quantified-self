import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ActivityTypes, ServiceNames } from '@sports-alliance/sports-lib';
import { TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID, type ScheduledWorkoutV1 } from '../../../shared/training-plans';
import { deliverySettingsId, type TrainingDeliveryCommandV1 } from '../../../shared/training-provider-delivery';
import { trainingDeliveryCommand } from '../training-plans/delivery/commands';
import { createWorkoutWithDeliveryForUser } from '../training-plans/create-workout-with-delivery';
import { deliveryIdentity } from '../training-plans/delivery/intent';
import { reconcileTrainingDeliveryPage } from '../training-plans/delivery/store';
import { processTrainingDelivery } from '../training-plans/delivery/worker';
import { FakeTrainingTransport } from '../training-plans/delivery/test-support/fake-transport';
import { CorosTrainingTransport } from '../training-plans/delivery/coros/transport';
import { reserveCorosIntegerIdentities } from '../training-plans/delivery/coros/identities';
import type { DeliveryLedgerV1, DeliveryRuntime } from '../training-plans/delivery/contracts';
import type { ActivityPushDependencies } from './activity-service';
import { observeTrainingSend, sendTrainingSendResult } from './training-send-service';
import { TRAINING_SEND, trainingSendId } from './training-send-policy';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('explicit Training send notifications', { timeout: 30_000 }, () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Loopback emulator required.');
  const db = new Firestore({ projectId: 'demo-training-send' });
  const origin = 'https://beta.quantified-self.io', key = 'B' + 'A'.repeat(86);
  const device = '00000000-0000-4000-8000-000000000001', generation = '00000000-0000-4000-8000-000000000002';
  let uid: string, root: string, now: number, destination: string, runtime: DeliveryRuntime, transport: FakeTrainingTransport;
  let deps: ActivityPushDependencies;
  const users: string[] = [];
  const stateRef = (scope: 'plan' | 'workout' = 'workout', id = 'w') => db.doc(`${root}/pushState/${trainingSendId(scope, id, 'garmin')}`);
  const workout = (id = 'w', planId: string | null = null): ScheduledWorkoutV1 => ({ schemaVersion: 1, id, planId, revision: 1,
    title: 'private-workout-canary', localDate: '2026-11-17', lifecycle: 'planned', createdAtMs: 1, updatedAtMs: 1,
    structure: { version: 1, sport: ActivityTypes.Running,
      nodes: [{ id: 'step', kind: 'step', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [] }] } });
  const command = async (patch: Partial<TrainingDeliveryCommandV1> = {}, preview = false) => {
    const raw = { schemaVersion: 1, mutationId: randomUUID(), scope: 'workout', scopeId: 'w', provider: 'garmin', action: 'send',
      expectedScheduleRevision: 1, expectedScopeRevision: 1, timeZone: 'UTC', ...patch } as TrainingDeliveryCommandV1;
    raw.expectedSettingsRevision ??= (await db.doc(`${root}/trainingDeliverySettings/${deliverySettingsId(raw.scope, raw.scopeId, raw.provider)}`).get()).get('revision') ?? 0;
    return { raw, result: await trainingDeliveryCommand(runtime, uid, raw, preview) };
  };
  const drain = async () => { for (let i = 0; i < 150; i++) if (!await reconcileTrainingDeliveryPage(runtime, uid)) return; throw new Error('Unbounded scan.'); };
  const ledgers = async () => (await db.collection(`${root}/trainingDeliveryLedger`).get()).docs.map(doc => doc.data() as DeliveryLedgerV1);
  const observe = async (id: string) => observeTrainingSend(uid, (await db.doc(`${root}/trainingDeliveryStatuses/${id}`).get()).data(), { db, now: () => now });
  const deliver = async () => {
    now += 1000;
    for (const ledger of await ledgers()) { await processTrainingDelivery(runtime, uid, ledger.id); await observe(ledger.id); }
  };
  const flush = async (scope: 'plan' | 'workout' = 'workout', id = 'w') => sendTrainingSendResult(uid, trainingSendId(scope, id, 'garmin'), deps);
  const plan = async (count = 20, provider: 'garmin' | 'coros' = 'garmin') => {
    const batch = db.batch(); batch.set(db.doc(`${root}/trainingPlans/p`), { revision: 1, lifecycle: 'active' });
    for (let i = 0; i < count; i++) batch.set(db.doc(`${root}/scheduledWorkouts/w${i}`), workout(`w${i}`, 'p'));
    await batch.commit();
    return command({ scope: 'plan', scopeId: 'p', action: 'configure', provider });
  };
  beforeEach(async () => {
    uid = `send-${randomUUID()}`; users.push(uid); root = `users/${uid}`; now = Date.UTC(2026, 10, 16, 12);
    destination = deliveryIdentity(uid, 'garmin', 'account', 'account'); transport = new FakeTrainingTransport(); transport.horizonDays = 14;
    runtime = { db, now: () => now, hasPro: async () => true, transport: () => transport,
      notificationConfiguration: vi.fn(async () => ({ enabled: true, publicKey: key })),
      connection: async tx => ({ state: 'connected', destinationKey: destination, generation: 'connection',
        epoch: (await tx.get(db.doc(`${root}/trainingDeliveryState/current`))).get('connectionEpochs.garmin') ?? 0 }) };
    deps = { db, now: () => now, configuration: vi.fn(async () => ({ enabled: true, publicKey: key })),
      send: vi.fn(async () => ({})), outcome: vi.fn() };
    const batch = db.batch(); batch.set(db.doc(root), {});
    batch.set(db.doc(`${root}/trainingPlanState/current`), { schemaVersion: 1, revision: 1, activePlanId: null, currentWorkoutCount: 1, updatedAtMs: 1 });
    batch.set(db.doc(`${root}/scheduledWorkouts/w`), workout());
    batch.set(db.doc(`${root}/meta/${ServiceNames.GarminAPI}`), { connectionState: 'connected', providerUserId: 'account' });
    batch.set(db.doc(`${root}/pushSubscriptions/${device}`), { schemaVersion: 1, generation, origin, vapidPublicKey: key,
      endpoint: 'https://web.push.apple.com/synthetic', keys: { p256dh: key, auth: 'A'.repeat(22) } }); await batch.commit();
  });
  afterAll(async () => { for (const id of users) await db.recursiveDelete(db.doc(`users/${id}`)); await db.terminate(); });

  it('sends exactly one result for twenty workouts, after all pages complete, with competing claims and duplicate status events', async () => {
    await plan(); expect((await stateRef('plan', 'p').get()).get('total')).toBe(20); await drain();
    const rows = await ledgers(); now += 1000;
    for (const ledger of rows.slice(0, 10)) { await processTrainingDelivery(runtime, uid, ledger.id); await observe(ledger.id); }
    await flush('plan', 'p'); expect(deps.send).not.toHaveBeenCalled();
    for (const ledger of rows.slice(10)) { await processTrainingDelivery(runtime, uid, ledger.id); await observe(ledger.id); }
    await Promise.all([observe(rows[0].id), observe(rows[0].id)]);
    await Promise.all([flush('plan', 'p'), flush('plan', 'p')]); await flush('plan', 'p');
    expect(deps.send).toHaveBeenCalledOnce(); const payload = JSON.parse(vi.mocked(deps.send).mock.calls[0][1]);
    expect(payload.web_push).toBe(8030); expect(payload.notification.body).toBe('Your 20 workouts were sent to Garmin.');
    expect(payload.notification.navigate).toBe(origin + '/training/plans/plan/p?sync=attention');
    expect(JSON.stringify(payload)).not.toContain('private-workout-canary');
  });
  it('returns one partial result and owns its per-workout failures', async () => {
    await plan(3); await drain(); now += 1000;
    const rows = await ledgers(); await processTrainingDelivery(runtime, uid, rows[0].id); await observe(rows[0].id);
    for (const row of rows.slice(1)) {
      await db.doc(`${root}/trainingDeliveryLedger/${row.id}`).update({ status: 'failed', updatedAtMs: now });
      await db.doc(`${root}/trainingDeliveryStatuses/${row.id}`).update({ status: 'failed', updatedAtMs: now });
      expect(await observe(row.id)).toBe(true);
    }
    await flush('plan', 'p'); expect(deps.send).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(deps.send).mock.calls[0][1]).notification.body).toBe('1 of 3 workouts were sent to Garmin. 2 need attention.');
    expect(await observe(rows[1].id)).toBe(true); // Replayed failure remains covered after the summary claim.
    now += 1000; await db.doc(`${root}/trainingDeliveryStatuses/${rows[1].id}`).update({ updatedAtMs: now });
    expect(await observe(rows[1].id)).toBe(false); // A later background incident is independent.
  });
  it('waits for multiple COROS transport batches rather than notifying once per accepted provider batch', async () => {
    const client = vi.fn(async (request: { data?: string }, beforeSend: () => Promise<void>) => {
      await beforeSend(); const payload = JSON.parse(request.data!);
      return { status: 200, body: { result: '0000', message: 'OK', data: {
        StartDate: payload.StartDate.replaceAll('-', ''), EndDate: payload.EndDate.replaceAll('-', ''),
      } } };
    });
    const coros = new CorosTrainingTransport(client, () => now, reserveCorosIntegerIdentities);
    destination = deliveryIdentity(uid, 'coros', 'account', 'account'); runtime.transport = provider => provider === 'coros' ? coros : null;
    await db.doc(`${root}/meta/${ServiceNames.COROSAPI}`).set({ connectionState: 'connected', providerUserId: 'account' });
    await plan(31, 'coros'); await drain(); now += 1000;
    const rows = await ledgers(); expect(rows).toHaveLength(31);
    await processTrainingDelivery(runtime, uid, rows[0].id);
    for (const row of rows) await observe(row.id);
    await sendTrainingSendResult(uid, trainingSendId('plan', 'p', 'coros'), deps); expect(deps.send).not.toHaveBeenCalled();
    const pending = (await ledgers()).find(row => row.status !== 'delivered')!;
    await processTrainingDelivery(runtime, uid, pending.id); for (const row of rows) await observe(row.id);
    await sendTrainingSendResult(uid, trainingSendId('plan', 'p', 'coros'), deps);
    expect(client).toHaveBeenCalledTimes(2); expect(deps.send).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(deps.send).mock.calls[0][1]).notification.body).toBe('Your 31 workouts were sent to COROS.');
  });
  it('includes explicit Add & send, without turning a receipt replay into a second result', async () => {
    const request = { mutationId: randomUUID(), expectedRevisions: [{ scope: 'state' as const, id: 'current', revision: 1 }],
      operation: { kind: 'create-workout' as const, workoutId: 'new', planId: null, localDate: '2026-11-17', title: 'New run',
        confirmPlanRangeExtension: false, structure: workout().structure } };
    await createWorkoutWithDeliveryForUser(uid, request, { providers: ['garmin'], timeZone: 'UTC' }, runtime);
    expect((await stateRef('workout', 'new').get()).get('total')).toBe(1);
    await drain(); await deliver(); await flush('workout', 'new'); expect(deps.send).toHaveBeenCalledOnce();
    await createWorkoutWithDeliveryForUser(uid, request, { providers: ['garmin'], timeZone: 'UTC' }, runtime);
    await flush('workout', 'new'); expect(deps.send).toHaveBeenCalledOnce();
  });
  it('captures a plan-workout manual retry through inherited consent, and excludes suppressed plan workouts', async () => {
    await plan(2); await command({ scopeId: 'w0', action: 'stop' });
    await stateRef('plan', 'p').delete(); await command({ scope: 'plan', scopeId: 'p', action: 'retry' });
    expect((await stateRef('plan', 'p').get()).get('total')).toBe(1);
    await command({ scopeId: 'w1', action: 'retry' });
    expect((await stateRef('workout', 'w1').get()).get('total')).toBe(1);
    await drain(); await deliver(); await flush('workout', 'w1'); expect(deps.send).toHaveBeenCalledOnce();
    await flush('plan', 'p'); expect(deps.send).toHaveBeenCalledOnce(); // The newer workout command supersedes the older plan result.
  });
  it('replays the mutation receipt without recreating a claim, and a no-op send stays silent', async () => {
    const { raw } = await command(); await drain(); await deliver(); await flush(); expect(deps.send).toHaveBeenCalledOnce();
    const before = (await stateRef().get()).data(); await trainingDeliveryCommand(runtime, uid, raw, false);
    expect((await stateRef().get()).data()).toEqual(before);
    now += 1000; await command(); await drain(); await flush(); expect(deps.send).toHaveBeenCalledOnce();
  });
  it('captures a manual retry as a new result, while automatic retry waits silently', async () => {
    await command(); await drain(); const row = (await ledgers())[0];
    await db.doc(`${root}/trainingDeliveryLedger/${row.id}`).update({ status: 'retrying' });
    await db.doc(`${root}/trainingDeliveryStatuses/${row.id}`).update({ status: 'retrying' });
    expect(await observe(row.id)).toBe(false); await flush(); expect(deps.send).not.toHaveBeenCalled();
    await db.doc(`${root}/trainingDeliveryLedger/${row.id}`).update({ status: 'failed', updatedAtMs: ++now });
    await db.doc(`${root}/trainingDeliveryStatuses/${row.id}`).update({ status: 'failed', updatedAtMs: now });
    await observe(row.id); await flush(); expect(deps.send).toHaveBeenCalledOnce();
    now += 1000; await command({ action: 'retry' }); await drain(); await deliver(); await flush();
    expect(deps.send).toHaveBeenCalledTimes(2);
  });
  it('does not capture previews, routine configuration, Resume, Stop or background delivery', async () => {
    await command({}, true); expect(runtime.notificationConfiguration).not.toHaveBeenCalled(); expect((await stateRef().get()).exists).toBe(false);
    await plan(1); const old = (await stateRef('plan', 'p').get()).data();
    now += 1000; await command({ scope: 'plan', scopeId: 'p', action: 'configure' });
    expect((await stateRef('plan', 'p').get()).data()).toEqual(old);
    await stateRef('plan', 'p').delete(); await drain(); await deliver(); await flush('plan', 'p');
    expect(deps.send).not.toHaveBeenCalled();
    await command({ action: 'send' }); await stateRef().delete();
    await command({ action: 'stop' }); await command({ action: 'resume' });
    expect((await stateRef().get()).exists).toBe(false);
  });
  it.each(['flag', 'category', 'no devices', 'old key', 'malformed category'])('does not capture without %s admission', async reason => {
    if (reason === 'flag') runtime.notificationConfiguration = async () => ({ enabled: false, publicKey: key });
    if (reason === 'category') await db.doc(`${root}/notificationPreferences/training_send`).set({ schemaVersion: 1, enabled: false, revision: 1 });
    if (reason === 'malformed category') await db.doc(`${root}/notificationPreferences/training_send`).set({ enabled: true });
    if (reason === 'no devices') await db.doc(`${root}/pushSubscriptions/${device}`).delete();
    if (reason === 'old key') await db.doc(`${root}/pushSubscriptions/${device}`).update({ vapidPublicKey: 'C' + 'A'.repeat(86) });
    await command(); expect((await stateRef().get()).exists).toBe(false);
  });
  it.each([[false, true], [true, false]])('keeps send results independent with attention=%s and results=%s', async (attention, results) => {
    const batch = db.batch();
    batch.set(db.doc(`${root}/notificationPreferences/training_sync`), { schemaVersion: 1, enabled: attention, revision: 1 });
    batch.set(db.doc(`${root}/notificationPreferences/training_send`), { schemaVersion: 1, enabled: results, revision: 1 });
    await batch.commit();
    await command(); expect((await stateRef().get()).exists).toBe(results);
    await drain(); await deliver(); await flush();
    expect(deps.send).toHaveBeenCalledTimes(results ? 1 : 0);
  });
  it('does not cancel a captured result when only the attention category changes', async () => {
    await command(); await drain(); await deliver();
    await db.doc(`${root}/notificationPreferences/training_sync`).set({ schemaVersion: 1, enabled: false, revision: 1 });
    await flush(); expect(deps.send).toHaveBeenCalledOnce();
  });
  it.each(['past', 'outside horizon', 'completed'])('ignores %s workouts', async reason => {
    if (reason === 'past') await db.doc(`${root}/scheduledWorkouts/w`).update({ localDate: '2026-11-15' });
    if (reason === 'outside horizon') await db.doc(`${root}/scheduledWorkouts/w`).update({ localDate: '2027-02-01' });
    if (reason === 'completed') await db.doc(`${root}/trainingWorkoutCompletions/w`).set({});
    await command(); expect((await stateRef().get()).exists).toBe(false);
  });
  it.each(['flag', 'category', 'device', 'generation', 'key', 'epoch', 'account', 'reconnect', 'edit', 'completion', 'stop', 'lock', 'expired'])('cancels a ready result after %s changes', async reason => {
    await command(); await drain(); await deliver();
    if (reason === 'flag') deps.configuration = async () => ({ enabled: false, publicKey: key });
    if (reason === 'category') await db.doc(`${root}/notificationPreferences/training_send`).set({ schemaVersion: 1, enabled: false, revision: 1 });
    if (reason === 'device') await db.doc(`${root}/pushSubscriptions/${device}`).delete();
    if (reason === 'generation') await db.doc(`${root}/pushSubscriptions/${device}`).update({ generation: randomUUID() });
    if (reason === 'key') deps.configuration = async () => ({ enabled: true, publicKey: 'C' + 'A'.repeat(86) });
    if (reason === 'epoch') await db.doc(`${root}/trainingDeliveryState/current`).update({ 'connectionEpochs.garmin': 1 });
    if (reason === 'account') await db.doc(`${root}/meta/${ServiceNames.GarminAPI}`).update({ providerUserId: 'other-account' });
    if (reason === 'reconnect') await db.doc(`${root}/meta/${ServiceNames.GarminAPI}`).update({ activityNotificationConnectedAtMs: now + 1 });
    if (reason === 'edit') await db.doc(`${root}/scheduledWorkouts/w`).update({ title: 'Edited', updatedAtMs: now + 1 });
    if (reason === 'completion') await db.doc(`${root}/trainingWorkoutCompletions/w`).set({});
    if (reason === 'stop') await command({ action: 'stop' });
    if (reason === 'lock') await db.doc(`${root}/trainingPlanState/current/${TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID}/_bulk_restore`).set({});
    if (reason === 'expired') now += TRAINING_SEND.expiryMs + 1;
    await flush(); await flush(); expect(deps.send).not.toHaveBeenCalled();
  });
  it('does not mistake a missing acceptance timestamp or a stale content version for success', async () => {
    await command(); await drain(); await deliver(); const row = (await ledgers())[0];
    await db.doc(`${root}/trainingDeliveryLedger/${row.id}`).update({ lastAcceptedAtMs: null });
    await flush(); expect(deps.send).not.toHaveBeenCalled(); expect((await stateRef().get()).get('finished')).not.toBe(true);
    await db.doc(`${root}/trainingDeliveryLedger/${row.id}`).update({ lastAcceptedAtMs: now, contentDigest: 'changed' });
    expect(await observe(row.id)).toBe(false); expect((await stateRef().get()).get('finished')).toBe(true);
  });
  it('silences a request when reconciliation proves every captured workout was already accepted before it', async () => {
    await command(); await drain(); const row = (await ledgers())[0];
    await db.doc(`${root}/trainingDeliveryLedger/${row.id}`).update({ status: 'delivered',
      actual: { ids: { workout: 'already-sent' } }, acceptedContentDigest: row.contentDigest, lastAcceptedAtMs: now - 1 });
    await db.doc(`${root}/trainingDeliveryStatuses/${row.id}`).update({ status: 'delivered' });
    await observe(row.id); await flush(); expect(deps.send).not.toHaveBeenCalled();
    expect((await stateRef().get()).get('finished')).toBe(true);
  });
  it('rechecks the schedule before the second device wave after a source edit', async () => {
    const registration = (await db.doc(`${root}/pushSubscriptions/${device}`).get()).data()!;
    for (let i = 2; i <= 6; i++) await db.doc(`${root}/pushSubscriptions/00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
      .set({ ...registration, endpoint: `https://web.push.apple.com/device${i}` });
    await command(); await drain(); await deliver(); let first = true;
    vi.mocked(deps.send).mockImplementation(async () => {
      if (first) { first = false; await db.doc(`${root}/trainingPlanState/current`).update({ revision: 2 }); }
      return {};
    });
    await flush(); expect(vi.mocked(deps.send).mock.calls.length).toBeGreaterThan(0);
    expect(vi.mocked(deps.send).mock.calls.length).toBeLessThanOrEqual(5);
  });
  it('fans out to both beta and production, skips endpoint aliases and removes only expired generations', async () => {
    const registration = (await db.doc(`${root}/pushSubscriptions/${device}`).get()).data()!;
    await db.doc(`${root}/pushSubscriptions/00000000-0000-4000-8000-000000000003`).set({ ...registration, origin: 'https://quantified-self.io', endpoint: 'https://web.push.apple.com/prod' });
    const alias = '00000000-0000-4000-8000-000000000004', aliasGeneration = randomUUID();
    await db.doc(`${root}/pushSubscriptions/${alias}`).set({ ...registration, generation: aliasGeneration });
    await command(); await drain(); await deliver();
    vi.mocked(deps.send).mockImplementation(async target => { if (target.origin === origin) throw { statusCode: 410 }; return {}; });
    await flush(); expect(deps.send).toHaveBeenCalledTimes(2);
    const expired = vi.mocked(deps.send).mock.calls.find(([target]) => target.origin === origin)![0];
    expect((await db.doc(`${root}/pushSubscriptions/${expired.generation === aliasGeneration ? alias : device}`).get()).exists).toBe(false);
  });
  it('never replays an ambiguous transport failure', async () => {
    await command(); await drain(); await deliver(); vi.mocked(deps.send).mockRejectedValue(new Error('private-transport-canary'));
    await flush(); await flush(); expect(deps.send).toHaveBeenCalledOnce(); expect(deps.outcome).toHaveBeenCalledWith('failed');
  });
  it('keeps a newly registered device when the previous generation expires during transport', async () => {
    await command(); await drain(); await deliver(); const next = randomUUID();
    vi.mocked(deps.send).mockImplementation(async () => {
      await db.doc(`${root}/pushSubscriptions/${device}`).update({ generation: next }); throw { statusCode: 410 };
    });
    await flush(); expect((await db.doc(`${root}/pushSubscriptions/${device}`).get()).get('generation')).toBe(next);
  });
});
