import { randomUUID } from 'node:crypto';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeImportQueue } from './import-monitoring';

vi.mock('firebase-functions/logger', () => ({ info: vi.fn() }));

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('recorded import observations in isolated Firestore', () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Loopback emulator required.');
  let db: Firestore;
  beforeEach(() => { vi.clearAllMocks(); db = new Firestore({ projectId: `demo-import-monitor-${randomUUID().slice(0, 8)}` }); });
  afterEach(async () => { await db.terminate(); });
  async function seed(queue = 'garminAPIActivityQueue', root = 'garminAPITokens', identity = 'userID', id = 'qa', service = ServiceNames.GarminAPI) {
    const user = db.collection('users').doc(id);
    await user.set({ private: 'PRIVATE_OWNER' });
    await user.collection('meta').doc(service).set({ connectionState: 'connected' });
    await db.collection(root).doc(id).set({ private: 'PRIVATE_ROOT' });
    await db.collection(root).doc(id).collection('tokens').doc('account').set({ [identity]: 'account', accessToken: 'PRIVATE_TOKEN' });
    const ref = db.collection(queue).doc(id);
    await ref.set({ firebaseUserID: id, [identity]: 'account', processed: false, retryCount: 0, dispatchedToCloudTask: null, dateCreated: 1, callbackURL: 'PRIVATE_CALLBACK', queueRevision: 'R1' });
    return ref;
  }
  function sample(provider = 'garmin') { return vi.mocked(logger.info).mock.calls.find(([, fields]) => fields.provider === provider && fields.event === 'queue_sample')?.[1]; }
  it.each([ServiceNames.GarminAPI, ServiceNames.SuuntoApp, ServiceNames.COROSAPI, ServiceNames.WahooAPI])('emits an idle heartbeat for %s', async service => {
    await observeImportQueue(db, service);
    expect(logger.info).toHaveBeenCalledWith('[ActivityImport]', expect.objectContaining({ event: 'queue_sample', dueSample: 0, ageLowerBoundMs: 0, unknownSample: 0 }));
  });
  it.each([
    [ServiceNames.GarminAPI, 'garmin', 'garminAPIActivityQueue', 'garminAPITokens', 'userID'],
    [ServiceNames.SuuntoApp, 'suunto', 'suuntoAppWorkoutQueue', 'suuntoAppAccessTokens', 'userName'],
    [ServiceNames.COROSAPI, 'coros', 'COROSAPIWorkoutQueue', 'COROSAPIAccessTokens', 'openId'],
    [ServiceNames.WahooAPI, 'wahoo', 'wahooAPIWorkoutQueue', 'wahooAPIAccessTokens', 'wahooUserID'],
  ])('observes eligible current work for %s without leaking payloads', async (service, provider, queue, root, identity) => {
    const ref = await seed(queue, root, identity, 'qa', service);
    const lastWrite = (await ref.get()).updateTime!.toMillis();
    await observeImportQueue(db, service, lastWrite + 3_600_000);
    expect(sample(provider)).toMatchObject({ dueSample: 1, ageLowerBoundMs: 3_600_000 });
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('PRIVATE');
  });
  it('replacement/recovery writes reset the conservative delay without changing creation time', async () => {
    const ref = await seed();
    const initial = await ref.get();
    await ref.update({ queueRevision: 'R2', dispatchRecoveryGeneration: 2 });
    const current = await ref.get();
    expect(current.createTime!.isEqual(initial.createTime!)).toBe(true);
    await observeImportQueue(db, ServiceNames.GarminAPI, current.updateTime!.toMillis() + 1_000);
    expect(sample()).toMatchObject({ dueSample: 1, ageLowerBoundMs: 1_000 });
  });
  it('excludes processed, future recovery, active leases, parked/disconnected and deleting owners', async () => {
    const now = Date.now();
    const processed = await seed(undefined, undefined, undefined, 'processed'); await processed.update({ processed: true });
    const future = await seed(undefined, undefined, undefined, 'future'); await future.update({ dispatchedToCloudTask: now });
    const leased = await seed(undefined, undefined, undefined, 'leased'); await leased.update({ processingLeaseExpiresAt: now + 60_000 });
    const parked = await seed(undefined, undefined, undefined, 'parked'); await parked.update({ resultStatus: 'deferred' });
    await seed(undefined, undefined, undefined, 'disconnected'); await db.doc(`users/disconnected/meta/${ServiceNames.GarminAPI}`).update({ connectionState: 'disconnect_pending' });
    await seed(undefined, undefined, undefined, 'deleting'); await db.doc('userDeletionTombstones/deleting').set({ expireAt: Timestamp.fromMillis(now + 60_000) });
    await seed(undefined, undefined, undefined, 'wrong-account'); await db.doc('garminAPITokens/wrong-account/tokens/account').update({ userID: 'replacement' });
    await observeImportQueue(db, ServiceNames.GarminAPI, now);
    expect(sample()).toMatchObject({ dueSample: 0, ageLowerBoundMs: 0, excludedSample: 5 });
  });
  it('unknown owner data is visible without a false zero backlog', async () => {
    await db.doc('garminAPIActivityQueue/legacy').set({ processed: false, retryCount: 0, dispatchedToCloudTask: null });
    await observeImportQueue(db, ServiceNames.GarminAPI);
    expect(sample()).toMatchObject({ unknownSample: 1 });
    expect(sample()).not.toHaveProperty('dueSample');
    expect(sample()).not.toHaveProperty('ageLowerBoundMs');
  });
  it.each([
    [ServiceNames.COROSAPI, 'coros', 'COROSAPIWorkoutQueue', 'COROSAPIAccessTokens', 'openId'],
    [ServiceNames.WahooAPI, 'wahoo', 'wahooAPIWorkoutQueue', 'wahooAPIAccessTokens', 'wahooUserID'],
  ])('excludes a different pinned %s account despite retained credentials', async (service, provider, queue, root, identity) => {
    await seed(queue, root, identity, 'qa', service);
    await db.doc(`users/qa/meta/${service}`).update({ providerUserId: 'replacement-account' });
    await observeImportQueue(db, service);
    expect(sample(provider)).toMatchObject({ dueSample: 0, excludedSample: 1, unknownSample: 0 });
  });
  it('excludes missing owners, tombstones without expiry and credential children below missing roots', async () => {
    await seed(undefined, undefined, undefined, 'missing-owner');
    await db.doc('users/missing-owner').delete();
    await seed(undefined, undefined, undefined, 'deleting');
    await db.doc('userDeletionTombstones/deleting').set({});
    await seed(undefined, undefined, undefined, 'orphan-token');
    // Deliberately reproduce Firestore's retained child below a missing parent.
    await db.doc('garminAPITokens/orphan-token').delete();
    await observeImportQueue(db, ServiceNames.GarminAPI);
    expect(sample()).toMatchObject({ dueSample: 0, excludedSample: 3, unknownSample: 0 });
  });
  it('caps work at twenty rows plus look-ahead rather than enumerating the backlog', async () => {
    const batch = db.batch();
    for (let index = 0; index < 100; index++) batch.set(db.collection('garminAPIActivityQueue').doc(`legacy-${index}`), { processed: false, retryCount: 0, dispatchedToCloudTask: null });
    await batch.commit();
    await observeImportQueue(db, ServiceNames.GarminAPI);
    expect(sample()).toMatchObject({ sampled: 20, truncated: true, unknownSample: 20 });
  });
});
