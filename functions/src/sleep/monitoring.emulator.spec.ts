import { randomUUID } from 'node:crypto';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeHealthSleepQueue } from './monitoring';

vi.mock('firebase-functions/logger', () => ({ info: vi.fn() }));

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Health/Sleep bounded observations in isolated Firestore', () => {
    if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Loopback emulator required.');
    let db: Firestore;
    beforeEach(() => { vi.clearAllMocks(); db = new Firestore({ projectId: `demo-health-monitor-${randomUUID().slice(0, 8)}` }); });
    afterEach(async () => { await db.terminate(); });
    async function seed(id = 'qa', provider = 'GarminAPI', type = 'garmin_ping') {
        const root = provider === 'GarminAPI' ? 'garminAPITokens' : provider === 'SuuntoApp' ? 'suuntoAppAccessTokens' : 'COROSAPIAccessTokens';
        const identity = provider === 'GarminAPI' ? 'userID' : provider === 'SuuntoApp' ? 'userName' : 'openId';
        const user = db.collection('users').doc(id);
        await user.set({ private: 'PRIVATE_OWNER' });
        await user.collection('meta').doc(provider).set({ connectionState: 'connected' });
        await db.collection(root).doc(id).set({ private: 'PRIVATE_ROOT' });
        await db.collection(root).doc(id).collection('tokens').doc('account').set({ [identity]: 'account', accessToken: 'PRIVATE_TOKEN' });
        const ref = db.collection('sleepSyncQueue').doc(id);
        await ref.set({ provider, type, userID: id, providerUserId: 'account', processed: false, retryCount: 0, dispatchedToCloudTask: null, dateCreated: 1, callbackURL: 'PRIVATE_CALLBACK', payload: 'PRIVATE_PAYLOAD', queueRevision: 'R1' });
        return ref;
    }
    function sample(provider = 'GarminAPI', workload = 'sleep_sync') {
        return vi.mocked(logger.info).mock.calls.find(([, fields]) => fields.provider === provider && fields.workload === workload && fields.event === 'queue_sample')?.[1];
    }
    it('emits four idle workload heartbeats without depending on provider traffic', async () => {
        await observeHealthSleepQueue(db, 0);
        expect(logger.info).toHaveBeenCalledTimes(4);
        for (const [, fields] of vi.mocked(logger.info).mock.calls) expect(fields).toMatchObject({ event: 'queue_sample', dueSample: 0, unknownSample: 0 });
    });
    it.each([['GarminAPI', 'garmin_ping'], ['SuuntoApp', 'suunto_health_poll'], ['COROSAPI', 'coros_poll']])('observes eligible %s work with no payload reads or queue writes', async (provider, type) => {
        const ref = await seed('qa', provider, type); const before = await ref.get();
        await observeHealthSleepQueue(db, 0, before.updateTime!.toMillis() + 3_600_000);
        expect(sample(provider)).toMatchObject({ dueSample: 1, ageLowerBoundMs: 3_600_000 });
        expect((await ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
        expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('PRIVATE');
    });
    it('separates Garmin backfill, suppressing intentional serialized wait without hiding unknown capacity', async () => {
        const ref = await seed('backfill', 'GarminAPI', 'garmin_health_backfill');
        const now = (await ref.get()).updateTime!.toMillis() + 86_400_000;
        await observeHealthSleepQueue(db, 1, now);
        expect(sample('GarminAPI', 'garmin_health_backfill')).toMatchObject({ dueSample: 0, excludedSample: 1 });
        vi.clearAllMocks(); await observeHealthSleepQueue(db, undefined, now);
        expect(sample('GarminAPI', 'garmin_health_backfill')).toMatchObject({ unknownSample: 1 });
        expect(sample('GarminAPI', 'garmin_health_backfill')).not.toHaveProperty('dueSample');
        vi.clearAllMocks(); await observeHealthSleepQueue(db, 0, now);
        expect(sample('GarminAPI', 'garmin_health_backfill')).toMatchObject({ dueSample: 1, ageLowerBoundMs: 86_400_000 });
    });
    it.each([
        ['future-poll', { rangeStartMs: Date.now() + 86_400_000 }],
        ['future-backfill', { type: 'garmin_health_backfill', dispatchAfterMs: Date.now() + 86_400_000 }],
        ['rate-limit', { dispatchAfterMs: Date.now() + 86_400_000 }],
        ['retry', { retryCount: 1 }],
        ['dispatched', { dispatchedToCloudTask: Date.now() }],
        ['active-lease', { processingLeaseExpiresAt: Date.now() + 86_400_000 }],
        ['parked', { resultStatus: 'deferred' }],
        ['manual', { resultStatus: 'manual_reconciliation_required' }],
    ])('excludes %s from actionable backlog', async (id, fields) => {
        const ref = await seed(id); await ref.update(fields);
        await observeHealthSleepQueue(db, 0);
        const s = sample('GarminAPI', fields.type === 'garmin_health_backfill' ? 'garmin_health_backfill' : 'sleep_sync');
        expect(s).toMatchObject({ dueSample: 0, unknownSample: 0, excludedSample: 1 });
    });
    it('excludes deletion, disconnect, missing credentials and different pinned COROS accounts', async () => {
        const now = Date.now();
        await seed('deleting'); await db.doc('userDeletionTombstones/deleting').set({ expireAt: Timestamp.fromMillis(now + 60_000) });
        await seed('missing'); await db.doc('users/missing').delete();
        await seed('disconnected'); await db.doc('users/disconnected/meta/GarminAPI').update({ connectionState: 'disconnect_pending' });
        await seed('token-missing'); await db.doc('garminAPITokens/token-missing/tokens/account').update({ userID: 'other' });
        await seed('orphan'); await db.doc('garminAPITokens/orphan').delete();
        await seed('pinned', 'COROSAPI', 'coros_poll'); await db.doc('users/pinned/meta/COROSAPI').update({ providerUserId: 'different' });
        await observeHealthSleepQueue(db, 0);
        expect(sample()).toMatchObject({ dueSample: 0, excludedSample: 5, unknownSample: 0 });
        expect(sample('COROSAPI')).toMatchObject({ dueSample: 0, excludedSample: 1 });
    });
    it('replacement/recovery resets the lower-bound age instead of borrowing original creation time', async () => {
        const ref = await seed(); const first = await ref.get(); await ref.update({ queueRevision: 'R2' });
        const current = await ref.get(); expect(current.createTime!.isEqual(first.createTime!)).toBe(true);
        await observeHealthSleepQueue(db, 0, current.updateTime!.toMillis() + 1_000);
        expect(sample()).toMatchObject({ dueSample: 1, ageLowerBoundMs: 1_000 });
    });
    it('cannot borrow a stale snapshot age when the row changes before the read-only transaction', async () => {
        const ref = await seed(); const run = db.runTransaction.bind(db);
        vi.spyOn(db, 'runTransaction').mockImplementationOnce(async (...args) => {
            await ref.update({ queueRevision: 'R2' }); return run(...args);
        });
        await observeHealthSleepQueue(db, 0);
        expect(sample()).toMatchObject({ dueSample: 0, excludedSample: 1 });
    });
    it('unknown owner and workload data never becomes a false zero observation', async () => {
        await db.doc('sleepSyncQueue/legacy').set({ provider: 'GarminAPI', type: 'garmin_ping', processed: false, dateCreated: 1, retryCount: 0 });
        await observeHealthSleepQueue(db, 0);
        expect(sample()).toMatchObject({ unknownSample: 1 }); expect(sample()).not.toHaveProperty('dueSample');
        vi.clearAllMocks(); await db.doc('sleepSyncQueue/invalid').set({ provider: 'PRIVATE_PROVIDER', type: 'PRIVATE_TYPE', processed: false, dateCreated: 2 });
        await observeHealthSleepQueue(db, 0);
        for (const [, fields] of vi.mocked(logger.info).mock.calls) { expect(fields.unknownSample).toBeGreaterThan(0); expect(fields).not.toHaveProperty('dueSample'); }
        expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('PRIVATE');
    });
    it('caps the shared query at twenty plus look-ahead and reports saturation', async () => {
        const batch = db.batch();
        for (let index = 0; index < 100; index++) batch.set(db.doc(`sleepSyncQueue/legacy-${index}`), { provider: 'GarminAPI', type: 'garmin_ping', processed: false, dateCreated: index });
        await batch.commit(); await observeHealthSleepQueue(db, 0);
        expect(sample()).toMatchObject({ sampled: 20, truncated: true, unknownSample: 20 });
    });
    it.each(['dispatchedToCloudTask', 'dispatchAfterMs', 'rangeStartMs', 'processingLeaseExpiresAt'])('reports malformed %s as unknown instead of eligible or healthy zero', async field => {
        const ref = await seed(); await ref.update({ [field]: 'malformed' });
        await observeHealthSleepQueue(db, 0);
        expect(sample()).toMatchObject({ unknownSample: 1 });
        expect(sample()).not.toHaveProperty('dueSample');
    });
    it('excludes processed work and nonzero lifecycle sentinels', async () => {
        const completed = await seed('completed'); await completed.update({ processed: true });
        const deferred = await seed('sentinel'); await deferred.update({ dispatchedToCloudTask: -1 });
        await observeHealthSleepQueue(db, 0);
        expect(sample()).toMatchObject({ sampled: 1, dueSample: 0, excludedSample: 1 });
    });
});
