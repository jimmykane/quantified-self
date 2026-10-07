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
    it.each([
        ['GarminAPI', 'garmin_ping', 'garminHealthTokenCredentialGeneration', 'token'],
        ['GarminAPI', 'garmin_health_backfill', 'garminHealthRootOAuthCredentialGeneration', 'root'],
        ['GarminAPI', 'garmin_ping', 'garminHealthConnectionStateGeneration', 'meta'],
        ['SuuntoApp', 'suunto_health_poll', 'suuntoHealthTokenCredentialGeneration', 'token'],
        ['SuuntoApp', 'suunto_health_poll', 'suuntoHealthRootOAuthCredentialGeneration', 'root'],
        ['SuuntoApp', 'suunto_health_poll', 'suuntoHealthConnectionStateGeneration', 'meta'],
    ])('excludes superseded %s %s %s without borrowing old queue age', async (provider, type, field, target) => {
        const ref = await seed('qa', provider, type);
        const root = provider === 'GarminAPI' ? 'garminAPITokens' : 'suuntoAppAccessTokens';
        await ref.update({ [field]: 'OLD_GENERATION' });
        if (target === 'token' || target === 'root') {
            await db.doc(`${root}/qa/tokens/account`).update({ tokenCredentialGeneration: 'NEW_GENERATION' });
            await db.doc(`${root}/qa`).update({ activeOAuthCredentialGeneration: 'NEW_GENERATION' });
        }
        if (target === 'meta') await db.doc(`users/qa/meta/${provider}`).update({ connectionStateGeneration: 'NEW_GENERATION' });
        await observeHealthSleepQueue(db, 0, (await ref.get()).updateTime!.toMillis() + 86_400_000);
        expect(sample(provider, type === 'garmin_health_backfill' ? 'garmin_health_backfill' : 'sleep_sync'))
            .toMatchObject({ dueSample: 0, excludedSample: 1, unknownSample: 0 });
        expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toMatch(/OLD_GENERATION|NEW_GENERATION|PRIVATE/);
    });
    it.each(['GarminAPI', 'SuuntoApp', 'COROSAPI'])('excludes mismatched pinned %s accounts', async provider => {
        await seed('qa', provider, provider === 'GarminAPI' ? 'garmin_ping' : provider === 'SuuntoApp' ? 'suunto_health_poll' : 'coros_poll');
        await db.doc(`users/qa/meta/${provider}`).update({ providerUserId: 'other-account' });
        await observeHealthSleepQueue(db, 0);
        expect(sample(provider)).toMatchObject({ dueSample: 0, excludedSample: 1 });
    });
    it('accepts matching lifecycle metadata without selecting credentials and distinguishes a null fence from an absent legacy fence', async () => {
        const ref = await seed('qa', 'SuuntoApp', 'suunto_health_poll');
        await db.doc('suuntoAppAccessTokens/qa').update({ activeOAuthCredentialGeneration: 'GENERATION' });
        await db.doc('suuntoAppAccessTokens/qa/tokens/account').update({ tokenCredentialGeneration: 'GENERATION' });
        await db.doc('users/qa/meta/SuuntoApp').update({ connectionStateGeneration: 'CONNECTION' });
        await ref.update({ suuntoHealthTokenCredentialGeneration: 'GENERATION', suuntoHealthRootOAuthCredentialGeneration: 'GENERATION', suuntoHealthConnectionStateGeneration: 'CONNECTION' });
        await observeHealthSleepQueue(db, 0);
        expect(sample('SuuntoApp')).toMatchObject({ dueSample: 1, unknownSample: 0 });
        vi.clearAllMocks(); await ref.update({ suuntoHealthTokenCredentialGeneration: null });
        await observeHealthSleepQueue(db, 0);
        expect(sample('SuuntoApp')).toMatchObject({ dueSample: 0, excludedSample: 1 });
    });
    it('preserves legacy unfenced work on a matching generated connection and accepts null fences on a legacy connection', async () => {
        await seed('unfenced', 'SuuntoApp', 'suunto_health_poll');
        await db.doc('suuntoAppAccessTokens/unfenced').update({ activeOAuthCredentialGeneration: 'CURRENT' });
        await db.doc('suuntoAppAccessTokens/unfenced/tokens/account').update({ tokenCredentialGeneration: 'CURRENT' });
        const ref = await seed('null-fences', 'SuuntoApp', 'suunto_health_poll');
        await ref.update({ suuntoHealthTokenCredentialGeneration: null, suuntoHealthRootOAuthCredentialGeneration: null, suuntoHealthConnectionStateGeneration: null });
        await observeHealthSleepQueue(db, 0);
        expect(sample('SuuntoApp')).toMatchObject({ dueSample: 2, unknownSample: 0 });
    });
    it.each([
        ['sleepSyncQueue/qa', 'suuntoHealthTokenCredentialGeneration', ''],
        ['sleepSyncQueue/qa', 'suuntoHealthRootOAuthCredentialGeneration', ' padded '],
        ['sleepSyncQueue/qa', 'suuntoHealthConnectionStateGeneration', 'x'.repeat(129)],
        ['suuntoAppAccessTokens/qa', 'activeOAuthCredentialGeneration', 123],
        ['suuntoAppAccessTokens/qa/tokens/account', 'tokenCredentialGeneration', false],
        ['users/qa/meta/SuuntoApp', 'connectionStateGeneration', {}],
    ])('reports malformed %s %s as unknown without logging metadata', async (path, field, value) => {
        await seed('qa', 'SuuntoApp', 'suunto_health_poll');
        await db.doc(path).update({ [field]: value });
        await observeHealthSleepQueue(db, 0);
        expect(sample('SuuntoApp')).toMatchObject({ unknownSample: 1 });
        expect(sample('SuuntoApp')).not.toHaveProperty('dueSample');
        expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('PRIVATE');
    });
});
