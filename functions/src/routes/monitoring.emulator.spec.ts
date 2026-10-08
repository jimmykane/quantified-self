import { randomUUID } from 'node:crypto';
import { Firestore, Query, Timestamp, Transaction } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueItemInterface } from '../queue/queue-item.interface';
const state = vi.hoisted(() => ({ db: null as unknown as Firestore }));
vi.mock('firebase-admin', () => ({ firestore: () => state.db }));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.unmock('@sports-alliance/sports-lib');
import { increaseRetryCountIfCurrentUserActive, moveToDeadLetterQueueIfCurrentUserActive, QueueResult, updateToProcessed } from '../queue-utils';
import { observeRouteQueues, ROUTE_QUEUE_PROBE_LIMIT } from './monitoring-probe';
import { ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD } from '../token-refresh-coordinator';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME } from '../wahoo/constants';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('route observations with real isolated Firestore transitions', () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback emulator required.');
    beforeEach(async () => {
        vi.clearAllMocks();
        state.db = new Firestore({ projectId: `demo-route-monitor-${randomUUID().slice(0, 8)}` });
        state.db.settings({ ignoreUndefinedProperties: true });
        await state.db.doc('users/qa').set({ private: 'PRIVATE_OWNER' });
    });
    afterEach(async () => { vi.restoreAllMocks(); await state.db.terminate(); });
    const observed = () => vi.mocked(logger.info).mock.calls.filter(([message]) => message === '[RouteQueue]');
    async function seed(collection = 'routeDeliverySyncQueue') {
        const ref = state.db.collection(collection).doc('qa');
        const data = { processed: false, retryCount: 0, totalRetryCount: 0, dateCreated: 1, errors: [],
            sourceServiceName: ServiceNames.SuuntoApp, destinationServiceName: ServiceNames.WahooAPI, routeId: 'SuuntoApp_to_WahooAPI',
            userID: 'qa', firebaseUserID: 'qa', savedRouteID: 'PRIVATE', sourceRevisionKey: 'PRIVATE', geometry: 'PRIVATE' };
        await ref.set(data);
        return { ...data, id: ref.id, ref } as unknown as QueueItemInterface;
    }
    const guard = (item: QueueItemInterface) => ({ queueItem: item, error: new Error('PRIVATE_PROVIDER'), userID: 'qa', phase: 'qa', logPrefix: 'qa',
        isCurrent: (row: Record<string, unknown>) => row.processed === false && row.dateCreated === item.dateCreated && row.retryCount === item.retryCount });
    it('counts a new durable DLQ and terminal replay blocker, but not its retained history', async () => {
        const item = await seed();
        expect(await moveToDeadLetterQueueIfCurrentUserActive({ ...guard(item), manualReconciliation: { additionalData: { destinationProviderRouteId: 'PRIVATE' } } })).toBe(QueueResult.MovedToDLQ);
        expect((await item.ref!.get()).get('resultStatus')).toBe('manual_reconciliation_required');
        expect((await state.db.doc('failed_jobs/qa').get()).exists).toBe(true);
        expect(observed().map(([, fields]) => fields.outcome)).toEqual(['dead_lettered', 'manual_reconciliation']);
        await moveToDeadLetterQueueIfCurrentUserActive({ ...guard(item), manualReconciliation: {} });
        expect(observed()).toHaveLength(2);
        expect(JSON.stringify(observed())).not.toContain('PRIVATE');
    });
    it('does not report stale replacement work as a new permanent failure', async () => {
        const item = await seed(); await item.ref!.update({ dateCreated: 2 });
        expect(await moveToDeadLetterQueueIfCurrentUserActive(guard(item))).toBe(QueueResult.Processed);
        expect((await item.ref!.get()).get('dateCreated')).toBe(2);
        expect((await state.db.doc('failed_jobs/qa').get()).exists).toBe(false);
        expect(observed()).toHaveLength(0);
    });
    it('account deletion fences prevent failure records and success claims', async () => {
        const item = await seed();
        await state.db.doc('userDeletionTombstones/qa').set({ expireAt: Timestamp.fromMillis(Date.now() + 60_000) });
        await moveToDeadLetterQueueIfCurrentUserActive(guard(item));
        expect((await state.db.doc('failed_jobs/qa').get()).exists).toBe(false);
        expect(observed()).toHaveLength(0);
    });
    it('failed persistence cannot emit a committed outcome', async () => {
        const item = await seed(); const before = await item.ref!.get();
        vi.spyOn(state.db, 'runTransaction').mockRejectedValueOnce(new Error('PRIVATE_FIRESTORE'));
        expect(await moveToDeadLetterQueueIfCurrentUserActive(guard(item))).toBe(QueueResult.Failed);
        expect((await item.ref!.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
        expect(observed()).toHaveLength(0);
    });
    it.each(['retry', 'expected_contention'])('emits only the committed %s transition', async outcome => {
        const item = await seed();
        const error = new Error('PRIVATE'); if (outcome === 'expected_contention') error.name = 'TokenRefreshInProgressError';
        expect(await increaseRetryCountIfCurrentUserActive({ ...guard(item), error })).toBe(QueueResult.RetryIncremented);
        expect((await item.ref!.get()).get('retryCount')).toBe(1);
        expect(observed().map(([, fields]) => fields.outcome)).toEqual([outcome]);
        expect(JSON.stringify(observed())).not.toContain('PRIVATE');
    });
    it('retry exhaustion produces new DLQ and reconciliation, never route success', async () => {
        const item = await seed(); item.retryCount = 9; await item.ref!.update({ retryCount: 9 });
        expect(await increaseRetryCountIfCurrentUserActive({ ...guard(item), manualReconciliation: {} })).toBe(QueueResult.MovedToDLQ);
        expect(observed().map(([, fields]) => fields.outcome)).toEqual(['dead_lettered', 'manual_reconciliation']);
    });
    it('legacy imports distinguish a persisted success from a skip', async () => {
        const item = await seed('routeSyncQueue');
        await updateToProcessed(item, undefined, { resultStatus: 'success' });
        await updateToProcessed({ ...item, ref: state.db.doc('routeSyncQueue/qa') }, undefined, { resultStatus: 'skipped' });
        expect(observed().map(([, fields]) => [fields.lane, fields.outcome])).toEqual([['import', 'success'], ['import', 'skipped']]);
    });

    async function seedProbe(destination = ServiceNames.WahooAPI) {
        const routeId = destination === ServiceNames.WahooAPI ? 'SuuntoApp_to_WahooAPI'
            : destination === ServiceNames.GarminAPI ? 'SuuntoApp_to_GarminAPI' : 'SuuntoApp_to_COROSAPI';
        await state.db.doc('users/qa/config/settings').set({ serviceSyncSettings: { routeDeliverySyncRoutes: { [routeId]: { enabled: true } } } });
        await state.db.doc(`users/qa/meta/${ServiceNames.SuuntoApp}`).set({ connectionState: 'connected', connectionStateGeneration: 'PRIVATE_CONNECTION' });
        await state.db.collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME).doc('qa').set({ [ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD]: 'PRIVATE_ROOT' });
        await state.db.collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME).doc('qa').collection('tokens').doc('PRIVATE_ACCOUNT').set({
            serviceName: ServiceNames.SuuntoApp, userName: 'PRIVATE_ACCOUNT', tokenCredentialGeneration: 'PRIVATE_TOKEN', accessToken: 'PRIVATE_SECRET' });
        await state.db.doc(`users/qa/meta/${destination}`).set({ connectionState: 'connected' });
        const destinationCollection = destination === ServiceNames.WahooAPI ? WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME
            : destination === ServiceNames.GarminAPI ? GARMIN_API_TOKENS_COLLECTION_NAME : COROSAPI_ACCESS_TOKENS_COLLECTION_NAME;
        await state.db.collection(destinationCollection).doc('qa').set({});
        await state.db.collection(destinationCollection).doc('qa').collection('tokens').doc('PRIVATE_DEST').set({
            serviceName: destination, wahooUserID: 'PRIVATE_DEST', userID: 'PRIVATE_DEST', openId: 'PRIVATE_DEST', permissions: ['COURSE_IMPORT'],
            scope: 'routes_read routes_write', accessToken: 'PRIVATE_SECRET' });
        await state.db.doc('users/qa/routes/PRIVATE_ROUTE').set({ sourceSummary: { sourceServiceName: ServiceNames.SuuntoApp,
            providerUserId: 'PRIVATE_ACCOUNT', providerRouteId: 'PRIVATE_ROUTE', modifiedAt: 123, name: 'PRIVATE_NAME' }, geometry: 'PRIVATE_GEOMETRY' });
        const now = Date.now();
        const data = { processed: false, retryCount: 0, dateCreated: now - 60_000, dispatchedToCloudTask: null, manual: false,
            sourceServiceName: ServiceNames.SuuntoApp, firebaseUserID: 'qa', providerUserId: 'PRIVATE_ACCOUNT', providerRouteId: 'PRIVATE_ROUTE',
            destinationServiceName: destination, routeId, userID: 'qa', savedRouteID: 'PRIVATE_ROUTE', sourceRevisionKey: `${ServiceNames.SuuntoApp}:PRIVATE_ROUTE:123`,
            sourceProviderUserId: 'PRIVATE_ACCOUNT', sourceProviderRouteId: 'PRIVATE_ROUTE', sourceConnectionStateGeneration: 'PRIVATE_CONNECTION',
            sourceTokenCredentialGeneration: 'PRIVATE_TOKEN', sourceRootOAuthCredentialGeneration: 'PRIVATE_ROOT', errors: ['PRIVATE_ERROR'] };
        const imported = state.db.doc('routeSyncQueue/qa'); const delivery = state.db.doc('routeDeliverySyncQueue/qa');
        await imported.set(data); await delivery.set(data);
        return { imported, delivery, data, now: Date.now() + 1_000, destinationCollection };
    }
    const samples = () => observed().filter(([, fields]) => fields.event === 'queue_sample');
    const sampleFor = (lane: string, destination: string) => samples().find(([, fields]) => fields.lane === lane && fields.destination === destination)?.[1];
    it.each([ServiceNames.WahooAPI, ServiceNames.GarminAPI, ServiceNames.COROSAPI])('observes eligible import and %s delivery without writes or private payload reads', async destination => {
        const seeded = await seedProbe(destination);
        const before = await seeded.delivery.get();
        const runTransaction = vi.spyOn(state.db, 'runTransaction');
        const getAll = vi.spyOn(Transaction.prototype, 'getAll');
        const select = vi.spyOn(Query.prototype, 'select');
        await observeRouteQueues(state.db, async () => true, seeded.now);
        expect(sampleFor('import', 'qs')).toMatchObject({ dueSample: 1, unknownSample: 0, truncated: false });
        expect(sampleFor('delivery', destination === ServiceNames.WahooAPI ? 'wahoo' : destination === ServiceNames.GarminAPI ? 'garmin' : 'coros')).toMatchObject({ dueSample: 1, unknownSample: 0 });
        expect((await seeded.delivery.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
        expect(runTransaction.mock.calls.every(([, options]) => options?.readOnly === true)).toBe(true);
        expect(getAll.mock.calls.length).toBeGreaterThan(0);
        for (const call of getAll.mock.calls) {
            const fields = (call.at(-1) as { fieldMask: string[] }).fieldMask;
            expect(Array.isArray(fields)).toBe(true);
            expect(new Set(fields).size).toBe(fields.length);
            for (const forbidden of ['accessToken', 'refreshToken', 'errors', 'geometry', 'sourceSummary', 'sourceSummary.name', 'originalFiles']) expect(fields).not.toContain(forbidden);
        }
        expect(select.mock.calls.length).toBeGreaterThan(0);
        for (const fields of select.mock.calls) for (const forbidden of ['accessToken', 'refreshToken', 'errors', 'geometry', 'originalFiles']) expect(fields).not.toContain(forbidden);
        expect(JSON.stringify(observed())).not.toContain('PRIVATE');
    });
    it('accepts sub-millisecond Firestore update times and rounds age down to a lower bound', async () => {
        const seeded = await seedProbe();
        // Production commit timestamps can retain microseconds even when the emulator rounds to milliseconds.
        const toMillis = Timestamp.prototype.toMillis;
        vi.spyOn(Timestamp.prototype, 'toMillis').mockImplementation(function (this: Timestamp) {
            return Math.floor(toMillis.call(this)) + 0.125;
        });
        const timestamps = await Promise.all([seeded.imported.get(), seeded.delivery.get()]);
        await observeRouteQueues(state.db, async () => true, seeded.now);
        for (const [index, [lane, destination]] of [['import', 'qs'], ['delivery', 'wahoo']].entries()) {
            expect(sampleFor(lane, destination)).toMatchObject({ dueSample: 1, unknownSample: 0 });
            expect(sampleFor(lane, destination)?.ageLowerBoundMs).toBe(Math.floor(seeded.now - timestamps[index].updateTime!.toMillis()));
        }
    });
    it.each([0, false, 'wrong_account'])('does not accept a malformed or mismatched COROS token identity (%s)', async openId => {
        const seeded = await seedProbe(ServiceNames.COROSAPI);
        await state.db.collection(seeded.destinationCollection).doc('qa').collection('tokens').doc('PRIVATE_DEST').update({ openId });
        await observeRouteQueues(state.db, async () => true, seeded.now);
        expect(sampleFor('delivery', 'coros')).toMatchObject({ dueSample: 0, excludedSample: 1 });
    });
    it.each([null, ''])('retains the COROS legacy document-ID fallback only for an absent token identity (%s)', async openId => {
        const seeded = await seedProbe(ServiceNames.COROSAPI);
        await state.db.collection(seeded.destinationCollection).doc('qa').collection('tokens').doc('PRIVATE_DEST').update({ openId });
        await observeRouteQueues(state.db, async () => true, seeded.now);
        expect(sampleFor('delivery', 'coros')).toMatchObject({ dueSample: 1, unknownSample: 0 });
    });
    it.each(['deleted_owner', 'tombstone', 'disconnect', 'no_pro', 'source_token_identity', 'source_generation'])('excludes %s from eligible backlog', async reason => {
        const seeded = await seedProbe();
        if (reason === 'deleted_owner') await state.db.doc('users/qa').delete();
        if (reason === 'tombstone') await state.db.doc('userDeletionTombstones/qa').set({ expireAt: Timestamp.fromMillis(seeded.now + 60_000) });
        if (reason === 'disconnect') await state.db.doc(`users/qa/meta/${ServiceNames.SuuntoApp}`).update({ connectionState: 'disconnect_pending' });
        if (reason === 'source_token_identity') await state.db.collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME).doc('qa').collection('tokens').doc('PRIVATE_ACCOUNT').update({ userName: 'other_owner' });
        if (reason === 'source_generation') await state.db.doc(`users/qa/meta/${ServiceNames.SuuntoApp}`).update({ connectionStateGeneration: 'new_connection' });
        await observeRouteQueues(state.db, async () => reason !== 'no_pro', seeded.now);
        expect(sampleFor('delivery', 'wahoo')).toMatchObject({ dueSample: 0, excludedSample: 1 });
        if (reason !== 'source_generation' && reason !== 'no_pro') expect(sampleFor('import', 'qs')).toMatchObject({ dueSample: 0, excludedSample: 1 });
        if (reason === 'no_pro') expect(sampleFor('import', 'qs')).toMatchObject({ dueSample: 1 });
    });
    it.each(['disabled', 'stale_revision', 'wrong_source', 'permission', 'reconnect', 'restore', 'lease', 'claimed'])('excludes delivery %s, retaining import independence', async reason => {
        const seeded = await seedProbe();
        if (reason === 'disabled') await state.db.doc('users/qa/config/settings').set({});
        if (reason === 'stale_revision') await state.db.doc('users/qa/routes/PRIVATE_ROUTE').update({ 'sourceSummary.modifiedAt': 124 });
        if (reason === 'wrong_source') await state.db.doc('users/qa/routes/PRIVATE_ROUTE').update({ 'sourceSummary.providerUserId': 'other_owner' });
        if (reason === 'permission') await state.db.collection(seeded.destinationCollection).doc('qa').collection('tokens').doc('PRIVATE_DEST').update({ scope: 'workouts_read' });
        if (reason === 'reconnect') await state.db.doc(`users/qa/meta/${ServiceNames.WahooAPI}`).update({ connectionState: 'reconnect_required' });
        if (reason === 'restore') await state.db.doc(`users/qa/meta/${ServiceNames.WahooAPI}`).update({ routeRestorePending: true });
        if (reason === 'lease') await seeded.delivery.update({ processingLeaseExpiresAt: seeded.now + 60_000 });
        if (reason === 'claimed') await seeded.delivery.update({ destinationDeliveryAcceptedAt: seeded.now });
        await observeRouteQueues(state.db, async () => true, seeded.now);
        expect(sampleFor('delivery', 'wahoo')).toMatchObject({ dueSample: 0, excludedSample: 1 });
        expect(sampleFor('import', 'qs')).toMatchObject({ dueSample: 1 });
    });
    it('a queue replacement between candidate query and transaction is not due', async () => {
        const seeded = await seedProbe();
        await observeRouteQueues(state.db, async () => { await seeded.delivery.update({ sourceRevisionKey: 'replacement' }); return true; }, seeded.now);
        expect(sampleFor('delivery', 'wahoo')).toMatchObject({ unknownSample: 1 });
        expect(sampleFor('delivery', 'wahoo')).not.toHaveProperty('dueSample');
    });
    it('manual copies bypass direction settings but not connection or revision guards', async () => {
        const seeded = await seedProbe(); await state.db.doc('users/qa/config/settings').set({});
        await seeded.delivery.update({ manual: true });
        await observeRouteQueues(state.db, async () => true, seeded.now);
        expect(sampleFor('delivery', 'wahoo')).toMatchObject({ dueSample: 1 });
    });
    it.each([ServiceNames.WahooAPI, ServiceNames.COROSAPI])('fences %s pinned-account mismatch and credential rotation', async destination => {
        const seeded = await seedProbe(destination);
        const label = destination === ServiceNames.WahooAPI ? 'wahoo' : 'coros';
        const meta = state.db.doc(`users/qa/meta/${destination}`);
        await meta.update({ providerUserId: 'different_account' });
        await observeRouteQueues(state.db, async () => true, seeded.now);
        expect(sampleFor('delivery', label)).toMatchObject({ dueSample: 0, excludedSample: 1 });
        vi.clearAllMocks(); await meta.update({ providerUserId: 'PRIVATE_DEST' });
        await state.db.collection(seeded.destinationCollection).doc('qa').update({ [ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD]: 'rotated' });
        await observeRouteQueues(state.db, async () => true, seeded.now);
        if (destination === ServiceNames.WahooAPI) {
            expect(sampleFor('delivery', label)).toMatchObject({ unknownSample: 1 });
            expect(sampleFor('delivery', label)).not.toHaveProperty('dueSample');
        } else expect(sampleFor('delivery', label)).toMatchObject({ dueSample: 0, excludedSample: 1 });
    });
    it('excludes Garmin permission loss without contacting the provider', async () => {
        const seeded = await seedProbe(ServiceNames.GarminAPI);
        await state.db.collection(seeded.destinationCollection).doc('qa').collection('tokens').doc('PRIVATE_DEST').update({ permissions: ['ACTIVITY_IMPORT'] });
        await observeRouteQueues(state.db, async () => true, seeded.now);
        expect(sampleFor('delivery', 'garmin')).toMatchObject({ dueSample: 0, excludedSample: 1 });
    });
    it('does not turn an incomplete destination-token prefix into healthy zero', async () => {
        const seeded = await seedProbe();
        for (let index = 0; index < 6; index++) await state.db.collection(seeded.destinationCollection).doc('qa').collection('tokens').doc(`extra-${index}`).set({ wahooUserID: `extra-${index}`, accessToken: 'PRIVATE' });
        await observeRouteQueues(state.db, async () => true, seeded.now);
        expect(sampleFor('delivery', 'wahoo')).toMatchObject({ unknownSample: 1 });
        expect(sampleFor('delivery', 'wahoo')).not.toHaveProperty('dueSample');
    });
    it('malformed or truncated prefixes do not emit healthy zero', async () => {
        const seeded = await seedProbe(); await seeded.delivery.update({ retryCount: 'PRIVATE_INVALID' });
        await observeRouteQueues(state.db, async () => true, seeded.now);
        expect(sampleFor('delivery', 'wahoo')).toMatchObject({ unknownSample: 1 });
        expect(sampleFor('delivery', 'wahoo')).not.toHaveProperty('dueSample');
        vi.clearAllMocks();
        const batch = state.db.batch();
        for (let index = 0; index <= ROUTE_QUEUE_PROBE_LIMIT; index++) batch.set(state.db.doc(`routeDeliverySyncQueue/extra-${index}`), { ...seeded.data, dateCreated: 1, resultStatus: 'deferred' });
        await batch.commit(); await observeRouteQueues(state.db, async () => true, seeded.now);
        expect(sampleFor('delivery', 'wahoo')).toMatchObject({ truncated: true, sampled: ROUTE_QUEUE_PROBE_LIMIT });
        expect(sampleFor('delivery', 'wahoo')).not.toHaveProperty('dueSample');
    });
});
