import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DERIVED_METRIC_KINDS,
    DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS,
} from '../../../shared/derived-metrics';
import {
    DataDuration,
    DataHeartRateAvg,
    DataHeartRateZoneFiveDuration,
    DataHeartRateZoneFourDuration,
    DataHeartRateZoneOneDuration,
    DataHeartRateZoneThreeDuration,
    DataHeartRateZoneTwoDuration,
    DataPowerAvg,
    DataPowerZoneFiveDuration,
    DataPowerZoneFourDuration,
    DataPowerZoneOneDuration,
    DataPowerZoneThreeDuration,
    DataPowerZoneTwoDuration,
    DataRecoveryTime,
} from '@sports-alliance/sports-lib';

const hoisted = vi.hoisted(() => {
    const get = vi.fn();
    const select = vi.fn();
    const where = vi.fn();
    const transactionGet = vi.fn();
    const transactionSet = vi.fn();
    const userRootGet = vi.fn();
    const tombstoneGet = vi.fn();
    const eventsCollection = { where };
    const derivedMetricsCollectionRef = {
        path: 'users/user-1/derivedMetrics',
    };
    const recursiveDelete = vi.fn();
    const userRootRef = {
        path: 'users/user-1',
        get: userRootGet,
        collection: vi.fn((collectionName?: string) => {
            if (collectionName === 'derivedMetrics') {
                return derivedMetricsCollectionRef;
            }
            return eventsCollection;
        }),
    };
    const tombstoneRef = {
        path: 'userDeletionTombstones/user-1',
        get: tombstoneGet,
    };
    const coordinatorRef = {
        id: 'coordinator-ref',
        set: vi.fn(),
    };
    const batchSet = vi.fn();
    const batchCommit = vi.fn();
    const batch = vi.fn(() => ({
        set: batchSet,
        commit: batchCommit,
    }));
    const doc = vi.fn((path?: string) => {
        if (typeof path === 'string' && path.startsWith('userDeletionTombstones/')) {
            return tombstoneRef;
        }
        if (typeof path === 'string' && path.endsWith('/derivedMetrics/coordinator')) {
            return coordinatorRef;
        }
        if (typeof path === 'string' && path.includes('/derivedMetrics/')) {
            return coordinatorRef;
        }
        return userRootRef;
    });
    const runTransaction = vi.fn(async (updateFunction: (transaction: unknown) => Promise<void>) => {
        await updateFunction({
            get: transactionGet,
            set: transactionSet,
        });
    });
    const usersCollection = { doc: vi.fn(() => userRootRef) };
    const tombstonesCollection = { doc: vi.fn(() => tombstoneRef) };
    const getAll = vi.fn(async (...refs: unknown[]) => Promise.all(refs.map((ref) => {
        if (ref === userRootRef) {
            return userRootGet();
        }
        if (ref === tombstoneRef) {
            return tombstoneGet();
        }
        return { exists: false, data: () => undefined };
    })));
    const firestoreInstance = {
        collection: vi.fn((collectionName?: string) => {
            if (collectionName === 'userDeletionTombstones') {
                return tombstonesCollection;
            }
            return usersCollection;
        }),
        doc,
        getAll,
        batch,
        recursiveDelete,
        runTransaction,
    };
    const loggerWarn = vi.fn();
    const enqueueDerivedMetricsTask = vi.fn();

    return {
        get,
        select,
        where,
        transactionGet,
        transactionSet,
        userRootGet,
        tombstoneGet,
        userRootRef,
        tombstoneRef,
        derivedMetricsCollectionRef,
        recursiveDelete,
        coordinatorRef,
        batchSet,
        batchCommit,
        batch,
        doc,
        runTransaction,
        eventsCollection,
        usersCollection,
        tombstonesCollection,
        getAll,
        firestoreInstance,
        loggerWarn,
        enqueueDerivedMetricsTask,
    };
});

vi.mock('firebase-admin', () => ({
    firestore: vi.fn(() => hoisted.firestoreInstance),
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: hoisted.loggerWarn,
    error: vi.fn(),
}));

vi.mock('../shared/cloud-tasks', () => ({
    enqueueDerivedMetricsTask: hoisted.enqueueDerivedMetricsTask,
}));

function mockTransactionDeletionGuardDefaults(): void {
    hoisted.transactionGet.mockImplementation(async (ref: unknown) => {
        if (ref === hoisted.userRootRef) {
            return { exists: true, data: () => ({}) };
        }
        if (ref === hoisted.tombstoneRef) {
            return { exists: false, data: () => undefined };
        }
        return { exists: false, data: () => undefined };
    });
}

describe('fetchRecoveryLookbackEventDocs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.userRootGet.mockResolvedValue({ exists: true });
        hoisted.where.mockReturnValue({ select: hoisted.select });
        hoisted.select.mockReturnValue({ get: hoisted.get });
        hoisted.get.mockResolvedValue({ docs: [{ id: 'doc-1' }] });
    });

    it('queries startDate using numeric epoch milliseconds', async () => {
        const { fetchRecoveryLookbackEventDocs } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 3, 7, 10, 0, 0);
        const expectedLookbackStartMs = nowMs - (DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS * 1000);

        const docs = await fetchRecoveryLookbackEventDocs('user-1', nowMs);

        expect(hoisted.where).toHaveBeenCalledWith('startDate', '>=', expectedLookbackStartMs);
        expect(docs).toEqual([{ id: 'doc-1' }]);
    });

    it('logs a warning when lookback query returns no events', async () => {
        const { fetchRecoveryLookbackEventDocs } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 3, 7, 10, 0, 0);
        const expectedLookbackStartMs = nowMs - (DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS * 1000);
        hoisted.get.mockResolvedValueOnce({ docs: [] });

        await fetchRecoveryLookbackEventDocs('user-1', nowMs);

        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[derived-metrics] Recovery lookback query returned no event docs.',
            {
                uid: 'user-1',
                lookbackStartMs: expectedLookbackStartMs,
                lookbackWindowSeconds: DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS,
            },
        );
    });
});

describe('resolveDerivedMetricSourceRequirements', () => {
    it('marks form docs required for load-backed and KPI metric kinds', async () => {
        const { resolveDerivedMetricSourceRequirements } = await import('./derived-metrics.service');

        expect(
            resolveDerivedMetricSourceRequirements([
                DERIVED_METRIC_KINDS.FormNow,
                DERIVED_METRIC_KINDS.EasyPercent,
            ]),
        ).toEqual({
            needsFormDocs: true,
            needsRecoveryNowDocs: false,
        });
    });

    it('marks recovery lookback docs required only when recovery-now is requested', async () => {
        const { resolveDerivedMetricSourceRequirements } = await import('./derived-metrics.service');

        expect(
            resolveDerivedMetricSourceRequirements([
                DERIVED_METRIC_KINDS.RecoveryNow,
                DERIVED_METRIC_KINDS.Form,
            ]),
        ).toEqual({
            needsFormDocs: true,
            needsRecoveryNowDocs: true,
        });
    });
});

describe('startDerivedMetricsProcessing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.userRootGet.mockResolvedValue({ exists: true });
        hoisted.tombstoneGet.mockResolvedValue({ exists: false, data: () => undefined });
        mockTransactionDeletionGuardDefaults();
        hoisted.runTransaction.mockImplementation(async (updateFunction: (transaction: unknown) => Promise<void>) => {
            await updateFunction({
                get: hoisted.transactionGet,
                set: hoisted.transactionSet,
            });
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('claims queued generation and persists processing metric kinds for retries', async () => {
        const { startDerivedMetricsProcessing } = await import('./derived-metrics.service');
        hoisted.transactionGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                status: 'queued',
                generation: 42,
                eventMutationVersion: 101,
                dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
                updatedAtMs: Date.now(),
            }),
        });

        const result = await startDerivedMetricsProcessing('user-1', 42);

        expect(result).toEqual({
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
            startedAtMs: expect.any(Number),
            eventMutationVersion: 101,
        });
        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            hoisted.coordinatorRef,
            expect.objectContaining({
                status: 'processing',
                dirtyMetricKinds: [],
                processingMetricKinds: [DERIVED_METRIC_KINDS.Form],
            }),
            { merge: true },
        );
    });

    it('rejects duplicate processing claims for the same generation', async () => {
        const { startDerivedMetricsProcessing } = await import('./derived-metrics.service');
        hoisted.transactionGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                status: 'processing',
                generation: 7,
                eventMutationVersion: 55,
                dirtyMetricKinds: [],
                processingMetricKinds: [DERIVED_METRIC_KINDS.RecoveryNow],
                updatedAtMs: Date.now(),
            }),
        });

        const result = await startDerivedMetricsProcessing('user-1', 7);

        expect(result).toBeNull();
        expect(hoisted.transactionSet).not.toHaveBeenCalled();
    });

    it('reclaims stuck processing generations using in-flight metric kinds', async () => {
        const { startDerivedMetricsProcessing } = await import('./derived-metrics.service');
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 3, 11, 9, 0, 0));
        const nowMs = Date.now();
        hoisted.transactionGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                status: 'processing',
                generation: 9,
                eventMutationVersion: 77,
                dirtyMetricKinds: [],
                processingMetricKinds: [DERIVED_METRIC_KINDS.RecoveryNow],
                startedAtMs: nowMs - (20 * 60 * 1000),
                updatedAtMs: nowMs - (20 * 60 * 1000),
            }),
        });

        const result = await startDerivedMetricsProcessing('user-1', 9);

        expect(result).toEqual({
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.RecoveryNow],
            startedAtMs: expect.any(Number),
            eventMutationVersion: 77,
        });
        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            hoisted.coordinatorRef,
            expect.objectContaining({
                status: 'processing',
                processingMetricKinds: [DERIVED_METRIC_KINDS.RecoveryNow],
            }),
            { merge: true },
        );
    });

    it('does not claim queued work when a deletion tombstone is active inside the transaction', async () => {
        const { startDerivedMetricsProcessing } = await import('./derived-metrics.service');
        hoisted.transactionGet.mockImplementation(async (ref: unknown) => {
            if (ref === hoisted.userRootRef) {
                return { exists: true, data: () => ({}) };
            }
            if (ref === hoisted.tombstoneRef) {
                return { exists: true, data: () => ({ expireAt: { toMillis: () => Date.now() + 60_000 } }) };
            }
            return { exists: false, data: () => undefined };
        });
        hoisted.transactionGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                status: 'queued',
                generation: 42,
                eventMutationVersion: 101,
                dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
                updatedAtMs: Date.now(),
            }),
        });

        const result = await startDerivedMetricsProcessing('user-1', 42);

        expect(result).toBeNull();
        expect(hoisted.transactionSet).not.toHaveBeenCalled();
    });
});

describe('abandonDerivedMetricsProcessingAfterWriteBlock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.userRootGet.mockResolvedValue({ exists: true });
        hoisted.tombstoneGet.mockResolvedValue({ exists: false, data: () => undefined });
        mockTransactionDeletionGuardDefaults();
        hoisted.runTransaction.mockImplementation(async (updateFunction: (transaction: unknown) => Promise<void>) => {
            await updateFunction({
                get: hoisted.transactionGet,
                set: hoisted.transactionSet,
            });
        });
        hoisted.enqueueDerivedMetricsTask.mockResolvedValue(true);
        hoisted.recursiveDelete.mockResolvedValue(undefined);
    });

    it('recursively deletes derived metric state when the deletion guard is still active after claiming work', async () => {
        const { abandonDerivedMetricsProcessingAfterWriteBlock } = await import('./derived-metrics.service');
        hoisted.tombstoneGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ expireAt: { toMillis: () => Date.now() + 60_000 } }),
        });

        const result = await abandonDerivedMetricsProcessingAfterWriteBlock(
            'user-1',
            42,
            [DERIVED_METRIC_KINDS.Form],
            'task before snapshot building',
        );

        expect(result).toEqual({
            cleaned: true,
            requeued: false,
            nextGeneration: null,
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
        });
        expect(hoisted.recursiveDelete).toHaveBeenCalledWith(hoisted.derivedMetricsCollectionRef);
        expect(hoisted.runTransaction).not.toHaveBeenCalled();
        expect(hoisted.enqueueDerivedMetricsTask).not.toHaveBeenCalled();
    });

    it('requeues claimed work on a fresh generation when the write block has cleared before finalization', async () => {
        const { abandonDerivedMetricsProcessingAfterWriteBlock } = await import('./derived-metrics.service');
        hoisted.transactionGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                status: 'processing',
                generation: 42,
                dirtyMetricKinds: [DERIVED_METRIC_KINDS.RecoveryNow],
                processingMetricKinds: [DERIVED_METRIC_KINDS.Form],
                updatedAtMs: Date.now(),
                startedAtMs: Date.now(),
            }),
        });

        const result = await abandonDerivedMetricsProcessingAfterWriteBlock(
            'user-1',
            42,
            [DERIVED_METRIC_KINDS.Form],
            'task before snapshot building',
        );

        expect(result).toEqual({
            cleaned: false,
            requeued: true,
            nextGeneration: 43,
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.RecoveryNow, DERIVED_METRIC_KINDS.Form],
        });
        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            hoisted.coordinatorRef,
            expect.objectContaining({
                status: 'queued',
                generation: 43,
                dirtyMetricKinds: [DERIVED_METRIC_KINDS.RecoveryNow, DERIVED_METRIC_KINDS.Form],
                processingMetricKinds: [],
                startedAtMs: null,
                completedAtMs: null,
            }),
            { merge: true },
        );
        expect(hoisted.enqueueDerivedMetricsTask).toHaveBeenCalledWith('user-1', 43);
        expect(hoisted.recursiveDelete).not.toHaveBeenCalled();
    });

    it('does not requeue stale claimed work after the coordinator already left processing', async () => {
        const { abandonDerivedMetricsProcessingAfterWriteBlock } = await import('./derived-metrics.service');
        hoisted.transactionGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                status: 'idle',
                generation: 42,
                dirtyMetricKinds: [],
                processingMetricKinds: [],
                updatedAtMs: Date.now(),
                completedAtMs: Date.now(),
            }),
        });

        const result = await abandonDerivedMetricsProcessingAfterWriteBlock(
            'user-1',
            42,
            [DERIVED_METRIC_KINDS.Form],
            'task before snapshot building',
        );

        expect(result).toEqual({
            cleaned: false,
            requeued: false,
            nextGeneration: null,
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
        });
        expect(hoisted.transactionSet).not.toHaveBeenCalled();
        expect(hoisted.enqueueDerivedMetricsTask).not.toHaveBeenCalled();
        expect(hoisted.recursiveDelete).not.toHaveBeenCalled();
    });

    it('retries requeue finalization when the transaction guard clears after a blocked transaction', async () => {
        const { abandonDerivedMetricsProcessingAfterWriteBlock } = await import('./derived-metrics.service');
        const coordinatorSnapshot = {
            exists: true,
            data: () => ({
                status: 'processing',
                generation: 42,
                dirtyMetricKinds: [],
                processingMetricKinds: [DERIVED_METRIC_KINDS.Form],
                updatedAtMs: Date.now(),
                startedAtMs: Date.now(),
            }),
        };
        hoisted.transactionGet
            .mockResolvedValueOnce(coordinatorSnapshot)
            .mockResolvedValueOnce({ exists: true, data: () => ({}) })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({ expireAt: { toMillis: () => Date.now() + 60_000 } }),
            })
            .mockResolvedValueOnce(coordinatorSnapshot)
            .mockResolvedValueOnce({ exists: true, data: () => ({}) })
            .mockResolvedValueOnce({ exists: false, data: () => undefined });

        const result = await abandonDerivedMetricsProcessingAfterWriteBlock(
            'user-1',
            42,
            [DERIVED_METRIC_KINDS.Form],
            'task before snapshot building',
        );

        expect(result).toEqual({
            cleaned: false,
            requeued: true,
            nextGeneration: 43,
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
        });
        expect(hoisted.runTransaction).toHaveBeenCalledTimes(2);
        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            hoisted.coordinatorRef,
            expect.objectContaining({
                status: 'queued',
                generation: 43,
                dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
            }),
            { merge: true },
        );
        expect(hoisted.enqueueDerivedMetricsTask).toHaveBeenCalledWith('user-1', 43);
        expect(hoisted.recursiveDelete).not.toHaveBeenCalled();
    });

    it('cleans generated state if deletion starts before the replacement task is enqueued', async () => {
        const { abandonDerivedMetricsProcessingAfterWriteBlock } = await import('./derived-metrics.service');
        hoisted.tombstoneGet
            .mockResolvedValueOnce({ exists: false, data: () => undefined })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({ expireAt: { toMillis: () => Date.now() + 60_000 } }),
            });
        hoisted.transactionGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                status: 'processing',
                generation: 42,
                dirtyMetricKinds: [],
                processingMetricKinds: [DERIVED_METRIC_KINDS.Form],
                updatedAtMs: Date.now(),
                startedAtMs: Date.now(),
            }),
        });

        const result = await abandonDerivedMetricsProcessingAfterWriteBlock(
            'user-1',
            42,
            [DERIVED_METRIC_KINDS.Form],
            'task before snapshot building',
        );

        expect(result).toEqual({
            cleaned: true,
            requeued: false,
            nextGeneration: null,
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
        });
        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            hoisted.coordinatorRef,
            expect.objectContaining({
                status: 'queued',
                generation: 43,
                dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
            }),
            { merge: true },
        );
        expect(hoisted.recursiveDelete).toHaveBeenCalledWith(hoisted.derivedMetricsCollectionRef);
        expect(hoisted.enqueueDerivedMetricsTask).not.toHaveBeenCalled();
    });
});

describe('markDerivedMetricsDirtyAndMaybeQueue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.userRootGet.mockResolvedValue({ exists: true });
        hoisted.tombstoneGet.mockResolvedValue({ exists: false, data: () => undefined });
        mockTransactionDeletionGuardDefaults();
        hoisted.runTransaction.mockImplementation(async (updateFunction: (transaction: unknown) => Promise<void>) => {
            await updateFunction({
                get: hoisted.transactionGet,
                set: hoisted.transactionSet,
            });
        });
        hoisted.enqueueDerivedMetricsTask.mockResolvedValue(true);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('coalesces when coordinator is queued recently and dirty set is unchanged', async () => {
        const { markDerivedMetricsDirtyAndMaybeQueue } = await import('./derived-metrics.service');
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 3, 11, 9, 0, 0));
        const nowMs = Date.now();
        hoisted.transactionGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                status: 'queued',
                generation: 12,
                dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
                requestedAtMs: nowMs - 2 * 60 * 1000,
                updatedAtMs: nowMs - 2 * 60 * 1000,
            }),
        });

        const response = await markDerivedMetricsDirtyAndMaybeQueue(
            'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            [DERIVED_METRIC_KINDS.Form],
        );

        expect(response).toEqual({
            accepted: true,
            queued: false,
            generation: 12,
            metricKinds: [DERIVED_METRIC_KINDS.Form],
        });
        expect(hoisted.transactionSet).not.toHaveBeenCalled();
        expect(hoisted.enqueueDerivedMetricsTask).not.toHaveBeenCalled();
    });

    it('increments event mutation version without requeue when queued coordinator is healthy', async () => {
        const { markDerivedMetricsDirtyAndMaybeQueue } = await import('./derived-metrics.service');
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 3, 11, 9, 0, 0));
        const nowMs = Date.now();
        hoisted.transactionGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                status: 'queued',
                generation: 12,
                eventMutationVersion: 99,
                dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
                requestedAtMs: nowMs - 2 * 60 * 1000,
                updatedAtMs: nowMs - 2 * 60 * 1000,
            }),
        });

        const response = await markDerivedMetricsDirtyAndMaybeQueue(
            'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            [DERIVED_METRIC_KINDS.Form],
            { incrementEventMutationVersion: true },
        );

        expect(response).toEqual({
            accepted: true,
            queued: false,
            generation: 12,
            metricKinds: [DERIVED_METRIC_KINDS.Form],
        });
        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            hoisted.coordinatorRef,
            expect.objectContaining({
                status: 'queued',
                generation: 12,
                eventMutationVersion: 100,
                dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
            }),
            { merge: true },
        );
        const transactionPayload = hoisted.transactionSet.mock.calls[0]?.[1] as Record<string, unknown>;
        expect(transactionPayload?.requestedAtMs).toBeUndefined();
        expect(hoisted.enqueueDerivedMetricsTask).not.toHaveBeenCalled();
    });

    it('forces requeue when coordinator is queued for too long', async () => {
        const { markDerivedMetricsDirtyAndMaybeQueue } = await import('./derived-metrics.service');
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 3, 11, 9, 0, 0));
        const nowMs = Date.now();
        hoisted.transactionGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                status: 'queued',
                generation: 21,
                dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
                requestedAtMs: nowMs - 20 * 60 * 1000,
                updatedAtMs: nowMs - 20 * 60 * 1000,
            }),
        });

        const response = await markDerivedMetricsDirtyAndMaybeQueue(
            'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            [DERIVED_METRIC_KINDS.Form],
        );

        expect(response).toEqual({
            accepted: true,
            queued: true,
            generation: 22,
            metricKinds: [DERIVED_METRIC_KINDS.Form],
        });
        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            hoisted.coordinatorRef,
            expect.objectContaining({
                status: 'queued',
                generation: 22,
                dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
                processingMetricKinds: [],
            }),
            { merge: true },
        );
        expect(hoisted.enqueueDerivedMetricsTask).toHaveBeenCalledWith('xcsAolLDDTWTgtRN9eYF3lW2YKL2', 22);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[derived-metrics] Coordinator appears stuck; forcing requeue.',
            expect.objectContaining({
                uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
                status: 'queued',
                generation: 21,
            }),
        );
    });

    it('forces requeue when coordinator is processing for too long', async () => {
        const { markDerivedMetricsDirtyAndMaybeQueue } = await import('./derived-metrics.service');
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 3, 11, 9, 0, 0));
        const nowMs = Date.now();
        hoisted.transactionGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                status: 'processing',
                generation: 30,
                dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
                startedAtMs: nowMs - 20 * 60 * 1000,
                updatedAtMs: nowMs - 20 * 60 * 1000,
                processingMetricKinds: [DERIVED_METRIC_KINDS.Form],
            }),
        });

        const response = await markDerivedMetricsDirtyAndMaybeQueue(
            'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            [DERIVED_METRIC_KINDS.Form],
        );

        expect(response).toEqual({
            accepted: true,
            queued: true,
            generation: 31,
            metricKinds: [DERIVED_METRIC_KINDS.Form],
        });
        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            hoisted.coordinatorRef,
            expect.objectContaining({
                status: 'queued',
                generation: 31,
                dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
                processingMetricKinds: [],
            }),
            { merge: true },
        );
        expect(hoisted.enqueueDerivedMetricsTask).toHaveBeenCalledWith('xcsAolLDDTWTgtRN9eYF3lW2YKL2', 31);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[derived-metrics] Coordinator appears stuck; forcing requeue.',
            expect.objectContaining({
                uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
                status: 'processing',
                generation: 30,
            }),
        );
    });

    it('skips dirty-mark queueing when user root document is missing', async () => {
        const { markDerivedMetricsDirtyAndMaybeQueue } = await import('./derived-metrics.service');
        hoisted.userRootGet.mockResolvedValueOnce({ exists: false });

        const response = await markDerivedMetricsDirtyAndMaybeQueue(
            'missing-user',
            [DERIVED_METRIC_KINDS.Form],
        );

        expect(response).toEqual({
            accepted: false,
            queued: false,
            generation: null,
            metricKinds: [DERIVED_METRIC_KINDS.Form],
        });
        expect(hoisted.runTransaction).not.toHaveBeenCalled();
        expect(hoisted.enqueueDerivedMetricsTask).not.toHaveBeenCalled();
    });

    it('skips dirty-mark queueing when a deletion tombstone is active', async () => {
        const { markDerivedMetricsDirtyAndMaybeQueue } = await import('./derived-metrics.service');
        hoisted.tombstoneGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ expireAt: { toMillis: () => Date.now() + 60_000 } }),
        });

        const response = await markDerivedMetricsDirtyAndMaybeQueue(
            'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            [DERIVED_METRIC_KINDS.Form],
        );

        expect(response).toEqual({
            accepted: false,
            queued: false,
            generation: null,
            metricKinds: [DERIVED_METRIC_KINDS.Form],
        });
        expect(hoisted.runTransaction).not.toHaveBeenCalled();
        expect(hoisted.enqueueDerivedMetricsTask).not.toHaveBeenCalled();
    });

    it('skips coordinator writes when a deletion tombstone appears inside the transaction', async () => {
        const { markDerivedMetricsDirtyAndMaybeQueue } = await import('./derived-metrics.service');
        hoisted.transactionGet.mockImplementation(async (ref: unknown) => {
            if (ref === hoisted.userRootRef) {
                return { exists: true, data: () => ({}) };
            }
            if (ref === hoisted.tombstoneRef) {
                return { exists: true, data: () => ({ expireAt: { toMillis: () => Date.now() + 60_000 } }) };
            }
            return { exists: false, data: () => undefined };
        });
        hoisted.transactionGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                status: 'idle',
                generation: 1,
                dirtyMetricKinds: [],
                updatedAtMs: Date.now(),
            }),
        });

        const response = await markDerivedMetricsDirtyAndMaybeQueue(
            'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            [DERIVED_METRIC_KINDS.Form],
        );

        expect(response).toEqual({
            accepted: false,
            queued: false,
            generation: null,
            metricKinds: [DERIVED_METRIC_KINDS.Form],
        });
        expect(hoisted.transactionSet).not.toHaveBeenCalled();
        expect(hoisted.enqueueDerivedMetricsTask).not.toHaveBeenCalled();
    });
});

describe('writeDerivedMetricSnapshotsReady', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.userRootGet.mockResolvedValue({ exists: true });
        hoisted.tombstoneGet.mockResolvedValue({ exists: false, data: () => undefined });
        hoisted.batchCommit.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function buildEventDoc(data: Record<string, unknown>): any {
        return {
            data: () => data,
        };
    }

    function findPersistedPayload(metricKind: string): Record<string, unknown> {
        const call = hoisted.batchSet.mock.calls.find((setCall) => setCall?.[1]?.metricKind === metricKind);
        return (call?.[1] || {}) as Record<string, unknown>;
    }

    it('builds all v1 derived metric payloads from source docs', async () => {
        const { writeDerivedMetricSnapshotsReady } = await import('./derived-metrics.service');
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 0, 3, 12, 0, 0));
        const formDocs = [
            buildEventDoc({
                startDate: Date.UTC(2026, 0, 1, 8, 0, 0),
                endDate: Date.UTC(2026, 0, 1, 9, 0, 0),
                stats: {
                    'Training Stress Score': 10,
                    [DataPowerAvg.type]: 200,
                    [DataHeartRateAvg.type]: 100,
                    [DataDuration.type]: 3600,
                    [DataPowerZoneOneDuration.type]: 600,
                    [DataPowerZoneTwoDuration.type]: 1200,
                    [DataPowerZoneThreeDuration.type]: 900,
                    [DataPowerZoneFourDuration.type]: 600,
                    [DataPowerZoneFiveDuration.type]: 300,
                },
            }),
            buildEventDoc({
                startDate: Date.UTC(2026, 0, 2, 8, 0, 0),
                endDate: Date.UTC(2026, 0, 2, 9, 0, 0),
                stats: {
                    'Training Stress Score': 20,
                    [DataPowerAvg.type]: 240,
                    [DataHeartRateAvg.type]: 120,
                    [DataDuration.type]: 3600,
                    [DataHeartRateZoneOneDuration.type]: 900,
                    [DataHeartRateZoneTwoDuration.type]: 600,
                    [DataHeartRateZoneThreeDuration.type]: 900,
                    [DataHeartRateZoneFourDuration.type]: 600,
                    [DataHeartRateZoneFiveDuration.type]: 600,
                },
            }),
            buildEventDoc({
                startDate: Date.UTC(2026, 0, 3, 8, 0, 0),
                endDate: Date.UTC(2026, 0, 3, 9, 0, 0),
                stats: {
                    'Training Stress Score': 30,
                    [DataPowerAvg.type]: 180,
                    [DataHeartRateAvg.type]: 90,
                    [DataDuration.type]: 1800,
                },
            }),
        ];

        await writeDerivedMetricSnapshotsReady(
            'user-1',
            [
                DERIVED_METRIC_KINDS.Form,
                DERIVED_METRIC_KINDS.Acwr,
                DERIVED_METRIC_KINDS.RampRate,
                DERIVED_METRIC_KINDS.MonotonyStrain,
                DERIVED_METRIC_KINDS.FormNow,
                DERIVED_METRIC_KINDS.FormPlus7d,
                DERIVED_METRIC_KINDS.EasyPercent,
                DERIVED_METRIC_KINDS.HardPercent,
                DERIVED_METRIC_KINDS.EfficiencyDelta4w,
                DERIVED_METRIC_KINDS.FreshnessForecast,
                DERIVED_METRIC_KINDS.IntensityDistribution,
                DERIVED_METRIC_KINDS.EfficiencyTrend,
            ],
            {
                formDocs: formDocs as any,
                recoveryNowDocs: [] as any,
            },
            {
                builtFromEventMutationVersion: 42,
            },
        );

        const formPersistedSnapshot = findPersistedPayload(DERIVED_METRIC_KINDS.Form);
        expect(formPersistedSnapshot.builtFromEventMutationVersion).toBe(42);
        expect(formPersistedSnapshot.sourceDocCount).toBe(formDocs.length);
        const formPayload = formPersistedSnapshot.payload as Record<string, unknown>;
        expect(formPayload.dailyLoads).toEqual([
            { dayMs: Date.UTC(2026, 0, 1), load: 10 },
            { dayMs: Date.UTC(2026, 0, 2), load: 20 },
            { dayMs: Date.UTC(2026, 0, 3), load: 30 },
        ]);

        const acwrPayload = findPersistedPayload(DERIVED_METRIC_KINDS.Acwr).payload as Record<string, unknown>;
        expect(acwrPayload.asOfDayMs).toBe(Date.UTC(2026, 0, 3));
        expect(acwrPayload.acuteLoad7).toBe(60);
        expect(acwrPayload.chronicLoad28).toBe(15);
        expect(acwrPayload.ratio).toBe(4);
        expect(Array.isArray(acwrPayload.trend8Weeks)).toBe(true);

        const rampPayload = findPersistedPayload(DERIVED_METRIC_KINDS.RampRate).payload as Record<string, unknown>;
        expect(rampPayload.ctlToday).toBeTypeOf('number');
        expect(rampPayload.rampRate).toBeNull();

        const monotonyPayload = findPersistedPayload(DERIVED_METRIC_KINDS.MonotonyStrain).payload as Record<string, unknown>;
        expect(monotonyPayload.weeklyLoad7).toBe(60);
        expect(monotonyPayload.monotony).toBeTypeOf('number');
        expect(monotonyPayload.strain).toBeTypeOf('number');

        const formNowPayload = findPersistedPayload(DERIVED_METRIC_KINDS.FormNow).payload as Record<string, unknown>;
        expect(formNowPayload.asOfDayMs).toBe(Date.UTC(2026, 0, 3));
        expect(formNowPayload.value).toBeTypeOf('number');
        expect(Array.isArray(formNowPayload.trend8Weeks)).toBe(true);

        const formPlus7dPayload = findPersistedPayload(DERIVED_METRIC_KINDS.FormPlus7d).payload as Record<string, unknown>;
        expect(formPlus7dPayload.asOfDayMs).toBe(Date.UTC(2026, 0, 3));
        expect(formPlus7dPayload.value).toBeTypeOf('number');
        expect(formPlus7dPayload.projectedDayMs).toBe(Date.UTC(2026, 0, 10));

        const forecastPayload = findPersistedPayload(DERIVED_METRIC_KINDS.FreshnessForecast).payload as Record<string, unknown>;
        expect(forecastPayload.asOfDayMs).toBe(Date.UTC(2026, 0, 3));
        const forecastPoints = forecastPayload.points as Array<Record<string, unknown>>;
        expect(forecastPoints).toHaveLength(8);
        expect(forecastPoints[0].isForecast).toBe(false);
        expect(forecastPoints[forecastPoints.length - 1].isForecast).toBe(true);
        expect(formNowPayload.value).toBe(forecastPoints[0].formSameDay);
        expect(formNowPayload.value).not.toBe(forecastPoints[0].formPriorDay);
        expect(formPlus7dPayload.value).toBe(forecastPoints[forecastPoints.length - 1].formSameDay);

        const intensityPayload = findPersistedPayload(DERIVED_METRIC_KINDS.IntensityDistribution).payload as Record<string, unknown>;
        expect(Array.isArray(intensityPayload.weeks)).toBe(true);
        expect(intensityPayload.latestEasyPercent).toBeTypeOf('number');
        expect(intensityPayload.latestHardPercent).toBeTypeOf('number');

        const easyPercentPayload = findPersistedPayload(DERIVED_METRIC_KINDS.EasyPercent).payload as Record<string, unknown>;
        expect(easyPercentPayload.value).toBeTypeOf('number');
        expect(Array.isArray(easyPercentPayload.trend8Weeks)).toBe(true);

        const hardPercentPayload = findPersistedPayload(DERIVED_METRIC_KINDS.HardPercent).payload as Record<string, unknown>;
        expect(hardPercentPayload.value).toBeTypeOf('number');
        expect(Array.isArray(hardPercentPayload.trend8Weeks)).toBe(true);

        const efficiencyPayload = findPersistedPayload(DERIVED_METRIC_KINDS.EfficiencyTrend).payload as Record<string, unknown>;
        const efficiencyPoints = efficiencyPayload.points as Array<Record<string, unknown>>;
        expect(efficiencyPoints.length).toBeGreaterThan(0);
        expect(efficiencyPayload.latestValue).toBeTypeOf('number');
        expect(efficiencyPoints[0].value).toBeGreaterThan(0);

        const efficiencyDeltaPayload = findPersistedPayload(DERIVED_METRIC_KINDS.EfficiencyDelta4w).payload as Record<string, unknown>;
        expect(efficiencyDeltaPayload).toMatchObject({
            latestValue: expect.any(Number),
        });
        expect(efficiencyDeltaPayload).toHaveProperty('deltaAbs');
        expect(efficiencyDeltaPayload).toHaveProperty('deltaPct');
        expect(Array.isArray(efficiencyDeltaPayload.trend8Weeks)).toBe(true);
    });

    it('extends KPI daily-load state to today with zero-fill so latest KPI week is current', async () => {
        const { writeDerivedMetricSnapshotsReady } = await import('./derived-metrics.service');
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 0, 10, 12, 0, 0));
        const formDocs = [
            buildEventDoc({
                startDate: Date.UTC(2026, 0, 1, 8, 0, 0),
                endDate: Date.UTC(2026, 0, 1, 9, 0, 0),
                stats: {
                    'Training Stress Score': 10,
                },
            }),
            buildEventDoc({
                startDate: Date.UTC(2026, 0, 2, 8, 0, 0),
                endDate: Date.UTC(2026, 0, 2, 9, 0, 0),
                stats: {
                    'Training Stress Score': 20,
                },
            }),
            buildEventDoc({
                startDate: Date.UTC(2026, 0, 3, 8, 0, 0),
                endDate: Date.UTC(2026, 0, 3, 9, 0, 0),
                stats: {
                    'Training Stress Score': 30,
                },
            }),
        ];

        await writeDerivedMetricSnapshotsReady(
            'user-1',
            [
                DERIVED_METRIC_KINDS.Acwr,
                DERIVED_METRIC_KINDS.RampRate,
                DERIVED_METRIC_KINDS.MonotonyStrain,
                DERIVED_METRIC_KINDS.FormNow,
                DERIVED_METRIC_KINDS.FormPlus7d,
                DERIVED_METRIC_KINDS.FreshnessForecast,
            ],
            {
                formDocs: formDocs as any,
                recoveryNowDocs: [] as any,
            },
        );

        const acwrPayload = findPersistedPayload(DERIVED_METRIC_KINDS.Acwr).payload as Record<string, unknown>;
        expect(acwrPayload.asOfDayMs).toBe(Date.UTC(2026, 0, 10));
        expect(acwrPayload.latestDayMs).toBe(Date.UTC(2026, 0, 10));
        expect(acwrPayload.acuteLoad7).toBe(0);
        expect(acwrPayload.chronicLoad28).toBe(15);
        expect(acwrPayload.ratio).toBe(0);

        const rampPayload = findPersistedPayload(DERIVED_METRIC_KINDS.RampRate).payload as Record<string, unknown>;
        expect(rampPayload.asOfDayMs).toBe(Date.UTC(2026, 0, 10));
        expect(rampPayload.latestDayMs).toBe(Date.UTC(2026, 0, 10));
        expect(rampPayload.ctl7DaysAgo).toBeTypeOf('number');
        expect(rampPayload.rampRate).toBeTypeOf('number');

        const monotonyPayload = findPersistedPayload(DERIVED_METRIC_KINDS.MonotonyStrain).payload as Record<string, unknown>;
        expect(monotonyPayload.asOfDayMs).toBe(Date.UTC(2026, 0, 10));
        expect(monotonyPayload.latestDayMs).toBe(Date.UTC(2026, 0, 10));
        expect(monotonyPayload.weeklyLoad7).toBe(0);
        expect(monotonyPayload.monotony).toBeNull();
        expect(monotonyPayload.strain).toBeNull();

        const formNowPayload = findPersistedPayload(DERIVED_METRIC_KINDS.FormNow).payload as Record<string, unknown>;
        expect(formNowPayload.asOfDayMs).toBe(Date.UTC(2026, 0, 10));
        expect(formNowPayload.latestDayMs).toBe(Date.UTC(2026, 0, 10));
        expect(formNowPayload.value).toBeTypeOf('number');

        const formPlus7dPayload = findPersistedPayload(DERIVED_METRIC_KINDS.FormPlus7d).payload as Record<string, unknown>;
        expect(formPlus7dPayload.asOfDayMs).toBe(Date.UTC(2026, 0, 10));
        expect(formPlus7dPayload.latestDayMs).toBe(Date.UTC(2026, 0, 10));
        expect(formPlus7dPayload.projectedDayMs).toBe(Date.UTC(2026, 0, 17));

        const forecastPayload = findPersistedPayload(DERIVED_METRIC_KINDS.FreshnessForecast).payload as Record<string, unknown>;
        expect(forecastPayload.asOfDayMs).toBe(Date.UTC(2026, 0, 10));
        const forecastPoints = forecastPayload.points as Array<Record<string, unknown>>;
        expect(forecastPoints[0]?.dayMs).toBe(Date.UTC(2026, 0, 10));
        expect(forecastPoints[0]?.isForecast).toBe(false);
        expect(forecastPoints[0]?.trainingStressScore).toBe(0);
    });

    it('handles efficiency delta edge cases with insufficient baseline history', async () => {
        const { writeDerivedMetricSnapshotsReady } = await import('./derived-metrics.service');
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 0, 3, 12, 0, 0));
        const formDocs = [
            buildEventDoc({
                startDate: Date.UTC(2026, 0, 3, 8, 0, 0),
                endDate: Date.UTC(2026, 0, 3, 9, 0, 0),
                stats: {
                    [DataPowerAvg.type]: 200,
                    [DataHeartRateAvg.type]: 100,
                    [DataDuration.type]: 1800,
                },
            }),
        ];

        await writeDerivedMetricSnapshotsReady(
            'user-1',
            [DERIVED_METRIC_KINDS.EfficiencyDelta4w],
            {
                formDocs: formDocs as any,
                recoveryNowDocs: [] as any,
            },
        );

        const efficiencyDeltaPayload = findPersistedPayload(DERIVED_METRIC_KINDS.EfficiencyDelta4w).payload as Record<string, unknown>;
        expect(efficiencyDeltaPayload.latestValue).toBeTypeOf('number');
        expect(efficiencyDeltaPayload.baselineValue).toBeNull();
        expect(efficiencyDeltaPayload.deltaAbs).toBeNull();
        expect(efficiencyDeltaPayload.deltaPct).toBeNull();
    });

    it('builds nullable payloads for new KPI kinds when no source docs exist', async () => {
        const { writeDerivedMetricSnapshotsReady } = await import('./derived-metrics.service');
        await writeDerivedMetricSnapshotsReady(
            'user-1',
            [
                DERIVED_METRIC_KINDS.FormNow,
                DERIVED_METRIC_KINDS.FormPlus7d,
                DERIVED_METRIC_KINDS.EasyPercent,
                DERIVED_METRIC_KINDS.HardPercent,
                DERIVED_METRIC_KINDS.EfficiencyDelta4w,
            ],
            {
                formDocs: [] as any,
                recoveryNowDocs: [] as any,
            },
        );

        expect((findPersistedPayload(DERIVED_METRIC_KINDS.FormNow).payload as Record<string, unknown>).value).toBeNull();
        expect((findPersistedPayload(DERIVED_METRIC_KINDS.FormPlus7d).payload as Record<string, unknown>).value).toBeNull();
        expect((findPersistedPayload(DERIVED_METRIC_KINDS.EasyPercent).payload as Record<string, unknown>).value).toBeNull();
        expect((findPersistedPayload(DERIVED_METRIC_KINDS.HardPercent).payload as Record<string, unknown>).value).toBeNull();
        expect((findPersistedPayload(DERIVED_METRIC_KINDS.EfficiencyDelta4w).payload as Record<string, unknown>).deltaAbs).toBeNull();
    });

    it('excludes benchmark merges but includes multi merges in derived calculations', async () => {
        const { writeDerivedMetricSnapshotsReady } = await import('./derived-metrics.service');
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 0, 3, 12, 0, 0));

        const formDocs = [
            buildEventDoc({
                startDate: Date.UTC(2026, 0, 1, 8, 0, 0),
                endDate: Date.UTC(2026, 0, 1, 9, 0, 0),
                isMerge: true,
                mergeType: 'benchmark',
                originalFiles: [{ path: 'f1.fit' }, { path: 'f2.fit' }],
                stats: {
                    'Training Stress Score': 100,
                    [DataRecoveryTime.type]: 10_000,
                },
            }),
            buildEventDoc({
                startDate: Date.UTC(2026, 0, 2, 8, 0, 0),
                endDate: Date.UTC(2026, 0, 2, 9, 0, 0),
                isMerge: false,
                mergeType: 'multi',
                originalFiles: [{ path: 'f3.fit' }, { path: 'f4.fit' }],
                stats: {
                    'Training Stress Score': 40,
                    [DataRecoveryTime.type]: 4_000,
                },
            }),
            buildEventDoc({
                startDate: Date.UTC(2026, 0, 3, 8, 0, 0),
                endDate: Date.UTC(2026, 0, 3, 9, 0, 0),
                stats: {
                    'Training Stress Score': 10,
                    [DataRecoveryTime.type]: 1_000,
                },
            }),
        ];

        await writeDerivedMetricSnapshotsReady(
            'user-1',
            [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.RecoveryNow],
            {
                formDocs: formDocs as any,
                recoveryNowDocs: formDocs as any,
            },
            {
                builtFromEventMutationVersion: 42,
            },
        );

        const formPersistedSnapshot = findPersistedPayload(DERIVED_METRIC_KINDS.Form);
        expect(formPersistedSnapshot.sourceEventCount).toBe(2);
        const formPayload = formPersistedSnapshot.payload as Record<string, unknown>;
        expect(formPayload.dailyLoads).toEqual([
            { dayMs: Date.UTC(2026, 0, 2), load: 40 },
            { dayMs: Date.UTC(2026, 0, 3), load: 10 },
        ]);

        const recoveryPayload = findPersistedPayload(DERIVED_METRIC_KINDS.RecoveryNow).payload as Record<string, unknown>;
        expect(recoveryPayload.totalSeconds).toBe(5_000);
        expect(recoveryPayload.latestWorkoutSeconds).toBe(1_000);
        expect((recoveryPayload.segments as unknown[]).length).toBe(2);
    });
});
