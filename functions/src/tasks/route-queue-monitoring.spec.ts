import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
const mock = vi.hoisted(() => ({ get: vi.fn(), failed: vi.fn(), cleanup: vi.fn(), import: vi.fn(), delivery: vi.fn() }));
vi.mock('firebase-functions/v2/tasks', () => ({ onTaskDispatched: (_options: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('firebase-admin', () => ({ firestore: () => ({ collection: (collection: string) => ({ doc: () => ({ get: collection === 'failed_jobs' ? mock.failed : mock.get }) }) }) }));
vi.mock('../queue/cleanup-tombstone', () => ({ isQueueItemDeletedForUserCleanup: mock.cleanup }));
vi.mock('../routes/process-route-sync-queue-item', () => ({ processRouteSyncQueueItem: mock.import }));
vi.mock('../route-delivery-sync/process-queue-item', () => ({ processRouteDeliverySyncQueueItem: mock.delivery }));
vi.mock('../queue-utils', () => ({ QueueResult: { Processed: 'PROCESSED', Deferred: 'DEFERRED', MovedToDLQ: 'MOVED_TO_DLQ', Skipped: 'SKIPPED', RetryIncremented: 'RETRY_INCREMENTED', Failed: 'FAILED' } }));
vi.unmock('@sports-alliance/sports-lib');
import { processRouteSyncTask } from './route-sync-worker';
import { processRouteDeliverySyncTask } from './route-delivery-sync-worker';
const observed = () => vi.mocked(logger.info).mock.calls.filter(([message]) => message === '[RouteQueue]');
describe.each([
    ['import', processRouteSyncTask, mock.import], ['delivery', processRouteDeliverySyncTask, mock.delivery],
] as const)('%s task observations', (lane, functionObject, processor) => {
    const invoke = (request: unknown = { data: { queueItemId: 'PRIVATE' } }) => (functionObject as unknown as (request: unknown) => Promise<void>)(request);
    beforeEach(() => {
        vi.clearAllMocks();
        Object.values(mock).forEach(fn => fn.mockReset());
        mock.cleanup.mockResolvedValue(false); mock.failed.mockResolvedValue({ exists: false });
        mock.get.mockResolvedValue({ exists: true, id: 'PRIVATE', ref: { parent: { id: lane === 'import' ? 'routeSyncQueue' : 'routeDeliverySyncQueue' } }, data: () => ({
            sourceServiceName: ServiceNames.SuuntoApp, destinationServiceName: ServiceNames.WahooAPI, routeId: 'SuuntoApp_to_WahooAPI', userID: 'PRIVATE', geometry: 'PRIVATE', processed: false,
        }) });
    });
    it.each([['PROCESSED', 'acknowledged'], ['DEFERRED', 'deferred'], ['MOVED_TO_DLQ', 'dead_lettered']])('separates %s ACK from committed success', async (result, outcome) => {
        processor.mockResolvedValueOnce(result); await invoke();
        expect(observed()).toHaveLength(1);
        expect(observed()[0][1]).toMatchObject({ lane, event: 'worker_attempt', outcome });
        expect(JSON.stringify(observed())).not.toContain('PRIVATE');
    });
    it.each(['RETRY_INCREMENTED', 'FAILED', 'UNEXPECTED'])('preserves thrown retry/failure for %s', async result => {
        processor.mockResolvedValueOnce(result); await expect(invoke()).rejects.toThrow();
        expect(observed()[0][1]).toMatchObject({ outcome: result === 'RETRY_INCREMENTED' ? 'retry' : 'failed' });
    });
    it('observes lease contention but never hides its retry', async () => {
        processor.mockRejectedValueOnce(Object.assign(new Error('PRIVATE'), { name: 'ProviderOperationStillInFlightError' }));
        await expect(invoke()).rejects.toThrow('PRIVATE');
        expect(observed()[0][1]).toMatchObject({ outcome: 'expected_contention' });
    });
    it('covers initial Firestore read failure, not only provider processing', async () => {
        mock.get.mockRejectedValueOnce(new Error('PRIVATE'));
        await expect(invoke()).rejects.toThrow('PRIVATE');
        expect(observed()[0][1]).toMatchObject({ lane, outcome: 'failed' });
    });
    it.each([null, undefined])('observes malformed payload %s and still fails without processing', async data => {
        await expect(invoke({ data })).rejects.toThrow(TypeError);
        expect(observed()).toHaveLength(1);
        expect(observed()[0][1]).toMatchObject({ lane, outcome: 'failed', source: 'unknown', destination: 'unknown' });
        expect(processor).not.toHaveBeenCalled();
        expect(mock.get).not.toHaveBeenCalled();
    });
    it('acknowledges committed work even when only the telemetry logger fails', async () => {
        processor.mockResolvedValueOnce('PROCESSED');
        vi.mocked(logger.info).mockImplementation(message => {
            if (message === '[RouteQueue]') throw new Error('PRIVATE_LOGGER_FAILURE');
        });
        try {
            await expect(invoke()).resolves.toBeUndefined();
            expect(processor).toHaveBeenCalledOnce();
            expect(observed()).toHaveLength(1);
            expect(observed()[0][1]).toMatchObject({ lane, outcome: 'acknowledged' });
        } finally {
            vi.mocked(logger.info).mockReset();
        }
    });
    it.each(['already_processed', 'already_failed', 'cleanup_removed'])('ACKs %s without delivery success', async outcome => {
        mock.get.mockResolvedValueOnce(outcome === 'already_processed' ? { exists: true, data: () => ({ processed: true }) } : { exists: false });
        mock.failed.mockResolvedValueOnce({ exists: outcome === 'already_failed' });
        mock.cleanup.mockResolvedValueOnce(outcome === 'cleanup_removed');
        await invoke();
        expect(observed()[0][1]).toMatchObject({ lane, outcome });
        expect(processor).not.toHaveBeenCalled();
    });
});
