import { randomUUID } from 'node:crypto';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueItemInterface } from '../queue/queue-item.interface';
const state = vi.hoisted(() => ({ db: null as unknown as Firestore }));
vi.mock('firebase-admin', () => ({ firestore: () => state.db }));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.unmock('@sports-alliance/sports-lib');
import { increaseRetryCountIfCurrentUserActive, moveToDeadLetterQueueIfCurrentUserActive, QueueResult, updateToProcessed } from '../queue-utils';

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
});
