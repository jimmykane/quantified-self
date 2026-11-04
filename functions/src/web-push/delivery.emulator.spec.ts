import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ServiceNames } from '@sports-alliance/sports-lib';
import { DELIVERY_PUSH, type DeliveryCandidate } from './delivery-policy';
import { admitDeliveryNotification, sendDeliveryNotification, type DeliveryPushDependencies } from './delivery-service';
import { validateDeliveryNotificationConsent } from './delivery-consent';
const now = Date.UTC(2026, 10, 4, 12), key = 'B' + 'A'.repeat(86), origin = 'https://quantified-self.io';
const id = '00000000-0000-4000-8000-000000000001', generation = '00000000-0000-4000-8000-000000000002';
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('activity delivery notification transactions', () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Loopback emulator required');
  let db: Firestore;
  beforeEach(() => { db = new Firestore({ projectId: `demo-delivery-push-${randomUUID().slice(0, 8)}` }); });
  afterEach(async () => { vi.restoreAllMocks(); await db.terminate(); });
  async function setup() {
    let clock = now;
    const batch = db.batch(); batch.set(db.doc('users/owner'), {});
    batch.set(db.doc(`users/owner/pushSubscriptions/${id}`), { schemaVersion: 1, generation, origin, vapidPublicKey: key,
      endpoint: 'https://web.push.apple.com/synthetic', keys: { p256dh: key, auth: 'A'.repeat(22) } });
    batch.set(db.doc(`users/owner/meta/${ServiceNames.SuuntoApp}`), { connectionState: 'connected', connectionStateGeneration: 'connection', providerUserId: 'account' }); await batch.commit();
    const consent = await db.runTransaction(tx => validateDeliveryNotificationConsent(db, tx, 'owner', ServiceNames.SuuntoApp, 'account', { installationId: id, generation, origin }, key));
    const seed = async (kind: 'manual' | 'automatic' = 'manual', ref = 'batch'): Promise<DeliveryCandidate> => {
      const candidate = { kind, id: ref, createdAt: now - 1000, completedAt: now };
      const writes = db.batch();
      if (kind === 'manual') {
        writes.set(db.doc(`users/owner/activitySends/${ref}`), { state: 'complete', total: 20, finished: 20, provider: 'suunto', source: 'files', notificationRequested: true, createdAt: candidate.createdAt, updatedAt: now });
        writes.set(db.doc(`users/owner/activitySendOperations/${ref}`), { state: 'confirmed', provider: 'suunto', providerAccount: 'account', createdAt: candidate.createdAt, deliveryNotification: consent });
      } else {
        writes.set(db.doc(`failed_jobs/${ref}`), { id: ref, originalCollection: 'activitySyncQueue', manual: false, userID: 'owner', dateCreated: candidate.createdAt,
          failedAt: now, eventID: ref, destinationServiceName: ServiceNames.SuuntoApp, destinationProviderUserID: 'account' });
        writes.set(db.doc(`users/owner/events/${ref}`), { startDate: now - 3600000 });
      }
      await writes.commit(); return candidate;
    };
    const deps: DeliveryPushDependencies = { db, now: () => clock, configuration: async () => ({ enabled: true, publicKey: key }), send: vi.fn(async () => ({})), outcome: vi.fn() };
    return { seed, deps, advance: () => { clock += DELIVERY_PUSH.groupMs; }, state: db.doc('users/owner/pushState/activityDelivery'),
      admit: (candidate: DeliveryCandidate) => admitDeliveryNotification('owner', candidate, deps), send: () => sendDeliveryNotification('owner', deps) };
  }
  it.each(['manual', 'automatic'] as const)('deduplicates real competing %s admissions and claims', async kind => {
    const h = await setup(), candidate = await h.seed(kind); await Promise.all([h.admit(candidate), h.admit(candidate)]);
    expect((await h.state.get()).data()?.pending.entries).toHaveLength(1); h.advance();
    const due = await db.collectionGroup('pushState').where('deliveryDueAt', '<=', h.deps.now()).orderBy('deliveryDueAt').select('deliveryDueAt').get();
    expect(due.docs.map(doc => doc.ref.path)).toEqual([h.state.path]);
    await Promise.all([h.send(), h.send()]); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
    expect((await h.state.get()).data()?.attempts).toHaveLength(1); expect((await h.state.get()).data()).not.toHaveProperty('deliveryDueAt');
  }, 30000);
  it('groups twenty committed failures and deduplicates aliased browser endpoints', async () => {
    const h = await setup(); const registration = (await db.doc(`users/owner/pushSubscriptions/${id}`).get()).data()!;
    const writes = db.batch(); for (let n = 0; n < 6; n++) writes.set(db.collection('users/owner/pushSubscriptions').doc(randomUUID()), { ...registration, generation: randomUUID() }); await writes.commit();
    for (let n = 0; n < 20; n++) await h.admit(await h.seed('automatic', `job${n}`));
    h.advance(); await Promise.all([h.send(), h.send()]); expect(h.deps.send).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(h.deps.send).mock.calls[0][1]).notification.navigate).toBe(origin + '/services');
  }, 30000);
  it('delivers automatic failures to production and beta with one shared attempt', async () => {
    const h = await setup(); const registration = (await db.doc(`users/owner/pushSubscriptions/${id}`).get()).data()!;
    await db.collection('users/owner/pushSubscriptions').doc(randomUUID()).set({ ...registration,
      origin: 'https://beta.quantified-self.io', endpoint: 'https://web.push.apple.com/beta' });
    await h.admit(await h.seed('automatic')); h.advance(); await h.send();
    expect(h.deps.send).toHaveBeenCalledTimes(2); expect((await h.state.get()).data()?.attempts).toHaveLength(1);
    for (const [target, body] of vi.mocked(h.deps.send).mock.calls) expect(JSON.parse(body).notification.navigate).toBe(target.origin + '/services?serviceName=Suunto%20app');
  });
  it('rolls back an aborted claim and preserves the batch for one later attempt', async () => {
    const h = await setup(); await h.admit(await h.seed()); h.advance();
    const original = db.runTransaction.bind(db); vi.spyOn(db, 'runTransaction').mockImplementationOnce(fn => original(async tx => { await fn(tx); throw new Error('Abort'); }));
    await expect(h.send()).rejects.toThrow('Abort'); expect((await h.state.get()).data()?.attempts).toEqual([]);
    await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
  });
  it.each(['category', 'deletion', 'retry'] as const)('cancels pending work after %s without a send', async reason => {
    const h = await setup(); await h.admit(await h.seed());
    if (reason === 'category') await db.doc('users/owner/notificationPreferences/activity_delivery').set({ schemaVersion: 1, enabled: true, revision: 2 });
    if (reason === 'deletion') await db.doc('userDeletionTombstones/owner').set({});
    if (reason === 'retry') await db.doc('users/owner/activitySends/batch').update({ state: 'confirmed' });
    h.advance(); await h.send(); expect(h.deps.send).not.toHaveBeenCalled();
    const state = await h.state.get();
    if (reason === 'deletion') expect(state.exists).toBe(false);
    else expect(state.data()).not.toHaveProperty('deliveryDueAt');
  });
});
