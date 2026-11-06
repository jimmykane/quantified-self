import { randomUUID } from 'node:crypto';
import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
const mocks = vi.hoisted(() => ({ db: null as unknown as Firestore }));
vi.mock('firebase-admin', () => ({ firestore: Object.assign(() => mocks.db, { FieldValue }) }));
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getServiceWorkoutQueueName } from '../shared/queue-names';
import { setEventDocumentIfUserActive } from '../utils';
import { ACTIVITY_PUSH, type ActivityPushCandidate } from './activity-policy';
import { admitActivityNotification, sendActivityNotification, type ActivityPushDependencies } from './activity-service';

const now = Date.UTC(2026, 10, 3, 12), publicKey = 'B' + 'A'.repeat(86), origin = 'https://quantified-self.io';
const id = '00000000-0000-4000-8000-000000000001', generation = '00000000-0000-4000-8000-000000000002';
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('activity notification Firestore transactions', () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Loopback emulator required');
  beforeEach(() => { mocks.db = new Firestore({ projectId: `demo-activity-push-${randomUUID().slice(0, 8)}` }); });
  afterEach(async () => { vi.restoreAllMocks(); await mocks.db.terminate(); });
  async function seed(service = ServiceNames.SuuntoApp) {
    let clock = now; const db = mocks.db;
    const candidate: ActivityPushCandidate = { eventID: 'event', service, queueId: 'queue', queueCreatedAt: now,
      queueRevision: null, startMs: now - 3600000, endMs: now - 60000, connectedAtMs: now - 86400000 };
    const batch = db.batch(); batch.set(db.doc('users/owner'), {});
    batch.set(db.doc(`users/owner/pushSubscriptions/${id}`), { schemaVersion: 1, generation, origin, vapidPublicKey: publicKey,
      endpoint: 'https://web.push.apple.com/synthetic', keys: { p256dh: publicKey, auth: 'A'.repeat(22) } });
    const providerField = { [ServiceNames.SuuntoApp]: 'userName', [ServiceNames.COROSAPI]: 'openId', [ServiceNames.GarminAPI]: 'userID', [ServiceNames.WahooAPI]: 'wahooUserID' }[service];
    batch.set(db.doc(`${getServiceWorkoutQueueName(service)}/queue`), { activityNotificationOrigin: 'live', dateCreated: now, [providerField]: 'account', firebaseUserID: 'owner' });
    batch.set(db.doc(`users/owner/meta/${service}`), { connectionState: 'connected', connectionStateGeneration: 'connection', providerUserId: 'account' });
    batch.set(db.doc('users/owner/events/event'), { startDate: candidate.startMs, endDate: candidate.endMs }); await batch.commit();
    const deps: ActivityPushDependencies = { db, now: () => clock, configuration: async () => ({ enabled: true, publicKey }), send: vi.fn(async () => ({})), outcome: vi.fn() };
    return { candidate, deps, advance: () => { clock += ACTIVITY_PUSH.groupMs; }, admit: () => admitActivityNotification('owner', candidate, deps),
      send: () => sendActivityNotification('owner', deps), state: db.doc('users/owner/pushState/activitySync') };
  }
  it.each([ServiceNames.SuuntoApp, ServiceNames.COROSAPI, ServiceNames.GarminAPI, ServiceNames.WahooAPI])('deduplicates contending %s admissions and sender claims', async service => {
    const h = await seed(service); await Promise.all([h.admit(), h.admit()]);
    expect((await h.state.get()).data()?.pending.entries).toHaveLength(1);
    h.advance(); const due = await mocks.db.collectionGroup('pushState').where('dueAt', '<=', h.deps.now()).orderBy('dueAt').limit(25).select('dueAt').get();
    expect(due.docs.map(doc => doc.ref.path)).toEqual([h.state.path]);
    await Promise.all([h.send(), h.send()]); expect(h.deps.send).toHaveBeenCalledOnce();
    expect((await h.state.get()).data()).not.toHaveProperty('dueAt');
  }, 30000);
  it('sends one attempt to aliased subscriptions across device waves and competing senders', async () => {
    const h = await seed();
    const registration = (await mocks.db.doc(`users/owner/pushSubscriptions/${id}`).get()).data()!;
    const batch = mocks.db.batch();
    for (let n = 0; n < 6; n++) batch.set(mocks.db.collection('users/owner/pushSubscriptions').doc(randomUUID()),
      { ...registration, generation: randomUUID() });
    await batch.commit(); await h.admit(); h.advance();
    await Promise.all([h.send(), h.send()]); await h.send();
    expect(h.deps.send).toHaveBeenCalledOnce();
    const state = (await h.state.get()).data();
    expect(state?.attempts).toHaveLength(1); expect(state).not.toHaveProperty('dueAt');
  }, 30000);
  it('queries both sites and stops a remotely disabled beta registration before sending', async () => {
    const h = await seed(), betaId = randomUUID();
    const registration = (await mocks.db.doc(`users/owner/pushSubscriptions/${id}`).get()).data()!;
    const betaRef = mocks.db.doc(`users/owner/pushSubscriptions/${betaId}`);
    await betaRef.set({ ...registration, origin: 'https://beta.quantified-self.io', endpoint: 'https://web.push.apple.com/beta' });
    await h.admit(); expect((await h.state.get()).data()?.pending.targets).toHaveLength(2);
    await betaRef.delete(); h.advance(); await h.send();
    expect(h.deps.send).toHaveBeenCalledOnce();
    expect(vi.mocked(h.deps.send).mock.calls[0][0].origin).toBe(origin);
  });
  it('delivers to both sites with distinct navigation and one shared rate-limit attempt', async () => {
    const h = await seed();
    const registration = (await mocks.db.doc(`users/owner/pushSubscriptions/${id}`).get()).data()!;
    await mocks.db.collection('users/owner/pushSubscriptions').doc(randomUUID()).set({ ...registration,
      origin: 'https://beta.quantified-self.io', endpoint: 'https://web.push.apple.com/beta' });
    await h.admit(); h.advance(); await h.send();
    expect(h.deps.send).toHaveBeenCalledTimes(2); expect((await h.state.get()).data()?.attempts).toHaveLength(1);
    for (const [target, body] of vi.mocked(h.deps.send).mock.calls) expect(JSON.parse(body).notification.navigate).toBe(target.origin + '/user/owner/event/event');
  });
  it('does not persist an aborted admission or consume an attempt for an aborted claim', async () => {
    const h = await seed(); const original = mocks.db.runTransaction.bind(mocks.db);
    vi.spyOn(mocks.db, 'runTransaction').mockImplementationOnce(fn => original(async tx => { await fn(tx); throw new Error('Abort'); }));
    await expect(h.admit()).rejects.toThrow('Abort'); expect((await h.state.get()).exists).toBe(false);
    await h.admit(); h.advance();
    vi.spyOn(mocks.db, 'runTransaction').mockImplementationOnce(fn => original(async tx => { await fn(tx); throw new Error('Abort'); }));
    await expect(h.send()).rejects.toThrow('Abort'); expect((await h.state.get()).data()?.attempts).toEqual([]);
    await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
  });
  it('cancels off/on work permanently while new activities get the new revision', async () => {
    const h = await seed(); await h.admit();
    await mocks.db.doc('users/owner/notificationPreferences/activity_sync').set({ schemaVersion: 1, enabled: true, revision: 2, updatedAt: FieldValue.serverTimestamp() });
    h.advance(); await h.send(); expect(h.deps.send).not.toHaveBeenCalled(); expect((await h.state.get()).data()).not.toHaveProperty('dueAt');
  });
  it('cleans a tombstoned account batch without recreating an account or sending', async () => {
    const h = await seed(); await h.admit(); await mocks.db.doc('userDeletionTombstones/owner').set({});
    h.advance(); await h.send(); expect(h.deps.send).not.toHaveBeenCalled(); expect((await h.state.get()).exists).toBe(false);
  });
  it('uses committed parent existence to elect one canonical creation across competing writers', async () => {
    await seed(); const ref = mocks.db.doc('users/owner/events/new');
    const write = () => setEventDocumentIfUserActive('owner', 'synthetic import', ref, { startDate: now }, undefined, incoming => incoming);
    const results = await Promise.all([write(), write()]); expect(results.sort()).toEqual([false, true]);
    expect(await write()).toBe(false);
  }, 30000);
});
