import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { healthSleepWorkloadFields, observeHealthSleepQueue, recordHealthSleepCommit, recordHealthSleepCompletion, recordHealthSleepUnavailable } from './monitoring';

vi.mock('firebase-functions/logger', () => ({ info: vi.fn() }));

describe('Health/Sleep operational telemetry', () => {
    beforeEach(() => vi.clearAllMocks());
    const item = { provider: 'GarminAPI', type: 'garmin_health_backfill', ref: { parent: { id: 'sleepSyncQueue' } }, payload: 'PRIVATE' };
    it('uses bounded labels and distinguishes completed request campaigns from ingested records', () => {
        recordHealthSleepCompletion(item, { resultStatus: 'success', private: 'PRIVATE' });
        expect(logger.info).toHaveBeenCalledWith('[HealthSleep]', { telemetryVersion: 1, provider: 'GarminAPI', workload: 'garmin_health_backfill', event: 'committed', outcome: 'completed' });
        expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('PRIVATE');
        expect(healthSleepWorkloadFields({ provider: 'PRIVATE', type: 'PRIVATE' })).toEqual({ provider: 'unknown', workload: 'sleep_sync' });
    });
    it('does not turn acknowledgement, deferral or unrelated queue completion into success', () => {
        recordHealthSleepCompletion(item, { resultStatus: 'deferred' });
        recordHealthSleepCompletion(item);
        recordHealthSleepCommit({ ...item, ref: { parent: { id: 'activitySyncQueue' } } }, 'completed');
        expect(logger.info).not.toHaveBeenCalled();
    });
    it('retains separate lifecycle skips and ignores logger failure', () => {
        recordHealthSleepCompletion(item, { resultStatus: 'provider_disabled' });
        expect(logger.info).toHaveBeenCalledWith('[HealthSleep]', expect.objectContaining({ outcome: 'skipped' }));
        vi.mocked(logger.info).mockImplementationOnce(() => { throw new Error('PRIVATE'); });
        expect(() => recordHealthSleepCommit(item, 'dead_lettered')).not.toThrow();
    });
    it('unknown reads emit four unavailable observations, not zero backlog', async () => {
        const chain = { where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), get: vi.fn().mockRejectedValue(new Error('PRIVATE')) };
        await observeHealthSleepQueue({ collection: () => chain } as unknown as FirebaseFirestore.Firestore, 0);
        expect(logger.info).toHaveBeenCalledTimes(4);
        expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('PRIVATE');
        expect(chain.limit).toHaveBeenCalledWith(21);
        expect(chain.select.mock.calls[0]).not.toContain('payload');
        expect(chain.select.mock.calls[0]).not.toContain('callbackURL');
        for (const [, fields] of vi.mocked(logger.info).mock.calls) expect(fields).toMatchObject({ event: 'queue_sample_unavailable' });
    });
    it('late reads cannot emit a false empty sample after the deadline', async () => {
        vi.useFakeTimers();
        try {
            let release!: (value: unknown) => void;
            const pending = new Promise(resolve => { release = resolve; });
            const chain = { where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), get: vi.fn().mockReturnValue(pending) };
            const observing = observeHealthSleepQueue({ collection: () => chain } as unknown as FirebaseFirestore.Firestore, 0);
            await vi.advanceTimersByTimeAsync(5_000); await observing;
            release({ docs: [], size: 0 }); await vi.advanceTimersByTimeAsync(0);
            expect(logger.info).toHaveBeenCalledTimes(4);
            expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('dueSample');
        } finally { vi.useRealTimers(); }
    });
    it('unavailable reporting remains best effort', () => {
        vi.mocked(logger.info).mockImplementation(() => { throw new Error('logger unavailable'); });
        expect(recordHealthSleepUnavailable).not.toThrow();
        vi.mocked(logger.info).mockReset();
    });
    it('stops token lookups and later candidates when the snapshot finishes after the deadline', async () => {
        vi.useFakeTimers();
        try {
            let release!: (value: unknown[]) => void;
            const pending = new Promise<unknown[]>(resolve => { release = resolve; });
            const reference = { collection: vi.fn().mockReturnThis(), doc: vi.fn().mockReturnThis() };
            const updateTime = { isEqual: () => true, toMillis: () => 1 };
            const data = { provider: 'GarminAPI', type: 'garmin_ping', userID: 'qa', providerUserId: 'account', dateCreated: 1, retryCount: 0, processed: false, dispatchedToCloudTask: null };
            const candidate = { ref: reference, updateTime, data: () => data };
            const chain = { where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), get: vi.fn().mockResolvedValue({ docs: [candidate, candidate], size: 2 }) };
            const transaction = { getAll: vi.fn().mockReturnValue(pending), get: vi.fn() };
            const db = { collection: (name: string) => name === 'sleepSyncQueue' ? chain : reference,
                runTransaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)) };
            const observing = observeHealthSleepQueue(db as unknown as FirebaseFirestore.Firestore, 0, 10);
            await vi.advanceTimersByTimeAsync(5_000); await observing;
            release([{ exists: true, updateTime, data: () => data }, { exists: true }, { exists: false }, { get: () => undefined }, { exists: true, get: () => undefined }]);
            await vi.advanceTimersByTimeAsync(0);
            expect(transaction.getAll).toHaveBeenCalledTimes(1);
            expect(transaction.get).not.toHaveBeenCalled();
            expect(reference.collection).not.toHaveBeenCalledWith('tokens');
            expect(db.runTransaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), { readOnly: true });
            expect(logger.info).toHaveBeenCalledTimes(4);
            for (const [, fields] of vi.mocked(logger.info).mock.calls) expect(fields.event).toBe('queue_sample_unavailable');
        } finally { vi.useRealTimers(); }
    });
});
