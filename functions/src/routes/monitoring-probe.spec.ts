import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { observeRouteQueues, routeQueueProbeCandidate, ROUTE_QUEUE_PROBE_TIMEOUT_MS } from './monitoring-probe';
import { observeRouteDispatch } from './monitoring';
vi.mock('firebase-functions/logger', () => ({ info: vi.fn() }));
vi.unmock('@sports-alliance/sports-lib');
const now = 1_700_000_000_000;
const row = { processed: false, retryCount: 0, dateCreated: now - 3_600_000, dispatchedToCloudTask: null };
describe('bounded route observations', () => {
    beforeEach(() => vi.clearAllMocks());
    it('excludes retry backoff, claims, future work, deferrals, and accepted/ambiguous deliveries', () => {
        expect(routeQueueProbeCandidate(row, now)).toBe('new');
        for (const change of [{ retryCount: 1 }, { processed: true }, { dateCreated: now + 1 }, { dispatchedToCloudTask: now - 1 },
            { dispatchedToCloudTask: Number.MAX_SAFE_INTEGER }, { providerOperationStartedAt: now }, { processingLeaseExpiresAt: now + 1 },
            { resultStatus: 'deferred' }, { resultStatus: 'manual_reconciliation_required' }, { destinationDeliveryAcceptedAt: now },
            { destinationProviderRouteId: 'PRIVATE' }, { destinationDeliveries: [] }, { manualReconciliationRequiredAt: now }]) {
            expect(routeQueueProbeCandidate({ ...row, ...change }, now)).toBe('excluded');
        }
    });
    it('malformed scheduling fields remain unknown, not zero backlog', () => {
        for (const change of [{ retryCount: NaN }, { dateCreated: '1' }, { dispatchedToCloudTask: 'PRIVATE' },
            { processingLeaseExpiresAt: -1 }, { providerOperationStartedAt: -1 }, { resultStatus: 'PRIVATE_STATUS' }]) {
            expect(routeQueueProbeCandidate({ ...row, ...change }, now)).toBe('unknown');
        }
    });
    const query = () => ({ where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(), get: vi.fn() });
    it('masked, bounded query failures are unavailable for both lanes, never healthy zero', async () => {
        const chain = query(); chain.get.mockRejectedValue(new Error('PRIVATE'));
        await observeRouteQueues({ collection: () => chain } as never, vi.fn(), now);
        expect(logger.info).toHaveBeenCalledTimes(4);
        expect(vi.mocked(logger.info).mock.calls.every(([, fields]) => fields.event === 'queue_sample_unavailable')).toBe(true);
        expect(chain.limit).toHaveBeenCalledWith(21);
        expect(chain.select.mock.calls[0]).not.toContain('errors');
        expect(chain.select.mock.calls[0]).not.toContain('geometry');
        expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('PRIVATE');
    });
    it('shares one deadline and stops late reads/healthy emissions', async () => {
        vi.useFakeTimers();
        const chain = query(); const pro = vi.fn();
        const releases: Array<(value: unknown) => void> = [];
        chain.get.mockImplementation(() => new Promise(resolve => { releases.push(resolve); }));
        try {
            const pending = observeRouteQueues({ collection: () => chain } as never, pro, now);
            await vi.advanceTimersByTimeAsync(ROUTE_QUEUE_PROBE_TIMEOUT_MS); await pending;
            releases.forEach(release => release({ docs: [{ data: () => row }], size: 1 })); await Promise.resolve();
            expect(logger.info).toHaveBeenCalledTimes(4);
            expect(pro).not.toHaveBeenCalled();
        } finally { vi.useRealTimers(); }
    });
    it('does not start metadata reads after a late entitlement result', async () => {
        vi.useFakeTimers();
        const imports = query(); const deliveries = query(); const runTransaction = vi.fn();
        imports.get.mockResolvedValue({ docs: [], size: 0 });
        deliveries.get.mockResolvedValue({ size: 1, docs: [{ data: () => ({ ...row, sourceServiceName: ServiceNames.SuuntoApp,
            destinationServiceName: ServiceNames.WahooAPI, routeId: 'SuuntoApp_to_WahooAPI', userID: 'qa', sourceProviderUserId: 'account', savedRouteID: 'route', sourceRevisionKey: 'revision' }) }] });
        let release: (value: boolean) => void = () => {};
        const pro = vi.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
        try {
            const pending = observeRouteQueues({ collection: (name: string) => name === 'routeSyncQueue' ? imports : deliveries, runTransaction } as never, pro, now);
            await vi.advanceTimersByTimeAsync(ROUTE_QUEUE_PROBE_TIMEOUT_MS); await pending;
            expect(pro).toHaveBeenCalledOnce();
            release(true); await vi.advanceTimersByTimeAsync(1);
            expect(runTransaction).not.toHaveBeenCalled();
            expect(logger.info).toHaveBeenCalledTimes(4);
            expect(vi.mocked(logger.info).mock.calls.every(([, fields]) => fields.event === 'queue_sample_unavailable')).toBe(true);
        } finally { vi.useRealTimers(); }
    });
    it('deduplication preserves false and does not become a dispatch failure', async () => {
        expect(await observeRouteDispatch('import', row, 'enqueue', async () => false)).toBe(false);
        expect(logger.info).not.toHaveBeenCalled();
    });
    it('dispatch failure preserves error identity and never emits private error text', async () => {
        const error = new Error('PRIVATE');
        await expect(observeRouteDispatch('delivery', { ...row, userID: 'PRIVATE' }, 'marker', async () => { throw error; })).rejects.toBe(error);
        expect(logger.info).toHaveBeenCalledWith('[RouteQueue]', expect.objectContaining({ event: 'dispatch_failure', phase: 'marker', dispatchMode: 'immediate' }));
        expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('PRIVATE');
    });
    it('logger failure cannot change dispatch results or original errors', async () => {
        vi.mocked(logger.info).mockImplementationOnce(() => { throw new Error('logger'); });
        const error = new Error('original');
        await expect(observeRouteDispatch('import', row, 'enqueue', async () => { throw error; })).rejects.toBe(error);
    });
});
