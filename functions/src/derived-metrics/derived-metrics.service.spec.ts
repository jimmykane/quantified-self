import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DERIVED_METRIC_KINDS,
    DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS,
} from '../../../shared/derived-metrics';
import {
    ActivityTypeGroups,
    ActivityTypes,
    DataActivityTypes,
    DataCriticalPower,
    DataDuration,
    DataFTP,
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
    DataSwimDistance,
    DataSwimPaceAvg,
    DataVO2Max,
} from '@sports-alliance/sports-lib';
import { getActivityTypesForGroup } from '../../../shared/activity-type-group.metadata';
import { POWER_CURVE_STAT_TYPE } from '../../../shared/power-curve';
import { resolveTrainingDisciplineFromActivityType } from '../../../shared/training-disciplines';

function buildTrainingActivitySources(docs: readonly any[]): any[] {
    return docs.flatMap((doc, index) => {
        const eventData = doc.data() || {};
        if (eventData.isMerge === true) {
            return [];
        }
        const activityTypes = eventData.stats?.[DataActivityTypes.type];
        const activityType = Array.isArray(activityTypes) ? activityTypes[0] : activityTypes;
        const discipline = resolveTrainingDisciplineFromActivityType(activityType);
        const startMs = Number(eventData.startDate);
        if (!discipline || !Number.isFinite(startMs)) {
            return [];
        }
        const eventId = `${doc.id || `event-${index}`}`;
        const activityData = { ...eventData, type: activityType, eventID: eventId };
        return [{
            activityId: `${eventId}-activity`,
            eventId,
            discipline,
            activityData,
            eventData,
            metricData: activityData,
            startMs,
            startDayMs: Date.UTC(new Date(startMs).getUTCFullYear(), new Date(startMs).getUTCMonth(), new Date(startMs).getUTCDate()),
            eventStartMs: startMs,
            eventStartDayMs: Date.UTC(new Date(startMs).getUTCFullYear(), new Date(startMs).getUTCMonth(), new Date(startMs).getUTCDate()),
        }];
    });
}

const hoisted = vi.hoisted(() => {
    const get = vi.fn();
    const select = vi.fn();
    const where = vi.fn();
    const transactionGet = vi.fn();
    const transactionSet = vi.fn();
    const userRootGet = vi.fn();
    const tombstoneGet = vi.fn();
    const eventsCollection = { where, select };
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

describe('fetchDerivedMetricsEventDocs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.select.mockReturnValue({ get: hoisted.get });
        hoisted.get.mockResolvedValue({ docs: [] });
    });

    it('fetches both canonical and legacy event tag fields for derived race suggestions', async () => {
        const { fetchDerivedMetricsEventDocs } = await import('./derived-metrics.service');

        await fetchDerivedMetricsEventDocs('user-1');

        expect(hoisted.select).toHaveBeenCalledWith(
            'startDate',
            'endDate',
            'stats',
            'tags',
            'benchmarkReviewTags',
            'name',
            'isMerge',
            'mergeType',
            'creator',
            'serviceName',
            'sourceServiceName',
        );
    });

    it('fetches swim lengths only when the swimming performance metric needs them', async () => {
        const { fetchDerivedMetricsActivityDocs } = await import('./derived-metrics.service');

        await fetchDerivedMetricsActivityDocs('user-1');

        expect(hoisted.select).toHaveBeenCalledWith(
            'eventID',
            'startDate',
            'endDate',
            'type',
            'stats',
            'creator',
            'serviceName',
            'sourceServiceName',
        );

        await fetchDerivedMetricsActivityDocs('user-1', { includeSwimLengths: true });

        expect(hoisted.select).toHaveBeenLastCalledWith(
            'eventID',
            'startDate',
            'endDate',
            'type',
            'stats',
            'creator',
            'serviceName',
            'sourceServiceName',
            'swimLengths',
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
            needsTrainingActivityDocs: false,
            needsTrainingSwimLengths: false,
            needsTrainingBuildBenchmarkSettings: false,
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
            needsTrainingActivityDocs: false,
            needsTrainingSwimLengths: false,
            needsTrainingBuildBenchmarkSettings: false,
        });
    });

    it('uses the event source for the training summary snapshot', async () => {
        const { resolveDerivedMetricSourceRequirements } = await import('./derived-metrics.service');

        expect(resolveDerivedMetricSourceRequirements([DERIVED_METRIC_KINDS.TrainingSummary])).toEqual({
            needsFormDocs: true,
            needsRecoveryNowDocs: false,
            needsTrainingActivityDocs: true,
            needsTrainingSwimLengths: false,
            needsTrainingBuildBenchmarkSettings: false,
        });
    });

    it('uses the event source for the training capacity snapshot', async () => {
        const { resolveDerivedMetricSourceRequirements } = await import('./derived-metrics.service');

        expect(resolveDerivedMetricSourceRequirements([DERIVED_METRIC_KINDS.TrainingCapacity])).toEqual({
            needsFormDocs: true,
            needsRecoveryNowDocs: false,
            needsTrainingActivityDocs: true,
            needsTrainingSwimLengths: false,
            needsTrainingBuildBenchmarkSettings: false,
        });
    });

    it('uses the event source for the Power Curve snapshot', async () => {
        const { resolveDerivedMetricSourceRequirements } = await import('./derived-metrics.service');

        expect(resolveDerivedMetricSourceRequirements([DERIVED_METRIC_KINDS.PowerCurve])).toEqual({
            needsFormDocs: true,
            needsRecoveryNowDocs: false,
            needsTrainingActivityDocs: true,
            needsTrainingSwimLengths: false,
            needsTrainingBuildBenchmarkSettings: false,
        });
    });

    it('fetches settings only for the training build comparison snapshot', async () => {
        const { resolveDerivedMetricSourceRequirements } = await import('./derived-metrics.service');

        expect(resolveDerivedMetricSourceRequirements([DERIVED_METRIC_KINDS.TrainingBuildComparison])).toEqual({
            needsFormDocs: true,
            needsRecoveryNowDocs: false,
            needsTrainingActivityDocs: true,
            needsTrainingSwimLengths: false,
            needsTrainingBuildBenchmarkSettings: true,
        });
    });

    it('requests swim-length projection only for swimming performance', async () => {
        const { resolveDerivedMetricSourceRequirements } = await import('./derived-metrics.service');

        expect(resolveDerivedMetricSourceRequirements([DERIVED_METRIC_KINDS.TrainingSwimPerformance])).toEqual({
            needsFormDocs: true,
            needsRecoveryNowDocs: false,
            needsTrainingActivityDocs: true,
            needsTrainingSwimLengths: true,
            needsTrainingBuildBenchmarkSettings: false,
        });
    });
});

describe('buildTrainingBuildComparisonMetricPayload', () => {
    it('keeps sport windows separate, excludes the event anchor, and leaves optional metrics explicit', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 5, 30, 12, 0, 0);
        const raceDayMs = Date.UTC(2026, 3, 20);
        const docs = [
            {
                id: 'run-build',
                data: () => ({
                    startDate: Date.UTC(2026, 3, 19, 8, 0, 0),
                    stats: {
                        [DataActivityTypes.type]: [ActivityTypes.Running],
                        [DataDuration.type]: 3600,
                        Distance: 10000,
                        'Training Stress Score': 70,
                    },
                }),
            },
            {
                id: 'race-anchor',
                data: () => ({
                    name: 'Spring marathon',
                    tags: ['Race'],
                    startDate: raceDayMs + (8 * 60 * 60 * 1000),
                    stats: {
                        [DataActivityTypes.type]: [ActivityTypes.Running],
                        [DataDuration.type]: 12_000,
                        Distance: 42_195,
                    },
                }),
            },
            {
                id: 'current-cycle',
                data: () => ({
                    startDate: Date.UTC(2026, 5, 29, 8, 0, 0),
                    stats: {
                        [DataActivityTypes.type]: [ActivityTypes.Cycling],
                        [DataDuration.type]: 5400,
                        Distance: 50_000,
                    },
                }),
            },
            {
                id: 'merged-race',
                data: () => ({
                    tags: ['race'],
                    isMerge: true,
                    startDate: Date.UTC(2026, 3, 1),
                    stats: { [DataActivityTypes.type]: [ActivityTypes.Running] },
                }),
            },
        ] as any;

        const result = buildTrainingBuildComparisonMetricPayload(buildTrainingActivitySources(docs), {
            trainingSettings: {
                buildBenchmarks: {
                    running: { mode: 'event', durationWeeks: 8, eventId: 'race-anchor' },
                    cycling: { mode: 'period', durationWeeks: 8, endDayMs: Date.UTC(2026, 3, 1) },
                },
            },
        }, nowMs);

        const running = result.payload.disciplines.find(item => item.discipline === 'running')!;
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling')!;
        expect(running.status).toBe('ready');
        expect(running.selection?.windowEndDayMs).toBe(raceDayMs - (24 * 60 * 60 * 1000));
        expect(running.benchmark?.activityCount).toBe(1);
        expect(running.benchmark?.distanceMeters).toBe(10_000);
        expect(running.benchmark?.trainingStressScore).toBe(70);
        expect(running.benchmark?.easySeconds).toBeNull();
        expect(running.benchmark?.efficiency).toBeNull();
        expect(running.suggestedRaces).toEqual([{
            eventId: 'race-anchor', startDayMs: raceDayMs, label: 'Spring marathon',
            distanceMeters: 42_195, durationSeconds: 12_000, trainingStressScore: null,
        }]);
        expect(running.suggestedEvents).toEqual([
            {
                eventId: 'run-build', startDayMs: Date.UTC(2026, 3, 19), label: null,
                distanceMeters: 10_000, durationSeconds: 3_600, trainingStressScore: 70,
            },
        ]);
        expect(cycling.status).toBe('ready');
        expect(cycling.current?.activityCount).toBe(1);
        expect(cycling.current?.trainingStressScore).toBeNull();
    });

    it('marks malformed or overlapping selections invalid instead of building an overlapping comparison', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 5, 30, 12, 0, 0);
        const result = buildTrainingBuildComparisonMetricPayload([], {
            trainingSettings: {
                buildBenchmarks: {
                    running: { mode: 'period', durationWeeks: 12, endDayMs: Date.UTC(2026, 5, 29) },
                    cycling: { mode: 'event', durationWeeks: 9, eventId: 'missing' },
                },
            },
        }, nowMs);

        expect(result.payload.disciplines.find(item => item.discipline === 'running')?.status).toBe('invalid-selection');
        expect(result.payload.disciplines.find(item => item.discipline === 'cycling')?.status).toBe('not-configured');
    });

    it('keeps an existing Race-tagged event prioritized when resolving its saved benchmark', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 5, 30, 12, 0, 0);
        const raceDayMs = Date.UTC(2026, 3, 20);
        const docs = [
            {
                id: 'tagged-race',
                data: () => ({
                    name: 'Tagged marathon',
                    benchmarkReviewTags: ['Race'],
                    startDate: raceDayMs,
                    stats: { [DataActivityTypes.type]: [ActivityTypes.Running] },
                }),
            },
        ] as any;

        const result = buildTrainingBuildComparisonMetricPayload(buildTrainingActivitySources(docs), {
            trainingSettings: {
                buildBenchmarks: {
                    running: { mode: 'event', durationWeeks: 8, eventId: 'tagged-race' },
                },
            },
        }, nowMs);

        const running = result.payload.disciplines.find(item => item.discipline === 'running');
        expect(running?.status).toBe('ready');
        expect(running?.selection?.label).toBe('Tagged marathon');
        expect(running?.suggestedRaces).toEqual([
            {
                eventId: 'tagged-race', startDayMs: raceDayMs, label: 'Tagged marathon',
                distanceMeters: null, durationSeconds: null, trainingStressScore: null,
            },
        ]);
        expect(running?.suggestedEvents).toEqual([]);
    });

    it('keeps an older saved Race-tagged event visible when newer suggestions reach the bounded limit', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 5, 30, 12, 0, 0);
        const docs = Array.from({ length: 21 }, (_, index) => ({
            id: `race-${index}`,
            data: () => ({
                name: `Race ${index}`,
                tags: ['Race'],
                startDate: Date.UTC(2024, index, 1),
                stats: { [DataActivityTypes.type]: [ActivityTypes.Running] },
            }),
        })) as any;

        const result = buildTrainingBuildComparisonMetricPayload(buildTrainingActivitySources(docs), {
            trainingSettings: {
                buildBenchmarks: {
                    running: { mode: 'event', durationWeeks: 8, eventId: 'race-0' },
                },
            },
        }, nowMs);

        const running = result.payload.disciplines.find(item => item.discipline === 'running');
        expect(running?.status).toBe('ready');
        expect(running?.suggestedRaces).toHaveLength(20);
        expect(running?.suggestedRaces[0]?.eventId).toBe('race-0');
    });

    it('keeps an older saved untagged event visible when event suggestions reach the bounded limit', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 5, 30, 12, 0, 0);
        const docs = Array.from({ length: 101 }, (_, index) => ({
            id: `event-${index}`,
            data: () => ({
                name: `Training event ${index}`,
                startDate: Date.UTC(2024, 0, index + 1),
                stats: { [DataActivityTypes.type]: [ActivityTypes.Running] },
            }),
        })) as any;

        const result = buildTrainingBuildComparisonMetricPayload(buildTrainingActivitySources(docs), {
            trainingSettings: {
                buildBenchmarks: {
                    running: { mode: 'event', durationWeeks: 8, eventId: 'event-0' },
                },
            },
        }, nowMs);

        const running = result.payload.disciplines.find(item => item.discipline === 'running');
        expect(running?.status).toBe('ready');
        expect(running?.suggestedEvents).toHaveLength(100);
        expect(running?.suggestedEvents[0]?.eventId).toBe('event-0');
    });

    it('keeps newer anchors available when a saved benchmark uses a longer duration', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 5, 30, 12, 0, 0);
        const docs = [
            {
                id: 'saved-race',
                data: () => ({
                    name: 'Spring marathon',
                    tags: ['Race'],
                    startDate: Date.UTC(2026, 1, 1),
                    stats: { [DataActivityTypes.type]: [ActivityTypes.Running] },
                }),
            },
            {
                id: 'newer-event',
                data: () => ({
                    name: 'Long run dress rehearsal',
                    startDate: Date.UTC(2026, 4, 1),
                    stats: { [DataActivityTypes.type]: [ActivityTypes.Running] },
                }),
            },
        ] as any;

        const result = buildTrainingBuildComparisonMetricPayload(buildTrainingActivitySources(docs), {
            trainingSettings: {
                buildBenchmarks: {
                    running: { mode: 'event', durationWeeks: 12, eventId: 'saved-race' },
                },
            },
        }, nowMs);

        const running = result.payload.disciplines.find(item => item.discipline === 'running');
        expect(running?.status).toBe('ready');
        expect(running?.suggestedEvents).toEqual([
            {
                eventId: 'newer-event', startDayMs: Date.UTC(2026, 4, 1), label: 'Long run dress rehearsal',
                distanceMeters: null, durationSeconds: null, trainingStressScore: null,
            },
        ]);
    });

    it('does not count future-dated sessions in the current build', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 5, 30, 12, 0, 0);
        const docs = [
            {
                id: 'current-run',
                data: () => ({
                    startDate: Date.UTC(2026, 5, 30, 8, 0, 0),
                    stats: {
                        [DataActivityTypes.type]: [ActivityTypes.Running],
                        [DataDuration.type]: 3_600,
                        Distance: 10_000,
                    },
                }),
            },
            {
                id: 'scheduled-run',
                data: () => ({
                    startDate: Date.UTC(2026, 5, 30, 20, 0, 0),
                    stats: {
                        [DataActivityTypes.type]: [ActivityTypes.Running],
                        [DataDuration.type]: 7_200,
                        Distance: 20_000,
                    },
                }),
            },
        ] as any;

        const result = buildTrainingBuildComparisonMetricPayload(buildTrainingActivitySources(docs), {
            trainingSettings: {
                buildBenchmarks: {
                    running: { mode: 'period', durationWeeks: 8, endDayMs: Date.UTC(2026, 3, 1) },
                },
            },
        }, nowMs);

        const running = result.payload.disciplines.find(item => item.discipline === 'running');
        expect(running?.current?.activityCount).toBe(1);
        expect(running?.current?.durationSeconds).toBe(3_600);
        expect(running?.current?.distanceMeters).toBe(10_000);
    });

    it('counts consistency in seven-day build buckets rather than partial calendar weeks', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 14, 12);
        const currentWindowStartDayMs = Date.UTC(2026, 3, 22);
        const currentDates = [
            currentWindowStartDayMs,
            ...Array.from({ length: 12 }, (_, index) => Date.UTC(2026, 3, 27 + (index * 7))),
        ];
        const docs = currentDates.map((startDate, index) => ({
            id: `current-${index}`,
            data: () => ({
                startDate,
                stats: { [DataActivityTypes.type]: [ActivityTypes.Running] },
            }),
        }));

        const result = buildTrainingBuildComparisonMetricPayload(buildTrainingActivitySources(docs), {
            trainingSettings: {
                buildBenchmarks: {
                    running: { mode: 'period', durationWeeks: 12, endDayMs: Date.UTC(2026, 2, 31) },
                },
            },
        }, nowMs);

        const running = result.payload.disciplines.find(item => item.discipline === 'running');
        expect(running?.current?.activityCount).toBe(13);
        expect(running?.current?.activeWeekCount).toBe(12);
    });
});

describe('buildPowerCurveMetricPayload', () => {
    it('prepares scoped ranges, comparisons, and bounded point series from raw event stats', async () => {
        const { buildPowerCurveMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 0, 31, 12, 0, 0);
        const longCurve = Array.from({ length: 200 }, (_, index) => ({
            duration: index + 1,
            power: 500 - index,
        }));
        const docs = [
            {
                id: 'old-cycling',
                data: () => ({
                    startDate: Date.UTC(2025, 11, 1, 10, 0, 0),
                    stats: {
                        [DataActivityTypes.type]: [ActivityTypes.Cycling],
                        [DataDuration.type]: 3600,
                        [POWER_CURVE_STAT_TYPE]: longCurve,
                    },
                }),
            },
            {
                id: 'latest-cycling',
                data: () => ({
                    startDate: Date.UTC(2026, 0, 30, 10, 0, 0),
                    stats: {
                        [DataActivityTypes.type]: [ActivityTypes.Cycling],
                        [DataDuration.type]: 3600,
                        [POWER_CURVE_STAT_TYPE]: [{ duration: 60, power: 410 }, { duration: 300, power: 330 }],
                    },
                }),
            },
            {
                id: 'merged-running',
                data: () => ({
                    isMerge: true,
                    startDate: Date.UTC(2026, 0, 30, 10, 0, 0),
                    stats: {
                        [DataActivityTypes.type]: [ActivityTypes.Running],
                        [POWER_CURVE_STAT_TYPE]: [{ duration: 60, power: 999 }],
                    },
                }),
            },
            {
                id: 'future-cycling',
                data: () => ({
                    startDate: nowMs + 60_000,
                    stats: {
                        [DataActivityTypes.type]: [ActivityTypes.Cycling],
                        [POWER_CURVE_STAT_TYPE]: [{ duration: 60, power: 999 }],
                    },
                }),
            },
        ];

        const result = buildPowerCurveMetricPayload(buildTrainingActivitySources(docs), nowMs);
        const cycling = result.payload.scopes.cycling.ranges.all;

        expect(result.payload.asOfDayMs).toBe(Date.UTC(2026, 0, 31));
        expect(cycling.sourceEventCount).toBe(2);
        expect(cycling.matchedEventCount).toBe(2);
        expect(cycling.latestActivity?.eventId).toBe('latest-cycling');
        expect(cycling.best30dEventCount).toBe(1);
        expect(cycling.bestPoints).toHaveLength(128 * 3);
        expect(cycling.bestPoints.slice(0, 3)).toEqual([1, 500, 0]);
        expect(Object.keys(result.payload.scopes.cycling.thisWeekByStartDay)).toHaveLength(7);
        expect(result.payload.scopes.running.ranges.all.matchedEventCount).toBe(0);
    });

    it('anchors recent-best comparisons to the latest activity in the selected range', async () => {
        const { buildPowerCurveMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 0, 31, 12, 0, 0);
        const docs = [
            {
                id: 'older-best',
                data: () => ({
                    startDate: Date.UTC(2025, 11, 1, 10, 0, 0),
                    stats: {
                        [DataActivityTypes.type]: [ActivityTypes.Cycling],
                        [POWER_CURVE_STAT_TYPE]: [{ duration: 300, power: 500 }],
                    },
                }),
            },
            {
                id: 'latest',
                data: () => ({
                    startDate: Date.UTC(2025, 11, 31, 10, 0, 0),
                    stats: {
                        [DataActivityTypes.type]: [ActivityTypes.Cycling],
                        [POWER_CURVE_STAT_TYPE]: [{ duration: 300, power: 400 }],
                    },
                }),
            },
        ];

        const result = buildPowerCurveMetricPayload(buildTrainingActivitySources(docs), nowMs);

        expect(result.payload.scopes.cycling.ranges.all.best30dPoints).toEqual([300, 500, 0]);
        expect(result.payload.scopes.cycling.ranges.all.best30dEventCount).toBe(2);
    });

    it('uses the same activity groups as the dashboard scopes', async () => {
        const { buildPowerCurveMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 0, 31, 12, 0, 0);
        const cyclingActivityTypes = [...new Set([
            ...getActivityTypesForGroup(ActivityTypeGroups.CyclingGroup),
            ...getActivityTypesForGroup(ActivityTypeGroups.MountainBikingGroup),
        ])];
        const runningActivityTypes = [...new Set([
            ...getActivityTypesForGroup(ActivityTypeGroups.RunningGroup),
            ...getActivityTypesForGroup(ActivityTypeGroups.TrailRunningGroup),
        ])];
        const createDocs = (activityTypes: readonly string[], scope: string) => activityTypes.map((activityType, index) => ({
            id: `${scope}-${index}`,
            data: () => ({
                startDate: Date.UTC(2026, 0, 30, 10, 0, 0),
                stats: {
                    [DataActivityTypes.type]: [activityType],
                    [POWER_CURVE_STAT_TYPE]: [{ duration: 300, power: 280 }],
                },
            }),
        }));
        const docs = [
            ...createDocs(cyclingActivityTypes, 'cycling'),
            ...createDocs(runningActivityTypes, 'running'),
        ];

        const result = buildPowerCurveMetricPayload(buildTrainingActivitySources(docs), nowMs);

        expect(result.payload.scopes.cycling.ranges.all).toMatchObject({
            sourceEventCount: cyclingActivityTypes.length,
            matchedEventCount: cyclingActivityTypes.length,
            bestPoints: [300, 280, 0],
        });
        expect(result.payload.scopes.running.ranges.all).toMatchObject({
            sourceEventCount: runningActivityTypes.length,
            matchedEventCount: runningActivityTypes.length,
        });
    });
});

describe('buildTrainingCapacityMetricPayload', () => {
    const nowMs = Date.UTC(2026, 6, 10, 12, 0, 0);
    const modeledCurve = [180, 300, 600, 900, 1200].map(duration => ({
        duration,
        power: 240 + (18_000 / duration),
        wattsPerKg: 3.2 + (240 / duration),
    }));
    const createDoc = (
        id: string,
        dayMs: number,
        overrides: Record<string, unknown> = {},
        curve: unknown = modeledCurve,
        creatorName = 'Edge 1050',
    ) => ({
        id,
        data: () => ({
            startDate: dayMs,
            serviceName: 'Garmin',
            creator: { name: creatorName },
            stats: {
                [DataActivityTypes.type]: [ActivityTypes.Cycling],
                [DataDuration.type]: 3600,
                [POWER_CURVE_STAT_TYPE]: curve,
                ...overrides,
            },
        }),
    });

    it('deduplicates carried settings and models CP from the 90-day aggregate curve', async () => {
        const { buildPowerCurveMetricPayload, buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
        const docs = [
            createDoc('old-setting', Date.UTC(2026, 0, 1), {
                [DataFTP.type]: 210,
                [DataVO2Max.type]: 54,
            }, null),
            createDoc('new-setting', Date.UTC(2026, 1, 1), {
                [DataFTP.type]: 222,
                [DataVO2Max.type]: 55.9,
            }, null),
            createDoc('recent-one', Date.UTC(2026, 6, 1), {
                [DataFTP.type]: 222,
                [DataVO2Max.type]: 55.9,
                [DataCriticalPower.type]: 120,
            }),
            createDoc('recent-two', Date.UTC(2026, 6, 5), {
                [DataFTP.type]: 222,
                [DataVO2Max.type]: 55.9,
                [DataCriticalPower.type]: 500,
            }),
            createDoc('recent-three', Date.UTC(2026, 6, 8), {
                [DataFTP.type]: 222,
                [DataVO2Max.type]: 55.9,
                [DataCriticalPower.type]: 100,
            }),
        ];
        const trainingActivities = buildTrainingActivitySources(docs);
        const powerCurve = buildPowerCurveMetricPayload(trainingActivities, nowMs);

        const result = buildTrainingCapacityMetricPayload(trainingActivities, powerCurve.payload, nowMs);
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling');

        expect(cycling?.ftpSetting).toMatchObject({
            kind: 'ftp-setting',
            value: 222,
            sourceKey: 'garmin / edge 1050',
            firstSeenAtMs: Date.UTC(2026, 1, 1),
            lastSeenAtMs: Date.UTC(2026, 6, 8),
            observationCount: 4,
            previousValue: 210,
            changePct: 5.71,
        });
        expect(cycling?.importedVo2Max).toMatchObject({
            kind: 'vo2-max',
            value: 55.9,
            firstSeenAtMs: Date.UTC(2026, 1, 1),
            observationCount: 4,
            previousValue: 54,
        });
        expect(cycling?.modeledCriticalPower).toMatchObject({
            status: 'ready',
            valueWatts: 240,
            valueWattsPerKg: 3.2,
            wPrimeJoules: 18_000,
            confidence: 'high',
            sourceEventCount: 3,
            anchorPointCount: 5,
            rSquared: 1,
            normalizedRmse: 0,
        });
    });

    it('withholds modeled CP when the aggregate curve lacks long-duration evidence', async () => {
        const { buildPowerCurveMetricPayload, buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
        const docs = [
            createDoc('short-only', Date.UTC(2026, 6, 8), {
                [DataCriticalPower.type]: 400,
            }, [
                { duration: 180, power: 350 },
                { duration: 300, power: 310 },
                { duration: 600, power: 275 },
            ]),
        ];
        const trainingActivities = buildTrainingActivitySources(docs);
        const powerCurve = buildPowerCurveMetricPayload(trainingActivities, nowMs);

        const result = buildTrainingCapacityMetricPayload(trainingActivities, powerCurve.payload, nowMs);
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling');

        expect(cycling?.modeledCriticalPower).toMatchObject({
            status: 'insufficient-evidence',
            valueWatts: null,
            confidence: null,
            sourceEventCount: 1,
            anchorPointCount: 3,
            minDurationSeconds: 180,
            maxDurationSeconds: 600,
        });
    });

    it('does not call a source change a comparable setting change', async () => {
        const { buildPowerCurveMetricPayload, buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
        const docs = [
            createDoc('garmin', Date.UTC(2026, 5, 1), { [DataFTP.type]: 210 }, null, 'Edge 1050'),
            createDoc('wahoo', Date.UTC(2026, 6, 1), { [DataFTP.type]: 230 }, null, 'Wahoo Kickr'),
        ];
        const trainingActivities = buildTrainingActivitySources(docs);
        const powerCurve = buildPowerCurveMetricPayload(trainingActivities, nowMs);

        const result = buildTrainingCapacityMetricPayload(trainingActivities, powerCurve.payload, nowMs);
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling');

        expect(cycling?.ftpSetting).toMatchObject({
            value: 230,
            sourceKey: 'garmin / wahoo kickr',
            previousValue: 210,
            previousSourceKey: 'garmin / edge 1050',
            changePct: null,
        });
    });

    it('keeps provider-only provenance when device metadata is unavailable', async () => {
        const { buildPowerCurveMetricPayload, buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
        const docs = [createDoc('provider-only', Date.UTC(2026, 6, 8), { [DataFTP.type]: 222 }, null, '')];
        const trainingActivities = buildTrainingActivitySources(docs);
        const powerCurve = buildPowerCurveMetricPayload(trainingActivities, nowMs);

        const result = buildTrainingCapacityMetricPayload(trainingActivities, powerCurve.payload, nowMs);
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling');

        expect(cycling?.ftpSetting).toMatchObject({ sourceKey: 'garmin', value: 222 });
    });

    it('does not present a session-derived 20-minute FTP estimate as an imported setting', async () => {
        const { buildPowerCurveMetricPayload, buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
        const docs = [createDoc('derived-ftp', Date.UTC(2026, 6, 8), {
            [DataFTP.type]: Math.round(modeledCurve.find(point => point.duration === 1_200)!.power * 0.95),
        })];
        const trainingActivities = buildTrainingActivitySources(docs);
        const powerCurve = buildPowerCurveMetricPayload(trainingActivities, nowMs);

        const result = buildTrainingCapacityMetricPayload(trainingActivities, powerCurve.payload, nowMs);
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling');

        expect(cycling?.ftpSetting).toBeNull();
        expect(cycling?.modeledCriticalPower.status).toBe('ready');
    });

    it('resolves equal-timestamp imported settings deterministically by event id', async () => {
        const { buildPowerCurveMetricPayload, buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
        const timestamp = Date.UTC(2026, 6, 8);
        const docs = [
            createDoc('setting-b', timestamp, { [DataFTP.type]: 220 }, null),
            createDoc('setting-a', timestamp, { [DataFTP.type]: 210 }, null),
        ];
        const trainingActivities = buildTrainingActivitySources(docs);
        const powerCurve = buildPowerCurveMetricPayload(trainingActivities, nowMs);

        const result = buildTrainingCapacityMetricPayload(trainingActivities, powerCurve.payload, nowMs);
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling');

        expect(cycling?.ftpSetting).toMatchObject({
            value: 220,
            previousValue: 210,
            previousAtMs: timestamp,
        });
    });

    it('uses activity groups for sport capacity and excludes merged events', async () => {
        const { buildPowerCurveMetricPayload, buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
        const docs = [
            createDoc('trail-run', Date.UTC(2026, 6, 7), {
                [DataActivityTypes.type]: [ActivityTypes.TrailRunning],
                [DataFTP.type]: 190,
            }, null),
            createDoc('mountain-bike', Date.UTC(2026, 6, 8), {
                [DataActivityTypes.type]: ['Mountain Biking'],
                [DataFTP.type]: 250,
            }, null),
            {
                id: 'merged-ride',
                data: () => ({
                    isMerge: true,
                    startDate: Date.UTC(2026, 6, 9),
                    stats: {
                        [DataActivityTypes.type]: [ActivityTypes.Cycling],
                        [DataFTP.type]: 500,
                    },
                }),
            },
        ];
        const trainingActivities = buildTrainingActivitySources(docs);
        const powerCurve = buildPowerCurveMetricPayload(trainingActivities, nowMs);

        const result = buildTrainingCapacityMetricPayload(trainingActivities, powerCurve.payload, nowMs);
        const running = result.payload.disciplines.find(item => item.discipline === 'running');
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling');

        expect(running?.ftpSetting?.value).toBe(190);
        expect(cycling?.ftpSetting?.value).toBe(250);
        expect(result.sourceEventCount).toBe(2);
    });

    it('ignores future settings and withholds an unreliable relative-power fit', async () => {
        const { buildPowerCurveMetricPayload, buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
        const relativePower = [4, 3.4, 3.6, 3.1, 3.3];
        const unreliableRelativeCurve = modeledCurve.map((point, index) => ({
            ...point,
            wattsPerKg: relativePower[index],
        }));
        const docs = [
            createDoc('recent-one', Date.UTC(2026, 6, 1), { [DataFTP.type]: 222 }, unreliableRelativeCurve),
            createDoc('recent-two', Date.UTC(2026, 6, 5), { [DataFTP.type]: 222 }, unreliableRelativeCurve),
            createDoc('recent-three', Date.UTC(2026, 6, 8), { [DataFTP.type]: 222 }, unreliableRelativeCurve),
            createDoc('future', Date.UTC(2026, 6, 20), { [DataFTP.type]: 300 }, modeledCurve),
        ];
        const trainingActivities = buildTrainingActivitySources(docs);
        const powerCurve = buildPowerCurveMetricPayload(trainingActivities, nowMs);

        const result = buildTrainingCapacityMetricPayload(trainingActivities, powerCurve.payload, nowMs);
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling');

        expect(cycling?.ftpSetting).toMatchObject({ value: 222, observationCount: 3 });
        expect(cycling?.modeledCriticalPower).toMatchObject({
            status: 'ready',
            valueWatts: 240,
            valueWattsPerKg: null,
        });
    });

    it('does not manufacture a model by interpolating across a sparse duration gap', async () => {
        const { buildPowerCurveMetricPayload, buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
        const sparseCurve = modeledCurve.filter(point => point.duration === 180 || point.duration === 1_200);
        const docs = [
            createDoc('sparse-one', Date.UTC(2026, 6, 1), {}, sparseCurve),
            createDoc('sparse-two', Date.UTC(2026, 6, 5), {}, sparseCurve),
            createDoc('sparse-three', Date.UTC(2026, 6, 8), {}, sparseCurve),
        ];
        const trainingActivities = buildTrainingActivitySources(docs);
        const powerCurve = buildPowerCurveMetricPayload(trainingActivities, nowMs);

        const result = buildTrainingCapacityMetricPayload(trainingActivities, powerCurve.payload, nowMs);
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling');

        expect(cycling?.modeledCriticalPower).toMatchObject({
            status: 'insufficient-evidence',
            valueWatts: null,
            anchorPointCount: 2,
        });
    });

    it('withholds W/kg when aggregate anchors imply inconsistent body weights', async () => {
        const { buildPowerCurveMetricPayload, buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
        const inconsistentWeightCurve = modeledCurve.map(point => ({
            ...point,
            wattsPerKg: 3.2 + (180 / point.duration),
        }));
        const docs = [
            createDoc('weight-one', Date.UTC(2026, 6, 1), {}, inconsistentWeightCurve),
            createDoc('weight-two', Date.UTC(2026, 6, 5), {}, inconsistentWeightCurve),
            createDoc('weight-three', Date.UTC(2026, 6, 8), {}, inconsistentWeightCurve),
        ];
        const trainingActivities = buildTrainingActivitySources(docs);
        const powerCurve = buildPowerCurveMetricPayload(trainingActivities, nowMs);

        const result = buildTrainingCapacityMetricPayload(trainingActivities, powerCurve.payload, nowMs);
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling');

        expect(cycling?.modeledCriticalPower).toMatchObject({
            status: 'ready',
            valueWatts: 240,
            valueWattsPerKg: null,
        });
    });
});

describe('buildTrainingSummaryMetricPayload', () => {
    const nowMs = Date.UTC(2026, 6, 10, 12, 0, 0);
    const createDoc = (data: Record<string, unknown>) => ({ data: () => data });
    const createEvent = (
        dayMs: number,
        activityType: string,
        source: string,
        overrides: Record<string, unknown> = {},
        sourceMetadata: Record<string, unknown> = {},
    ) => createDoc({
        startDate: dayMs,
        serviceName: source,
        creator: { name: `${source} device` },
        ...sourceMetadata,
        stats: {
            [DataActivityTypes.type]: [activityType],
            [DataDuration.type]: 3600,
            [DataHeartRateZoneOneDuration.type]: 1200,
            [DataHeartRateZoneThreeDuration.type]: 1200,
            [DataHeartRateZoneFiveDuration.type]: 600,
            ...overrides,
        },
    });

    it('separates activity families, normalizes the 84-day baseline, and excludes merged events', async () => {
        const { buildTrainingSummaryMetricPayload } = await import('./derived-metrics.service');
        const currentRunningDay = Date.UTC(2026, 6, 8);
        const baselineRunningDay = Date.UTC(2026, 5, 1);
        const baselineRunningDayTwo = Date.UTC(2026, 4, 1);
        const docs = [
            createEvent(currentRunningDay, 'Running', 'Garmin', {
                [DataVO2Max.type]: 51,
                [DataFTP.type]: 250,
            }),
            createEvent(baselineRunningDay, 'Trail Running', 'Garmin', {
                [DataVO2Max.type]: 49,
                [DataFTP.type]: 230,
            }),
            createEvent(baselineRunningDayTwo, 'Treadmill', 'Garmin', {
                [DataVO2Max.type]: 50,
                [DataFTP.type]: 240,
            }),
            createEvent(currentRunningDay, 'Mountain Biking', 'Wahoo', {
                [DataFTP.type]: 270,
                [DataCriticalPower.type]: 300,
            }),
            createEvent(nowMs + 60_000, 'Swimming', 'Garmin'),
            createDoc({
                isMerge: true,
                startDate: currentRunningDay,
                stats: {
                    [DataActivityTypes.type]: ['Running'],
                    [DataDuration.type]: 7200,
                },
            }),
        ];

        const result = buildTrainingSummaryMetricPayload(buildTrainingActivitySources(docs), nowMs);
        const running = result.payload.disciplines.find(summary => summary.discipline === 'running');
        const cycling = result.payload.disciplines.find(summary => summary.discipline === 'cycling');

        expect(result.sourceEventCount).toBe(4);
        expect(running?.current28d).toMatchObject({ activityCount: 1, durationSeconds: 3600, easySeconds: 1200, moderateSeconds: 1200, hardSeconds: 600 });
        expect(running?.baseline28d).toMatchObject({ activityCount: 0.67, durationSeconds: 2400, easySeconds: 800, moderateSeconds: 800, hardSeconds: 400 });
        expect(cycling?.current28d.activityCount).toBe(1);
        expect(running).not.toHaveProperty('vo2Max');
        expect(running).not.toHaveProperty('ftp');
        expect(cycling).not.toHaveProperty('criticalPower');
    });
});

describe('activity-level Training sources and swimming performance', () => {
    const activityDoc = (id: string, eventID: string, data: Record<string, unknown>) => ({
        id,
        data: () => ({ eventID, ...data }),
    });
    const eventDoc = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });

    it('splits multisport activity legs, includes MTB in Cycling, and excludes missing or merged parents', async () => {
        const { buildTrainingSummaryMetricPayload, joinTrainingActivitySources } = await import('./derived-metrics.service');
        const startDate = Date.UTC(2026, 6, 8, 8);
        const eventDocs = [
            eventDoc('triathlon', { startDate, name: 'A race' }),
            eventDoc('merged', { startDate, isMerge: true }),
        ];
        const activityDocs = [
            activityDoc('swim-leg', 'triathlon', { startDate, type: ActivityTypes.Swimming, stats: { [DataDuration.type]: 1_000 } }),
            activityDoc('bike-leg', 'triathlon', { startDate, type: ActivityTypes.MountainBiking, stats: { [DataDuration.type]: 2_000 } }),
            activityDoc('run-leg', 'triathlon', { startDate, type: ActivityTypes.TrailRunning, stats: { [DataDuration.type]: 3_000 } }),
            activityDoc('aggregate', 'triathlon', { startDate, type: ActivityTypes.Triathlon, stats: { [DataDuration.type]: 6_000 } }),
            activityDoc('missing-parent', 'missing', { startDate, type: ActivityTypes.Running, stats: {} }),
            activityDoc('merged-child', 'merged', { startDate, type: ActivityTypes.Cycling, stats: {} }),
        ];

        const activities = joinTrainingActivitySources(activityDocs as never, eventDocs as never);
        const summary = buildTrainingSummaryMetricPayload(activities, Date.UTC(2026, 6, 10, 12));

        expect(activities.map(activity => activity.discipline)).toEqual(['swimming', 'cycling', 'running']);
        expect(summary.sourceEventCount).toBe(3);
        expect(summary.payload.disciplines.map(item => [item.discipline, item.current28d.activityCount])).toEqual([
            ['running', 1],
            ['cycling', 1],
            ['swimming', 1],
        ]);
    });

    it('builds fixed pool/open-water pace series and compares SWOLF only in the dominant context', async () => {
        const { buildTrainingSwimPerformanceMetricPayload, joinTrainingActivitySources } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 14, 12);
        const poolDate = Date.UTC(2026, 6, 7, 8);
        const openDate = Date.UTC(2026, 6, 8, 8);
        const events = [
            eventDoc('pool-one', { startDate: poolDate }),
            eventDoc('pool-two', { startDate: poolDate }),
            eventDoc('open', { startDate: openDate }),
            eventDoc('future', { startDate: nowMs + 10_000 }),
        ];
        const activities = [
            activityDoc('pool-one-leg', 'pool-one', {
                startDate: poolDate,
                type: ActivityTypes.Swimming,
                stats: { [DataSwimDistance.type]: 1_000, [DataSwimPaceAvg.type]: 100 },
                swimLengths: [
                    { type: 'active', stroke: 'freestyle', poolLength: 25, swolf: 40 },
                    { type: 'rest', stroke: 'freestyle', poolLength: 25, swolf: 1 },
                    { type: 'active', stroke: 'backstroke', poolLength: 25, swolf: 30 },
                ],
            }),
            activityDoc('pool-two-leg', 'pool-two', {
                startDate: poolDate,
                type: ActivityTypes.Swimming,
                stats: { [DataSwimDistance.type]: 2_000, [DataSwimPaceAvg.type]: 110 },
                swimLengths: [
                    { type: 'active', stroke: 'freestyle', poolLength: 25, swolf: 42 },
                    { type: 'active', stroke: 'freestyle', poolLength: 50, swolf: 50 },
                ],
            }),
            activityDoc('open-leg', 'open', {
                startDate: openDate,
                type: ActivityTypes.OpenWaterSwimming,
                stats: { [DataSwimDistance.type]: 1_500, [DataSwimPaceAvg.type]: 120 },
                swimLengths: [{ type: 'active', stroke: 'freestyle', poolLength: 25, swolf: 10 }],
            }),
            activityDoc('future-leg', 'future', {
                startDate: nowMs + 10_000,
                type: ActivityTypes.Swimming,
                stats: { [DataSwimDistance.type]: 9_000, [DataSwimPaceAvg.type]: 1 },
            }),
        ];

        const result = buildTrainingSwimPerformanceMetricPayload(
            joinTrainingActivitySources(activities as never, events as never),
            nowMs,
        );
        const populatedPool = result.payload.weeks.find(week => week.environment === 'pool' && week.activityCount > 0);
        const populatedOpen = result.payload.weeks.find(week => week.environment === 'open-water' && week.activityCount > 0);

        expect(result.payload.weeks).toHaveLength(24);
        expect(result.sourceEventCount).toBe(3);
        expect(result.payload.swolfContext).toEqual({ stroke: 'freestyle', poolLengthMeters: 25 });
        expect(populatedPool).toMatchObject({
            activityCount: 2,
            distanceMeters: 3_000,
            averagePaceSecondsPer100m: 106.67,
            paceActivityCount: 2,
            swolf: 41,
            swolfLengthCount: 2,
        });
        expect(populatedOpen).toMatchObject({
            activityCount: 1,
            distanceMeters: 1_500,
            averagePaceSecondsPer100m: 120,
            swolf: null,
            swolfLengthCount: 0,
        });
    });

    it('anchors separate multisport race suggestions and aggregates only the selected Swimming legs', async () => {
        const { buildTrainingBuildComparisonMetricPayload, joinTrainingActivitySources } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 5, 30, 12);
        const raceDate = Date.UTC(2026, 3, 20, 8);
        const benchmarkDate = Date.UTC(2026, 2, 15, 8);
        const currentDate = Date.UTC(2026, 5, 15, 8);
        const events = [
            eventDoc('triathlon-race', { startDate: raceDate, name: 'Spring triathlon', tags: ['rAcE'] }),
            eventDoc('benchmark-swim', { startDate: benchmarkDate }),
            eventDoc('current-swim', { startDate: currentDate }),
        ];
        const activities = [
            activityDoc('race-swim-one', 'triathlon-race', {
                startDate: raceDate, type: ActivityTypes.Swimming,
                stats: { [DataSwimDistance.type]: 1_000, [DataDuration.type]: 1_200 },
            }),
            activityDoc('race-swim-two', 'triathlon-race', {
                startDate: raceDate, type: ActivityTypes.Swimming,
                stats: { [DataSwimDistance.type]: 500, [DataDuration.type]: 700 },
            }),
            activityDoc('race-bike', 'triathlon-race', {
                startDate: raceDate, type: ActivityTypes.MountainBiking,
                stats: { Distance: 40_000, [DataDuration.type]: 5_000 },
            }),
            activityDoc('race-run', 'triathlon-race', {
                startDate: raceDate, type: ActivityTypes.TrailRunning,
                stats: { Distance: 10_000, [DataDuration.type]: 3_600 },
            }),
            activityDoc('benchmark-swim-leg', 'benchmark-swim', {
                startDate: benchmarkDate, type: ActivityTypes.Swimming,
                stats: { [DataSwimDistance.type]: 2_000, [DataDuration.type]: 2_400, [DataSwimPaceAvg.type]: 105 },
            }),
            activityDoc('current-swim-leg', 'current-swim', {
                startDate: currentDate, type: ActivityTypes.OpenWaterSwimming,
                stats: { [DataSwimDistance.type]: 3_000, [DataDuration.type]: 3_900, [DataSwimPaceAvg.type]: 115 },
            }),
        ];
        const joined = joinTrainingActivitySources(activities as never, events as never);
        const result = buildTrainingBuildComparisonMetricPayload(joined, {
            trainingSettings: {
                buildBenchmarks: {
                    running: { mode: 'event', durationWeeks: 8, eventId: 'triathlon-race' },
                    cycling: { mode: 'event', durationWeeks: 8, eventId: 'triathlon-race' },
                    swimming: { mode: 'event', durationWeeks: 8, eventId: 'triathlon-race' },
                },
            },
        }, nowMs);

        const running = result.payload.disciplines.find(item => item.discipline === 'running')!;
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling')!;
        const swimming = result.payload.disciplines.find(item => item.discipline === 'swimming')!;
        expect(running.status).toBe('ready');
        expect(cycling.status).toBe('ready');
        expect(swimming.status).toBe('ready');
        expect(swimming.suggestedRaces).toEqual([expect.objectContaining({
            eventId: 'triathlon-race', distanceMeters: 1_500, durationSeconds: 1_900,
        })]);
        expect(running.suggestedRaces[0]).toMatchObject({ distanceMeters: 10_000, durationSeconds: 3_600 });
        expect(cycling.suggestedRaces[0]).toMatchObject({ distanceMeters: 40_000, durationSeconds: 5_000 });
        expect(swimming.benchmark).toMatchObject({
            activityCount: 1, distanceMeters: 2_000, poolAveragePaceSecondsPer100m: 105,
            openWaterAveragePaceSecondsPer100m: null, efficiency: null,
        });
        expect(swimming.current).toMatchObject({
            activityCount: 1, distanceMeters: 3_000, poolAveragePaceSecondsPer100m: null,
            openWaterAveragePaceSecondsPer100m: 115, efficiency: null,
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

    it('does not overwrite a newly claimed generation when an earlier enqueue reports a failure', async () => {
        const { markDerivedMetricsDirtyAndMaybeQueue } = await import('./derived-metrics.service');
        let coordinatorReadCount = 0;
        hoisted.transactionGet.mockImplementation(async (ref: unknown) => {
            if (ref === hoisted.coordinatorRef) {
                coordinatorReadCount += 1;
                return coordinatorReadCount === 1
                    ? {
                        exists: true,
                        data: () => ({
                            status: 'idle',
                            generation: 7,
                            dirtyMetricKinds: [],
                            updatedAtMs: Date.now(),
                        }),
                    }
                    : {
                        exists: true,
                        data: () => ({
                            status: 'processing',
                            generation: 8,
                            dirtyMetricKinds: [],
                            updatedAtMs: Date.now(),
                        }),
                    };
            }
            if (ref === hoisted.userRootRef) {
                return { exists: true, data: () => ({}) };
            }
            if (ref === hoisted.tombstoneRef) {
                return { exists: false, data: () => undefined };
            }
            return { exists: false, data: () => undefined };
        });
        hoisted.enqueueDerivedMetricsTask.mockRejectedValueOnce(new Error('transient task queue error'));

        await expect(markDerivedMetricsDirtyAndMaybeQueue(
            'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            [DERIVED_METRIC_KINDS.TrainingBuildComparison],
        )).resolves.toEqual({
            accepted: false,
            queued: false,
            generation: 8,
            metricKinds: [DERIVED_METRIC_KINDS.TrainingBuildComparison],
        });

        expect(hoisted.transactionSet).toHaveBeenCalledTimes(1);
        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            hoisted.coordinatorRef,
            expect.objectContaining({
                status: 'queued',
                generation: 8,
            }),
            { merge: true },
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
