import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_DERIVED_METRIC_KINDS,
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
} from '@sports-alliance/sports-lib';

const hoisted = vi.hoisted(() => {
    const get = vi.fn();
    const select = vi.fn();
    const where = vi.fn();
    const transactionGet = vi.fn();
    const transactionSet = vi.fn();
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
    const doc = vi.fn(() => coordinatorRef);
    const runTransaction = vi.fn(async (updateFunction: (transaction: unknown) => Promise<void>) => {
        await updateFunction({
            get: transactionGet,
            set: transactionSet,
        });
    });
    const eventsCollection = { where };
    const userDoc = { collection: vi.fn(() => eventsCollection) };
    const usersCollection = { doc: vi.fn(() => userDoc) };
    const firestoreInstance = {
        collection: vi.fn(() => usersCollection),
        doc,
        batch,
        runTransaction,
    };
    const loggerWarn = vi.fn();

    return {
        get,
        select,
        where,
        transactionGet,
        transactionSet,
        coordinatorRef,
        batchSet,
        batchCommit,
        batch,
        doc,
        runTransaction,
        eventsCollection,
        usersCollection,
        firestoreInstance,
        loggerWarn,
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
    enqueueDerivedMetricsTask: vi.fn(),
}));

describe('fetchRecoveryLookbackEventDocs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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

describe('startDerivedMetricsProcessing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.runTransaction.mockImplementation(async (updateFunction: (transaction: unknown) => Promise<void>) => {
            await updateFunction({
                get: hoisted.transactionGet,
                set: hoisted.transactionSet,
            });
        });
    });

    it('claims queued generation and persists processing metric kinds for retries', async () => {
        const { startDerivedMetricsProcessing } = await import('./derived-metrics.service');
        hoisted.transactionGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                status: 'queued',
                generation: 42,
                dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
                updatedAtMs: Date.now(),
            }),
        });

        const result = await startDerivedMetricsProcessing('user-1', 42);

        expect(result).toEqual({
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
            startedAtMs: expect.any(Number),
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

    it('reclaims processing generation using persisted in-flight metric kinds', async () => {
        const { startDerivedMetricsProcessing } = await import('./derived-metrics.service');
        hoisted.transactionGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                status: 'processing',
                generation: 7,
                dirtyMetricKinds: [],
                processingMetricKinds: [DERIVED_METRIC_KINDS.RecoveryNow],
                updatedAtMs: Date.now(),
            }),
        });

        const result = await startDerivedMetricsProcessing('user-1', 7);

        expect(result).toEqual({
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.RecoveryNow],
            startedAtMs: expect.any(Number),
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

    it('recovers legacy processing coordinator docs by falling back to default metric kinds', async () => {
        const { startDerivedMetricsProcessing } = await import('./derived-metrics.service');
        hoisted.transactionGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                status: 'processing',
                generation: 9,
                dirtyMetricKinds: [],
                updatedAtMs: Date.now(),
            }),
        });

        const result = await startDerivedMetricsProcessing('user-1', 9);

        expect(result).toEqual({
            dirtyMetricKinds: DEFAULT_DERIVED_METRIC_KINDS,
            startedAtMs: expect.any(Number),
        });
        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            hoisted.coordinatorRef,
            expect.objectContaining({
                status: 'processing',
                processingMetricKinds: DEFAULT_DERIVED_METRIC_KINDS,
            }),
            { merge: true },
        );
    });
});

describe('writeDerivedMetricSnapshotsReady', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
                DERIVED_METRIC_KINDS.FreshnessForecast,
                DERIVED_METRIC_KINDS.IntensityDistribution,
                DERIVED_METRIC_KINDS.EfficiencyTrend,
            ],
            {
                formDocs: formDocs as any,
                recoveryNowDocs: [] as any,
            },
        );

        const formPayload = findPersistedPayload(DERIVED_METRIC_KINDS.Form).payload as Record<string, unknown>;
        expect(formPayload.dailyLoads).toEqual([
            { dayMs: Date.UTC(2026, 0, 1), load: 10 },
            { dayMs: Date.UTC(2026, 0, 2), load: 20 },
            { dayMs: Date.UTC(2026, 0, 3), load: 30 },
        ]);

        const acwrPayload = findPersistedPayload(DERIVED_METRIC_KINDS.Acwr).payload as Record<string, unknown>;
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

        const forecastPayload = findPersistedPayload(DERIVED_METRIC_KINDS.FreshnessForecast).payload as Record<string, unknown>;
        const forecastPoints = forecastPayload.points as Array<Record<string, unknown>>;
        expect(forecastPoints).toHaveLength(8);
        expect(forecastPoints[0].isForecast).toBe(false);
        expect(forecastPoints[forecastPoints.length - 1].isForecast).toBe(true);

        const intensityPayload = findPersistedPayload(DERIVED_METRIC_KINDS.IntensityDistribution).payload as Record<string, unknown>;
        expect(Array.isArray(intensityPayload.weeks)).toBe(true);
        expect(intensityPayload.latestEasyPercent).toBeTypeOf('number');
        expect(intensityPayload.latestHardPercent).toBeTypeOf('number');

        const efficiencyPayload = findPersistedPayload(DERIVED_METRIC_KINDS.EfficiencyTrend).payload as Record<string, unknown>;
        const efficiencyPoints = efficiencyPayload.points as Array<Record<string, unknown>>;
        expect(efficiencyPoints.length).toBeGreaterThan(0);
        expect(efficiencyPayload.latestValue).toBeTypeOf('number');
        expect(efficiencyPoints[0].value).toBeGreaterThan(0);
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
            ],
            {
                formDocs: formDocs as any,
                recoveryNowDocs: [] as any,
            },
        );

        const acwrPayload = findPersistedPayload(DERIVED_METRIC_KINDS.Acwr).payload as Record<string, unknown>;
        expect(acwrPayload.latestDayMs).toBe(Date.UTC(2026, 0, 10));
        expect(acwrPayload.acuteLoad7).toBe(0);
        expect(acwrPayload.chronicLoad28).toBe(15);
        expect(acwrPayload.ratio).toBe(0);

        const rampPayload = findPersistedPayload(DERIVED_METRIC_KINDS.RampRate).payload as Record<string, unknown>;
        expect(rampPayload.latestDayMs).toBe(Date.UTC(2026, 0, 10));
        expect(rampPayload.ctl7DaysAgo).toBeTypeOf('number');
        expect(rampPayload.rampRate).toBeTypeOf('number');

        const monotonyPayload = findPersistedPayload(DERIVED_METRIC_KINDS.MonotonyStrain).payload as Record<string, unknown>;
        expect(monotonyPayload.latestDayMs).toBe(Date.UTC(2026, 0, 10));
        expect(monotonyPayload.weeklyLoad7).toBe(0);
        expect(monotonyPayload.monotony).toBeNull();
        expect(monotonyPayload.strain).toBeNull();
    });
});
