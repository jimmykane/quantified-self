import { randomUUID } from 'node:crypto';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import * as logger from 'firebase-functions/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeActivityDeliveryQueue } from './monitoring-probe';
vi.mock('firebase-functions/logger', () => ({ info: vi.fn() }));
vi.unmock('@sports-alliance/sports-lib');

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('activity delivery observations in isolated Firestore', () => {
    if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Loopback emulator required.');
    let db: Firestore;
    beforeEach(() => { vi.clearAllMocks(); db = new Firestore({ projectId: `demo-delivery-monitor-${randomUUID().slice(0, 8)}` }); });
    afterEach(async () => { await db.terminate(); });
    async function seed(id = 'qa', destination = 'WahooAPI', source = 'GarminAPI', historical = false) {
        const user = db.collection('users').doc(id);
        await user.set({ private: 'PRIVATE_OWNER' });
        for (const [service, root] of [[ServiceNames.GarminAPI, 'garminAPITokens'], [ServiceNames.SuuntoApp, 'suuntoAppAccessTokens'], [ServiceNames.WahooAPI, 'wahooAPIAccessTokens'], [ServiceNames.COROSAPI, 'COROSAPIAccessTokens']]) {
            await user.collection('meta').doc(service).set({ connectionState: 'connected' });
            await db.doc(`${root}/${id}`).set({ private: 'PRIVATE_ROOT' });
            await db.doc(`${root}/${id}/tokens/account`).set({ serviceName: service, accessToken: 'PRIVATE_TOKEN' });
        }
        const routeId = `${source}_to_${destination}`;
        await user.collection('config').doc('settings').set({ serviceSyncSettings: { activitySyncRoutes: { [routeId]: { enabled: true } } } });
        const ref = db.collection('activitySyncQueue').doc(id);
        await ref.set({ routeId, sourceServiceName: source === 'ManualUpload' ? 'manualUpload' : ServiceNames[source as keyof typeof ServiceNames],
            destinationServiceName: ServiceNames[destination as keyof typeof ServiceNames], deliveryMode: historical ? 'historical' : 'automatic', userID: id,
            manual: historical, processed: false, retryCount: 0, dateCreated: 1, dispatchedToCloudTask: null,
            originalFile: { path: 'PRIVATE_ORIGINAL' }, errors: ['PRIVATE_ERROR'] });
        return ref;
    }
    function sample(destination = 'wahoo') { return vi.mocked(logger.info).mock.calls.find(([, fields]) => fields.event === 'queue_sample' && fields.destination === destination)?.[1]; }
    it('emits all three idle destination heartbeats without provider traffic', async () => {
        await observeActivityDeliveryQueue(db, vi.fn(), 0);
        expect(logger.info).toHaveBeenCalledTimes(3);
        for (const destination of ['suunto', 'wahoo', 'coros']) expect(sample(destination)).toMatchObject({ dueSample: 0, unknownSample: 0, ageLowerBoundMs: 0 });
    });
    it.each([['SuuntoApp', 'suunto'], ['WahooAPI', 'wahoo'], ['COROSAPI', 'coros']])('observes %s without mutating documents or logging payloads', async (destination, label) => {
        const ref = await seed('qa', destination); const before = await ref.get();
        await observeActivityDeliveryQueue(db, async () => true, 0, before.updateTime!.toMillis() + 3_600_000);
        expect(sample(label)).toMatchObject({ dueSample: 1, ageLowerBoundMs: 3_600_000 });
        expect((await ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
        expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('PRIVATE');
    });
    it('historical and manual sends do not require source connection or an automatic route setting', async () => {
        await seed('history', 'WahooAPI', 'GarminAPI', true);
        await db.doc('garminAPITokens/history').delete();
        await db.doc(`users/history/meta/${ServiceNames.GarminAPI}`).update({ connectionState: 'disconnect_pending' });
        await db.doc('users/history/config/settings').set({});
        await seed('manual', 'WahooAPI', 'ManualUpload', true);
        await observeActivityDeliveryQueue(db, async () => true, 0);
        expect(sample()).toMatchObject({ dueSample: 2, unknownSample: 0 });
    });
    it('excludes missing/deleting users, orphan credentials, disconnected destinations and disabled settings', async () => {
        await seed('missing'); await db.doc('users/missing').delete();
        await seed('deleting'); await db.doc('userDeletionTombstones/deleting').set({ expireAt: Timestamp.fromMillis(Date.now() + 60_000) });
        await seed('orphan'); await db.doc('wahooAPIAccessTokens/orphan').delete();
        await seed('disconnected'); await db.doc(`users/disconnected/meta/${ServiceNames.WahooAPI}`).update({ connectionState: 'disconnect_pending' });
        await seed('disabled'); await db.doc('users/disabled/config/settings').set({});
        await seed('token-missing'); await db.doc('wahooAPIAccessTokens/token-missing/tokens/account').delete();
        await observeActivityDeliveryQueue(db, async () => true, 0);
        expect(sample()).toMatchObject({ dueSample: 0, excludedSample: 6, unknownSample: 0 });
    });
    it('excludes non-Pro work; entitlement read failure stays unknown, not healthy zero', async () => {
        await seed(); await observeActivityDeliveryQueue(db, async () => false, 0);
        expect(sample()).toMatchObject({ dueSample: 0, excludedSample: 1 });
        vi.clearAllMocks(); await observeActivityDeliveryQueue(db, async () => { throw new Error('PRIVATE_AUTH'); }, 0);
        expect(vi.mocked(logger.info).mock.calls.every(([, fields]) => fields.event === 'queue_sample_unavailable')).toBe(true);
        expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('PRIVATE');
    });
    it('future historical work, pending polls, ordinary retries and parked records are not overdue backlog', async () => {
        const now = Date.now();
        for (const [id, fields] of [
            ['future', { dateCreated: now + 60_000 }], ['retry', { retryCount: 1 }],
            ['poll', { destinationUploadID: 'PRIVATE_UPLOAD', retryCount: 2, dispatchedToCloudTask: now + 900_000 }],
            ['deferred', { resultStatus: 'deferred' }], ['claim', { dispatchedToCloudTask: Number.MAX_SAFE_INTEGER - 1, providerOperationStartedAt: now }],
        ] as const) { const ref = await seed(id); await ref.update(fields); }
        await observeActivityDeliveryQueue(db, async () => true, 0, now);
        expect(sample()).toMatchObject({ dueSample: 0, unknownSample: 0, excludedSample: 5 });
    });
    it.each(['WahooAPI', 'COROSAPI'])('observes a genuinely overdue %s status poll, without new-upload entitlement or a resend', async destination => {
        const ref = await seed('poll', destination); const due = Date.now() - 10_800_000;
        await ref.update({ destinationUploadID: 'PRIVATE_RESUME_ID', destinationProviderUserID: 'PRIVATE_ACCOUNT', retryCount: 3, dispatchedToCloudTask: due });
        const before = await ref.get(); const proAccess = vi.fn().mockResolvedValue(false);
        const now = before.updateTime!.toMillis() + 7_200_000;
        await observeActivityDeliveryQueue(db, proAccess, 0, now);
        expect(sample(destination === 'WahooAPI' ? 'wahoo' : 'coros')).toMatchObject({ dueSample: 1, overduePollSample: 1, ageLowerBoundMs: 7_200_000 });
        expect(proAccess).not.toHaveBeenCalled();
        expect((await ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
    });
    it('replacement writes reset the lower-bound age, and stale sampled revisions cannot borrow it', async () => {
        const ref = await seed(); await ref.update({ dateCreated: 2 });
        const before = await ref.get(); await observeActivityDeliveryQueue(db, async () => true, 0, before.updateTime!.toMillis() + 1_000);
        expect(sample()).toMatchObject({ dueSample: 1, ageLowerBoundMs: 1_000 });
        vi.clearAllMocks(); const run = db.runTransaction.bind(db);
        vi.spyOn(db, 'runTransaction').mockImplementationOnce(async (...args) => { await ref.update({ dateCreated: 3 }); return run(...args); });
        await observeActivityDeliveryQueue(db, async () => true, 0);
        expect(sample()).toMatchObject({ dueSample: 0, excludedSample: 1 });
    });
    it('unknown data and saturation remain explicit, capped at twenty rows plus look-ahead', async () => {
        const batch = db.batch();
        for (let i = 0; i < 100; i++) batch.set(db.doc(`activitySyncQueue/legacy-${i}`), { processed: false, dateCreated: 1, retryCount: 0, routeId: 'PRIVATE_UNKNOWN' });
        await batch.commit(); await observeActivityDeliveryQueue(db, vi.fn(), 0);
        for (const [, fields] of vi.mocked(logger.info).mock.calls) {
            expect(fields).toMatchObject({ truncated: true, unknownSample: 20 });
            expect(fields).not.toHaveProperty('dueSample');
        }
    });
});
