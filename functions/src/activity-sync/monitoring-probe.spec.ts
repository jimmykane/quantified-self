import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import * as logger from 'firebase-functions/logger';
import { activityDeliveryProbeCandidate, observeActivityDeliveryQueue } from './monitoring-probe';
vi.mock('firebase-functions/logger', () => ({ info: vi.fn() }));
const now = 1_700_000_000_000;
const row = { processed: false, retryCount: 0, dateCreated: now - 3_600_000, dispatchedToCloudTask: null };
describe('activity delivery probe exclusions and bounds', () => {
    beforeEach(() => vi.clearAllMocks());
    it('only observes new undispatched work, not retry backoff, future work, deferrals or active claims', () => {
        expect(activityDeliveryProbeCandidate(row, now)).toBe('new');
        for (const change of [{ retryCount: 1 }, { processed: true }, { dateCreated: now + 1 }, { dispatchedToCloudTask: now - 1 }, { dispatchedToCloudTask: Number.MAX_SAFE_INTEGER }, { providerOperationStartedAt: now }, { resultStatus: 'deferred' }, { resultStatus: 'manual_reconciliation_required' }, { processingLeaseExpiresAt: now + 1 }]) {
            expect(activityDeliveryProbeCandidate({ ...row, ...change }, now)).toBe('excluded');
        }
    });
    it('unknown numbers never turn into zero backlog', () => {
        for (const change of [{ retryCount: NaN }, { dateCreated: '1' }, { dispatchedToCloudTask: 'PRIVATE' }, { destinationUploadID: {} }]) expect(activityDeliveryProbeCandidate({ ...row, ...change }, now)).toBe('unknown');
    });
    it.each([ServiceNames.WahooAPI, ServiceNames.COROSAPI])('requires an empty native queue and a two-hour overdue saved %s poll', destinationServiceName => {
        const poll = { ...row, retryCount: 3, destinationServiceName, destinationUploadID: 'PRIVATE', destinationProviderUserID: 'PRIVATE_ACCOUNT', dispatchedToCloudTask: now - 7_200_000 };
        expect(activityDeliveryProbeCandidate(poll, now, 0)).toBe('poll');
        expect(activityDeliveryProbeCandidate(poll, now, 1)).toBe('excluded');
        expect(activityDeliveryProbeCandidate(poll, now)).toBe('unknown');
        expect(activityDeliveryProbeCandidate({ ...poll, dispatchedToCloudTask: now + 900_000 }, now, 0)).toBe('excluded');
        expect(activityDeliveryProbeCandidate({ ...poll, dispatchedToCloudTask: now - 900_000 }, now, 0)).toBe('excluded');
        if (destinationServiceName === ServiceNames.COROSAPI) expect(activityDeliveryProbeCandidate({ ...poll, destinationProviderUserID: undefined }, now, 0)).toBe('unknown');
    });
    it('times out without emitting late healthy observations or continuing account reads', async () => {
        vi.clearAllMocks(); vi.useFakeTimers();
        let resolveQuery: (result: unknown) => void = () => {};
        const query = { where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), get: () => new Promise(resolve => { resolveQuery = resolve; }) };
        const pro = vi.fn();
        try {
            const observation = observeActivityDeliveryQueue({ collection: () => query } as never, pro, 0, now);
            await vi.advanceTimersByTimeAsync(5_000); await observation;
            resolveQuery({ docs: [{ data: () => row }], size: 1 }); await Promise.resolve();
            expect(logger.info).toHaveBeenCalledTimes(3);
            expect(vi.mocked(logger.info).mock.calls.every(([, fields]) => fields.event === 'queue_sample_unavailable')).toBe(true);
            expect(pro).not.toHaveBeenCalled();
        } finally { vi.useRealTimers(); }
    });
    it('read errors emit unavailable observations instead of empty healthy samples', async () => {
        const query = { where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), get: vi.fn().mockRejectedValue(new Error('PRIVATE')) };
        await observeActivityDeliveryQueue({ collection: () => query } as never, vi.fn(), 0, now);
        const observations = vi.mocked(logger.info).mock.calls;
        expect(observations).toHaveLength(3);
        expect(observations.every(([, fields]) => fields.event === 'queue_sample_unavailable')).toBe(true);
        expect(JSON.stringify(observations)).not.toContain('PRIVATE');
        expect(query.limit).toHaveBeenCalledWith(21);
        expect(query.select.mock.calls[0]).not.toContain('originalFile');
    });
});
