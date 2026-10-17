import { APPROVED_REMAINING_SPORT_CASES, APPROVED_OTHER_TRAINING_NAMES } from '../../../shared/testing/training-remaining-sport-cases';
import { APPROVED_WATER_TEAM_SPORT_CASES } from '../../../shared/testing/training-water-team-cases';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DERIVED_FORM_PAYLOAD_VERSION,
    DERIVED_METRIC_KINDS,
    DERIVED_METRIC_SCHEMA_VERSION,
    DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS,
    DERIVED_TRAINING_BUILD_COMPARISON_RECOVERY_VERSION,
    DERIVED_TRAINING_POWER_SYSTEMS_POLICY_VERSION,
    DERIVED_TRAINING_POWER_SYSTEMS_MAX_SNAPSHOT_BYTES,
    DERIVED_TRAINING_POWER_SYSTEMS_HISTORY_DAYS,
    DERIVED_TRAINING_POWER_SYSTEMS_WINDOW_DAYS,
} from '../../../shared/derived-metrics';
import {
    ActivityTypeGroups,
    ActivityTypes,
    ActivityTypesHelper,
    DataAscent,
    DataActivityTypes,
    DataAvgStrokeDistance,
    DataCadenceAvg,
    DataCriticalPower,
    DataDescent,
    DataDescentTime,
    DataDistance,
    DataDurabilityEvidence,
    DataDuration,
    DataFTP,
    DataFlow,
    DataGrit,
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
    DataStrokeRateAvg,
    DataJumpCount,
    DataJumpDistanceMax,
    DataSwimDistance,
    DataSwimPaceAvg,
    DataVO2Max,
    DataWeight,
    DURABILITY_PROTOCOL_VERSION,
    fitThreeDimensionalCapacityModel,
    type ThreeDimensionalCapacityFit,
} from '@sports-alliance/sports-lib';
import { getActivityTypesForGroup } from '../../../shared/activity-type-group.metadata';
import { POWER_CURVE_STAT_TYPE } from '../../../shared/power-curve';
import { resolveTrainingDisciplineFromActivityType, TRAINING_SPORT_DEFINITIONS } from '../../../shared/training-disciplines';
import { CompatibleTrainingActivityTypes as RefinedTypes } from '../../../shared/activity-type-compatibility';
import {
    HEALTH_COVERAGE_STATUSES,
    HEALTH_METRIC_IDS,
    HEALTH_NORMALIZATION_STATUSES,
    HEALTH_PROVIDERS,
    HEALTH_QUALITY_STATUSES,
    HEALTH_RECORDING_METHODS,
    HEALTH_SOURCE_RECORD_KINDS,
    HEALTH_UNITS,
    HEALTH_VALUE_ORIGINS,
    HEALTH_VALUE_TYPES,
    type HealthMetricId,
} from '../../../shared/health';
import { encodeHealthMetricSportsLibData } from '../../../shared/sports-lib-health-data';
import { MANUAL_HEALTH_SOURCE_RECORD_TYPE } from '../../../shared/manual-health';
import { attachEffectiveTrainingLoad, resolveEffectiveTrainingLoad } from '../../../shared/training-load-policy';

function healthMeasurementDoc(options: {
    id: string;
    metricId: HealthMetricId;
    value: number;
    observedAtMs: number;
    provider?: typeof HEALTH_PROVIDERS[keyof typeof HEALTH_PROVIDERS];
    accountKey?: string;
    semanticVariant?: string;
    qualifiers?: Record<string, string>;
}) {
    const isWeight = options.metricId === HEALTH_METRIC_IDS.BodyWeight;
    const unit = isWeight ? HEALTH_UNITS.Kilogram : HEALTH_UNITS.MillilitersPerKilogramPerMinute;
    return {
        id: options.id,
        data: () => ({
            kind: HEALTH_SOURCE_RECORD_KINDS.PointMeasurement,
            source: {
                provider: options.provider || HEALTH_PROVIDERS.QuantifiedSelf,
                accountKey: options.accountKey || 'opaque-account',
                sourceRecordType: MANUAL_HEALTH_SOURCE_RECORD_TYPE,
            },
            endTimeMs: options.observedAtMs,
            metrics: [encodeHealthMetricSportsLibData({
                kind: 'value',
                metricId: options.metricId,
                valueType: HEALTH_VALUE_TYPES.Number,
                aggregation: 'measurement',
                semanticVariant: options.semanticVariant || 'point',
                origin: HEALTH_VALUE_ORIGINS.Recorded,
                recordingMethod: options.provider
                    ? HEALTH_RECORDING_METHODS.Device
                    : HEALTH_RECORDING_METHODS.Manual,
                quality: { status: HEALTH_QUALITY_STATUSES.Valid },
                coverage: { status: HEALTH_COVERAGE_STATUSES.Complete },
                normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
                native: {
                    metric: isWeight ? DataWeight.type : DataVO2Max.type,
                    value: options.value,
                    unit,
                    qualifiers: options.qualifiers,
                },
                canonical: { value: options.value, unit },
            })],
        }),
    };
}

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
        get: vi.fn(),
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
    const loggerInfo = vi.fn();
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
        loggerInfo,
        loggerWarn,
        enqueueDerivedMetricsTask,
    };
});

vi.mock('../training-load/training-load-cache', async importOriginal => ({ ...await importOriginal<any>(),
    readTrainingLoadSummaries: vi.fn(async () => new Map()),
}));

vi.mock('firebase-admin', () => ({
    firestore: vi.fn(() => hoisted.firestoreInstance),
}));

vi.mock('firebase-functions/logger', () => ({
    info: hoisted.loggerInfo,
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

describe('fetchDerivedFormSnapshotSeed', () => {
    const dayMs = Date.UTC(2026, 8, 14);
    const valid = () => ({ entryType: 'snapshot', metricKind: DERIVED_METRIC_KINDS.Form,
        status: 'ready', schemaVersion: DERIVED_METRIC_SCHEMA_VERSION, builtFromEventMutationVersion: 7,
        sourceEventCount: 1, sourceDocCount: 2, payload: { payloadVersion: DERIVED_FORM_PAYLOAD_VERSION,
            dayBoundary: 'UTC', excludesMergedEvents: true,
            rangeStartDayMs: dayMs, rangeEndDayMs: dayMs,
            dailyLoads: [{ dayMs, load: 50, activityCount: 1 }] } });
    beforeEach(() => vi.clearAllMocks());
    async function read(data: unknown) {
        const { fetchDerivedFormSnapshotSeed } = await import('./derived-metrics.service');
        hoisted.coordinatorRef.get.mockResolvedValue({ data: () => data });
        return fetchDerivedFormSnapshotSeed('user-1');
    }
    it('accepts canonical loads and genuine zero-load histories', async () => {
        expect(await read(valid())).toMatchObject({
            dailyLoads: [{ dayMs, load: 50, activityCount: 1 }],
            sourceEventCount: 1,
        });
        const zero = valid(); zero.payload.dailyLoads[0].load = 0;
        expect(await read(zero)).toMatchObject({
            dailyLoads: [{ dayMs, load: 0, activityCount: 1 }],
            sourceEventCount: 1,
        });
        const empty = valid(); empty.sourceEventCount = 0;
        Object.assign(empty.payload, { dailyLoads: [], rangeStartDayMs: null, rangeEndDayMs: null });
        expect(await read(empty)).toMatchObject({ dailyLoads: [], sourceEventCount: 0, sourceDocCount: 2 });
    });
    it.each([
        { payload: null }, { payload: { ...valid().payload, dailyLoads: undefined } },
        { payload: { ...valid().payload, payloadVersion: 1 } },
        { payload: { ...valid().payload, dailyLoads: [{ dayMs, load: Number.NaN, activityCount: 1 }] } },
        { payload: { ...valid().payload, dailyLoads: [{ dayMs, load: -1, activityCount: 1 }] } },
        { payload: { ...valid().payload, dailyLoads: [{ dayMs, load: 50 }] } },
        { payload: { ...valid().payload, dailyLoads: [{ dayMs, load: 50, activityCount: 2 }] } },
        { payload: { ...valid().payload, rangeStartDayMs: dayMs + 1, rangeEndDayMs: dayMs + 1,
            dailyLoads: [{ dayMs: dayMs + 1, load: 50, activityCount: 1 }] } },
        { payload: { ...valid().payload, rangeStartDayMs: -86_400_000, rangeEndDayMs: -86_400_000,
            dailyLoads: [{ dayMs: -86_400_000, load: 50, activityCount: 1 }] } },
        { sourceEventCount: 2, payload: { ...valid().payload,
            dailyLoads: [{ dayMs, load: 20, activityCount: 1 }, { dayMs, load: 30, activityCount: 1 }] } },
        { sourceEventCount: 2, payload: { ...valid().payload, rangeStartDayMs: dayMs + 86_400_000,
            dailyLoads: [{ dayMs: dayMs + 86_400_000, load: 20, activityCount: 1 },
                { dayMs, load: 30, activityCount: 1 }] } },
        { payload: { ...valid().payload, rangeEndDayMs: dayMs - 86_400_000 } },
        { payload: { ...valid().payload, dailyLoads: [], rangeStartDayMs: null, rangeEndDayMs: null } },
        { sourceDocCount: 0 }, { sourceEventCount: undefined },
        { schemaVersion: DERIVED_METRIC_SCHEMA_VERSION + 1 },
    ])('rejects incomplete/incompatible Form inputs rather than silently normalizing them: %j', async patch => {
        expect(await read({ ...valid(), ...patch })).toBeNull();
    });
});

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

    it('logs expected empty lookback results at info level', async () => {
        const { fetchRecoveryLookbackEventDocs } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 3, 7, 10, 0, 0);
        const expectedLookbackStartMs = nowMs - (DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS * 1000);
        hoisted.get.mockResolvedValueOnce({ docs: [] });

        await fetchRecoveryLookbackEventDocs('user-1', nowMs);

        expect(hoisted.loggerInfo).toHaveBeenCalledWith(
            '[derived-metrics] Recovery lookback query returned no event docs.',
            {
                uid: 'user-1',
                lookbackStartMs: expectedLookbackStartMs,
                lookbackWindowSeconds: DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS,
            },
        );
        expect(hoisted.loggerWarn).not.toHaveBeenCalled();
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

describe('fetchTrainingBuildSleepDocs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const query = { where: hoisted.where, select: hoisted.select };
        hoisted.where.mockReturnValue(query);
        hoisted.select.mockReturnValue({ get: hoisted.get });
        hoisted.get
            .mockResolvedValueOnce({ docs: [{ id: 'historical-sleep', data: () => ({}) }] })
            .mockResolvedValueOnce({ docs: [{ id: 'recent-sleep', data: () => ({}) }] });
    });

    it.each(['period', 'event'] as const)('reused %s benchmark windows issue exactly the full-build sleep queries', async mode => {
        const { fetchTrainingBuildSleepDocs, buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 5, 30, 12);
        const activities = buildTrainingActivitySources([{ id: 'anchor', data: () => ({ startDate: Date.UTC(2026, 0, 1, 8),
            stats: { [DataActivityTypes.type]: [ActivityTypes.Running] } }) }]);
        const settings = { trainingSettings: { buildBenchmarks: { running: mode === 'period'
            ? { mode, durationWeeks: 8, endDayMs: Date.UTC(2026, 2, 1) }
            : { mode, durationWeeks: 8, eventId: 'anchor' } } } };
        await fetchTrainingBuildSleepDocs('user-1', activities, settings, nowMs);
        const queries = [...hoisted.where.mock.calls];
        expect(queries).toHaveLength(4);
        hoisted.where.mockClear();
        hoisted.get.mockResolvedValue({ docs: [] });
        const result = buildTrainingBuildComparisonMetricPayload(activities, settings, nowMs);
        await fetchTrainingBuildSleepDocs('user-1', [], settings, nowMs, { ...result, metadata: {} } as any);
        expect(hoisted.where.mock.calls).toEqual(queries);
    });

    it('queries only the merged recent and configured benchmark sleep-date ranges', async () => {
        const { fetchTrainingBuildSleepDocs } = await import('./derived-metrics.service');
        const docs = await fetchTrainingBuildSleepDocs(
            'user-1',
            [],
            {
                trainingSettings: {
                    buildBenchmarks: {
                        running: { mode: 'period', durationWeeks: 8, endDayMs: Date.UTC(2026, 2, 1) },
                    },
                },
            },
            Date.UTC(2026, 5, 30, 12),
        );

        expect(hoisted.where.mock.calls).toEqual([
            ['sleepDate', '>=', '2026-01-05'],
            ['sleepDate', '<=', '2026-03-01'],
            ['sleepDate', '>=', '2026-03-11'],
            ['sleepDate', '<=', '2026-06-30'],
        ]);
        expect(hoisted.select).toHaveBeenCalledTimes(2);
        expect(hoisted.select).toHaveBeenCalledWith(
            'source.provider',
            'source.providerUserId',
            'sleepDate',
            'startTimeMs',
            'endTimeMs',
            'timezoneOffsetSeconds',
            'durationSeconds',
            'sportsLibData.schemaVersion',
            'sportsLibData.metrics.duration',
            'sportsLibData.metrics.overnightHrv',
            'sportsLibData.metrics.averageHrv',
            'sportsLibData.metrics.hrvSampleCount',
            'isNap',
            'providerFields.suunto.timestamp',
            'providerFields.suunto.SleepOnsetLatencyDuration',
            'vitals.overnightHrvMs',
            'vitals.averageHrvMs',
        );
        expect(docs.map(doc => doc.id)).toEqual(['historical-sleep', 'recent-sleep']);
    });

    it('resolves event-anchored sleep ranges from the selected sport activity without a full metric prebuild', async () => {
        const { fetchTrainingBuildSleepDocs, joinTrainingActivitySources } = await import('./derived-metrics.service');
        const raceStartMs = Date.UTC(2026, 0, 1, 8);
        const activities = joinTrainingActivitySources(
            [{
                id: 'winter-bike',
                data: () => ({
                    eventID: 'winter-event',
                    startDate: raceStartMs,
                    type: ActivityTypes.Cycling,
                    stats: {},
                }),
            }] as any,
            [{
                id: 'winter-event',
                data: () => ({ startDate: raceStartMs, name: 'Winter event' }),
            }] as any,
        );
        await fetchTrainingBuildSleepDocs(
            'user-1',
            activities,
            {
                trainingSettings: {
                    buildBenchmarks: {
                        cycling: { mode: 'event', durationWeeks: 8, eventId: 'winter-event' },
                    },
                },
            },
            Date.UTC(2026, 5, 30, 12),
        );

        expect(hoisted.where.mock.calls).toEqual([
            ['sleepDate', '>=', '2025-11-06'],
            ['sleepDate', '<=', '2025-12-31'],
            ['sleepDate', '>=', '2026-03-11'],
            ['sleepDate', '<=', '2026-06-30'],
        ]);
    });
});

describe('fetchTrainingReadinessSleepDocs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const query = { where: hoisted.where, select: hoisted.select };
        hoisted.where.mockReturnValue(query);
        hoisted.select.mockReturnValue({ get: hoisted.get });
        hoisted.get.mockResolvedValue({ docs: [{ id: 'readiness-sleep', data: () => ({}) }] });
    });

    it('queries the bounded sleep envelope required by every historical cutoff without loading events or activities', async () => {
        const { fetchTrainingReadinessSleepDocs } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 16, 12);
        const firstHistoryCutoffMs = Date.UTC(2026, 6, 3) + (24 * 60 * 60 * 1000) - 1;
        const docs = await fetchTrainingReadinessSleepDocs('user-1', nowMs);

        expect(hoisted.where.mock.calls).toEqual([
            ['endTimeMs', '>=', firstHistoryCutoffMs - (60 * 24 * 60 * 60 * 1000)],
            ['endTimeMs', '<=', nowMs],
        ]);
        expect(hoisted.select).toHaveBeenCalledWith(
            'source.provider',
            'source.providerUserId',
            'sleepDate',
            'startTimeMs',
            'endTimeMs',
            'timezoneOffsetSeconds',
            'durationSeconds',
            'sportsLibData.schemaVersion',
            'sportsLibData.metrics.duration',
            'sportsLibData.metrics.score',
            'sportsLibData.metrics.overnightHrv',
            'sportsLibData.metrics.averageHrv',
            'sportsLibData.metrics.hrvSampleCount',
            'sportsLibData.metrics.averageHeartRate',
            'sportsLibData.metrics.minimumHeartRate',
            'isNap',
            'score.value',
            'providerFields.suunto.timestamp',
            'providerFields.suunto.SleepOnsetLatencyDuration',
            'vitals.overnightHrvMs',
            'vitals.averageHrvMs',
            'vitals.averageHeartRateBpm',
            'vitals.minimumHeartRateBpm',
        );
        expect(docs.map(doc => doc.id)).toEqual(['readiness-sleep']);
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
            needsTrainingActivityDocs: true,
            needsTrainingSwimLengths: false,
            needsTrainingBuildBenchmarkSettings: false,
            needsTrainingBuildSleepDocs: false,
            needsTrainingReadinessSleepDocs: false,
            needsBodyWeightHealthDocs: false,
            needsVo2HealthDocs: false,
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
            needsTrainingBuildSleepDocs: false,
            needsTrainingReadinessSleepDocs: false,
            needsBodyWeightHealthDocs: false,
            needsVo2HealthDocs: false,
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
            needsTrainingBuildSleepDocs: false,
            needsTrainingReadinessSleepDocs: false,
            needsBodyWeightHealthDocs: false,
            needsVo2HealthDocs: false,
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
            needsTrainingBuildSleepDocs: false,
            needsTrainingReadinessSleepDocs: false,
            needsBodyWeightHealthDocs: false,
            needsVo2HealthDocs: true,
        });
    });

    it('uses parent events and every canonical child activity for the power-systems snapshot', async () => {
        const { resolveDerivedMetricSourceRequirements } = await import('./derived-metrics.service');

        expect(resolveDerivedMetricSourceRequirements([DERIVED_METRIC_KINDS.TrainingPowerSystems])).toEqual({
            needsFormDocs: true,
            needsRecoveryNowDocs: false,
            needsTrainingActivityDocs: true,
            needsTrainingSwimLengths: false,
            needsTrainingBuildBenchmarkSettings: false,
            needsTrainingBuildSleepDocs: false,
            needsTrainingReadinessSleepDocs: false,
            needsBodyWeightHealthDocs: false,
            needsVo2HealthDocs: false,
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
            needsTrainingBuildSleepDocs: false,
            needsTrainingReadinessSleepDocs: false,
            needsBodyWeightHealthDocs: false,
            needsVo2HealthDocs: false,
        });
    });

    it('uses parent events and child activities for training explanation and durability', async () => {
        const { resolveDerivedMetricSourceRequirements } = await import('./derived-metrics.service');

        for (const metricKind of [
            DERIVED_METRIC_KINDS.TrainingExplanation,
            DERIVED_METRIC_KINDS.TrainingDurability,
        ]) {
            expect(resolveDerivedMetricSourceRequirements([metricKind])).toEqual({
                needsFormDocs: true,
                needsRecoveryNowDocs: false,
                needsTrainingActivityDocs: true,
                needsTrainingSwimLengths: false,
                needsTrainingBuildBenchmarkSettings: false,
                needsTrainingBuildSleepDocs: false,
                needsTrainingReadinessSleepDocs: false,
                needsBodyWeightHealthDocs: false,
                needsVo2HealthDocs: false,
            });
        }
    });

    it('fetches settings only for the training build comparison snapshot', async () => {
        const { resolveDerivedMetricSourceRequirements } = await import('./derived-metrics.service');

        expect(resolveDerivedMetricSourceRequirements([DERIVED_METRIC_KINDS.TrainingBuildComparison])).toEqual({
            needsFormDocs: true,
            needsRecoveryNowDocs: false,
            needsTrainingActivityDocs: true,
            needsTrainingSwimLengths: false,
            needsTrainingBuildBenchmarkSettings: true,
            needsTrainingBuildSleepDocs: true,
            needsTrainingReadinessSleepDocs: false,
            needsBodyWeightHealthDocs: false,
            needsVo2HealthDocs: false,
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
            needsTrainingBuildSleepDocs: false,
            needsTrainingReadinessSleepDocs: false,
            needsBodyWeightHealthDocs: false,
            needsVo2HealthDocs: false,
        });
    });

    it('uses only form state and a bounded sleep source for readiness history', async () => {
        const { resolveDerivedMetricSourceRequirements } = await import('./derived-metrics.service');

        expect(resolveDerivedMetricSourceRequirements([DERIVED_METRIC_KINDS.TrainingReadiness])).toEqual({
            needsFormDocs: true,
            needsRecoveryNowDocs: false,
            needsTrainingActivityDocs: false,
            needsTrainingSwimLengths: false,
            needsTrainingBuildBenchmarkSettings: false,
            needsTrainingBuildSleepDocs: false,
            needsTrainingReadinessSleepDocs: true,
            needsBodyWeightHealthDocs: false,
            needsVo2HealthDocs: false,
        });
    });

    it('uses Health Weight plus workout fallback inputs for the body-weight trend', async () => {
        const { resolveDerivedMetricSourceRequirements } = await import('./derived-metrics.service');

        expect(resolveDerivedMetricSourceRequirements([DERIVED_METRIC_KINDS.BodyWeightTrend])).toEqual({
            needsFormDocs: true,
            needsRecoveryNowDocs: false,
            needsTrainingActivityDocs: false,
            needsTrainingSwimLengths: false,
            needsTrainingBuildBenchmarkSettings: false,
            needsTrainingBuildSleepDocs: false,
            needsTrainingReadinessSleepDocs: false,
            needsBodyWeightHealthDocs: true,
            needsVo2HealthDocs: false,
        });
    });
});

describe('buildBodyWeightTrendMetricPayload', () => {
    it('prefers true Health measurements globally and keeps their sources separate', async () => {
        const { buildBodyWeightTrendMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 16, 12);
        const workoutDocs = [{
            id: 'workout',
            data: () => ({
                startDate: nowMs,
                serviceName: 'Garmin',
                stats: { [DataWeight.type]: 99 },
            }),
        }];
        const healthDocs = [
            healthMeasurementDoc({
                id: 'manual', metricId: HEALTH_METRIC_IDS.BodyWeight, value: 70,
                observedAtMs: nowMs, accountKey: 'manual-account',
            }),
            healthMeasurementDoc({
                id: 'garmin', metricId: HEALTH_METRIC_IDS.BodyWeight, value: 71,
                observedAtMs: nowMs - 86_400_000, provider: HEALTH_PROVIDERS.GarminAPI,
                accountKey: 'garmin-account',
            }),
        ];

        const result = buildBodyWeightTrendMetricPayload(workoutDocs as any, nowMs, healthDocs as any);

        expect(result.sourceEventCount).toBe(2);
        expect(result.payload.series).toHaveLength(2);
        expect(result.payload.series.map(series => series.sourceKind)).toEqual([
            'health-measurement',
            'health-measurement',
        ]);
        expect(result.payload.series.map(series => series.provider)).toEqual([
            HEALTH_PROVIDERS.GarminAPI,
            HEALTH_PROVIDERS.QuantifiedSelf,
        ]);
        expect(result.payload.series.flatMap(series => [
            series.latestWeightKg,
            ...series.points.map(point => point.weightKg),
        ])).not.toContain(99);
        expect(result.payload.latestWeightKg).toBeNull();
        expect(result.payload.points.every(point => point.weightKg === null)).toBe(true);
    });

    it('suppresses recent workout Weight when an older Health measurement exists', async () => {
        const { buildBodyWeightTrendMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 16, 12);
        const workoutDocs = [{
            id: 'workout',
            data: () => ({
                startDate: nowMs,
                serviceName: 'Garmin',
                stats: { [DataWeight.type]: 99 },
            }),
        }];

        const result = buildBodyWeightTrendMetricPayload(workoutDocs as any, nowMs, [], true);

        expect(result.sourceEventCount).toBe(0);
        expect(result.payload.series).toEqual([]);
        expect(result.payload.latestWeightKg).toBeNull();
    });

    it('builds daily medians, leaves gaps explicit, and withholds sparse comparison claims', async () => {
        const { buildBodyWeightTrendMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 16, 12);
        const weightDoc = (id: string, dayOffset: number, weightKg: unknown) => ({
            id,
            data: () => ({
                startDate: nowMs + (dayOffset * 24 * 60 * 60 * 1000),
                stats: { [DataWeight.type]: weightKg },
            }),
        });

        const result = buildBodyWeightTrendMetricPayload([
            weightDoc('today-a', 0, 70.4),
            weightDoc('today-b', 0, 70.8),
            weightDoc('one-day', -1, 70.7),
            weightDoc('two-days', -2, 70.6),
            weightDoc('previous-one', -8, 71.2),
            weightDoc('previous-two', -9, 71.1),
            weightDoc('invalid-weight', -3, -20),
            weightDoc('future-weight', 1, 65),
        ] as any, nowMs);

        expect(result.sourceEventCount).toBe(6);
        expect(result.payload).toMatchObject({
            dayBoundary: 'UTC',
            asOfDayMs: Date.UTC(2026, 6, 16),
            trendDays: 28,
            comparisonWindowDays: 7,
            minimumComparableDayCount: 3,
            latestWeightKg: 70.6,
            latestWeightDayMs: Date.UTC(2026, 6, 16),
            median7dKg: 70.6,
            recordedDayCount7d: 3,
            recordedDayCount28d: 5,
            change7dKg: null,
            change28dKg: null,
        });
        expect(result.payload.points).toHaveLength(28);
        expect(result.payload.points.at(-1)).toEqual({ dayMs: Date.UTC(2026, 6, 16), weightKg: 70.6 });
        expect(result.payload.points.find(point => point.dayMs === Date.UTC(2026, 6, 13))).toEqual({
            dayMs: Date.UTC(2026, 6, 13),
            weightKg: null,
        });
    });

    it('compares like-for-like rolling medians when both windows have enough recorded days', async () => {
        const { buildBodyWeightTrendMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 16, 12);
        const dayMs = 24 * 60 * 60 * 1000;
        const docs = [0, -1, -2].flatMap((offset) => [
            {
                id: `current-${offset}`,
                data: () => ({
                    startDate: nowMs + (offset * dayMs),
                    stats: { [DataWeight.type]: 70 },
                }),
            },
            {
                id: `previous-${offset}`,
                data: () => ({
                    startDate: nowMs + ((offset - 7) * dayMs),
                    stats: { [DataWeight.type]: 71 },
                }),
            },
            {
                id: `previous-month-${offset}`,
                data: () => ({
                    startDate: nowMs + ((offset - 28) * dayMs),
                    stats: { [DataWeight.type]: 72 },
                }),
            },
        ]);

        const result = buildBodyWeightTrendMetricPayload(docs as any, nowMs);

        expect(result.payload).toMatchObject({
            median7dKg: 70,
            median28dKg: 70.5,
            change7dKg: -1,
            change7dPercent: -1.41,
            change28dKg: -1.5,
            change28dPercent: -2.08,
        });
    });
});

describe('buildTrainingReadinessMetricPayload', () => {
    it('builds a true 14-day series with per-day evidence cutoffs and the shared readiness formula', async () => {
        const { buildTrainingReadinessMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 16, 12);
        const sleepDoc = (
            id: string,
            dayMs: number,
            values: {
                score: number;
                hrv: number;
                averageHeartRate: number;
                minimumHeartRate: number;
                isNap?: boolean;
            },
        ) => ({
            id,
            data: () => ({
                source: { provider: 'GarminAPI' },
                sleepDate: new Date(dayMs).toISOString().slice(0, 10),
                startTimeMs: dayMs - (2 * 60 * 60 * 1000),
                endTimeMs: dayMs + (6 * 60 * 60 * 1000),
                durationSeconds: 8 * 60 * 60,
                isNap: values.isNap === true,
                score: { value: values.score },
                vitals: {
                    averageHrvMs: values.hrv,
                    averageHeartRateBpm: values.averageHeartRate,
                    minimumHeartRateBpm: values.minimumHeartRate,
                },
            }),
        });
        const baselineDocs = Array.from({ length: 5 }, (_, index) => sleepDoc(
            `baseline-${index}`,
            Date.UTC(2026, 6, 1 + index),
            { score: 80, hrv: 50, averageHeartRate: 60, minimumHeartRate: 50 },
        ));
        const docs = [
            ...baselineDocs,
            sleepDoc('latest', Date.UTC(2026, 6, 16), {
                score: 90, hrv: 55, averageHeartRate: 54, minimumHeartRate: 48,
            }),
            sleepDoc('future', Date.UTC(2026, 6, 17), {
                score: 100, hrv: 80, averageHeartRate: 45, minimumHeartRate: 40,
            }),
            sleepDoc('nap', Date.UTC(2026, 6, 16), {
                score: 100,
                hrv: 100,
                averageHeartRate: 40,
                minimumHeartRate: 35,
                isNap: true,
            }),
        ];

        const result = buildTrainingReadinessMetricPayload([], 0, docs as any, nowMs);
        const today = result.payload.points[result.payload.points.length - 1];
        const staleDay = result.payload.points.find(point => point.dayMs === Date.UTC(2026, 6, 13));

        expect(result.payload).toMatchObject({
            formulaVersion: 4,
            evidenceVersion: 4,
            dayBoundary: 'UTC',
            asOfDayMs: Date.UTC(2026, 6, 16),
            generatedAtMs: nowMs,
            historyDays: 14,
        });
        expect(result.payload.points).toHaveLength(14);
        expect(staleDay).toMatchObject({ score: null, availableSignalCount: 0 });
        expect(today).toMatchObject({
            score: 78,
            label: 'Ready',
            confidence: 'low',
            availableSignalCount: 2,
            baselineEvidenceCount: 5,
            latestSleepAtMs: Date.UTC(2026, 6, 16, 6),
            sleepScore: 90,
            hrvRatio: null,
            averageHeartRateRatio: 0.9,
            minimumHeartRateRatio: 0.96,
        });
        expect(today?.overnightHeartRateRatio).toBeCloseTo(0.918);
    });

    it('reconciles adjacent Suunto fragments into one sample-weighted current night', async () => {
        const { buildTrainingReadinessMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 8, 28, 12);
        const dayMs = 24 * 60 * 60 * 1000;
        const buildDoc = (id: string, sleepDate: string, startTimeMs: number, endTimeMs: number,
            hrv: number, hrvSampleCount = 35) => ({
            id,
            data: () => ({
                source: { provider: 'SuuntoApp', providerUserId: 'suunto-user', sourceSessionKey: id },
                sleepDate,
                startTimeMs,
                endTimeMs,
                durationSeconds: Math.round((endTimeMs - startTimeMs) / 1000),
                timezoneOffsetSeconds: 3 * 60 * 60,
                isNap: false,
                score: { value: 80 },
                vitals: { averageHrvMs: hrv, hrvSampleCount },
            }),
        });
        const baseline = Array.from({ length: 15 }, (_, index) => {
            const endTimeMs = nowMs - (15 - index) * dayMs - (4 * 60 * 60 * 1000);
            return buildDoc(`baseline-${index}`, new Date(endTimeMs).toISOString().slice(0, 10),
                endTimeMs - (8 * 60 * 60 * 1000), endTimeMs, 34);
        });
        const sleepDate = '2026-09-28';
        const fragments = [
            buildDoc('part-1', sleepDate, Date.UTC(2026, 8, 27, 18, 57), Date.UTC(2026, 8, 27, 23, 54), 29, 46),
            buildDoc('part-2', sleepDate, Date.UTC(2026, 8, 28, 0, 1), Date.UTC(2026, 8, 28, 4), 40),
        ];

        const today = buildTrainingReadinessMetricPayload([], 0, [...baseline, ...fragments] as any, nowMs)
            .payload.points.at(-1);

        expect(today).toMatchObject({ sleepScore: 80, availableSignalCount: 2 });
        expect(today?.hrvPersonalRange?.latestMs).toBeCloseTo(((29 * 46) + (40 * 35)) / 81);
        expect(today?.hrvRatio).toBeCloseTo(1);
    });

    it('uses Suunto sleep onset when enforcing the fragment gap boundary', async () => {
        const { buildTrainingReadinessMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 8, 28, 12);
        const source = { provider: 'SuuntoApp', providerUserId: 'suunto-user' };
        const baseline = Array.from({ length: 5 }, (_, index) => {
            const endTimeMs = nowMs - ((index + 2) * 24 * 60 * 60 * 1000);
            return { id: `baseline-${index}`, data: () => ({
                source: { ...source, sourceSessionKey: `baseline-${index}` },
                sleepDate: new Date(endTimeMs).toISOString().slice(0, 10),
                startTimeMs: endTimeMs - (8 * 60 * 60 * 1000),
                endTimeMs,
                durationSeconds: 8 * 60 * 60,
                timezoneOffsetSeconds: 0,
                isNap: false,
                score: { value: 80 },
                vitals: { averageHeartRateBpm: 60 },
            }) };
        });
        const firstEndTimeMs = Date.UTC(2026, 8, 28, 0);
        const docs = [
            ...baseline,
            { id: 'part-1', data: () => ({
                source: { ...source, sourceSessionKey: 'part-1' },
                sleepDate: '2026-09-28',
                startTimeMs: firstEndTimeMs - (4 * 60 * 60 * 1000),
                endTimeMs: firstEndTimeMs,
                durationSeconds: 4 * 60 * 60,
                timezoneOffsetSeconds: 0,
                isNap: false,
                score: { value: 70 },
                vitals: { averageHeartRateBpm: 50 },
            }) },
            { id: 'part-2', data: () => ({
                source: { ...source, sourceSessionKey: 'part-2' },
                sleepDate: '2026-09-28',
                startTimeMs: firstEndTimeMs + (25 * 60 * 1000),
                endTimeMs: firstEndTimeMs + (4 * 60 * 60 * 1000),
                durationSeconds: 3 * 60 * 60,
                timezoneOffsetSeconds: 0,
                isNap: false,
                score: { value: 82 },
                providerFields: { suunto: { SleepOnsetLatencyDuration: 10 * 60 } },
                vitals: { averageHeartRateBpm: 70 },
            }) },
        ];

        const today = buildTrainingReadinessMetricPayload([], 0, docs as any, nowMs).payload.points.at(-1);

        expect(today).toMatchObject({ sleepScore: 82, latestSleepAtMs: firstEndTimeMs + (4 * 60 * 60 * 1000) });
        expect(today?.averageHeartRateRatio).toBeCloseTo(70 / 60);
    });

    it('withholds current HRV when the latest sleep has expired', async () => {
        const { buildTrainingReadinessMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 8, 13, 12);
        const docs = Array.from({ length: 60 }, (_, index) => {
            const endTimeMs = nowMs - (index + 3) * 86400000;
            return { id: `night-${index}`, data: () => ({ source: { provider: 'SuuntoApp' },
                sleepDate: new Date(endTimeMs).toISOString().slice(0, 10), endTimeMs,
                startTimeMs: endTimeMs - 28800000, durationSeconds: 28800, isNap: false,
                vitals: { averageHrvMs: 40 } }) };
        });
        const { payload } = buildTrainingReadinessMetricPayload([], 0, docs as any, nowMs);
        expect(payload.points[payload.points.length - 1]).toMatchObject({ score: null, availableSignalCount: 0,
            latestSleepAtMs: null, hrvPersonalRange: null, hrvRatio: null });
        expect(payload.legacyPoints![payload.legacyPoints!.length - 1]).toMatchObject({ score: null,
            label: null, confidence: null, availableSignalCount: 0, hrvRatio: null });
    });

    it('produces the same readiness evidence from legacy and new-only Sports Lib sleep aggregates', async () => {
        const { buildTrainingReadinessMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 16, 12);
        const common = {
            source: { provider: 'GarminAPI' },
            sleepDate: '2026-07-16',
            startTimeMs: Date.UTC(2026, 6, 15, 22),
            endTimeMs: Date.UTC(2026, 6, 16, 6),
            isNap: false,
        };
        const legacy = {
            id: 'same-night',
            data: () => ({
                ...common,
                durationSeconds: 28_800,
                score: { value: 90 },
                vitals: {
                    averageHrvMs: 55,
                    averageHeartRateBpm: 54,
                    minimumHeartRateBpm: 48,
                },
            }),
        };
        const newOnly = {
            id: 'same-night',
            data: () => ({
                ...common,
                sportsLibData: {
                    schemaVersion: 1,
                    metrics: {
                        duration: { 'Sleep Duration': 28_800 },
                        score: { 'Sleep Score': 90 },
                        averageHrv: { 'Average Sleep HRV': 55 },
                        averageHeartRate: { 'Average Sleep Heart Rate': 54 },
                        minimumHeartRate: { 'Minimum Sleep Heart Rate': 48 },
                    },
                },
            }),
        };

        const legacyDocs = [legacy] as unknown as Parameters<typeof buildTrainingReadinessMetricPayload>[2];
        const newDocs = [newOnly] as unknown as Parameters<typeof buildTrainingReadinessMetricPayload>[2];
        const legacyResult = buildTrainingReadinessMetricPayload([], 0, legacyDocs, nowMs);
        const newResult = buildTrainingReadinessMetricPayload([], 0, newDocs, nowMs);

        expect(newResult).toEqual(legacyResult);
    });

    it('ignores a malformed Sports Lib sleep envelope instead of failing readiness recomputation', async () => {
        const { buildTrainingReadinessMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 16, 12);
        const malformed = {
            id: 'malformed-sleep',
            data: () => ({
                source: { provider: 'GarminAPI' },
                sleepDate: '2026-07-16',
                startTimeMs: Date.UTC(2026, 6, 15, 22),
                endTimeMs: Date.UTC(2026, 6, 16, 6),
                durationSeconds: 28_800,
                isNap: false,
                sportsLibData: {
                    schemaVersion: 1,
                    metrics: { duration: { 'Sleep Duration': Number.NaN } },
                },
            }),
        };
        const malformedDocs = [malformed] as unknown as Parameters<typeof buildTrainingReadinessMetricPayload>[2];

        expect(buildTrainingReadinessMetricPayload([], 0, malformedDocs, nowMs)).toEqual(
            buildTrainingReadinessMetricPayload([], 0, [], nowMs),
        );
    });

    it('matches live Suunto local-date grouping before choosing readiness baselines', async () => {
        const { buildTrainingReadinessMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 16, 12);
        const docs = Array.from({ length: 3 }, (_, index) => ({
            id: `suunto-part-${index}`,
            data: () => ({
                source: { provider: 'SuuntoApp' },
                sleepDate: `2026-07-${13 + index}`,
                startTimeMs: Date.UTC(2026, 6, 16, 0 + index),
                endTimeMs: Date.UTC(2026, 6, 16, 1 + index),
                timezoneOffsetSeconds: 2 * 60 * 60,
                durationSeconds: 60 * 60,
                isNap: false,
                score: { value: 80 + index },
                vitals: { averageHrvMs: 50 + index, minimumHeartRateBpm: 48 - index },
            }),
        }));

        const result = buildTrainingReadinessMetricPayload([], 0, docs as any, nowMs);
        const today = result.payload.points.at(-1);

        expect(today).toMatchObject({
            sleepScore: 82,
            availableSignalCount: 1,
            confidence: 'low',
            hrvPersonalRange: null,
            hrvRatio: null,
            averageHeartRateRatio: null,
            minimumHeartRateRatio: null,
            overnightHeartRateRatio: null,
        });
    });

    it('selects tied same-night records deterministically', async () => {
        const { buildTrainingReadinessMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 16, 12);
        const sleepDoc = (id: string, score: number) => ({
            id,
            data: () => ({
                source: { provider: 'GarminAPI' },
                sleepDate: '2026-07-16',
                startTimeMs: Date.UTC(2026, 6, 15, 22),
                endTimeMs: Date.UTC(2026, 6, 16, 6),
                durationSeconds: 8 * 60 * 60,
                isNap: false,
                score: { value: score },
                vitals: {},
            }),
        });

        const forward = buildTrainingReadinessMetricPayload(
            [], 0, [sleepDoc('alpha', 70), sleepDoc('zulu', 90)] as any, nowMs,
        );
        const reverse = buildTrainingReadinessMetricPayload(
            [], 0, [sleepDoc('zulu', 90), sleepDoc('alpha', 70)] as any, nowMs,
        );

        expect(forward.payload.points.at(-1)?.sleepScore).toBe(90);
        expect(reverse.payload.points.at(-1)?.sleepScore).toBe(90);
    });

    it('matches the live missing-date fallback without accepting malformed sessions', async () => {
        const { buildTrainingReadinessMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 16, 12);
        const buildDoc = (id: string, sleepDate: string | undefined, score: number, endHour: number) => ({
            id,
            data: () => ({
                source: { provider: 'GarminAPI' },
                sleepDate,
                startTimeMs: Date.UTC(2026, 6, 15, 22),
                endTimeMs: Date.UTC(2026, 6, 16, endHour),
                durationSeconds: 8 * 60 * 60,
                isNap: false,
                score: { value: score },
                vitals: {},
            }),
        });

        const result = buildTrainingReadinessMetricPayload([], 0, [
            buildDoc('missing-date', undefined, 84, 6),
            buildDoc('invalid-date', '2026-02-31', 99, 7),
            {
                id: 'invalid-time',
                data: () => ({
                    source: { provider: 'GarminAPI' },
                    sleepDate: '2026-07-16',
                    startTimeMs: Number.MAX_SAFE_INTEGER - 1,
                    endTimeMs: Number.MAX_SAFE_INTEGER,
                    durationSeconds: 1,
                    isNap: false,
                    score: { value: 100 },
                    vitals: {},
                }),
            },
        ] as any, nowMs);

        expect(result.payload.points.at(-1)).toMatchObject({
            sleepScore: 84,
            latestSleepAtMs: Date.UTC(2026, 6, 16, 6),
        });
    });

    it('ignores invalid vitals and bounds malformed Suunto timezone offsets', async () => {
        const { buildTrainingReadinessMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 16, 12);
        const buildDoc = (
            id: string,
            offset: number,
            hrv: number,
            averageHeartRate: number,
            minimumHeartRate: number,
        ) => ({
            id,
            data: () => ({
                source: { provider: 'SuuntoApp' },
                sleepDate: '2026-07-16',
                startTimeMs: Date.UTC(2026, 6, 15, 22),
                endTimeMs: Date.UTC(2026, 6, 16, 6),
                timezoneOffsetSeconds: offset,
                durationSeconds: 4 * 60 * 60,
                isNap: false,
                score: { value: 80 },
                providerFields: { suunto: { timestamp: '2026-07-16T00:00:00+02:00' } },
                vitals: {
                    averageHrvMs: hrv,
                    averageHeartRateBpm: averageHeartRate,
                    minimumHeartRateBpm: minimumHeartRate,
                },
            }),
        });

        const result = buildTrainingReadinessMetricPayload([], 0, [
            buildDoc('invalid', Number.MAX_SAFE_INTEGER, -100, -80, -20),
            buildDoc('valid', 2 * 60 * 60, 60, 55, 44),
        ] as any, nowMs);

        expect(result.payload.points.at(-1)).toMatchObject({
            sleepScore: 80,
            hrvRatio: null,
            averageHeartRateRatio: null,
            minimumHeartRateRatio: null,
            overnightHeartRateRatio: null,
        });
    });
});

describe('buildTrainingBuildComparisonMetricPayload', () => {
    it.each(['period', 'event'] as const)('recovery-only refresh equals a full %s rebuild after sleep edits and deletes', async mode => {
        const { buildTrainingBuildComparisonMetricPayload, refreshTrainingBuildComparisonRecovery } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 5, 30, 12);
        const activities = buildTrainingActivitySources([
            { id: 'anchor', data: () => ({ startDate: Date.UTC(2026, 0, 1, 8), name: 'Winter race', tags: ['Race'],
                stats: { [DataActivityTypes.type]: [ActivityTypes.Running], [DataDuration.type]: 3600 } }) },
            { id: 'recent', data: () => ({ startDate: nowMs - 86_400_000,
                stats: { [DataActivityTypes.type]: [ActivityTypes.Running], [DataDuration.type]: 1800 } }) },
        ]);
        const settings = { trainingSettings: { buildBenchmarks: { running: mode === 'period'
            ? { mode, durationWeeks: 8, endDayMs: Date.UTC(2026, 2, 10) }
            : { mode, durationWeeks: 8, eventId: 'anchor' } } } };
        const sleep = (durationSeconds: number) => Array.from({ length: 7 }, (_, i) => ({ id: `night-${i}`, data: () => ({
            source: { provider: 'GarminAPI' }, sleepDate: `2026-06-${23 + i}`, durationSeconds, isNap: false,
            startTimeMs: Date.UTC(2026, 5, 23 + i), endTimeMs: Date.UTC(2026, 5, 23 + i, 8),
            timezoneOffsetSeconds: 0, vitals: { overnightHrvMs: 50 + i },
        }) }));
        const original = buildTrainingBuildComparisonMetricPayload(activities, settings, nowMs, sleep(25_200) as any);
        expect(original.payload.disciplines.find(d => d.discipline === 'running')?.status).toBe('ready');
        for (const docs of [sleep(28_800), sleep(28_800).slice(1), []]) {
            const refreshed = refreshTrainingBuildComparisonRecovery(original.payload, docs as any);
            expect(refreshed).toEqual(buildTrainingBuildComparisonMetricPayload(activities, settings, nowMs + 1000, docs as any).payload);
            expect(refreshed.recovery).not.toEqual(original.payload.recovery);
            expect(refreshed.disciplines[0].current).toEqual(original.payload.disciplines[0].current);
        }
    });

    it('compares trustworthy overnight recovery context without treating naps or missing nights as zero', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 5, 30, 12);
        const buildSleepDocs = (
            startDayMs: number,
            dayCount: number,
            durationSeconds: number,
            overnightHrvMs: number,
            prefix: string,
        ) => Array.from({ length: dayCount }, (_, index) => {
            const sleepDayMs = startDayMs + (index * 24 * 60 * 60 * 1000);
            const bedtimeOffsetHours = index % 2 === 0 ? 2 : 1;
            return {
                id: `${prefix}-${index}`,
                data: () => ({
                    source: { provider: 'GarminAPI' },
                    sleepDate: new Date(sleepDayMs).toISOString().slice(0, 10),
                    startTimeMs: sleepDayMs - (bedtimeOffsetHours * 60 * 60 * 1000),
                    endTimeMs: sleepDayMs + ((durationSeconds / 3600 - bedtimeOffsetHours) * 60 * 60 * 1000),
                    timezoneOffsetSeconds: 0,
                    durationSeconds,
                    isNap: false,
                    vitals: { overnightHrvMs },
                }),
            };
        });
        const sleepDocs = [
            ...buildSleepDocs(Date.UTC(2026, 0, 14), 56, 6.5 * 3600, 45, 'benchmark'),
            ...buildSleepDocs(Date.UTC(2026, 2, 11), 84, 7 * 3600, 50, 'usual'),
            ...buildSleepDocs(Date.UTC(2026, 5, 3), 28, 8 * 3600, 60, 'current'),
            {
                id: 'ignored-nap',
                data: () => ({
                    source: { provider: 'GarminAPI' },
                    sleepDate: '2026-06-30',
                    startTimeMs: Date.UTC(2026, 5, 30, 12),
                    durationSeconds: 4 * 3600,
                    isNap: true,
                    vitals: { overnightHrvMs: 100 },
                }),
            },
        ] as any;

        const result = buildTrainingBuildComparisonMetricPayload([], {
            trainingSettings: {
                buildBenchmarks: {
                    running: { mode: 'period', durationWeeks: 8, endDayMs: Date.UTC(2026, 2, 10) },
                },
            },
        }, nowMs, sleepDocs);

        expect(result.payload.recovery).toMatchObject({
            sameProvider: true,
            isComparable: true,
            current: {
                periodDays: 28,
                provider: 'GarminAPI',
                recordedNightCount: 28,
                coverage: 'sufficient',
                averageSleepSeconds: 8 * 3600,
                bedtimeVariationMinutes: 30,
                medianOvernightHrvMs: 60,
            },
            reference: {
                periodDays: 84,
                provider: 'GarminAPI',
                recordedNightCount: 84,
                coverage: 'sufficient',
                averageSleepSeconds: 7 * 3600,
                medianOvernightHrvMs: 50,
            },
        });
        expect(result.payload.recoveryVersion).toBe(DERIVED_TRAINING_BUILD_COMPARISON_RECOVERY_VERSION);
        const running = result.payload.disciplines.find(item => item.discipline === 'running');
        expect(running?.recovery).toMatchObject({
            sameProvider: true,
            isComparable: true,
            current: { periodDays: 56, averageSleepSeconds: 7.5 * 3600 },
            reference: { periodDays: 56, averageSleepSeconds: 6.5 * 3600 },
        });
        expect(result.payload.disciplines.find(item => item.discipline === 'cycling')?.recovery).toBeNull();
    });

    it('uses one canonical Suunto night for recovery duration, timing, and sample-weighted HRV', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 5, 30, 12);
        const dayMs = 24 * 60 * 60 * 1000;
        const docs = Array.from({ length: 5 }, (_, index) => {
            const sleepDayMs = Date.UTC(2026, 5, 26) + (index * dayMs);
            const source = { provider: 'SuuntoApp', providerUserId: 'suunto-user' };
            return [
                { id: `part-1-${index}`, data: () => ({
                    source: { ...source, sourceSessionKey: `part-1-${index}` },
                    sleepDate: new Date(sleepDayMs).toISOString().slice(0, 10),
                    startTimeMs: sleepDayMs - (5 * 60 * 60 * 1000) - (3 * 60 * 1000),
                    endTimeMs: sleepDayMs - (6 * 60 * 1000),
                    timezoneOffsetSeconds: 3 * 60 * 60,
                    durationSeconds: 15_840,
                    isNap: false,
                    providerFields: { suunto: { SleepOnsetLatencyDuration: 360 } },
                    vitals: { averageHrvMs: 29, hrvSampleCount: 46 },
                }) },
                { id: `part-2-${index}`, data: () => ({
                    source: { ...source, sourceSessionKey: `part-2-${index}` },
                    sleepDate: new Date(sleepDayMs).toISOString().slice(0, 10),
                    startTimeMs: sleepDayMs + (1 * 60 * 1000),
                    endTimeMs: sleepDayMs + (4 * 60 * 60 * 1000),
                    timezoneOffsetSeconds: 3 * 60 * 60,
                    durationSeconds: 13_320,
                    isNap: false,
                    providerFields: { suunto: { SleepOnsetLatencyDuration: 480 } },
                    vitals: { averageHrvMs: 40, hrvSampleCount: 35 },
                }) },
            ];
        }).flat();

        const result = buildTrainingBuildComparisonMetricPayload([], {}, nowMs, docs as any);

        expect(result.payload.recovery.current).toMatchObject({
            provider: 'SuuntoApp',
            recordedNightCount: 5,
            averageSleepSeconds: 29_160,
            typicalLocalStartMinutes: (22 * 60) + 3,
            typicalLocalEndMinutes: 7 * 60,
            medianOvernightHrvMs: 33.8,
            overnightHrvNightCount: 5,
        });
    });

    it('retains a short Suunto fragment when its canonical night is long enough', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 5, 30, 12);
        const dayMs = 24 * 60 * 60 * 1000;
        const docs = Array.from({ length: 5 }, (_, index) => {
            const sleepDayMs = Date.UTC(2026, 5, 26) + (index * dayMs);
            const source = { provider: 'SuuntoApp', providerUserId: 'suunto-user' };
            return [
                { id: `main-${index}`, data: () => ({
                    source: { ...source, sourceSessionKey: `main-${index}` },
                    sleepDate: new Date(sleepDayMs).toISOString().slice(0, 10),
                    startTimeMs: sleepDayMs - (7.5 * 60 * 60 * 1000),
                    endTimeMs: sleepDayMs,
                    timezoneOffsetSeconds: 0,
                    durationSeconds: 7.5 * 60 * 60,
                    isNap: false,
                    vitals: {},
                }) },
                { id: `short-${index}`, data: () => ({
                    source: { ...source, sourceSessionKey: `short-${index}` },
                    sleepDate: new Date(sleepDayMs).toISOString().slice(0, 10),
                    startTimeMs: sleepDayMs + (5 * 60 * 1000),
                    endTimeMs: sleepDayMs + (35 * 60 * 1000),
                    timezoneOffsetSeconds: 0,
                    durationSeconds: 30 * 60,
                    isNap: false,
                    vitals: {},
                }) },
            ];
        }).flat();

        const result = buildTrainingBuildComparisonMetricPayload([], {}, nowMs, docs as any);

        expect(result.payload.recovery.current).toMatchObject({
            recordedNightCount: 5,
            averageSleepSeconds: 8 * 60 * 60,
        });
    });

    it('withholds recovery comparability across providers and keeps absent HRV null', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const buildProviderNights = (
            provider: 'GarminAPI' | 'SuuntoApp',
            startDayMs: number,
            count: number,
            prefix: string,
        ) => Array.from({ length: count }, (_, index) => {
            const sleepDayMs = startDayMs + (index * 24 * 60 * 60 * 1000);
            return {
                id: `${prefix}-${index}`,
                data: () => ({
                    source: { provider },
                    sleepDate: new Date(sleepDayMs).toISOString().slice(0, 10),
                    startTimeMs: sleepDayMs - (2 * 60 * 60 * 1000),
                    durationSeconds: 7.5 * 3600,
                    timezoneOffsetSeconds: 0,
                    isNap: false,
                    vitals: {},
                }),
            };
        });
        const sleepDocs = [
            ...buildProviderNights('SuuntoApp', Date.UTC(2026, 2, 11), 42, 'reference'),
            ...buildProviderNights('GarminAPI', Date.UTC(2026, 5, 3), 14, 'current'),
        ] as any;

        const result = buildTrainingBuildComparisonMetricPayload(
            [],
            {},
            Date.UTC(2026, 5, 30, 12),
            sleepDocs,
        );

        expect(result.payload.recovery).toMatchObject({
            sameProvider: false,
            isComparable: false,
            current: {
                provider: 'GarminAPI',
                coverage: 'sufficient',
                medianOvernightHrvMs: null,
                overnightHrvNightCount: 0,
            },
            reference: {
                provider: 'SuuntoApp',
                coverage: 'sufficient',
                medianOvernightHrvMs: null,
                overnightHrvNightCount: 0,
            },
        });
    });

    it('uses one canonical main sleep record per provider and sleep date', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const dayMs = 24 * 60 * 60 * 1000;
        const firstSleepDayMs = Date.UTC(2026, 5, 24);
        const sleepDocs = Array.from({ length: 7 }, (_, index) => {
            const sleepDayMs = firstSleepDayMs + (index * dayMs);
            return {
                id: `main-${index}`,
                data: () => ({
                    source: { provider: 'GarminAPI' },
                    sleepDate: new Date(sleepDayMs).toISOString().slice(0, 10),
                    startTimeMs: sleepDayMs - (2 * 60 * 60 * 1000),
                    durationSeconds: 8 * 3600,
                    timezoneOffsetSeconds: 0,
                    isNap: false,
                    vitals: { overnightHrvMs: 50 },
                }),
            };
        });
        sleepDocs.push({
            id: 'duplicate-main-record',
            data: () => ({
                source: { provider: 'GarminAPI' },
                sleepDate: '2026-06-24',
                startTimeMs: firstSleepDayMs - (2 * 60 * 60 * 1000),
                durationSeconds: 8 * 3600,
                timezoneOffsetSeconds: 0,
                isNap: false,
                vitals: { overnightHrvMs: 50 },
            }),
        });

        const result = buildTrainingBuildComparisonMetricPayload(
            [],
            {},
            Date.UTC(2026, 5, 30, 12),
            sleepDocs as unknown as FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[],
        );

        expect(result.payload.recovery.current).toMatchObject({
            provider: 'GarminAPI',
            recordedNightCount: 7,
            averageSleepSeconds: 8 * 3600,
            overnightHrvNightCount: 7,
        });
    });

    it('measures bedtime variation on a circular clock for daytime and shift sleep', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const dayMs = 24 * 60 * 60 * 1000;
        const firstSleepDayMs = Date.UTC(2026, 5, 25);
        const sleepDocs = Array.from({ length: 6 }, (_, index) => {
            const sleepDayMs = firstSleepDayMs + (index * dayMs);
            const localBedtimeHour = index % 2 === 0 ? 10 : 14;
            return {
                id: `shift-${index}`,
                data: () => ({
                    source: { provider: 'SuuntoApp' },
                    sleepDate: new Date(sleepDayMs).toISOString().slice(0, 10),
                    startTimeMs: sleepDayMs + (localBedtimeHour * 60 * 60 * 1000),
                    durationSeconds: 8 * 3600,
                    timezoneOffsetSeconds: 0,
                    isNap: false,
                    vitals: {},
                }),
            };
        });

        const result = buildTrainingBuildComparisonMetricPayload(
            [],
            {},
            Date.UTC(2026, 5, 30, 12),
            sleepDocs as any,
        );

        expect(result.payload.recovery.current.bedtimeVariationMinutes).toBe(120);
    });

    it('derives a typical local sleep window only from complete local start and end evidence', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const dayMs = 24 * 60 * 60 * 1000;
        const firstSleepDayMs = Date.UTC(2026, 5, 25);
        const sleepDocs = Array.from({ length: 6 }, (_, index) => {
            const sleepDayMs = firstSleepDayMs + (index * dayMs);
            const hasCompleteLocalWindow = index < 5;
            return {
                id: `local-window-${index}`,
                data: () => ({
                    source: { provider: 'GarminAPI' },
                    sleepDate: new Date(sleepDayMs).toISOString().slice(0, 10),
                    startTimeMs: sleepDayMs - (90 * 60 * 1000),
                    ...(hasCompleteLocalWindow ? { endTimeMs: sleepDayMs + ((6 * 60 + 45) * 60 * 1000) } : {}),
                    durationSeconds: 8 * 3600,
                    timezoneOffsetSeconds: 0,
                    isNap: false,
                    vitals: {},
                }),
            };
        });

        const result = buildTrainingBuildComparisonMetricPayload(
            [],
            {},
            Date.UTC(2026, 5, 30, 12),
            sleepDocs as any,
        );

        expect(result.payload.recovery.current).toMatchObject({
            recordedNightCount: 6,
            typicalLocalStartMinutes: (22 * 60) + 30,
            typicalLocalEndMinutes: (6 * 60) + 45,
        });
    });

    it('keeps malformed finite timestamps and timezone offsets from poisoning bedtime variation', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const dayMs = 24 * 60 * 60 * 1000;
        const firstSleepDayMs = Date.UTC(2026, 5, 26);
        const sleepDocs = Array.from({ length: 5 }, (_, index) => {
            const sleepDayMs = firstSleepDayMs + (index * dayMs);
            return {
                id: `malformed-time-${index}`,
                data: () => ({
                    source: { provider: 'COROSAPI' },
                    sleepDate: new Date(sleepDayMs).toISOString().slice(0, 10),
                    startTimeMs: Number.MAX_VALUE,
                    durationSeconds: 8 * 3600,
                    timezoneOffsetSeconds: Number.MAX_VALUE,
                    isNap: false,
                    vitals: {},
                }),
            };
        });

        const result = buildTrainingBuildComparisonMetricPayload(
            [],
            {},
            Date.UTC(2026, 5, 30, 12),
            sleepDocs as unknown as FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[],
        );

        expect(result.payload.recovery.current).toMatchObject({
            recordedNightCount: 0,
            bedtimeVariationMinutes: null,
        });
    });

    it('retains sleep evidence without inventing bedtime regularity when timezone is missing', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const dayMs = 24 * 60 * 60 * 1000;
        const firstSleepDayMs = Date.UTC(2026, 5, 26);
        const sleepDocs = Array.from({ length: 5 }, (_, index) => {
            const sleepDayMs = firstSleepDayMs + (index * dayMs);
            return {
                id: `no-timezone-${index}`,
                data: () => ({
                    source: { provider: 'GarminAPI' },
                    sleepDate: new Date(sleepDayMs).toISOString().slice(0, 10),
                    startTimeMs: sleepDayMs - (2 * 60 * 60 * 1000),
                    durationSeconds: 8 * 3600,
                    isNap: false,
                    vitals: { overnightHrvMs: 50 + index },
                }),
            };
        });

        const result = buildTrainingBuildComparisonMetricPayload(
            [],
            {},
            Date.UTC(2026, 5, 30, 12),
            sleepDocs as any,
        );

        expect(result.payload.recovery.current).toMatchObject({
            recordedNightCount: 5,
            averageSleepSeconds: 8 * 3600,
            bedtimeVariationMinutes: null,
            medianOvernightHrvMs: 52,
        });
    });

    it('uses the local offset preserved in historical Suunto timestamps for bedtime variation', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const dayMs = 24 * 60 * 60 * 1000;
        const firstSleepDayMs = Date.UTC(2026, 5, 26);
        const sleepDocs = Array.from({ length: 5 }, (_, index) => {
            const sleepDayMs = firstSleepDayMs + (index * dayMs);
            return {
                id: `suunto-offset-${index}`,
                data: () => ({
                    source: { provider: 'SuuntoApp' },
                    sleepDate: new Date(sleepDayMs).toISOString().slice(0, 10),
                    startTimeMs: sleepDayMs - (2 * 60 * 60 * 1000),
                    durationSeconds: 8 * 3600,
                    isNap: false,
                    providerFields: { suunto: { timestamp: '2026-06-26T00:00:00+02:00' } },
                    vitals: {},
                }),
            };
        });

        const result = buildTrainingBuildComparisonMetricPayload(
            [],
            {},
            Date.UTC(2026, 5, 30, 12),
            sleepDocs as any,
        );

        expect(result.payload.recovery.current).toMatchObject({
            recordedNightCount: 5,
            bedtimeVariationMinutes: 0,
        });
    });

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
        expect(running.benchmark?.durability).toBeNull();
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

    it('keeps zero TSS in new-context build totals and event suggestions while intensity follows its own policy', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 14, 12);
        const types = [RefinedTypes.BMX, RefinedTypes.Kickbiking, RefinedTypes.ObstacleRacing,
            RefinedTypes.EEnduroMTB, ActivityTypes.StrengthTraining];
        const docs = types.flatMap((type, index) => [Date.UTC(2026, 6, 1), Date.UTC(2026, 3, 1)].map((startDate, window) => ({
            id: `zero-${index}-${window}`,
            data: () => ({ startDate, stats: {
                [DataActivityTypes.type]: [type], [DataDuration.type]: 3600,
                'Training Stress Score': 0, [DataHeartRateZoneOneDuration.type]: 1800,
            } }),
        })));
        const result = buildTrainingBuildComparisonMetricPayload(buildTrainingActivitySources(docs), {
            trainingSettings: { buildBenchmarks: Object.fromEntries(['cycling', 'running', 'strength'].map(sport =>
                [sport, { mode: 'period', durationWeeks: 8, endDayMs: Date.UTC(2026, 3, 30) }])) },
        }, nowMs);
        const cycling = result.payload.disciplines.find(sport => sport.discipline === 'cycling')!;
        const running = result.payload.disciplines.find(sport => sport.discipline === 'running')!;
        const strength = result.payload.disciplines.find(sport => sport.discipline === 'strength')!;
        [cycling, running, strength].forEach(sport => {
            expect(sport.status).toBe('ready');
            expect(sport.current?.trainingStressScore).toBe(0);
            expect(sport.current?.trainingStressScoreEventCount).toBe(sport.current?.activityCount);
            expect(sport.benchmark?.trainingStressScore).toBe(0);
            expect(sport.suggestedEvents.length).toBeGreaterThan(0);
            sport.suggestedEvents.forEach(event => expect(event.trainingStressScore).toBe(0));
        });
        expect(cycling.current).toMatchObject({ activityCount: 3, easySeconds: 1800, intensitySourceEventCount: 1 });
        expect(running.current).toMatchObject({ activityCount: 1, easySeconds: 1800, intensitySourceEventCount: 1 });
        expect(strength.current).toMatchObject({ activityCount: 1, easySeconds: null, intensitySourceEventCount: 0 });
    });

    it('counts saved TSS for benchmark-capable sports while retaining specialist intensity exclusions', async () => {
        const { buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 10, 12);
        const benchmarkEndDayMs = Date.UTC(2026, 3, 30);
        const docs = [
            [
                'strength-current',
                ActivityTypes.StrengthTraining,
                Date.UTC(2026, 6, 1),
            ],
            [
                'strength-benchmark',
                ActivityTypes.StrengthTraining,
                Date.UTC(2026, 3, 1),
            ],
            [
                'downhill-current',
                ActivityTypes.DownhillCycling,
                Date.UTC(2026, 6, 2),
            ],
            [
                'downhill-benchmark',
                ActivityTypes.DownhillCycling,
                Date.UTC(2026, 3, 2),
            ],
        ].map(([id, activityType, startDate]) => ({
            id,
            data: () => ({
                startDate,
                stats: {
                    [DataActivityTypes.type]: [activityType],
                    [DataDuration.type]: 3_600,
                    [DataDistance.type]: 12_000,
                    [DataDescent.type]: 800,
                    [DataDescentTime.type]: 600,
                    [DataJumpCount.type]: 8,
                    [DataJumpDistanceMax.type]: id === 'downhill-current' ? 7.4 : 5.8,
                    [DataGrit.type]: 14,
                    [DataFlow.type]: 7,
                    'Training Stress Score': 90,
                    [DataHeartRateZoneOneDuration.type]: 1_800,
                },
            }),
        }));

        const result = buildTrainingBuildComparisonMetricPayload(buildTrainingActivitySources(docs), {
            trainingSettings: {
                buildBenchmarks: {
                    cycling: { mode: 'period', durationWeeks: 8, endDayMs: benchmarkEndDayMs },
                    strength: { mode: 'period', durationWeeks: 8, endDayMs: benchmarkEndDayMs },
                },
            },
        }, nowMs);
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling');
        const strength = result.payload.disciplines.find(item => item.discipline === 'strength');

        expect(result.payload.disciplines.map(item => item.discipline)).toEqual([
            'running', 'cycling', 'swimming', 'rowing', 'walking-hiking', 'nordic-skiing', 'strength',
            'fitness-gym', 'paddling', 'wheelchair', 'climbing-mountaineering', 'mountain-snow', 'skating', 'combat-martial-arts', 'dance', 'team-sports', 'racket-sports', 'precision-sports', 'water-sports', 'diving', 'performance-sports', 'outdoor-adventures', 'aerial-sports', 'motorized-activities', 'other-training',
        ]);
        [cycling, strength].forEach((discipline) => {
            expect(discipline?.status).toBe('ready');
            expect(discipline?.current).toMatchObject({
                activityCount: 1,
                durationSeconds: 3_600,
                trainingStressScore: 90,
                trainingStressScoreEventCount: 1,
                easySeconds: null,
                moderateSeconds: null,
                hardSeconds: null,
                intensitySourceEventCount: 0,
            });
            expect(discipline?.benchmark).toMatchObject({ activityCount: 1, durationSeconds: 3_600 });
        });
        expect(cycling?.current).toMatchObject({ distanceMeters: 12_000, distanceEventCount: 1 });
        expect(strength?.current).toMatchObject({ distanceMeters: null, distanceEventCount: 0 });
        ['fitness-gym', 'other-training'].forEach((discipline) => {
            expect(result.payload.disciplines.find(item => item.discipline === discipline)).toMatchObject({
                status: 'not-configured',
                selection: null,
                suggestedRaces: [],
                suggestedEvents: [],
            });
        });
        expect(cycling?.current?.contexts).toEqual([expect.objectContaining({
            context: 'downhill',
            profile: 'gravity',
            metrics: expect.arrayContaining([
                { metric: 'distance', value: 12_000, sourceActivityCount: 1 },
                { metric: 'descent', value: 800, sourceActivityCount: 1 },
                { metric: 'descent-time', value: 600, sourceActivityCount: 1 },
                { metric: 'jump-count', value: 8, sourceActivityCount: 1 },
                { metric: 'max-jump-distance', value: 7.4, sourceActivityCount: 1 },
            ]),
        })]);
        expect(strength?.current?.contexts).toEqual([expect.objectContaining({
            context: 'strength',
            profile: 'strength',
            metrics: [{ metric: 'elapsed-time', value: 3_600, sourceActivityCount: 1 }],
        })]);
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
    const sessionPowerCurve = [180, 300, 600, 900, 1200].map(duration => ({
        duration,
        power: 240 + (18_000 / duration),
        wattsPerKg: 3.2 + (240 / duration),
    }));
    const createDoc = (
        id: string,
        dayMs: number,
        overrides: Record<string, unknown> = {},
        curve: unknown = null,
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

    it('keeps a dated manual lab reference separate and compares only nearby workout evidence', async () => {
        const { buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
        const workoutAtMs = Date.UTC(2026, 6, 8, 8);
        const manualAtMs = Date.UTC(2026, 6, 9, 8);
        const docs = [createDoc('running-vo2', workoutAtMs, {
            [DataActivityTypes.type]: [ActivityTypes.Running],
            [DataVO2Max.type]: 55,
        })];
        const healthDocs = [healthMeasurementDoc({
            id: 'manual-running-lab',
            metricId: HEALTH_METRIC_IDS.Vo2Max,
            value: 57,
            observedAtMs: manualAtMs,
            semanticVariant: 'manual_running_lab_test',
            qualifiers: { context: 'running', method: 'lab_test' },
        }), healthMeasurementDoc({
            id: 'provider-running-lab-lookalike',
            metricId: HEALTH_METRIC_IDS.Vo2Max,
            value: 63,
            observedAtMs: manualAtMs + 1_000,
            provider: HEALTH_PROVIDERS.GarminAPI,
            semanticVariant: 'manual_running_lab_test',
            qualifiers: { context: 'running', method: 'lab_test' },
        })];

        const result = buildTrainingCapacityMetricPayload(
            buildTrainingActivitySources(docs),
            nowMs,
            healthDocs as any,
        );
        const running = result.payload.disciplines.find(item => item.discipline === 'running');

        expect(running?.importedVo2Max).toMatchObject({ value: 55, provenance: 'imported-activity-stat' });
        expect(running?.referenceVo2Max).toEqual({
            kind: 'vo2-max',
            value: 57,
            context: 'running',
            method: 'lab-test',
            observedAtMs: manualAtMs,
            provenance: 'manual-health-measurement',
            comparison: {
                value: 55,
                observedAtMs: workoutAtMs,
                delta: 2,
                gapDays: 1,
            },
        });
        expect(result.sourceEventCount).toBe(2);
    });

    it('deduplicates carried imported settings without adding a modeled capacity value', async () => {
        const { buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
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

        const result = buildTrainingCapacityMetricPayload(trainingActivities, nowMs);
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
        expect(cycling).not.toHaveProperty('modeledCriticalPower');
    });

    it('keeps imported capacity independent of incomplete power curves', async () => {
        const { buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
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

        const result = buildTrainingCapacityMetricPayload(trainingActivities, nowMs);
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling');

        expect(cycling).toEqual(expect.objectContaining({
            discipline: 'cycling',
            ftpSetting: null,
            importedVo2Max: null,
        }));
        expect(cycling).not.toHaveProperty('modeledCriticalPower');
    });

    it('does not call a source change a comparable setting change', async () => {
        const { buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
        const docs = [
            createDoc('garmin', Date.UTC(2026, 5, 1), { [DataFTP.type]: 210 }, null, 'Edge 1050'),
            createDoc('wahoo', Date.UTC(2026, 6, 1), { [DataFTP.type]: 230 }, null, 'Wahoo Kickr'),
        ];
        const trainingActivities = buildTrainingActivitySources(docs);

        const result = buildTrainingCapacityMetricPayload(trainingActivities, nowMs);
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
        const { buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
        const docs = [createDoc('provider-only', Date.UTC(2026, 6, 8), { [DataFTP.type]: 222 }, null, '')];
        const trainingActivities = buildTrainingActivitySources(docs);

        const result = buildTrainingCapacityMetricPayload(trainingActivities, nowMs);
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling');

        expect(cycling?.ftpSetting).toMatchObject({ sourceKey: 'garmin', value: 222 });
    });

    it('does not present a session-derived 20-minute FTP estimate as an imported setting', async () => {
        const { buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
        const docs = [createDoc('derived-ftp', Date.UTC(2026, 6, 8), {
            [DataFTP.type]: Math.round(sessionPowerCurve.find(point => point.duration === 1_200)!.power * 0.95),
        }, sessionPowerCurve)];
        const trainingActivities = buildTrainingActivitySources(docs);

        const result = buildTrainingCapacityMetricPayload(trainingActivities, nowMs);
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling');

        expect(cycling?.ftpSetting).toBeNull();
        expect(cycling).not.toHaveProperty('modeledCriticalPower');
    });

    it('resolves equal-timestamp imported settings deterministically by event id', async () => {
        const { buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
        const timestamp = Date.UTC(2026, 6, 8);
        const docs = [
            createDoc('setting-b', timestamp, { [DataFTP.type]: 220 }, null),
            createDoc('setting-a', timestamp, { [DataFTP.type]: 210 }, null),
        ];
        const trainingActivities = buildTrainingActivitySources(docs);

        const result = buildTrainingCapacityMetricPayload(trainingActivities, nowMs);
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling');

        expect(cycling?.ftpSetting).toMatchObject({
            value: 220,
            previousValue: 210,
            previousAtMs: timestamp,
        });
    });

    it('uses activity groups for sport capacity and excludes merged events', async () => {
        const { buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
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

        const result = buildTrainingCapacityMetricPayload(trainingActivities, nowMs);
        const running = result.payload.disciplines.find(item => item.discipline === 'running');
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling');

        expect(running?.ftpSetting?.value).toBe(190);
        expect(cycling?.ftpSetting?.value).toBe(250);
        expect(result.sourceEventCount).toBe(2);
    });

    it('ignores future imported settings', async () => {
        const { buildTrainingCapacityMetricPayload } = await import('./derived-metrics.service');
        const docs = [
            createDoc('recent-one', Date.UTC(2026, 6, 1), { [DataFTP.type]: 222 }),
            createDoc('recent-two', Date.UTC(2026, 6, 5), { [DataFTP.type]: 222 }),
            createDoc('recent-three', Date.UTC(2026, 6, 8), { [DataFTP.type]: 222 }),
            createDoc('future', Date.UTC(2026, 6, 20), { [DataFTP.type]: 300 }),
        ];
        const trainingActivities = buildTrainingActivitySources(docs);

        const result = buildTrainingCapacityMetricPayload(trainingActivities, nowMs);
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling');

        expect(cycling?.ftpSetting).toMatchObject({ value: 222, observationCount: 3 });
        expect(cycling).not.toHaveProperty('modeledCriticalPower');
    });
});

describe('buildTrainingPowerSystemsMetricPayload', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const nowMs = Date.UTC(2026, 6, 20, 12);
    const asOfDayMs = Date.UTC(2026, 6, 20);
    const powerCurve = [
        1, 2, 3, 5, 8, 12, 20, 30,
        120, 180, 240, 300, 480, 720, 900, 1200,
    ].map(duration => ({
        duration,
        power: duration <= 30
            ? 250 + (18_000 / (duration + 15))
            : 250 + (18_000 / duration),
    }));
    const source = (
        id: string,
        activityType: ActivityTypes,
        dayMs: number,
        curve: unknown = powerCurve,
    ): any => ({
        activityId: id,
        eventId: `event-${id}`,
        discipline: resolveTrainingDisciplineFromActivityType(activityType),
        activityData: {
            type: activityType,
            startDate: dayMs,
            stats: {
                [DataDuration.type]: 3600,
                [POWER_CURVE_STAT_TYPE]: curve,
            },
        },
        eventData: { startDate: dayMs },
        startMs: dayMs,
        startDayMs: dayMs,
        eventStartMs: dayMs,
        eventStartDayMs: dayMs,
    });
    const datedCurve = (id: string, activityType: ActivityTypes, dayMs: number) => ({
        sourceId: id,
        activityType,
        date: new Date(dayMs).toISOString().slice(0, 10),
        powerCurve,
    });

    it('keeps six wheelchair power histories independent across recorded indoor and outdoor types', async () => {
        const { buildTrainingPowerSystemsMetricPayload } = await import('./derived-metrics.service');
        const types = ['Wheel Chair', 'Wheelchair Push Walk', 'Wheelchair Push Run',
            'Indoor Wheelchair Push Walk', 'Indoor Wheelchair Push Run', 'Wheelchair Racing'];
        const activities = types.flatMap((type, index) => [
            source(`wheelchair-${index}-1`, type as ActivityTypes, asOfDayMs - (20 * DAY_MS)),
            source(`wheelchair-${index}-2`, type as ActivityTypes, asOfDayMs - DAY_MS),
        ]);
        const fitSpy = vi.fn(fitThreeDimensionalCapacityModel);
        const result = buildTrainingPowerSystemsMetricPayload(activities, nowMs, fitSpy);
        expect(result.payload.activityTypes.map(item => item.activityType)).toEqual([...types].sort((left, right) => left.localeCompare(right)));
        const currentFits = fitSpy.mock.calls.filter(([, options]) => options?.effectiveDate === '2026-07-20');
        expect(currentFits).toHaveLength(6);
        for (const [curves] of currentFits) {
            expect(curves).toHaveLength(2);
            expect(new Set(curves.map(curve => curve.activityType)).size).toBe(1);
        }
        for (const entry of result.payload.activityTypes) {
            // New exact names become fitter inputs when the expanded catalog is adopted.
            const available = ActivityTypesHelper.resolveActivityType(entry.activityType) !== null;
            expect(entry.current.diagnostics.sourceCount).toBe(available ? 2 : 0);
            expect(entry.current.activityType).toBe(entry.activityType);
            expect(entry.evidenceCounts.usableCurveActivityCount).toBe(available ? 2 : 0);
        }
        const availableEntries = result.payload.activityTypes.filter(item => ActivityTypesHelper.resolveActivityType(item.activityType));
        expect(new Set(availableEntries.map(item => item.current.sourceFingerprint)).size).toBe(availableEntries.length);
    });

    it('keeps both approved 50-sport power-history batches independent after JSON reload', async () => {
        const { buildTrainingPowerSystemsMetricPayload } = await import('./derived-metrics.service');
        const types = [
            'Snowshoeing', 'Bouldering', 'Climbing', 'Rock Climbing', 'Indoor Climbing',
            'Via Ferrata', 'Mountaineering', 'Ski Touring', 'Ski Mountaineering', 'Backcountry Skiing',
            'Backcountry Snowboarding', 'Splitboarding', 'Alpine Skiing', 'Snowboarding', 'Telemark Skiing',
            'Inline Skating', 'Skating', 'Ice Skating', 'Skateboarding', 'Boxing',
            'Combat', 'Judo', 'Kickboxing', 'Mixed Martial Arts', 'Taekwondo',
            'Ballet Dancing', 'Ballroom Dancing', 'Dancing', 'Jazz Dancing', 'Latin Dancing',
            'Modern Dancing', 'Show Dancing', 'Street Dancing', 'Basketball', 'Wheelchair Basketball',
            'Football', 'Soccer', 'Volleyball', 'Beach Volleyball', 'Badminton',
            'Beach Tennis', 'Padel', 'Pickleball', 'Platform Tennis', 'Racket Sport',
            'Racquet Ball', 'Squash', 'Table Tennis', 'Tennis', 'Wheelchair Tennis',
            ...APPROVED_WATER_TEAM_SPORT_CASES.map(item => item.name),
            ...APPROVED_REMAINING_SPORT_CASES.map(item => item.name),
            ...APPROVED_OTHER_TRAINING_NAMES,

        ];
        const activities = JSON.parse(JSON.stringify(types.flatMap((type, index) => [
            source(`approved-${index}-1`, type as ActivityTypes, asOfDayMs - 20 * DAY_MS),
            source(`approved-${index}-2`, type as ActivityTypes, asOfDayMs - DAY_MS),
        ])));
        const fitSpy = vi.fn(fitThreeDimensionalCapacityModel);
        const result = buildTrainingPowerSystemsMetricPayload(activities, nowMs, fitSpy);
        expect(result.payload.activityTypes.map(item => item.activityType)).toEqual([...types].sort((left, right) => left.localeCompare(right)));
        const currentFits = fitSpy.mock.calls.filter(([, options]) => options?.effectiveDate === '2026-07-20');
        expect(currentFits).toHaveLength(146);
        currentFits.forEach(([curves]) => {
            expect(curves).toHaveLength(2);
            expect(new Set(curves.map(curve => curve.activityType)).size).toBe(1);
        });
        result.payload.activityTypes.forEach(entry => {
            const available = ActivityTypesHelper.resolveActivityType(entry.activityType) !== null;
            expect(entry.current.activityType).toBe(entry.activityType);
            expect(entry.current.diagnostics.sourceCount).toBe(available ? 2 : 0);
            expect(entry.evidenceCounts.usableCurveActivityCount).toBe(available ? 2 : 0);
        });
        const availableEntries = result.payload.activityTypes.filter(item => ActivityTypesHelper.resolveActivityType(item.activityType));
        expect(new Set(availableEntries.map(item => item.current.sourceFingerprint)).size).toBe(availableEntries.length);
    });

    it('uses the exact closed-open 42-day window and matches the Sports-lib public fitter', async () => {
        const { buildTrainingPowerSystemsMetricPayload } = await import('./derived-metrics.service');
        const activities = [
            source('outside', ActivityTypes.Cycling, asOfDayMs - (43 * DAY_MS)),
            source('boundary', ActivityTypes.Cycling, asOfDayMs - (42 * DAY_MS)),
            source('middle', ActivityTypes.Cycling, asOfDayMs - (20 * DAY_MS)),
            source('latest', ActivityTypes.Cycling, asOfDayMs - DAY_MS),
            source('same-day', ActivityTypes.Cycling, asOfDayMs),
            source('future', ActivityTypes.Cycling, asOfDayMs + DAY_MS),
        ];

        const result = buildTrainingPowerSystemsMetricPayload(activities, nowMs);
        const cycling = result.payload.activityTypes.find(item => item.activityType === ActivityTypes.Cycling);
        const expected = fitThreeDimensionalCapacityModel([
            datedCurve('boundary', ActivityTypes.Cycling, asOfDayMs - (42 * DAY_MS)),
            datedCurve('middle', ActivityTypes.Cycling, asOfDayMs - (20 * DAY_MS)),
            datedCurve('latest', ActivityTypes.Cycling, asOfDayMs - DAY_MS),
        ], { effectiveDate: '2026-07-20' });

        expect(result.payload).toMatchObject({
            asOfDayMs,
            windowDays: DERIVED_TRAINING_POWER_SYSTEMS_WINDOW_DAYS,
            historyDays: DERIVED_TRAINING_POWER_SYSTEMS_HISTORY_DAYS,
            excludesEffectiveDay: true,
        });
        expect(cycling?.current).toEqual({
            effectiveDayMs: asOfDayMs,
            status: expected.status,
            reason: expected.reason,
            activityType: ActivityTypes.Cycling,
            sourceFingerprint: expected.sourceFingerprint,
            criticalPower: expected.criticalPower,
            wPrime: expected.wPrime,
            maximumPower: expected.maximumPower,
            diagnostics: {
                sourceCount: expected.diagnostics.sourceCount,
                historyStartDayMs: Date.parse(
                    `${expected.envelope.historyStartDate}T00:00:00.000Z`,
                ),
                historyEndDayMs: Date.parse(
                    `${expected.envelope.historyEndDate}T00:00:00.000Z`,
                ),
                historySpanDays: expected.diagnostics.historySpanDays,
                rejectedPointCount: expected.envelope.rejectedPointCount,
                rejectedShortPowerSpikePointCount:
                    expected.envelope.rejectedShortPowerSpikePointCount,
                criticalPowerAnchorCount:
                    expected.diagnostics.criticalPowerAnchorCount,
                earlyCriticalPowerAnchorCount:
                    expected.diagnostics.earlyCriticalPowerAnchorCount,
                longCriticalPowerAnchorCount:
                    expected.diagnostics.longCriticalPowerAnchorCount,
                criticalPowerContributingSourceCount: 1,
                maximumPowerAnchorCount:
                    expected.diagnostics.maximumPowerAnchorCount,
                maximumPowerContributingSourceCount: 1,
                criticalPowerNormalizedRmse:
                    expected.diagnostics.criticalPowerNormalizedRmse,
                criticalPowerSpreadRatio:
                    expected.diagnostics.criticalPowerSpreadRatio,
                wPrimeSpreadRatio: expected.diagnostics.wPrimeSpreadRatio,
                wPrimeCandidateCount: 0,
                wPrimeCandidateMinimumJoules: null,
                wPrimeCandidateMaximumJoules: null,
                criticalPowerLeaveOneOutSpreadRatio:
                    expected.diagnostics.criticalPowerLeaveOneOutSpreadRatio,
                wPrimeLeaveOneOutSpreadRatio:
                    expected.diagnostics.wPrimeLeaveOneOutSpreadRatio,
                criticalPowerSourceRemovalFitCount:
                    expected.diagnostics.criticalPowerSourceRemovalFitCount,
                criticalPowerSourceRemovalFailureCount:
                    expected.diagnostics.criticalPowerSourceRemovalFailureCount,
                criticalPowerSourceRemovalMaximumChangeRatio:
                    expected.diagnostics
                        .criticalPowerSourceRemovalMaximumChangeRatio,
                wPrimeSourceRemovalMaximumChangeRatio:
                    expected.diagnostics.wPrimeSourceRemovalMaximumChangeRatio,
                maximumPowerNormalizedRmse:
                    expected.diagnostics.maximumPowerNormalizedRmse,
                maximumPowerLeaveOneOutSpreadRatio:
                    expected.diagnostics.maximumPowerLeaveOneOutSpreadRatio,
            },
        });
        expect(cycling?.current).not.toHaveProperty('estimatorVersion');
        expect(cycling?.evidenceCounts).toEqual({
            candidateActivityCount: 3,
            usableCurveActivityCount: 3,
            excludedActivityCount: 0,
        });
    });

    it('preserves valid no-evidence diagnostics when a stored curve contains only an isolated spike', async () => {
        const { buildTrainingPowerSystemsMetricPayload } = await import('./derived-metrics.service');
        const activities = [
            source(
                'spike-only',
                ActivityTypes.Cycling,
                asOfDayMs - DAY_MS,
                [
                    { duration: 1, power: 900 },
                    { duration: 2, power: 450 },
                    { duration: 3, power: 300 },
                ],
            ),
        ];

        const result = buildTrainingPowerSystemsMetricPayload(activities, nowMs);
        const cycling = result.payload.activityTypes[0];

        expect(cycling.current).toMatchObject({
            status: 'insufficient-evidence',
            reason: 'no-evidence',
            sourceFingerprint: null,
            diagnostics: {
                sourceCount: 0,
                rejectedPointCount: 0,
                rejectedShortPowerSpikePointCount: 3,
            },
        });
        expect(cycling.evidenceCounts).toEqual({
            candidateActivityCount: 1,
            usableCurveActivityCount: 0,
            excludedActivityCount: 1,
        });
    });

    it('discovers a same-day powered type without using that workout in today’s fit', async () => {
        const { buildTrainingPowerSystemsMetricPayload } = await import('./derived-metrics.service');

        const result = buildTrainingPowerSystemsMetricPayload([
            source('same-day-rowing', ActivityTypes.Rowing, asOfDayMs),
        ], nowMs);
        const rowing = result.payload.activityTypes[0];

        expect(rowing).toMatchObject({
            activityType: ActivityTypes.Rowing,
            current: {
                effectiveDayMs: asOfDayMs,
                status: 'insufficient-evidence',
                reason: 'no-evidence',
                sourceFingerprint: null,
                diagnostics: {
                    sourceCount: 0,
                    historyStartDayMs: null,
                    historyEndDayMs: null,
                    historySpanDays: 0,
                },
            },
            evidenceCounts: {
                candidateActivityCount: 0,
                usableCurveActivityCount: 0,
                excludedActivityCount: 0,
            },
        });
        expect(rowing.history).toHaveLength(1);
        expect(rowing.history[0]).toMatchObject({
            effectiveDayMs: asOfDayMs,
            status: 'insufficient-evidence',
            reason: 'no-evidence',
        });
    });

    it('is deterministic under shuffled input and caches each exact type/date fit', async () => {
        const { buildTrainingPowerSystemsMetricPayload } = await import('./derived-metrics.service');
        const activities = [
            source('one', ActivityTypes.Cycling, asOfDayMs - (40 * DAY_MS)),
            source('two', ActivityTypes.Cycling, asOfDayMs - (25 * DAY_MS)),
            source('three', ActivityTypes.Cycling, asOfDayMs - (15 * DAY_MS)),
            source('four', ActivityTypes.Cycling, asOfDayMs - DAY_MS),
        ];
        const fitSpy = vi.fn(fitThreeDimensionalCapacityModel);

        const ordered = buildTrainingPowerSystemsMetricPayload(activities, nowMs, fitSpy);
        const shuffleWithSeed = (seed: number) => {
            const shuffled = [...activities];
            let state = seed;
            for (let index = shuffled.length - 1; index > 0; index -= 1) {
                state = ((state * 1_664_525) + 1_013_904_223) >>> 0;
                const swapIndex = state % (index + 1);
                [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
            }
            return shuffled;
        };

        for (let seed = 1; seed <= 12; seed += 1) {
            expect(buildTrainingPowerSystemsMetricPayload(shuffleWithSeed(seed), nowMs)).toEqual(ordered);
        }
        expect(fitSpy).toHaveBeenCalledTimes(5);
        expect(fitSpy.mock.calls.map(([, options]) => options.effectiveDate)).toEqual([
            '2026-07-20',
            '2026-06-10',
            '2026-06-25',
            '2026-07-05',
            '2026-07-19',
        ]);
    });

    it.each([
        [ActivityTypes.Cycling, RefinedTypes.RoadCycling, ActivityTypes.IndoorCycling],
        [ActivityTypes.Running, RefinedTypes.RoadRunning, ActivityTypes.TrailRunning],
    ])('pools only %s with %s, retaining actual labels and one fit per model/date', async (generic, road, separate) => {
        const { buildTrainingPowerSystemsMetricPayload } = await import('./derived-metrics.service');
        const dates = [asOfDayMs - (40 * DAY_MS), asOfDayMs - (20 * DAY_MS), asOfDayMs - DAY_MS];
        const activities = [
            source('generic-old', generic, dates[0]),
            source('road-middle', road, dates[1]),
            source('generic-new', generic, dates[2]),
            source('road-no-curve', road, dates[2], []),
            source('separate', separate, dates[1]),
            source('road-effective-day', road, asOfDayMs),
            source('road-future', road, asOfDayMs + DAY_MS),
            source('road-outside', road, asOfDayMs - (43 * DAY_MS)),
        ];
        const fitSpy = vi.fn(fitThreeDimensionalCapacityModel);
        const result = buildTrainingPowerSystemsMetricPayload(activities, nowMs, fitSpy);
        const genericEntry = result.payload.activityTypes.find(item => item.activityType === generic)!;
        const roadEntry = result.payload.activityTypes.find(item => item.activityType === road)!;
        const separateEntry = result.payload.activityTypes.find(item => item.activityType === separate)!;
        const expected = fitThreeDimensionalCapacityModel([
            datedCurve('generic-old', generic, dates[0]),
            datedCurve('road-middle', generic, dates[1]),
            datedCurve('generic-new', generic, dates[2]),
        ], { effectiveDate: '2026-07-20' });
        expect(genericEntry.current.sourceFingerprint).toBe(expected.sourceFingerprint);
        expect(roadEntry.current.sourceFingerprint).toBe(expected.sourceFingerprint);
        expect(genericEntry.current.activityType).toBe(generic);
        expect(roadEntry.current.activityType).toBe(road);
        expect(genericEntry.current.criticalPower).toEqual(expected.criticalPower);
        expect(roadEntry.current.criticalPower).toEqual(expected.criticalPower);
        expect(genericEntry.history).toEqual(roadEntry.history);
        expect(genericEntry.history.map(point => point.effectiveDayMs)).toEqual([
            asOfDayMs - (43 * DAY_MS), ...dates, asOfDayMs,
        ]);
        expect(genericEntry.evidenceCounts).toEqual({
            candidateActivityCount: 4, usableCurveActivityCount: 3, excludedActivityCount: 1,
        });
        expect(roadEntry.evidenceCounts).toEqual(genericEntry.evidenceCounts);
        expect(separateEntry.current.diagnostics.sourceCount).toBe(1);
        expect(separateEntry.current.sourceFingerprint).not.toBe(expected.sourceFingerprint);
        expect(fitSpy).toHaveBeenCalledTimes(7);
        expect(buildTrainingPowerSystemsMetricPayload([...activities].reverse(), nowMs)).toEqual(result);
    });

    it.each([
        [ActivityTypes.Cycling, RefinedTypes.RoadCycling, ActivityTypes.IndoorCycling],
        [ActivityTypes.Running, RefinedTypes.RoadRunning, ActivityTypes.TrailRunning],
    ])('counts older %s events that supply the discovered %s model history', async (generic, road, separate) => {
        const { buildTrainingPowerSystemsMetricPayload, buildLegacyTrainingPowerSystemsMetricPayload } = await import('./derived-metrics.service');
        const olderDayMs = asOfDayMs - (90 * DAY_MS);
        const recentDayMs = asOfDayMs - (70 * DAY_MS);
        const activities = [
            source('generic-before-history', generic, olderDayMs),
            source('road-in-history', road, recentDayMs),
            source('separate-before-history', separate, olderDayMs),
        ];
        const fitSpy = vi.fn(fitThreeDimensionalCapacityModel);
        const result = buildTrainingPowerSystemsMetricPayload(activities, nowMs, fitSpy);

        expect(result.payload.activityTypes.map(entry => entry.activityType)).toEqual([road]);
        const historicalFit = fitSpy.mock.calls.find(([, options]) => (
            options.effectiveDate === new Date(recentDayMs).toISOString().slice(0, 10)
        ));
        expect(historicalFit?.[0]).toEqual([datedCurve('generic-before-history', generic, olderDayMs)]);
        expect(result.sourceEventCount).toBe(2);

        const legacy = buildLegacyTrainingPowerSystemsMetricPayload(activities, nowMs);
        expect(legacy.payload.activityTypes.map(entry => entry.activityType)).toEqual([road]);
        expect(legacy.sourceEventCount).toBe(1);
    });

    it('stores independently fitted policy-1 inputs only for the four affected canonical labels', async () => {
        const { buildTrainingPowerSystemsMetricPayload, buildLegacyTrainingPowerSystemsMetricPayload } = await import('./derived-metrics.service');
        const dates = [asOfDayMs - (40 * DAY_MS), asOfDayMs - (20 * DAY_MS), asOfDayMs - DAY_MS];
        const activities = [
            source('cycling-old', ActivityTypes.Cycling, dates[0]),
            source('cycling-new', ActivityTypes.Cycling, dates[2]),
            source('road-cycling', RefinedTypes.RoadCycling, dates[1]),
            source('running-old', ActivityTypes.Running, dates[0]),
            source('running-new', ActivityTypes.Running, dates[2]),
            source('road-running', RefinedTypes.RoadRunning, dates[1]),
            source('indoor', ActivityTypes.IndoorCycling, dates[1]),
        ];
        const legacy = buildLegacyTrainingPowerSystemsMetricPayload(activities, nowMs);
        const current = buildTrainingPowerSystemsMetricPayload(activities, nowMs);
        expect(legacy.payload.policyVersion).toBe(1);
        expect(current.payload.policyVersion).toBe(2);
        expect(legacy.payload.activityTypes.map(entry => entry.activityType)).toEqual([
            'Cycling', 'Road Cycling', 'Road Running', 'Running',
        ]);
        legacy.payload.activityTypes.forEach(entry => {
            const actualSources = activities.filter(activity => activity.activityData.type === entry.activityType);
            const expected = fitThreeDimensionalCapacityModel(actualSources.map(activity =>
                datedCurve(activity.activityId, activity.activityData.type, activity.startDayMs)), { effectiveDate: '2026-07-20' });
            expect(entry.current.sourceFingerprint).toBe(expected.sourceFingerprint);
            expect(entry.current.diagnostics.sourceCount).toBe(expected.diagnostics.sourceCount);
            expect(entry.current.activityType).toBe(entry.activityType);
            expect(entry.history.map(point => point.effectiveDayMs)).toEqual([
                ...actualSources.map(activity => activity.startDayMs).sort((left, right) => left - right), asOfDayMs,
            ]);
        });
        expect(legacy.payload.activityTypes.find(entry => entry.activityType === 'Cycling')?.current.diagnostics.sourceCount).toBe(2);
        expect(current.payload.activityTypes.find(entry => entry.activityType === 'Cycling')?.current.diagnostics.sourceCount).toBe(3);
        expect(buildLegacyTrainingPowerSystemsMetricPayload([...activities].reverse(), nowMs)).toEqual(legacy);
    });

    it('bounds the private legacy sidecar to four current snapshots and 340 observed history points', async () => {
        const { buildLegacyTrainingPowerSystemsMetricPayload } = await import('./derived-metrics.service');
        const activities = [ActivityTypes.Cycling, RefinedTypes.RoadCycling, ActivityTypes.Running, RefinedTypes.RoadRunning]
            .flatMap(type => Array.from({ length: 85 }, (_, index) => source(`${type}-${index}`, type, asOfDayMs - (index * DAY_MS))));
        const result = buildLegacyTrainingPowerSystemsMetricPayload(activities, nowMs);
        expect(result.payload.activityTypes).toHaveLength(4);
        expect(result.payload.activityTypes.reduce((sum, entry) => sum + entry.history.length, 0)).toBe(340);
        expect(Buffer.byteLength(JSON.stringify(result.payload), 'utf8')).toBeLessThan(128 * 1024);
        const oversizedFit = vi.fn((...args: Parameters<typeof fitThreeDimensionalCapacityModel>) => ({
            ...fitThreeDimensionalCapacityModel(...args), sourceFingerprint: 'x'.repeat(128 * 1024),
        }));
        expect(() => buildLegacyTrainingPowerSystemsMetricPayload(activities.slice(0, 3), nowMs, oversizedFit))
            .toThrow('Legacy power-system sidecar exceeds its fixed storage bounds');
    });

    it('keeps related cycling types and a non-Training power sport completely separate', async () => {
        const { buildTrainingPowerSystemsMetricPayload } = await import('./derived-metrics.service');
        const activityTypes = [
            ActivityTypes.Cycling,
            ActivityTypes.IndoorCycling,
            ActivityTypes.Rowing,
        ];
        const activities = activityTypes.flatMap((activityType, typeIndex) => (
            [40, 20, 1].map((daysAgo, index) => source(
                `${typeIndex}-${index}`,
                activityType,
                asOfDayMs - (daysAgo * DAY_MS),
            ))
        ));

        const result = buildTrainingPowerSystemsMetricPayload(activities, nowMs);

        expect(result.payload.activityTypes.map(item => item.activityType)).toEqual([
            ActivityTypes.Cycling,
            ActivityTypes.IndoorCycling,
            ActivityTypes.Rowing,
        ].sort());
        result.payload.activityTypes.forEach((entry) => {
            expect(entry.current.diagnostics.sourceCount).toBe(3);
            expect(entry.current.activityType).toBe(entry.activityType);
            expect(entry.evidenceCounts.usableCurveActivityCount).toBe(3);
        });
        expect(new Set(result.payload.activityTypes.map(entry => entry.current.sourceFingerprint)).size).toBe(3);
    });

    it('bounds historical effective dates to 12 weeks while retaining today as the endpoint', async () => {
        const { buildTrainingPowerSystemsMetricPayload } = await import('./derived-metrics.service');
        const activities = [
            source('before-history', ActivityTypes.Cycling, asOfDayMs - (85 * DAY_MS)),
            source('history-boundary', ActivityTypes.Cycling, asOfDayMs - (84 * DAY_MS)),
            source('recent', ActivityTypes.Cycling, asOfDayMs - DAY_MS),
        ];

        const result = buildTrainingPowerSystemsMetricPayload(activities, nowMs);
        const historyDays = result.payload.activityTypes[0].history.map(point => point.effectiveDayMs);

        expect(historyDays).toEqual([
            asOfDayMs - (84 * DAY_MS),
            asOfDayMs - DAY_MS,
            asOfDayMs,
        ]);
    });

    it('handles malformed and missing curves without throwing or turning them into zero evidence', async () => {
        const { buildTrainingPowerSystemsMetricPayload } = await import('./derived-metrics.service');
        const activities = [
            source('valid', ActivityTypes.Rowing, asOfDayMs - DAY_MS),
            source('malformed', ActivityTypes.Rowing, asOfDayMs - (2 * DAY_MS), [
                null,
                { duration: 'bad', power: Number.NaN },
                { duration: -1, power: 400 },
            ]),
            source('missing', ActivityTypes.Rowing, asOfDayMs - (3 * DAY_MS), null),
            source('no-standard-anchor', ActivityTypes.Rowing, asOfDayMs - (4 * DAY_MS), [
                { duration: 45, power: 420 },
            ]),
            {
                ...source('invalid-type', ActivityTypes.Rowing, asOfDayMs - (5 * DAY_MS)),
                activityData: {
                    ...source('invalid-type', ActivityTypes.Rowing, asOfDayMs - (5 * DAY_MS)).activityData,
                    type: Symbol('invalid activity type'),
                },
            },
        ];

        expect(() => buildTrainingPowerSystemsMetricPayload(activities, nowMs)).not.toThrow();
        const rowing = buildTrainingPowerSystemsMetricPayload(activities, nowMs).payload.activityTypes[0];
        expect(rowing.evidenceCounts).toEqual({
            candidateActivityCount: 4,
            usableCurveActivityCount: 1,
            excludedActivityCount: 3,
        });
        expect(rowing.current).toMatchObject({
            status: 'insufficient-evidence',
            reason: 'insufficient-history',
            criticalPower: { value: null },
            wPrime: { value: null },
            maximumPower: { value: null },
        });
    });

    it.each([
        'ready',
        'partial',
        'insufficient-evidence',
        'poor-fit',
        'unstable',
        'invalid-input',
    ] as const)('preserves the %s fitter state and exposes only ready component values', async (status) => {
        const { buildTrainingPowerSystemsMetricPayload } = await import('./derived-metrics.service');
        const baseFit = fitThreeDimensionalCapacityModel([], { effectiveDate: '2026-07-20' });
        const componentStatus = status === 'partial' ? 'ready' : status === 'ready' ? 'ready' : status;
        const reason = status === 'ready'
            ? null
            : status === 'partial'
                ? 'insufficient-maximum-power-range'
                : status === 'insufficient-evidence'
                    ? 'insufficient-history'
                    : status === 'poor-fit'
                        ? 'poor-critical-power-fit'
                        : status === 'unstable'
                            ? 'unstable-critical-power-fit'
                            : 'invalid-source';
        const fit = {
            ...baseFit,
            status,
            reason,
            activityType: ActivityTypes.Rowing,
            sourceFingerprint: 'three-dimensional-capacity:0123456789abcdef',
            criticalPower: {
                status: componentStatus,
                reason: componentStatus === 'ready' ? null : reason,
                value: componentStatus === 'ready' ? 260 : null,
            },
            wPrime: {
                status: componentStatus,
                reason: componentStatus === 'ready' ? null : reason,
                value: componentStatus === 'ready' ? 18_500 : null,
            },
            maximumPower: status === 'partial'
                ? { status: 'insufficient-evidence', reason, value: null }
                : {
                    status: componentStatus,
                    reason: componentStatus === 'ready' ? null : reason,
                    value: componentStatus === 'ready' ? 1_200 : null,
                },
        } as any;

        const result = buildTrainingPowerSystemsMetricPayload(
            [source('rowing', ActivityTypes.Rowing, asOfDayMs - DAY_MS)],
            nowMs,
            () => fit,
        );
        const current = result.payload.activityTypes[0].current;

        expect(current.status).toBe(status);
        expect(current.criticalPower.value).toBe(componentStatus === 'ready' ? 260 : null);
        expect(current.wPrime.value).toBe(componentStatus === 'ready' ? 18_500 : null);
        expect(current.maximumPower.value).toBe(status === 'ready' ? 1_200 : null);
    });

    it('preserves a ready CP when Sports-lib rejects W′ stability and dependent Pmax', async () => {
        const { buildTrainingPowerSystemsMetricPayload } = await import('./derived-metrics.service');
        const baseFit = fitThreeDimensionalCapacityModel([], { effectiveDate: '2026-07-20' });
        const fit: ThreeDimensionalCapacityFit = {
            ...baseFit,
            status: 'partial',
            reason: 'unstable-w-prime-fit',
            activityType: ActivityTypes.Cycling,
            sourceFingerprint: 'three-dimensional-capacity:0123456789abcdef',
            criticalPower: { status: 'ready', reason: null, value: 224.13 },
            wPrime: { status: 'unstable', reason: 'unstable-w-prime-fit', value: null },
            maximumPower: {
                status: 'insufficient-evidence',
                reason: 'unstable-w-prime-fit',
                value: null,
            },
            diagnostics: {
                ...baseFit.diagnostics,
                criticalPowerCandidates: [
                    {
                        method: 'power-reciprocal-time',
                        criticalPowerWatts: 230.8,
                        wPrimeJoules: 10_017,
                        normalizedRmse: 0.022,
                    },
                    {
                        method: 'work-time',
                        criticalPowerWatts: 224.13,
                        wPrimeJoules: 12_433,
                        normalizedRmse: 0.032,
                    },
                    {
                        method: 'duration-domain',
                        criticalPowerWatts: 221.9,
                        wPrimeJoules: 14_410,
                        normalizedRmse: 0.051,
                    },
                ],
            },
        };

        const result = buildTrainingPowerSystemsMetricPayload(
            [source('cycling', ActivityTypes.Cycling, asOfDayMs - DAY_MS)],
            nowMs,
            () => fit,
        );

        expect(result.payload.activityTypes[0].current).toMatchObject({
            status: 'partial',
            reason: 'unstable-w-prime-fit',
            criticalPower: { status: 'ready', reason: null, value: 224.13 },
            wPrime: { status: 'unstable', reason: 'unstable-w-prime-fit', value: null },
            maximumPower: {
                status: 'insufficient-evidence',
                reason: 'unstable-w-prime-fit',
                value: null,
            },
            diagnostics: {
                wPrimeCandidateCount: 3,
                wPrimeCandidateMinimumJoules: 10_017,
                wPrimeCandidateMaximumJoules: 14_410,
            },
        });
    });

    it('reports envelope contributors and short anchors even when CP/W′ exits as unstable', async () => {
        const { buildTrainingPowerSystemsMetricPayload } = await import('./derived-metrics.service');
        const baseFit = fitThreeDimensionalCapacityModel([], { effectiveDate: '2026-07-20' });
        const criticalPowerDurations = [120, 180, 240, 300, 480, 900, 1200];
        const maximumPowerDurations = [1, 2, 3, 5, 8, 12, 20, 30];
        const unstableFit: ThreeDimensionalCapacityFit = {
            ...baseFit,
            status: 'unstable',
            reason: 'unstable-critical-power-fit',
            activityType: ActivityTypes.Cycling,
            sourceFingerprint: 'three-dimensional-capacity:0123456789abcdef',
            criticalPower: {
                status: 'unstable',
                reason: 'unstable-critical-power-fit',
                value: null,
            },
            wPrime: {
                status: 'unstable',
                reason: 'unstable-critical-power-fit',
                value: null,
            },
            maximumPower: {
                status: 'unstable',
                reason: 'unstable-critical-power-fit',
                value: null,
            },
            envelope: {
                ...baseFit.envelope,
                status: 'ready',
                reason: null,
                activityType: ActivityTypes.Cycling,
                sourceCount: 9,
                historyStartDate: '2026-06-21',
                historyEndDate: '2026-07-19',
                historySpanDays: 28,
                sourceFingerprint: 'three-dimensional-capacity:0123456789abcdef',
                points: [
                    ...criticalPowerDurations.map(durationSeconds => ({
                        durationSeconds,
                        powerWatts: 250 + (18_000 / durationSeconds),
                        sourceId: 'sustained-test',
                        sourceDate: '2026-06-29',
                    })),
                    ...maximumPowerDurations.map((durationSeconds, index) => ({
                        durationSeconds,
                        powerWatts: 250 + (18_000 / (durationSeconds + 15)),
                        sourceId: index < 4 ? 'short-test-one' : 'short-test-two',
                        sourceDate: index < 4 ? '2026-07-02' : '2026-07-11',
                    })),
                ],
            },
            diagnostics: {
                ...baseFit.diagnostics,
                sourceCount: 9,
                historySpanDays: 28,
                criticalPowerAnchorCount: 7,
                earlyCriticalPowerAnchorCount: 4,
                longCriticalPowerAnchorCount: 2,
                maximumPowerAnchorCount: 0,
                criticalPowerSpreadRatio: 0.041,
                wPrimeSpreadRatio: 0.327,
                criticalPowerLeaveOneOutSpreadRatio: 0.008,
                wPrimeLeaveOneOutSpreadRatio: 0.095,
            },
        };

        const result = buildTrainingPowerSystemsMetricPayload(
            [source('cycling', ActivityTypes.Cycling, asOfDayMs - DAY_MS)],
            nowMs,
            () => unstableFit,
        );

        expect(result.payload.activityTypes[0].current).toMatchObject({
            status: 'unstable',
            reason: 'unstable-critical-power-fit',
            diagnostics: {
                sourceCount: 9,
                criticalPowerAnchorCount: 7,
                criticalPowerContributingSourceCount: 1,
                maximumPowerAnchorCount: 8,
                maximumPowerContributingSourceCount: 2,
                criticalPowerSpreadRatio: 0.041,
                wPrimeSpreadRatio: 0.327,
                criticalPowerLeaveOneOutSpreadRatio: 0.008,
                wPrimeLeaveOneOutSpreadRatio: 0.095,
            },
        });
    });

    it('degrades an internally invalid fitter result to one valid invalid-input snapshot', async () => {
        const { buildTrainingPowerSystemsMetricPayload } = await import('./derived-metrics.service');
        const fit = fitThreeDimensionalCapacityModel([
            datedCurve('rowing', ActivityTypes.Rowing, asOfDayMs - DAY_MS),
        ], { effectiveDate: '2026-07-20' });
        const invalidFit = {
            ...fit,
            status: 'ready',
            reason: null,
            criticalPower: { status: 'ready', reason: null, value: Number.NaN },
            wPrime: { status: 'ready', reason: null, value: 18_500 },
            maximumPower: { status: 'ready', reason: null, value: 1_200 },
        } as any;

        const result = buildTrainingPowerSystemsMetricPayload(
            [source('rowing', ActivityTypes.Rowing, asOfDayMs - DAY_MS)],
            nowMs,
            () => invalidFit,
        );
        const current = result.payload.activityTypes[0].current;

        expect(current).toMatchObject({
            status: 'invalid-input',
            reason: 'invalid-source',
            criticalPower: { status: 'invalid-input', reason: 'invalid-source', value: null },
            wPrime: { status: 'invalid-input', reason: 'invalid-source', value: null },
            maximumPower: { status: 'invalid-input', reason: 'invalid-source', value: null },
        });
        expect(result.payload.activityTypes[0].history.at(-1)).toMatchObject({
            status: 'invalid-input',
            criticalPowerWatts: null,
            wPrimeJoules: null,
            maximumPowerWatts: null,
        });
    });

    it.each([
        {
            name: 'an impossible overall status and reason pairing',
            mutate: (fit: any) => ({
                ...fit,
                status: 'poor-fit',
                reason: 'invalid-source',
                criticalPower: { status: 'poor-fit', reason: 'invalid-source', value: null },
                wPrime: { status: 'poor-fit', reason: 'invalid-source', value: null },
                maximumPower: { status: 'poor-fit', reason: 'invalid-source', value: null },
            }),
        },
        {
            name: 'a partial reason that disagrees with the maximum-power status',
            mutate: (fit: any) => ({
                ...fit,
                status: 'partial',
                reason: 'poor-maximum-power-fit',
                criticalPower: { status: 'ready', reason: null, value: 260 },
                wPrime: { status: 'ready', reason: null, value: 18_500 },
                maximumPower: {
                    status: 'insufficient-evidence',
                    reason: 'poor-maximum-power-fit',
                    value: null,
                },
            }),
        },
        {
            name: 'a ready component carrying an unavailable reason',
            mutate: (fit: any) => ({
                ...fit,
                status: 'ready',
                reason: null,
                criticalPower: { status: 'ready', reason: 'invalid-source', value: 260 },
                wPrime: { status: 'ready', reason: null, value: 18_500 },
                maximumPower: { status: 'ready', reason: null, value: 1_200 },
            }),
        },
    ])('degrades $name before persistence', async ({ mutate }) => {
        const { buildTrainingPowerSystemsMetricPayload } = await import('./derived-metrics.service');
        const fit = fitThreeDimensionalCapacityModel([
            datedCurve('rowing', ActivityTypes.Rowing, asOfDayMs - DAY_MS),
        ], { effectiveDate: '2026-07-20' });

        const result = buildTrainingPowerSystemsMetricPayload(
            [source('rowing', ActivityTypes.Rowing, asOfDayMs - DAY_MS)],
            nowMs,
            () => mutate(fit),
        );

        expect(result.payload.activityTypes[0].current).toMatchObject({
            status: 'invalid-input',
            reason: 'invalid-source',
            criticalPower: { status: 'invalid-input', reason: 'invalid-source', value: null },
            wPrime: { status: 'invalid-input', reason: 'invalid-source', value: null },
            maximumPower: { status: 'invalid-input', reason: 'invalid-source', value: null },
        });
    });

    it('inherits merged-event and malformed-date exclusion from the canonical parent/activity join', async () => {
        const {
            buildTrainingPowerSystemsMetricPayload,
            joinTrainingActivitySources,
        } = await import('./derived-metrics.service');
        const eventDoc = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });
        const activityDoc = (id: string, eventID: string, data: Record<string, unknown>) => ({
            id,
            data: () => ({ eventID, ...data }),
        });
        const events = [
            eventDoc('valid', { startDate: asOfDayMs - DAY_MS }),
            eventDoc('merged', { startDate: asOfDayMs - DAY_MS, mergeType: 'benchmark' }),
            eventDoc('bad-date', { startDate: 'not-a-date' }),
        ];
        const activities = [
            activityDoc('valid-activity', 'valid', {
                type: ActivityTypes.Rowing,
                stats: { [DataDuration.type]: 3600, [POWER_CURVE_STAT_TYPE]: powerCurve },
            }),
            activityDoc('merged-activity', 'merged', {
                type: ActivityTypes.Rowing,
                stats: { [DataDuration.type]: 3600, [POWER_CURVE_STAT_TYPE]: powerCurve },
            }),
            activityDoc('bad-date-activity', 'bad-date', {
                type: ActivityTypes.Rowing,
                stats: { [DataDuration.type]: 3600, [POWER_CURVE_STAT_TYPE]: powerCurve },
            }),
        ];

        const joined = joinTrainingActivitySources(activities as never, events as never, {
            includeUnclassified: true,
        });
        const result = buildTrainingPowerSystemsMetricPayload(joined, nowMs);

        expect(joined.map(item => item.activityId)).toEqual(['valid-activity']);
        expect(result.sourceEventCount).toBe(1);
        expect(result.payload.activityTypes[0].evidenceCounts.candidateActivityCount).toBe(1);
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
                [DataDistance.type]: 10_000,
                [DataVO2Max.type]: 51,
                [DataFTP.type]: 250,
            }),
            createEvent(baselineRunningDay, 'Trail Running', 'Garmin', {
                [DataDistance.type]: 9_000,
                [DataAscent.type]: 400,
                [DataVO2Max.type]: 49,
                [DataFTP.type]: 230,
            }),
            createEvent(baselineRunningDayTwo, 'Treadmill', 'Garmin', {
                [DataDistance.type]: 6_000,
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
        expect(running?.current28d.contexts).toEqual([expect.objectContaining({
            context: 'running',
            profile: 'endurance',
            activityCount: 1,
            metrics: expect.arrayContaining([
                { metric: 'distance', value: 10_000, sourceActivityCount: 1 },
                { metric: 'moving-time', value: 3_600, sourceActivityCount: 1 },
                { metric: 'elapsed-time', value: 3_600, sourceActivityCount: 1 },
            ]),
        })]);
        expect(running?.baseline28d.contexts).toEqual([
            expect.objectContaining({
                context: 'trail-running',
                activityCount: 0.33,
                metrics: expect.arrayContaining([
                    { metric: 'distance', value: 3_000, sourceActivityCount: 0.33 },
                    { metric: 'ascent', value: 133.33, sourceActivityCount: 0.33 },
                ]),
            }),
            expect.objectContaining({
                context: 'indoor-running',
                activityCount: 0.33,
                metrics: expect.arrayContaining([
                    { metric: 'distance', value: 2_000, sourceActivityCount: 0.33 },
                ]),
            }),
        ]);
        expect(cycling?.current28d.activityCount).toBe(1);
        expect(running).not.toHaveProperty('vo2Max');
        expect(running).not.toHaveProperty('ftp');
        expect(cycling).not.toHaveProperty('criticalPower');
    });

    it('combines generic provider cycling and refined names in the same Training context', async () => {
        const { buildTrainingSummaryMetricPayload } = await import('./derived-metrics.service');
        const currentDay = Date.UTC(2026, 6, 8);
        const activities = buildTrainingActivitySources([
            createEvent(currentDay, 'Cycling', 'Suunto', { [DataDistance.type]: 20_000 }),
            createEvent(currentDay, 'Road Cycling', 'Garmin', { [DataDistance.type]: 30_000 }),
        ]);
        const result = buildTrainingSummaryMetricPayload(activities, nowMs);
        const cycling = result.payload.disciplines.find(summary => summary.discipline === 'cycling');
        const other = result.payload.disciplines.find(summary => summary.discipline === 'other-training');
        expect(cycling?.current28d).toMatchObject({ activityCount: 2, durationSeconds: 7_200 });
        expect(cycling?.current28d.contexts).toEqual([expect.objectContaining({
            context: 'cycling',
            activityCount: 2,
            metrics: expect.arrayContaining([{ metric: 'distance', value: 50_000, sourceActivityCount: 2 }]),
        })]);
        expect(other?.current28d.activityCount).toBe(0);
        expect(activities.map(activity => activity.activityData.type)).toEqual(['Cycling', 'Road Cycling']);
    });

    it('builds all registered sport families while keeping gravity and strength volume-only', async () => {
        const { buildTrainingSummaryMetricPayload } = await import('./derived-metrics.service');
        const currentDay = Date.UTC(2026, 6, 8);
        const docs = [
            createEvent(currentDay, ActivityTypes.Rowing, 'Garmin', {
                [DataDistance.type]: 2_000,
                [DataDuration.type]: 480,
                [DataCadenceAvg.type]: 28,
                [DataAvgStrokeDistance.type]: 10,
            }),
            createEvent(currentDay, ActivityTypes.Hiking, 'Garmin'),
            createEvent(currentDay, ActivityTypes.RollerSki, 'Garmin'),
            createEvent(currentDay, ActivityTypes.StrengthTraining, 'Garmin'),
            createEvent(currentDay, ActivityTypes.Kayaking, 'Garmin', {
                [DataStrokeRateAvg.type]: 42,
            }),
            createEvent(currentDay, ActivityTypes.Swimming, 'Garmin', {
                [DataSwimDistance.type]: 1_500,
                [DataCadenceAvg.type]: 30,
            }),
            createEvent(currentDay, ActivityTypes['Enduro MTB'], 'Garmin'),
            createEvent(currentDay, ActivityTypes.DownhillCycling, 'Garmin', {
                [DataDistance.type]: 12_000,
                [DataDuration.type]: 1_800,
                [DataDescent.type]: 900,
                [DataDescentTime.type]: 600,
                [DataJumpCount.type]: 12,
                [DataJumpDistanceMax.type]: 7.4,
                [DataGrit.type]: 18,
                [DataFlow.type]: 6,
            }),
        ];

        const result = buildTrainingSummaryMetricPayload(buildTrainingActivitySources(docs), nowMs);
        const currentBySport = Object.fromEntries(result.payload.disciplines.map(
            item => [item.discipline, item.current28d],
        ));

        expect(result.sourceEventCount).toBe(8);
        expect(currentBySport.rowing).toMatchObject({ activityCount: 1, easySeconds: 1200, moderateSeconds: 1200, hardSeconds: 600 });
        expect(currentBySport['walking-hiking']).toMatchObject({ activityCount: 1, easySeconds: 1200 });
        expect(currentBySport['nordic-skiing']).toMatchObject({ activityCount: 1, easySeconds: 1200 });
        expect(currentBySport.paddling).toMatchObject({ activityCount: 1, easySeconds: 1200 });
        expect(currentBySport.swimming.contexts).toEqual([expect.objectContaining({
            context: 'pool-swimming',
            metrics: expect.arrayContaining([
                { metric: 'distance', value: 1_500, sourceActivityCount: 1 },
                { metric: 'stroke-rate', value: 30, sourceActivityCount: 1 },
            ]),
        })]);
        expect(currentBySport.strength).toMatchObject({ activityCount: 1, durationSeconds: 3600, easySeconds: 0, moderateSeconds: 0, hardSeconds: 0 });
        expect(currentBySport.cycling).toMatchObject({ activityCount: 2, durationSeconds: 5400, easySeconds: 0, moderateSeconds: 0, hardSeconds: 0 });
        expect(currentBySport.rowing.contexts).toEqual([expect.objectContaining({
            context: 'on-water-rowing',
            metrics: expect.arrayContaining([
                { metric: 'pace-500m', value: 120, sourceActivityCount: 1 },
                { metric: 'stroke-rate', value: 28, sourceActivityCount: 1 },
                { metric: 'stroke-distance', value: 10, sourceActivityCount: 1 },
            ]),
        })]);
        expect(currentBySport.paddling.contexts).toEqual([expect.objectContaining({
            context: 'kayaking',
            metrics: expect.arrayContaining([
                { metric: 'stroke-rate', value: 42, sourceActivityCount: 1 },
            ]),
        })]);
        expect(currentBySport.cycling.contexts).toEqual(expect.arrayContaining([
            expect.objectContaining({
                context: 'downhill',
                profile: 'gravity',
                metrics: expect.arrayContaining([
                    { metric: 'descent', value: 900, sourceActivityCount: 1 },
                    { metric: 'descent-time', value: 600, sourceActivityCount: 1 },
                    { metric: 'jump-count', value: 12, sourceActivityCount: 1 },
                    { metric: 'max-jump-distance', value: 7.4, sourceActivityCount: 1 },
                    { metric: 'grit', value: 18, sourceActivityCount: 1 },
                    { metric: 'flow', value: 6, sourceActivityCount: 1 },
                ]),
            }),
        ]));
    });

    it.each([
        ['Classic Roller Skiing', ActivityTypes.RollerSki, 'nordic-skiing', 'roller-skiing'],
        ['Skate Roller Skiing', ActivityTypes.RollerSki, 'nordic-skiing', 'roller-skiing'],
        ['Virtual Rowing', ActivityTypes.IndoorRowing, 'rowing', 'indoor-rowing'],
        ['Whitewater Kayaking', ActivityTypes.Kayaking, 'paddling', 'kayaking'],
    ])('combines %s with %s while counting saved TSS and recorded zones', async (sport, baseSport, discipline, context) => {
        const { buildTrainingSummaryMetricPayload, buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const currentDay = Date.UTC(2026, 6, 8);
        const activities = buildTrainingActivitySources([currentDay, Date.UTC(2026, 3, 1)].flatMap(day => [
            createEvent(day, sport, 'Garmin', {
                [DataDistance.type]: 2_000, 'Training Stress Score': 71.25, [DataStrokeRateAvg.type]: 42,
            }),
            createEvent(day, baseSport, 'Polar', {
                [DataDistance.type]: 3_000, 'Training Stress Score': 0, [DataStrokeRateAvg.type]: 38,
            }),
        ]));
        const result = buildTrainingSummaryMetricPayload(activities, nowMs);
        const current = result.payload.disciplines.find(item => item.discipline === discipline)?.current28d;
        expect(result.sourceEventCount).toBe(4);
        expect(current).toMatchObject({
            activityCount: 2, durationSeconds: 7_200,
            easySeconds: 2_400, moderateSeconds: 2_400, hardSeconds: 1_200,
        });
        expect(current?.contexts).toEqual([expect.objectContaining({
            context, activityCount: 2,
            metrics: expect.arrayContaining([{ metric: 'distance', value: 5_000, sourceActivityCount: 2 }]),
        })]);
        if (discipline !== 'nordic-skiing') {
            expect(current?.contexts[0].metrics).toContainEqual({ metric: 'stroke-rate', value: 40, sourceActivityCount: 2 });
        }
        expect(result.payload.disciplines.find(item => item.discipline === 'other-training')?.current28d.activityCount).toBe(0);
        expect(activities.map(activity => activity.activityData.type)).toEqual([sport, baseSport, sport, baseSport]);
        const build = buildTrainingBuildComparisonMetricPayload(activities, {
            trainingSettings: { buildBenchmarks: {
                [discipline]: { mode: 'period', durationWeeks: 8, endDayMs: Date.UTC(2026, 3, 30) },
            } },
        }, nowMs).payload.disciplines.find(item => item.discipline === discipline);
        expect(build?.status).toBe('ready');
        for (const window of [build?.current, build?.benchmark]) {
            expect(window).toMatchObject({ activityCount: 2, trainingStressScore: 71.25, trainingStressScoreEventCount: 2 });
        }
    });

    it('counts all approved fitness and mobility recordings with saved TSS and strength-only Best Build', async () => {
        const { buildTrainingSummaryMetricPayload, buildTrainingBuildComparisonMetricPayload, buildTrainingExplanationMetricPayload } = await import('./derived-metrics.service');
        const groups = [
            { sport: 'strength', context: 'strength', names: ['Calisthenics', 'Core Training', 'LES MILLS CORE', 'LES MILLS GRIT Strength'] },
            { sport: 'fitness-gym', context: 'conditioning', names: [
                'Bootcamp', 'Functional Training', 'Fitness Boxing', 'Fitness Dancing', 'Fitness Martial Arts',
                'Jump Rope', 'Step Training', 'LES MILLS BODYATTACK', 'LES MILLS BODYCOMBAT', 'LES MILLS BODYJAM',
                'LES MILLS BODYSTEP', 'LES MILLS GRIT Athletic', 'LES MILLS GRIT Cardio', "LES MILLS SH'BAM", 'LES MILLS TONE',
            ] },
            { sport: 'fitness-gym', context: 'mobility-fitness', names: [
                'Barre', 'Mobility', 'Dynamic Mobility', 'Static Mobility', 'Mind-Body Training', 'Physical Therapy',
                'LES MILLS BARRE', 'LES MILLS BODYBALANCE',
            ] },
            { sport: 'fitness-gym', context: 'general-fitness', names: ['Indoor Skiing', 'Indoor Grinding', 'Trucker Workout'] },
        ];
        const names = groups.flatMap(group => group.names);
        const docs = [Date.UTC(2026, 6, 8), Date.UTC(2026, 3, 1)].flatMap(day => names.flatMap(name => [
            createEvent(day, name, 'Polar', { [DataDistance.type]: 2_000, 'Training Stress Score': 71.25 }),
            createEvent(day, name, 'Garmin', { [DataDistance.type]: 3_000, 'Training Stress Score': 0 }),
        ]));
        const activities = buildTrainingActivitySources(docs);
        const result = buildTrainingSummaryMetricPayload(activities, nowMs);
        expect(result.sourceEventCount).toBe(120);
        for (const { sport, context, names: contextNames } of groups) {
            const current = result.payload.disciplines.find(item => item.discipline === sport)?.current28d;
            expect(current?.contexts).toContainEqual(expect.objectContaining({
                context, activityCount: contextNames.length * 2,
                metrics: [{ metric: 'elapsed-time', value: contextNames.length * 7_200, sourceActivityCount: contextNames.length * 2 }],
            }));
            expect(current).toMatchObject({ easySeconds: 0, moderateSeconds: 0, hardSeconds: 0 });
        }
        expect(result.payload.disciplines.find(item => item.discipline === 'strength')?.current28d.activityCount).toBe(8);
        expect(result.payload.disciplines.find(item => item.discipline === 'fitness-gym')?.current28d.activityCount).toBe(52);
        expect(result.payload.disciplines.find(item => item.discipline === 'other-training')?.current28d.activityCount).toBe(0);
        expect(activities.map(activity => activity.activityData.type)).toEqual([names, names].flatMap(windowNames => windowNames.flatMap(name => [name, name])));
        const build = buildTrainingBuildComparisonMetricPayload(activities, {
            trainingSettings: { buildBenchmarks: {
                strength: { mode: 'period', durationWeeks: 8, endDayMs: Date.UTC(2026, 3, 30) },
            } },
        }, nowMs).payload;
        const strength = build.disciplines.find(item => item.discipline === 'strength');
        expect(strength?.status).toBe('ready');
        for (const window of [strength?.current, strength?.benchmark]) {
            expect(window).toMatchObject({ activityCount: 8, trainingStressScore: 285, trainingStressScoreEventCount: 8 });
        }
        expect(build.disciplines.find(item => item.discipline === 'fitness-gym')).toMatchObject({
            status: 'not-configured', current: null, benchmark: null, suggestedEvents: [],
        });
        const explanation = buildTrainingExplanationMetricPayload(docs as never, activities, nowMs).payload.current;
        expect(explanation).toMatchObject({
            parentTrainingStressScore: 2_137.5, childTrainingStressScore: 2_137.5,
            childActivityCount: 60, childLoadActivityCount: 60,
            childLoadCoverage: { loadedCount: 60, totalCount: 60, ratio: 1 },
        });
        expect(explanation.sportLoads).toEqual(expect.arrayContaining([
            expect.objectContaining({ sport: 'strength', activityCount: 8, loadActivityCount: 8, trainingStressScore: 285 }),
            expect.objectContaining({ sport: 'fitness-gym', activityCount: 52, loadActivityCount: 52, trainingStressScore: 1_852.5 }),
        ]));
    });

    it.each([
        ['Rucking', 'walking-hiking', 'rucking', true, true],
        ['Orienteering', 'running', 'orienteering', true, true],
        ['Ski Orienteering', 'nordic-skiing', 'ski-orienteering', true, true],
        ['Biathlon', 'nordic-skiing', 'biathlon', true, true],
        ['Fitness Racing', 'fitness-gym', 'conditioning', false, false],
        ['Aqua Fitness', 'fitness-gym', 'conditioning', false, false],
        ['Water Running', 'fitness-gym', 'water-running', true, false],
        ['Wheel Chair', 'wheelchair', 'wheelchair-general', true, true],
        ['Wheelchair Push Walk', 'wheelchair', 'wheelchair-push-walk', true, true],
        ['Wheelchair Push Run', 'wheelchair', 'wheelchair-push-run', true, true],
        ['Indoor Wheelchair Push Walk', 'wheelchair', 'indoor-wheelchair-push-walk', true, true],
        ['Indoor Wheelchair Push Run', 'wheelchair', 'indoor-wheelchair-push-run', true, true],
        ['Wheelchair Racing', 'wheelchair', 'wheelchair-racing', true, true],
    ])('builds %s summaries with saved TSS, recorded zones and distinct comparisons', async (name, sport, context, zones, distance) => {
        const { buildTrainingSummaryMetricPayload, buildTrainingBuildComparisonMetricPayload, buildTrainingExplanationMetricPayload } = await import('./derived-metrics.service');
        const docs = [Date.UTC(2026, 6, 8), Date.UTC(2026, 3, 1)].flatMap(day => [
            createEvent(day, name, 'Garmin', {
                [DataDistance.type]: 2_000, 'Training Stress Score': 71.25,
                [DataPowerZoneOneDuration.type]: 300,
                [DataPowerZoneThreeDuration.type]: 400,
                [DataPowerZoneFiveDuration.type]: 500,
            }),
            createEvent(day, name, 'Polar', { [DataDistance.type]: 3_000, 'Training Stress Score': 0 }),
        ]);
        const activities = buildTrainingActivitySources(docs);
        const summary = buildTrainingSummaryMetricPayload(activities, nowMs);
        expect(summary.sourceEventCount).toBe(4);
        const current = summary.payload.disciplines.find(item => item.discipline === sport)?.current28d;
        expect(current).toMatchObject({
            activityCount: 2, durationSeconds: 7_200,
            easySeconds: zones ? 1_500 : 0,
            moderateSeconds: zones ? 1_600 : 0,
            hardSeconds: zones ? 1_100 : 0,
        });
        expect(current?.contexts).toEqual([expect.objectContaining({ context, activityCount: 2 })]);
        const metrics = current?.contexts[0].metrics;
        expect(metrics).toContainEqual({ metric: 'elapsed-time', value: 7_200, sourceActivityCount: 2 });
        if (distance) {
            expect(metrics).toContainEqual({ metric: 'distance', value: 5_000, sourceActivityCount: 2 });
        } else {
            expect(metrics).toHaveLength(1);
        }
        const build = buildTrainingBuildComparisonMetricPayload(activities, {
            trainingSettings: { buildBenchmarks: {
                [sport]: { mode: 'period', durationWeeks: 8, endDayMs: Date.UTC(2026, 3, 30) },
            } },
        }, nowMs).payload.disciplines.find(item => item.discipline === sport);
        if (sport === 'fitness-gym') {
            expect(build).toMatchObject({ status: 'not-configured', current: null, benchmark: null });
        } else {
            expect(build?.status).toBe('ready');
            for (const window of [build?.current, build?.benchmark]) {
                expect(window).toMatchObject({ activityCount: 2, trainingStressScore: 71.25, trainingStressScoreEventCount: 2 });
                expect(window?.contexts).toEqual([expect.objectContaining({ context, activityCount: 2 })]);
            }
        }
        const explanation = buildTrainingExplanationMetricPayload(docs as never, activities, nowMs).payload.current;
        expect(explanation).toMatchObject({ parentTrainingStressScore: 71.25, childTrainingStressScore: 71.25 });
        expect(explanation.sportLoads).toContainEqual(expect.objectContaining({
            sport, activityCount: 2, loadActivityCount: 2, trainingStressScore: 71.25,
        }));
        expect(activities.map(activity => activity.activityData.type)).toEqual([name, name, name, name]);
    });

    it.each([
        ['Snowshoeing', 'walking-hiking', 'snowshoeing', true, ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent']],
        ['Bouldering', 'climbing-mountaineering', 'bouldering', false, ['elapsed-time', 'ascent']],
        ['Climbing', 'climbing-mountaineering', 'climbing', false, ['elapsed-time', 'ascent']],
        ['Rock Climbing', 'climbing-mountaineering', 'rock-climbing', false, ['elapsed-time', 'ascent']],
        ['Indoor Climbing', 'climbing-mountaineering', 'indoor-climbing', false, ['elapsed-time', 'ascent']],
        ['Via Ferrata', 'climbing-mountaineering', 'via-ferrata', false, ['elapsed-time', 'ascent']],
        ['Mountaineering', 'climbing-mountaineering', 'mountaineering', true, ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent']],
        ['Ski Touring', 'mountain-snow', 'ski-touring', true, ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time']],
        ['Ski Mountaineering', 'mountain-snow', 'ski-mountaineering', true, ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time']],
        ['Backcountry Skiing', 'mountain-snow', 'backcountry-skiing', true, ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time']],
        ['Backcountry Snowboarding', 'mountain-snow', 'backcountry-snowboarding', true, ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time']],
        ['Splitboarding', 'mountain-snow', 'splitboarding', true, ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time']],
        ['Alpine Skiing', 'mountain-snow', 'alpine-skiing', false, ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time']],
        ['Snowboarding', 'mountain-snow', 'snowboarding', false, ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time']],
        ['Telemark Skiing', 'mountain-snow', 'telemark-skiing', false, ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time']],
        ['Inline Skating', 'skating', 'inline-skating', true, ['distance', 'moving-time', 'elapsed-time']],
        ['Skating', 'skating', 'skating', false, ['distance', 'moving-time', 'elapsed-time']],
        ['Ice Skating', 'skating', 'ice-skating', false, ['distance', 'moving-time', 'elapsed-time']],
        ['Skateboarding', 'skating', 'skateboarding', false, ['distance', 'moving-time', 'elapsed-time']],
        ['Boxing', 'combat-martial-arts', 'boxing', false, ['elapsed-time']],
        ['Combat', 'combat-martial-arts', 'combat', false, ['elapsed-time']],
        ['Judo', 'combat-martial-arts', 'judo', false, ['elapsed-time']],
        ['Kickboxing', 'combat-martial-arts', 'kickboxing', false, ['elapsed-time']],
        ['Mixed Martial Arts', 'combat-martial-arts', 'mixed-martial-arts', false, ['elapsed-time']],
        ['Taekwondo', 'combat-martial-arts', 'taekwondo', false, ['elapsed-time']],
        ['Ballet Dancing', 'dance', 'ballet-dancing', false, ['elapsed-time']],
        ['Ballroom Dancing', 'dance', 'ballroom-dancing', false, ['elapsed-time']],
        ['Dancing', 'dance', 'dancing', false, ['elapsed-time']],
        ['Jazz Dancing', 'dance', 'jazz-dancing', false, ['elapsed-time']],
        ['Latin Dancing', 'dance', 'latin-dancing', false, ['elapsed-time']],
        ['Modern Dancing', 'dance', 'modern-dancing', false, ['elapsed-time']],
        ['Show Dancing', 'dance', 'show-dancing', false, ['elapsed-time']],
        ['Street Dancing', 'dance', 'street-dancing', false, ['elapsed-time']],
        ['Basketball', 'team-sports', 'basketball', false, ['elapsed-time']],
        ['Wheelchair Basketball', 'team-sports', 'wheelchair-basketball', false, ['elapsed-time']],
        ['Football', 'team-sports', 'football', false, ['elapsed-time']],
        ['Soccer', 'team-sports', 'soccer', false, ['elapsed-time']],
        ['Volleyball', 'team-sports', 'volleyball', false, ['elapsed-time']],
        ['Beach Volleyball', 'team-sports', 'beach-volleyball', false, ['elapsed-time']],
        ['Badminton', 'racket-sports', 'badminton', false, ['elapsed-time']],
        ['Beach Tennis', 'racket-sports', 'beach-tennis', false, ['elapsed-time']],
        ['Padel', 'racket-sports', 'padel', false, ['elapsed-time']],
        ['Pickleball', 'racket-sports', 'pickleball', false, ['elapsed-time']],
        ['Platform Tennis', 'racket-sports', 'platform-tennis', false, ['elapsed-time']],
        ['Racket Sport', 'racket-sports', 'racket-sport', false, ['elapsed-time']],
        ['Racquet Ball', 'racket-sports', 'racquet-ball', false, ['elapsed-time']],
        ['Squash', 'racket-sports', 'squash', false, ['elapsed-time']],
        ['Table Tennis', 'racket-sports', 'table-tennis', false, ['elapsed-time']],
        ['Tennis', 'racket-sports', 'tennis', false, ['elapsed-time']],
        ['Wheelchair Tennis', 'racket-sports', 'wheelchair-tennis', false, ['elapsed-time']],
        ...APPROVED_WATER_TEAM_SPORT_CASES.map(item => [item.name, item.sport, item.context, item.zones, item.metrics] as const),
        ...APPROVED_REMAINING_SPORT_CASES.filter(item => item.sport !== 'fitness-gym')
            .map(item => [item.name, item.sport, item.context, item.zones, item.metrics] as const),
    ] as const)('builds %s with its own comparison, recorded metrics and preserved positive/zero/missing TSS', async (name, sport, context, zones, expectedMetricIds) => {
        const { buildTrainingSummaryMetricPayload, buildTrainingBuildComparisonMetricPayload, buildTrainingExplanationMetricPayload } = await import('./derived-metrics.service');
        const docs = [Date.UTC(2026, 6, 8), Date.UTC(2026, 3, 1)].flatMap(day => [
            createEvent(day, name, 'Garmin', {
                [DataStrokeRateAvg.type]: 60, [DataAvgStrokeDistance.type]: 3,
                [DataDistance.type]: 2_000, [DataAscent.type]: 120, [DataDescent.type]: 80, [DataDescentTime.type]: 240,
                'Training Stress Score': 71.25,
                [DataPowerZoneOneDuration.type]: 300, [DataPowerZoneThreeDuration.type]: 400, [DataPowerZoneFiveDuration.type]: 500,
            }),
            createEvent(day, name, 'Polar', {
                [DataStrokeRateAvg.type]: 0, [DataAvgStrokeDistance.type]: 0,
                [DataDistance.type]: 3_000, [DataAscent.type]: 0, [DataDescent.type]: 0, [DataDescentTime.type]: 0,
                'Training Stress Score': 0,
            }),
            createEvent(day, name, 'Suunto', {
                [DataStrokeRateAvg.type]: -1, [DataAvgStrokeDistance.type]: -1,
                [DataDistance.type]: -1, [DataAscent.type]: -1, [DataDescent.type]: -1, [DataDescentTime.type]: -1,
                [DataHeartRateZoneOneDuration.type]: 0, [DataHeartRateZoneThreeDuration.type]: 0, [DataHeartRateZoneFiveDuration.type]: 0,
            }),
        ]);
        const activities = buildTrainingActivitySources(docs);
        const summary = buildTrainingSummaryMetricPayload(activities, nowMs);
        expect(summary.sourceEventCount).toBe(6);
        const current = summary.payload.disciplines.find(item => item.discipline === sport)?.current28d;
        expect(current).toMatchObject({ activityCount: 3, durationSeconds: 10_800,
            easySeconds: zones ? 1_500 : 0, moderateSeconds: zones ? 1_600 : 0, hardSeconds: zones ? 1_100 : 0,
        });
        expect(current?.contexts).toHaveLength(1);
        expect(current?.contexts[0]).toMatchObject({ context, activityCount: 3 });
        const metricValues = {
            distance: [5_000, 2], 'moving-time': [10_800, 3], 'elapsed-time': [10_800, 3],
            ascent: [120, 2], descent: [80, 2], 'descent-time': [240, 2], 'stroke-rate': [30, 2], 'stroke-distance': [1.5, 2],
        };
        expect(current?.contexts[0].metrics).toEqual(expectedMetricIds.map(metric => ({
            metric, value: metricValues[metric][0], sourceActivityCount: metricValues[metric][1],
        })));
        expect(summary.payload.disciplines.find(item => item.discipline === 'other-training')?.current28d.activityCount).toBe(0);
        const build = buildTrainingBuildComparisonMetricPayload(activities, {
            trainingSettings: { buildBenchmarks: { [sport]: { mode: 'period', durationWeeks: 8, endDayMs: Date.UTC(2026, 3, 30) } } },
        }, nowMs).payload.disciplines.find(item => item.discipline === sport);
        expect(build?.status).toBe('ready');
        for (const window of [build?.current, build?.benchmark]) {
            expect(window).toMatchObject({ activityCount: 3, durationSeconds: 10_800,
                trainingStressScore: 71.25, trainingStressScoreEventCount: 2, durability: null,
                easySeconds: zones ? 1_500 : null, moderateSeconds: zones ? 1_600 : null, hardSeconds: zones ? 1_100 : null,
                intensitySourceEventCount: zones ? 2 : 0,
                distanceMeters: expectedMetricIds.some(metric => metric === 'distance') ? 5_000 : null,
                distanceEventCount: expectedMetricIds.some(metric => metric === 'distance') ? 2 : 0,
            });
            expect(window?.contexts).toEqual(current?.contexts);
        }
        const explanation = buildTrainingExplanationMetricPayload(docs as never, activities, nowMs).payload.current;
        expect(explanation).toMatchObject({ parentTrainingStressScore: 71.25, childTrainingStressScore: 71.25,
            childActivityCount: 3, childLoadActivityCount: 2,
        });
        expect(explanation.sportLoads).toContainEqual(expect.objectContaining({ sport, activityCount: 3,
            loadActivityCount: 2, trainingStressScore: 71.25,
        }));
        expect(activities.map(activity => activity.activityData.type)).toEqual(Array(6).fill(name));
    });

    it.each([
        ...APPROVED_REMAINING_SPORT_CASES.filter(item => item.sport === 'fitness-gym'),
        ...APPROVED_OTHER_TRAINING_NAMES.map(name => ({ name, sport: 'other-training', context: 'other-training' })),
    ])('keeps $name saved load and elapsed time in its mix-only context', async ({ name, sport, context }) => {
        const { buildTrainingSummaryMetricPayload, buildTrainingBuildComparisonMetricPayload, buildTrainingExplanationMetricPayload } = await import('./derived-metrics.service');
        const docs = [71.25, 0, undefined].map(score => createEvent(Date.UTC(2026, 6, 8), name, 'Garmin', {
            ...(score === undefined ? {} : { 'Training Stress Score': score }),
            [DataDistance.type]: 2_000, [DataAscent.type]: 120,
            [DataPowerZoneOneDuration.type]: 300, [DataPowerZoneFiveDuration.type]: 500,
        }));
        const activities = buildTrainingActivitySources(docs);
        const current = buildTrainingSummaryMetricPayload(activities, nowMs).payload.disciplines
            .find(item => item.discipline === sport)?.current28d;
        expect(current).toMatchObject({ activityCount: 3, durationSeconds: 10_800,
            easySeconds: 0, moderateSeconds: 0, hardSeconds: 0,
            contexts: [{ context, profile: 'general', activityCount: 3, metrics: [
                { metric: 'elapsed-time', value: 10_800, sourceActivityCount: 3 },
            ] }],
        });
        const explanation = buildTrainingExplanationMetricPayload(docs as never, activities, nowMs).payload.current;
        expect(explanation.sportLoads).toContainEqual(expect.objectContaining({ sport, activityCount: 3,
            loadActivityCount: 2, trainingStressScore: 71.25 }));
        expect(buildTrainingBuildComparisonMetricPayload(activities, {}, nowMs).payload.disciplines
            .find(item => item.discipline === sport)).toMatchObject({ status: 'not-configured', current: null, benchmark: null });
        expect(activities.map(activity => activity.activityData.type)).toEqual(Array(3).fill(name));
    });

    it('summarizes floor climbing with recorded ascent, saved load and power-first intensity', async () => {
        const { buildTrainingSummaryMetricPayload, buildTrainingBuildComparisonMetricPayload, buildTrainingExplanationMetricPayload } = await import('./derived-metrics.service');
        const docs = [Date.UTC(2026, 6, 8), Date.UTC(2026, 3, 1)].flatMap(day => [
            createEvent(day, 'Floor Climbing', 'Garmin', {
                [DataDistance.type]: 2_000, [DataDescent.type]: 120, [DataAscent.type]: 120,
                'Training Stress Score': 71.25,
                [DataPowerZoneOneDuration.type]: 300,
                [DataPowerZoneThreeDuration.type]: 400,
                [DataPowerZoneFiveDuration.type]: 500,
            }),
            createEvent(day, 'Floor Climbing', 'Polar', {
                [DataDistance.type]: 3_000, [DataAscent.type]: 0, 'Training Stress Score': 0,
            }),
            createEvent(day, 'Floor Climbing', 'Suunto', {
                [DataDistance.type]: 4_000, [DataAscent.type]: -30,
                [DataHeartRateZoneOneDuration.type]: 0,
                [DataHeartRateZoneThreeDuration.type]: 0,
                [DataHeartRateZoneFiveDuration.type]: 0,
            }),
        ]);
        const activities = buildTrainingActivitySources(docs);
        const summary = buildTrainingSummaryMetricPayload(activities, nowMs);
        expect(summary.sourceEventCount).toBe(6);
        const fitness = summary.payload.disciplines.find(item => item.discipline === 'fitness-gym');
        expect(fitness?.current28d).toMatchObject({
            activityCount: 3, durationSeconds: 10_800, easySeconds: 1_500, moderateSeconds: 1_600, hardSeconds: 1_100,
            contexts: [{ context: 'stair-climbing', profile: 'general', activityCount: 3, metrics: [
                { metric: 'elapsed-time', value: 10_800, sourceActivityCount: 3 },
                { metric: 'ascent', value: 120, sourceActivityCount: 2 },
            ] }],
        });
        expect(fitness?.baseline28d.contexts).toEqual([{ context: 'stair-climbing', profile: 'general', activityCount: 1, metrics: [
            { metric: 'elapsed-time', value: 3_600, sourceActivityCount: 1 },
            { metric: 'ascent', value: 40, sourceActivityCount: 0.67 },
        ] }]);
        expect(fitness?.current28d.contexts[0].metrics).toHaveLength(2);
        expect(summary.payload.disciplines.find(item => item.discipline === 'other-training')?.current28d.activityCount).toBe(0);
        const explanation = buildTrainingExplanationMetricPayload(docs as never, activities, nowMs).payload.current;
        expect(explanation).toMatchObject({
            parentTrainingStressScore: 71.25, childTrainingStressScore: 71.25,
            childActivityCount: 3, childLoadActivityCount: 2,
        });
        expect(explanation.sportLoads).toContainEqual(expect.objectContaining({
            sport: 'fitness-gym', activityCount: 3, loadActivityCount: 2, trainingStressScore: 71.25,
        }));
        expect(buildTrainingBuildComparisonMetricPayload(activities, {}, nowMs).payload.disciplines
            .find(item => item.discipline === 'fitness-gym')).toMatchObject({
                status: 'not-configured', current: null, benchmark: null,
            });
        expect(activities.map(activity => activity.activityData.type)).toEqual(Array(6).fill('Floor Climbing'));
    });

    it('keeps missing wheelchair load and intensity unavailable while counting recorded volume', async () => {
        const { buildTrainingSummaryMetricPayload, buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const activities = buildTrainingActivitySources([createEvent(Date.UTC(2026, 6, 8), 'Wheelchair Racing', 'Polar', {
            [DataHeartRateZoneOneDuration.type]: 0,
            [DataHeartRateZoneThreeDuration.type]: 0,
            [DataHeartRateZoneFiveDuration.type]: 0,
        })]);
        const current = buildTrainingSummaryMetricPayload(activities, nowMs).payload.disciplines
            .find(item => item.discipline === 'wheelchair')?.current28d;
        expect(current).toMatchObject({ activityCount: 1, durationSeconds: 3_600, easySeconds: 0, moderateSeconds: 0, hardSeconds: 0 });
        expect(current?.contexts[0].metrics).toEqual([
            { metric: 'moving-time', value: 3_600, sourceActivityCount: 1 },
            { metric: 'elapsed-time', value: 3_600, sourceActivityCount: 1 },
        ]);
        const build = buildTrainingBuildComparisonMetricPayload(activities, {
            trainingSettings: { buildBenchmarks: { wheelchair: {
                mode: 'period', durationWeeks: 8, endDayMs: Date.UTC(2026, 3, 30),
            } } },
        }, nowMs).payload.disciplines.find(item => item.discipline === 'wheelchair');
        expect(build?.current).toMatchObject({ activityCount: 1, trainingStressScore: null, trainingStressScoreEventCount: 0, intensitySourceEventCount: 0 });
    });

    it('keeps generic fitness and known unmodeled sports visible as volume-only training', async () => {
        const { buildTrainingSummaryMetricPayload } = await import('./derived-metrics.service');
        const currentDay = Date.UTC(2026, 6, 8);
        const result = buildTrainingSummaryMetricPayload(buildTrainingActivitySources([
            createEvent(currentDay, ActivityTypes.Training, 'Suunto'),
            createEvent(currentDay, 'Chores' as ActivityTypes, 'Garmin'),
            createEvent(currentDay, ActivityTypes.Triathlon, 'Garmin'),
        ]), nowMs);
        const fitness = result.payload.disciplines.find(item => item.discipline === 'fitness-gym');
        const other = result.payload.disciplines.find(item => item.discipline === 'other-training');

        expect(result.sourceEventCount).toBe(2);
        expect(fitness?.current28d).toMatchObject({
            activityCount: 1,
            durationSeconds: 3_600,
            easySeconds: 0,
            moderateSeconds: 0,
            hardSeconds: 0,
        });
        expect(fitness?.current28d.contexts).toEqual([expect.objectContaining({
            context: 'general-fitness',
            profile: 'general',
            activityCount: 1,
        })]);
        expect(other?.current28d).toMatchObject({
            activityCount: 1,
            durationSeconds: 3_600,
            easySeconds: 0,
            moderateSeconds: 0,
            hardSeconds: 0,
        });
        expect(other?.current28d.contexts).toEqual([expect.objectContaining({
            context: 'other-training',
            profile: 'general',
            activityCount: 1,
        })]);
    });

    it('keeps the longest MTB jump as a maximum without scaling the normalized baseline', async () => {
        const { buildTrainingSummaryMetricPayload } = await import('./derived-metrics.service');
        const docs = [
            createEvent(Date.UTC(2026, 6, 8), ActivityTypes.DownhillCycling, 'Garmin', {
                [DataJumpDistanceMax.type]: 4.2,
            }),
            createEvent(Date.UTC(2026, 6, 9), ActivityTypes.DownhillCycling, 'Garmin', {
                [DataJumpDistanceMax.type]: 7.8,
            }),
            createEvent(Date.UTC(2026, 6, 7), ActivityTypes.DownhillCycling, 'Garmin', {
                'Jump Distance Max': 8.6,
            }),
            createEvent(Date.UTC(2026, 5, 1), ActivityTypes.DownhillCycling, 'Garmin', {
                [DataJumpDistanceMax.type]: 8.1,
            }),
            createEvent(Date.UTC(2026, 4, 1), ActivityTypes.DownhillCycling, 'Garmin', {
                [DataJumpDistanceMax.type]: 6.4,
            }),
            createEvent(Date.UTC(2026, 3, 1), ActivityTypes.DownhillCycling, 'Garmin', {
                [DataJumpDistanceMax.type]: 9.2,
            }),
        ];

        const result = buildTrainingSummaryMetricPayload(buildTrainingActivitySources(docs), nowMs);
        const cycling = result.payload.disciplines.find(item => item.discipline === 'cycling');
        const currentMetric = cycling?.current28d.contexts[0]?.metrics
            .find(metric => metric.metric === 'max-jump-distance');
        const baselineMetric = cycling?.baseline28d.contexts[0]?.metrics
            .find(metric => metric.metric === 'max-jump-distance');

        expect(currentMetric).toEqual({
            metric: 'max-jump-distance',
            value: 8.6,
            sourceActivityCount: 3,
        });
        expect(baselineMetric).toEqual({
            metric: 'max-jump-distance',
            value: 9.2,
            sourceActivityCount: 1,
        });
    });
});

describe('training explanation and durability metrics', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const eventDoc = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });
    const activityDoc = (id: string, eventID: string, data: Record<string, unknown>) => ({
        id,
        data: () => ({ eventID, ...data }),
    });
    const aerobicEvidence = (
        decouplingPercent: number,
        overrides: Record<string, unknown> = {},
    ) => {
        const firstHalfOutput = 100;
        const firstHalfHeartRateBpm = 100;
        const secondHalfHeartRateBpm = 105;
        const secondHalfEfficiency = 1 - (decouplingPercent / 100);
        const secondHalfOutput = secondHalfEfficiency * secondHalfHeartRateBpm;
        return {
            protocolVersion: DURABILITY_PROTOCOL_VERSION,
            sourceFingerprint: 'durability-v1:0000000000000001',
            discipline: 'running',
            outputSource: 'grade-adjusted-speed',
            outputUnit: 'm/s',
            context: null,
            durationSeconds: 3600,
            qualifyingDurationSeconds: 3240,
            coverageRatio: 0.9,
            eligibility: {
                eligible: true,
                reason: 'eligible',
                validSampleCount: 3240,
                comparisonSegments: 'halves',
                earlySampleCount: 1620,
                lateSampleCount: 1620,
                outputCoefficientOfVariation: 0.03,
                hardZoneRatio: 0.05,
            },
            evidence: {
                kind: 'aerobic-efficiency',
                firstHalfEfficiency: 1,
                secondHalfEfficiency,
                decouplingPercent,
                firstHalfOutput,
                secondHalfOutput,
                outputRetentionPercent: (secondHalfOutput / firstHalfOutput) * 100,
                firstHalfHeartRateBpm,
                secondHalfHeartRateBpm,
                heartRateDriftBpm: secondHalfHeartRateBpm - firstHalfHeartRateBpm,
            },
            ...overrides,
        };
    };

    it('explains current load against prior-block medians with sport coverage and discipline rhythm', async () => {
        const {
            buildTrainingExplanationMetricPayload,
            joinTrainingActivitySources,
        } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 14, 12);
        const currentDayMs = Date.UTC(2026, 6, 12, 8);
        const eventDocs = [
            eventDoc('current', {
                name: 'Current brick',
                startDate: currentDayMs,
                stats: { 'Training Stress Score': 100 },
            }),
            ...[50, 70, 90].map((load, index) => eventDoc(`baseline-${index}`, {
                startDate: nowMs - ((35 + (index * 28)) * DAY_MS),
                stats: { 'Training Stress Score': load },
            })),
            eventDoc('future', { startDate: nowMs + DAY_MS, stats: { 'Training Stress Score': 999 } }),
            eventDoc('merged', { startDate: currentDayMs, isMerge: true, stats: { 'Training Stress Score': 999 } }),
            eventDoc('missing-date', { stats: { 'Training Stress Score': 999 } }),
        ];
        const activityDocs = [
            activityDoc('run', 'current', {
                startDate: currentDayMs,
                type: ActivityTypes.Running,
                stats: { [DataDuration.type]: 3600, 'Training Stress Score': 60 },
            }),
            activityDoc('yoga', 'current', { startDate: currentDayMs, type: ActivityTypes.Yoga, stats: {} }),
            activityDoc('unknown', 'current', { startDate: currentDayMs, type: 'Provider Mystery', stats: {} }),
            activityDoc('future-child', 'future', { startDate: nowMs + DAY_MS, type: ActivityTypes.Running, stats: {} }),
            activityDoc('merged-child', 'merged', { startDate: currentDayMs, type: ActivityTypes.Running, stats: {} }),
        ];
        const activities = joinTrainingActivitySources(activityDocs as never, eventDocs as never);
        const result = buildTrainingExplanationMetricPayload(eventDocs as never, activities, nowMs);

        expect(result.sourceEventCount).toBe(4);
        expect(result.payload.current).toMatchObject({
            parentEventCount: 1,
            parentTrainingStressScore: 100,
            childActivityCount: 3,
            childTrainingStressScore: 60,
            childLoadCoverage: {
                totalCount: 3,
                loadedCount: 1,
                classifiedCount: 2,
                unclassifiedCount: 1,
                ratio: 0.3333,
            },
        });
        expect(result.payload.baselineMedian.parentTrainingStressScore).toBe(70);
        expect(result.payload.current.sportLoads).toEqual(expect.arrayContaining([
            expect.objectContaining({ sport: 'running', activityCount: 1, trainingStressScore: 60 }),
            expect.objectContaining({ sport: 'fitness-gym', activityCount: 1, trainingStressScore: null }),
            expect.objectContaining({ sport: 'unclassified', activityCount: 1, trainingStressScore: null }),
        ]));
        expect(result.payload.current.rhythms.find(item => item.discipline === 'running')).toMatchObject({
            sessionCount: 1,
            activeDayCount: 1,
            activeWeekCount: 1,
            longestInactivityGapDays: 25,
            longestSessionDurationSeconds: 3600,
        });
        expect(result.payload.topContributors[0]).toMatchObject({
            eventId: 'current',
            trainingStressScore: 100,
            childComposition: expect.arrayContaining([expect.objectContaining({ sport: 'running' })]),
        });
    });

    it('counts finite zero TSS across every registered Training activity type', async () => {
        const { buildTrainingExplanationMetricPayload, joinTrainingActivitySources } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 14, 12);
        const startDate = Date.UTC(2026, 6, 12, 8);
        const types = [...new Set(TRAINING_SPORT_DEFINITIONS.flatMap(sport =>
            sport.contexts.flatMap(context => [...context.activityTypes])))];
        const events = [eventDoc('zero-training', { startDate, stats: { 'Training Stress Score': 0 } })];
        const activities = types.map((type, index) => activityDoc(`zero-${index}`, 'zero-training', {
            startDate, type, stats: { 'Training Stress Score': 0 },
        }));
        const result = buildTrainingExplanationMetricPayload(
            events as never, joinTrainingActivitySources(activities as never, events as never), nowMs,
        );
        expect(result.payload.current).toMatchObject({
            parentTrainingStressScore: 0,
            childTrainingStressScore: 0,
            childLoadActivityCount: types.length,
            childLoadCoverage: { loadedCount: types.length, totalCount: types.length, ratio: 1 },
        });
        result.payload.current.sportLoads.filter(sport => sport.activityCount > 0).forEach(sport => {
            expect(sport.trainingStressScore).toBe(0);
            expect(sport.loadActivityCount).toBe(sport.activityCount);
        });
    });

    it('counts saved TSS for gravity, strength and gym sport loads independently of analysis', async () => {
        const { buildTrainingExplanationMetricPayload, joinTrainingActivitySources } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 14, 12);
        const startDate = Date.UTC(2026, 6, 12, 8);
        const events = [eventDoc('training-day', {
            startDate,
            stats: { 'Training Stress Score': 180 },
        })];
        const activities = [
            activityDoc('row', 'training-day', { startDate, type: ActivityTypes.Rowing, stats: { 'Training Stress Score': 50 } }),
            activityDoc('strength', 'training-day', { startDate, type: ActivityTypes.StrengthTraining, stats: { 'Training Stress Score': 70 } }),
            activityDoc('downhill', 'training-day', { startDate, type: ActivityTypes.DownhillCycling, stats: { 'Training Stress Score': 60 } }),
            activityDoc('yoga', 'training-day', { startDate, type: ActivityTypes.Yoga, stats: { 'Training Stress Score': 40 } }),
        ];

        const result = buildTrainingExplanationMetricPayload(
            events as never,
            joinTrainingActivitySources(activities as never, events as never),
            nowMs,
        );
        const sportLoads = result.payload.current.sportLoads;

        expect(sportLoads.map(({ sport, label }) => ({ sport, label }))).toEqual([
            { sport: 'running', label: 'Running' },
            { sport: 'cycling', label: 'Cycling' },
            { sport: 'swimming', label: 'Swimming' },
            { sport: 'rowing', label: 'Rowing' },
            { sport: 'walking-hiking', label: 'Walking & Hiking' },
            { sport: 'nordic-skiing', label: 'Nordic Skiing' },
            { sport: 'strength', label: 'Strength' },
            { sport: 'fitness-gym', label: 'Fitness & Gym' },
            { sport: 'paddling', label: 'Paddling' },
            { sport: 'wheelchair', label: 'Wheelchair Training' },
            { sport: 'climbing-mountaineering', label: 'Climbing & Mountaineering' },
            { sport: 'mountain-snow', label: 'Mountain Snow Sports' },
            { sport: 'skating', label: 'Skating' },
            { sport: 'combat-martial-arts', label: 'Combat & Martial Arts' },
            { sport: 'dance', label: 'Dance' },
            { sport: 'team-sports', label: 'Team Sports' },
            { sport: 'racket-sports', label: 'Racket Sports' },
            { sport: 'precision-sports', label: 'Precision Sports' },
            { sport: 'water-sports', label: 'Water Sports' },
            { sport: 'diving', label: 'Diving' },

            { sport: 'performance-sports', label: 'Performance Sports' },
            { sport: 'outdoor-adventures', label: 'Outdoor Adventures' },
            { sport: 'aerial-sports', label: 'Aerial Sports' },
            { sport: 'motorized-activities', label: 'Motorized Activities' },
            { sport: 'other-training', label: 'Other training' },
            { sport: 'other', label: 'Other' },
            { sport: 'unclassified', label: 'Unclassified' },
        ]);
        expect(sportLoads.find(item => item.sport === 'rowing')).toMatchObject({
            activityCount: 1,
            loadActivityCount: 1,
            trainingStressScore: 50,
        });
        expect(sportLoads.find(item => item.sport === 'strength')).toMatchObject({
            activityCount: 1,
            loadActivityCount: 1,
            trainingStressScore: 70,
        });
        expect(sportLoads.find(item => item.sport === 'cycling')).toMatchObject({
            activityCount: 1,
            loadActivityCount: 1,
            trainingStressScore: 60,
        });
        expect(sportLoads.find(item => item.sport === 'fitness-gym')).toMatchObject({
            activityCount: 1,
            loadActivityCount: 1,
            trainingStressScore: 40,
        });
        expect(result.payload.current).toMatchObject({
            childActivityCount: 4,
            parentTrainingStressScore: 180,
            childLoadActivityCount: 4,
            childTrainingStressScore: 220,
            childLoadCoverage: {
                totalCount: 4,
                loadedCount: 4,
                classifiedCount: 4,
                unclassifiedCount: 0,
                ratio: 1,
            },
        });
        expect(result.payload.current.rhythms.find(item => item.discipline === 'rowing')?.sessionCount).toBe(1);
        expect(result.payload.current.rhythms.find(item => item.discipline === 'strength')?.sessionCount).toBe(1);
        expect(result.payload.current.rhythms.find(item => item.discipline === 'fitness-gym')?.sessionCount).toBe(1);
    });

    it('aggregates only persisted eligible evidence into current, usual, weekly, and Best Build contexts', async () => {
        const {
            buildTrainingBuildComparisonMetricPayload,
            buildTrainingDurabilityMetricPayload,
        } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 14, 12);
        const makeActivity = (
            id: string,
            startDate: number,
            evidence: unknown | null,
            activityType: string = ActivityTypes.Running,
        ) => ({
            id,
            data: () => ({
                startDate,
                stats: {
                    [DataActivityTypes.type]: [activityType],
                    ...(evidence ? { [DataDurabilityEvidence.type]: evidence } : {}),
                },
            }),
        });
        const currentDates = [Date.UTC(2026, 6, 10), Date.UTC(2026, 6, 12)];
        const baselineDates = [Date.UTC(2026, 5, 10), Date.UTC(2026, 4, 10), Date.UTC(2026, 3, 10)];
        const docs = [
            ...currentDates.map((date, index) => makeActivity(`current-${index}`, date, aerobicEvidence(3 + index * 2))),
            ...baselineDates.map((date, index) => makeActivity(`baseline-${index}`, date, aerobicEvidence(4 + index * 2))),
            makeActivity('missing', Date.UTC(2026, 6, 11), null),
            makeActivity('malformed', Date.UTC(2026, 6, 10), aerobicEvidence(7, {
                qualifyingDurationSeconds: undefined,
            })),
            makeActivity('excluded', Date.UTC(2026, 6, 9), aerobicEvidence(99, {
                eligibility: {
                    eligible: false,
                    reason: 'too-intense',
                    validSampleCount: 3240,
                    comparisonSegments: 'halves',
                    earlySampleCount: 1620,
                    lateSampleCount: 1620,
                    outputCoefficientOfVariation: 0.03,
                    hardZoneRatio: 0.25,
                },
                evidence: null,
            })),
            makeActivity('pool', Date.UTC(2026, 6, 8), {
                protocolVersion: DURABILITY_PROTOCOL_VERSION,
                sourceFingerprint: 'durability-v1:0000000000000002',
                discipline: 'pool-swimming',
                outputSource: 'pool-length-speed',
                outputUnit: 'm/s',
                context: { poolLengthMeters: 25, stroke: 'freestyle' },
                durationSeconds: 2400,
                qualifyingDurationSeconds: 1800,
                coverageRatio: 0.95,
                eligibility: {
                    eligible: true,
                    reason: 'eligible',
                    validSampleCount: 24,
                    comparisonSegments: 'outer-thirds',
                    earlySampleCount: 8,
                    lateSampleCount: 8,
                    outputCoefficientOfVariation: 0.03,
                    hardZoneRatio: 0.05,
                },
                evidence: {
                    kind: 'pool-consistency',
                    firstPaceSecondsPer100m: 100,
                    finalPaceSecondsPer100m: 103,
                    paceRetentionPercent: (100 / 103) * 100,
                    firstSwolf: 40,
                    finalSwolf: 42,
                    swolfChange: 2,
                    poolLengthMeters: 25,
                    stroke: 'freestyle',
                    comparableLengthCount: 24,
                },
            }, ActivityTypes.Swimming),
            makeActivity('open-water', Date.UTC(2026, 6, 7), aerobicEvidence(4, {
                discipline: 'open-water-swimming',
                outputSource: 'speed',
            }), ActivityTypes.OpenWaterSwimming),
            makeActivity('future', nowMs + DAY_MS, aerobicEvidence(999)),
        ];
        const activities = buildTrainingActivitySources(docs);
        const result = buildTrainingDurabilityMetricPayload(activities, nowMs);
        const running = result.payload.scopes.find(item => item.scope === 'running')!;

        expect(result.payload.weeklyPointCount).toBe(12);
        expect(running.weeks).toHaveLength(12);
        expect(running.current.coverage).toMatchObject({
            candidateActivityCount: 5,
            evidenceActivityCount: 3,
            eligibleActivityCount: 2,
            missingEvidenceActivityCount: 2,
            excludedActivityCount: 1,
            eligibilityRatio: 0.4,
            exclusions: [{ reason: 'too-intense', activityCount: 1 }],
        });
        expect(running.current.summaries[0]).toMatchObject({
            sampleCount: 2,
            medianDecouplingPercent: 4,
            medianOutputRetentionPercent: 100.8,
            medianHeartRateDriftBpm: 5,
        });
        expect(running.usual.summaries[0].medianDecouplingPercent).toBe(6);
        expect(running.recentSupportingEvents).toHaveLength(2);
        expect(running.recentSupportingEvents).toEqual(expect.arrayContaining([
            expect.objectContaining({ startMs: currentDates[1] }),
        ]));
        expect(result.payload.scopes.find(item => item.scope === 'pool-swimming')?.current.summaries[0]).toMatchObject({
            context: { poolLengthMeters: 25, stroke: 'freestyle' },
            medianPaceRetentionPercent: 97.09,
            medianSwolfChange: 2,
        });
        expect(result.payload.scopes.find(item => item.scope === 'open-water-swimming')?.current.summaries[0]).toMatchObject({
            context: { outputSource: 'speed', poolLengthMeters: null, stroke: null },
            medianDecouplingPercent: 4,
        });

        const comparison = buildTrainingBuildComparisonMetricPayload(activities, {
            trainingSettings: {
                buildBenchmarks: {
                    running: { mode: 'period', durationWeeks: 8, endDayMs: Date.UTC(2026, 4, 19) },
                },
            },
        }, nowMs);
        const runningBuild = comparison.payload.disciplines.find(item => item.discipline === 'running')!;
        expect(runningBuild.current?.durability?.summaries[0].sampleCount).toBe(3);
        expect(runningBuild.durabilityComparisons[0]).toMatchObject({
            context: { outputSource: 'grade-adjusted-speed', outputUnit: 'm/s' },
            isComparable: true,
        });
    });

    it.each([ActivityTypes.DownhillCycling, ActivityTypes['Enduro MTB'], RefinedTypes.EEnduroMTB])('rejects legacy eligible %s evidence but retains explicit unsupported-context evidence', async (activityType) => {
        const { aggregatePersistedTrainingDurability } = await import('./derived-metrics.service');
        const startDate = Date.UTC(2026, 6, 10);
        const legacyEligible = aerobicEvidence(4, {
            discipline: 'cycling',
            outputSource: 'power',
            outputUnit: 'W',
        });
        const explicitUnsupported = {
            ...legacyEligible,
            sourceFingerprint: 'durability-v1:0000000000000003',
            qualifyingDurationSeconds: 0,
            coverageRatio: 0,
            eligibility: {
                eligible: false,
                reason: 'unsupported-context',
                validSampleCount: 0,
                comparisonSegments: 'halves',
                earlySampleCount: 0,
                lateSampleCount: 0,
                outputCoefficientOfVariation: null,
                hardZoneRatio: null,
            },
            evidence: null,
        };
        const source = (id: string, durability: unknown) => buildTrainingActivitySources([{
            id,
            data: () => ({
                startDate,
                stats: {
                    [DataActivityTypes.type]: [activityType],
                    [DataDurabilityEvidence.type]: durability,
                },
            }),
        }])[0];

        expect(aggregatePersistedTrainingDurability([source('legacy', legacyEligible)]).coverage).toMatchObject({
            candidateActivityCount: 1,
            evidenceActivityCount: 0,
            eligibleActivityCount: 0,
            missingEvidenceActivityCount: 1,
            excludedActivityCount: 0,
        });
        expect(aggregatePersistedTrainingDurability([source('current', explicitUnsupported)]).coverage).toMatchObject({
            candidateActivityCount: 1,
            evidenceActivityCount: 1,
            eligibleActivityCount: 0,
            missingEvidenceActivityCount: 0,
            excludedActivityCount: 1,
            exclusions: [{ reason: 'unsupported-context', activityCount: 1 }],
        });
    });

    it.each([RefinedTypes.BMX, RefinedTypes.Kickbiking, RefinedTypes.ObstacleRacing])('omits persisted specialist durability for %s', async (activityType) => {
        const { aggregatePersistedTrainingDurability } = await import('./derived-metrics.service');
        const activity = buildTrainingActivitySources([eventDoc('unsupported-specialist', {
            startDate: Date.UTC(2026, 6, 12),
            stats: {
                [DataActivityTypes.type]: [activityType],
                [DataDurabilityEvidence.type]: aerobicEvidence(4, {
                    discipline: activityType === RefinedTypes.ObstacleRacing ? 'running' : 'cycling',
                    outputSource: 'power', outputUnit: 'W',
                }),
            },
        })]);
        expect(aggregatePersistedTrainingDurability(activity).coverage).toMatchObject({
            candidateActivityCount: 0, evidenceActivityCount: 0, eligibleActivityCount: 0,
        });
    });

    it.each([RefinedTypes.TrackRunning, RefinedTypes.UltraRunning, RefinedTypes.CrosscountryRunning])('accepts existing protocol-qualified durability for %s', async (activityType) => {
        const { aggregatePersistedTrainingDurability } = await import('./derived-metrics.service');
        const activity = buildTrainingActivitySources([eventDoc('supported-running', {
            startDate: Date.UTC(2026, 6, 12),
            stats: { [DataActivityTypes.type]: [activityType], [DataDurabilityEvidence.type]: aerobicEvidence(4) },
        })]);
        expect(aggregatePersistedTrainingDurability(activity).coverage).toMatchObject({
            candidateActivityCount: 1, evidenceActivityCount: 1, eligibleActivityCount: 1,
        });
    });

    it('keeps steady Cycling contexts eligible while excluding Enduro and Downhill evidence', async () => {
        const { buildTrainingDurabilityMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 14, 12);
        const eligibleCyclingEvidence = aerobicEvidence(4, {
            discipline: 'cycling',
            outputSource: 'power',
            outputUnit: 'W',
        });
        const unsupportedGravityEvidence = aerobicEvidence(0, {
            discipline: 'cycling',
            outputSource: 'power',
            outputUnit: 'W',
            qualifyingDurationSeconds: 0,
            coverageRatio: 0,
            eligibility: {
                eligible: false,
                reason: 'unsupported-context',
                validSampleCount: 0,
                comparisonSegments: 'halves',
                earlySampleCount: 0,
                lateSampleCount: 0,
                outputCoefficientOfVariation: null,
                hardZoneRatio: null,
            },
            evidence: null,
        });
        const activityTypes = [
            ActivityTypes.Cycling,
            ActivityTypes.IndoorCycling,
            ActivityTypes.VirtualCycling,
            ActivityTypes.MountainBiking,
            RefinedTypes.RecumbentCycling,
            RefinedTypes.IndoorHandCycle,
            RefinedTypes.EMountainBiking,
            RefinedTypes.MountainBikeOrienteering,
            ActivityTypes['Enduro MTB'],
            RefinedTypes.EEnduroMTB,
            ActivityTypes.DownhillCycling,
        ];
        const docs = activityTypes.map((activityType, index) => eventDoc(`cycling-context-${index}`, {
            startDate: Date.UTC(2026, 6, 12),
            stats: {
                [DataActivityTypes.type]: [activityType],
                [DataDurabilityEvidence.type]: index < 8
                    ? eligibleCyclingEvidence
                    : unsupportedGravityEvidence,
            },
        }));

        const cycling = buildTrainingDurabilityMetricPayload(buildTrainingActivitySources(docs), nowMs)
            .payload.scopes.find(scope => scope.scope === 'cycling')!;

        expect(cycling.current.coverage).toEqual({
            candidateActivityCount: 11,
            evidenceActivityCount: 11,
            eligibleActivityCount: 8,
            missingEvidenceActivityCount: 0,
            excludedActivityCount: 3,
            eligibilityRatio: 0.7273,
            exclusions: [{ reason: 'unsupported-context', activityCount: 3 }],
        });
        expect(cycling.current.summaries).toEqual([
            expect.objectContaining({
                context: expect.objectContaining({
                    contextKey: 'cycling|power|W|-|-',
                    scope: 'cycling',
                    outputSource: 'power',
                }),
                sampleCount: 8,
            }),
        ]);
    });

    it('does not count registered families without durability adapters as durability sources or candidates', async () => {
        const {
            aggregatePersistedTrainingDurability,
            buildTrainingDurabilityMetricPayload,
        } = await import('./derived-metrics.service');
        const startDate = Date.UTC(2026, 6, 10);
        const activities = buildTrainingActivitySources([
            eventDoc('run', {
                startDate,
                stats: { [DataActivityTypes.type]: [ActivityTypes.Running] },
            }),
            eventDoc('row', {
                startDate,
                stats: { [DataActivityTypes.type]: [ActivityTypes.Rowing] },
            }),
            eventDoc('strength', {
                startDate,
                stats: { [DataActivityTypes.type]: [ActivityTypes.StrengthTraining] },
            }),
            eventDoc('paddle', {
                startDate,
                stats: { [DataActivityTypes.type]: [ActivityTypes.Kayaking] },
            }),
        ]);

        expect(aggregatePersistedTrainingDurability(activities).coverage).toMatchObject({
            candidateActivityCount: 1,
            evidenceActivityCount: 0,
            missingEvidenceActivityCount: 1,
        });
        expect(buildTrainingDurabilityMetricPayload(activities, startDate + 1).sourceEventCount).toBe(1);
    });

    it('does not present a context from one historical block as the athlete usual', async () => {
        const { buildTrainingDurabilityMetricPayload } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 14, 12);
        const docs = [
            eventDoc('sparse-current', {
                startDate: Date.UTC(2026, 6, 10),
                stats: {
                    [DataActivityTypes.type]: [ActivityTypes.Running],
                    [DataDurabilityEvidence.type]: aerobicEvidence(3, { outputSource: 'speed' }),
                },
            }),
            eventDoc('sparse-baseline', {
                startDate: Date.UTC(2026, 5, 10),
                stats: {
                    [DataActivityTypes.type]: [ActivityTypes.Running],
                    [DataDurabilityEvidence.type]: aerobicEvidence(5, { outputSource: 'speed' }),
                },
            }),
        ];

        const running = buildTrainingDurabilityMetricPayload(buildTrainingActivitySources(docs), nowMs)
            .payload.scopes.find(scope => scope.scope === 'running')!;

        expect(running.usual.summaries[0]).toMatchObject({
            sampleCount: 0,
            medianDurationSeconds: null,
            medianCoverageRatio: null,
            medianDecouplingPercent: null,
            medianOutputRetentionPercent: null,
            medianHeartRateDriftBpm: null,
        });
    });
});

describe('activity-level Training sources and swimming performance', () => {
    const activityDoc = (id: string, eventID: string, data: Record<string, unknown>) => ({
        id,
        data: () => ({ eventID, ...data }),
    });
    const eventDoc = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });

    it.each(['Brick Training', 'Pool Triathlon', 'Offroad Triathlon', 'Offroad Duathlon'])(
        'retains unsplit %s saved load while excluding standalone Training workout counts', async (sport) => {
            const { joinTrainingActivitySources, buildTrainingSummaryMetricPayload, buildTrainingExplanationMetricPayload } = await import('./derived-metrics.service');
            const startDate = Date.UTC(2026, 6, 8);
            const nowMs = Date.UTC(2026, 6, 10, 12);
            const events = [eventDoc('combined', { startDate, stats: { 'Training Stress Score': 90 } })];
            const docs = [activityDoc('whole-recording', 'combined', {
                startDate, type: sport, stats: { [DataDuration.type]: 6_000, 'Training Stress Score': 90 },
            })];
            const activities = joinTrainingActivitySources(docs as never, events as never);
            const summary = buildTrainingSummaryMetricPayload(activities, nowMs);
            expect(summary.sourceEventCount).toBe(0);
            expect(summary.payload.disciplines.every(item => item.current28d.activityCount === 0)).toBe(true);
            expect(buildTrainingExplanationMetricPayload(events as never, activities, nowMs).payload.current)
                .toMatchObject({ parentTrainingStressScore: 90, childTrainingStressScore: 90 });
            expect(activities[0].activityData).toMatchObject({ type: sport, stats: { 'Training Stress Score': 90 } });
        });

    it.each(['Triathlon', 'Brick Training', 'Pool Triathlon', 'Offroad Triathlon', 'Offroad Duathlon'])(
        'counts %s individual legs while excluding its aggregate, missing and merged parents', async (aggregateType) => {
        const {
            aggregatePersistedTrainingDurability,
            buildTrainingBuildComparisonMetricPayload,
            buildTrainingDurabilityMetricPayload,
            buildTrainingSummaryMetricPayload,
            joinTrainingActivitySources,
        } = await import('./derived-metrics.service');
        const startDate = Date.UTC(2026, 6, 8, 8);
        const eventDocs = [
            eventDoc('triathlon', { startDate, name: 'A race' }),
            eventDoc('merged', { startDate, isMerge: true }),
        ];
        const activityDocs = [
            activityDoc('swim-leg', 'triathlon', { startDate, type: ActivityTypes.Swimming, stats: { [DataDuration.type]: 1_000 } }),
            activityDoc('bike-leg', 'triathlon', { startDate, type: ActivityTypes.MountainBiking, stats: { [DataDuration.type]: 2_000 } }),
            activityDoc('run-leg', 'triathlon', { startDate, type: ActivityTypes.TrailRunning, stats: { [DataDuration.type]: 3_000 } }),
            activityDoc('aggregate', 'triathlon', { startDate, type: aggregateType, stats: { [DataDuration.type]: 6_000 } }),
            activityDoc('missing-parent', 'missing', { startDate, type: ActivityTypes.Running, stats: {} }),
            activityDoc('merged-child', 'merged', { startDate, type: ActivityTypes.Cycling, stats: {} }),
        ];

        const activities = joinTrainingActivitySources(activityDocs as never, eventDocs as never);
        const classifiedActivities = joinTrainingActivitySources(
            activityDocs as never,
            eventDocs as never,
            { includeUnclassified: false },
        );
        const summary = buildTrainingSummaryMetricPayload(activities, Date.UTC(2026, 6, 10, 12));
        const durability = aggregatePersistedTrainingDurability(activities);
        const durabilityMetric = buildTrainingDurabilityMetricPayload(activities, Date.UTC(2026, 6, 10, 12));
        const buildComparison = buildTrainingBuildComparisonMetricPayload(
            activities,
            {},
            Date.UTC(2026, 6, 10, 12),
        );

        expect(activities.map(activity => activity.discipline)).toEqual(['swimming', 'cycling', 'running', null]);
        expect(classifiedActivities.map(activity => activity.discipline)).toEqual(['swimming', 'cycling', 'running']);
        expect(summary.sourceEventCount).toBe(3);
        expect(durabilityMetric.sourceEventCount).toBe(3);
        expect(buildComparison.sourceEventCount).toBe(3);
        expect(durability.coverage).toMatchObject({
            candidateActivityCount: 3,
            missingEvidenceActivityCount: 3,
        });
        expect(summary.payload.disciplines.map(item => [item.discipline, item.current28d.activityCount])).toEqual([
            ['running', 1],
            ['cycling', 1],
            ['swimming', 1],
            ['rowing', 0],
            ['walking-hiking', 0],
            ['nordic-skiing', 0],
            ['strength', 0],
            ['fitness-gym', 0],
            ['paddling', 0],
            ['wheelchair', 0],
            ['climbing-mountaineering', 0],
            ['mountain-snow', 0],
            ['skating', 0],
            ['combat-martial-arts', 0],
            ['dance', 0],
            ['team-sports', 0],
            ['racket-sports', 0],
            ['precision-sports', 0],
            ['water-sports', 0],
            ['diving', 0],

            ['performance-sports', 0],
            ['outdoor-adventures', 0],
            ['aerial-sports', 0],
            ['motorized-activities', 0],
            ['other-training', 0],
        ]);
    });

    it('uses parent timing only as an anchor and never leaks parent workload into a child leg', async () => {
        const {
            buildTrainingExplanationMetricPayload,
            buildTrainingSummaryMetricPayload,
            joinTrainingActivitySources,
        } = await import('./derived-metrics.service');
        const startDate = Date.UTC(2026, 6, 10, 8);
        const eventDocs = [eventDoc('parent', {
            startDate,
            endDate: startDate + (10 * 60 * 60 * 1000),
            stats: { [DataDuration.type]: 36_000, 'Training Stress Score': 500 },
        })];
        const activityDocs = [activityDoc('leg', 'parent', {
            type: ActivityTypes.Running,
            stats: {},
        })];
        const sources = joinTrainingActivitySources(activityDocs as never, eventDocs as never);

        expect(sources[0].startMs).toBe(startDate);
        expect(sources[0]).not.toHaveProperty('metricData');
        expect(sources[0].activityData).not.toHaveProperty('endDate');
        expect(buildTrainingSummaryMetricPayload(sources, Date.UTC(2026, 6, 14)).payload.disciplines[0].current28d)
            .toMatchObject({ activityCount: 1, durationSeconds: 0 });
        expect(buildTrainingExplanationMetricPayload(
            eventDocs as never,
            sources,
            Date.UTC(2026, 6, 14),
        ).payload.current).toMatchObject({
            parentTrainingStressScore: 500,
            childTrainingStressScore: null,
        });
    });

    it('falls back to parent provenance without copying parent fields into activity metrics', async () => {
        const {
            buildTrainingCapacityMetricPayload,
            joinTrainingActivitySources,
        } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 14, 12);
        const startDate = Date.UTC(2026, 6, 10, 8);
        const eventDocs = [eventDoc('parent', {
            startDate,
            sourceServiceName: 'GarminAPI',
            creator: { name: 'Edge MTB' },
        })];
        const activityDocs = [activityDoc('leg', 'parent', {
            startDate,
            type: ActivityTypes.Cycling,
            stats: { [DataFTP.type]: 222 },
        })];
        const sources = joinTrainingActivitySources(activityDocs as never, eventDocs as never);
        const capacity = buildTrainingCapacityMetricPayload(sources, nowMs);

        expect(sources[0].activityData).not.toHaveProperty('sourceServiceName');
        expect(sources[0].activityData).not.toHaveProperty('creator');
        expect(capacity.payload.disciplines.find(item => item.discipline === 'cycling')?.ftpSetting)
            .toMatchObject({ value: 222, sourceKey: 'garminapi / edge mtb' });
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
            openWaterAveragePaceSecondsPer100m: null, durability: null,
        });
        expect(swimming.current).toMatchObject({
            activityCount: 1, distanceMeters: 3_000, poolAveragePaceSecondsPer100m: null,
            openWaterAveragePaceSecondsPer100m: 115, durability: null,
        });
    });
});

describe('startDerivedMetricsProcessing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.userRootGet.mockResolvedValue({ exists: true });
        hoisted.tombstoneGet.mockResolvedValue({ exists: false, data: () => undefined });
        mockTransactionDeletionGuardDefaults();
        hoisted.enqueueDerivedMetricsTask.mockResolvedValue(true);
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

    it.each(['queued', 'failed'])('retries only its own unclaimed follow-up enqueue (%s)', async status => {
        const { startDerivedMetricsProcessing } = await import('./derived-metrics.service');
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 9, 17, 10));
        hoisted.transactionGet.mockResolvedValueOnce({ exists: true, data: () => ({
            status, generation: 43, retryFromGeneration: 42, buildNotBeforeMs: Date.now() + 90_000,
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
        }) });
        expect(await startDerivedMetricsProcessing('user-1', 42)).toBeNull();
        expect(hoisted.enqueueDerivedMetricsTask).toHaveBeenCalledWith('user-1', 43, 90);
        expect(hoisted.transactionSet).not.toHaveBeenCalled();
    });

    it.each([
        { status: 'processing', generation: 43, retryFromGeneration: 42 },
        { status: 'idle', generation: 43, retryFromGeneration: 42 },
        { status: 'failed', generation: 43, retryFromGeneration: 41 },
        { status: 'queued', generation: 44, retryFromGeneration: 42 },
        { status: 'failed', generation: 43 },
    ])('does not let stale tasks repair unrelated or already claimed work: %j', async coordinator => {
        const { startDerivedMetricsProcessing } = await import('./derived-metrics.service');
        hoisted.transactionGet.mockResolvedValueOnce({ exists: true, data: () => coordinator });
        expect(await startDerivedMetricsProcessing('user-1', 42)).toBeNull();
        expect(hoisted.enqueueDerivedMetricsTask).not.toHaveBeenCalled();
        expect(hoisted.transactionSet).not.toHaveBeenCalled();
    });

    it('discards the follow-up enqueue decision from an aborted transaction', async () => {
        const { startDerivedMetricsProcessing } = await import('./derived-metrics.service');
        hoisted.transactionGet
            .mockResolvedValueOnce({ exists: true, data: () => ({ status: 'queued', generation: 43, retryFromGeneration: 42 }) })
            .mockResolvedValueOnce({ exists: true, data: () => ({}) })
            .mockResolvedValueOnce({ exists: false, data: () => undefined })
            .mockResolvedValueOnce({ exists: true, data: () => ({ status: 'processing', generation: 43 }) });
        hoisted.runTransaction.mockImplementation(async (callback: (transaction: unknown) => Promise<void>) => {
            const transaction = { get: hoisted.transactionGet, set: hoisted.transactionSet };
            await callback(transaction);
            await callback(transaction);
        });
        expect(await startDerivedMetricsProcessing('user-1', 42)).toBeNull();
        expect(hoisted.enqueueDerivedMetricsTask).not.toHaveBeenCalled();
    });

    it('anchors the build start to the successful claim after transaction contention', async () => {
        const { startDerivedMetricsProcessing } = await import('./derived-metrics.service');
        vi.useFakeTimers();
        const requestAtMs = Date.UTC(2026, 9, 17, 10);
        vi.setSystemTime(requestAtMs);
        const coordinatorSnapshot = { exists: true, data: () => ({
            status: 'queued', generation: 42, eventMutationVersion: 7,
            startedAtMs: requestAtMs - 120_000, dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
        }) };
        const defaultGet = hoisted.transactionGet.getMockImplementation()!;
        hoisted.transactionGet.mockImplementation(async (ref: unknown) => {
            if (ref === hoisted.coordinatorRef) {
                return coordinatorSnapshot;
            }
            // Reading the owner guard can also wait behind concurrent writes.
            if (ref === hoisted.userRootRef) {
                vi.setSystemTime(Date.now() + 10_000);
            }
            return defaultGet(ref);
        });
        hoisted.runTransaction.mockImplementation(async (callback: (transaction: unknown) => Promise<void>) => {
            const transaction = { get: hoisted.transactionGet, set: hoisted.transactionSet };
            await callback(transaction); // Aborted attempt; a concurrent write forces a retry.
            vi.setSystemTime(requestAtMs + 30_000);
            await callback(transaction);
        });

        const result = await startDerivedMetricsProcessing('user-1', 42);

        expect(result).toEqual({
            startedAtMs: requestAtMs + 40_000, eventMutationVersion: 7, workoutInputsVersion: 0,
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
        });
        expect(hoisted.transactionSet).toHaveBeenLastCalledWith(hoisted.coordinatorRef, expect.objectContaining({
            status: 'processing', startedAtMs: requestAtMs + 40_000, updatedAtMs: requestAtMs + 40_000,
        }), { merge: true });
    });

    it('reclaims failed work with a distinct claim even when the retry starts in the same millisecond', async () => {
        const { startDerivedMetricsProcessing } = await import('./derived-metrics.service');
        vi.useFakeTimers();
        const nowMs = Date.UTC(2026, 8, 14, 10);
        vi.setSystemTime(nowMs);
        hoisted.transactionGet.mockResolvedValueOnce({ exists: true, data: () => ({
            status: 'failed', generation: 42, eventMutationVersion: 7, workoutInputsVersion: 3,
            startedAtMs: nowMs, dirtyMetricKinds: [DERIVED_METRIC_KINDS.TrainingReadiness], processingMetricKinds: [],
        }) });
        expect(await startDerivedMetricsProcessing('user-1', 42)).toEqual({
            startedAtMs: nowMs + 1, eventMutationVersion: 7, workoutInputsVersion: 3,
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.TrainingReadiness],
        });
        expect(hoisted.transactionSet).toHaveBeenCalledWith(hoisted.coordinatorRef, expect.objectContaining({
            status: 'processing', startedAtMs: nowMs + 1, dirtyMetricKinds: [],
            processingMetricKinds: [DERIVED_METRIC_KINDS.TrainingReadiness],
        }), { merge: true });
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
            workoutInputsVersion: 0,
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
            workoutInputsVersion: 0,
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
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 9, 17));
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

    afterEach(() => vi.useRealTimers());

    it('discards a delayed enqueue decision when the transaction retries after another completion', async () => {
        const { abandonDerivedMetricsProcessingAfterWriteBlock } = await import('./derived-metrics.service');
        hoisted.transactionGet
            .mockResolvedValueOnce({ exists: true, data: () => ({ status: 'processing', generation: 42,
                startedAtMs: Date.now() - 30_000, dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form] }) })
            .mockResolvedValueOnce({ exists: true, data: () => ({}) })
            .mockResolvedValueOnce({ exists: false, data: () => undefined })
            .mockResolvedValueOnce({ exists: true, data: () => ({ status: 'queued', generation: 43,
                buildNotBeforeMs: Date.now(), dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form] }) });
        hoisted.runTransaction.mockImplementation(async (callback: (transaction: unknown) => Promise<void>) => {
            const transaction = { get: hoisted.transactionGet, set: hoisted.transactionSet };
            await callback(transaction); // Aborted optimistic attempt, not a committed write.
            await callback(transaction);
        });
        const result = await abandonDerivedMetricsProcessingAfterWriteBlock('user-1', 42,
            [DERIVED_METRIC_KINDS.Form], 'synthetic write block');
        expect(result.requeued).toBe(false);
        expect(hoisted.enqueueDerivedMetricsTask).not.toHaveBeenCalled();
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
        expect(hoisted.enqueueDerivedMetricsTask).toHaveBeenCalledWith('user-1', 43, 120);
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
        expect(hoisted.enqueueDerivedMetricsTask).toHaveBeenCalledWith('user-1', 43, 120);
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

    it.each([
        ['idle', null, 0], ['idle', -30_000, 90], ['idle', -120_000, 0],
        ['idle', 30_000, 0], ['failed', -30_000, 0],
        ['queued', -30_000, 0], ['processing', -1_200_000, 0],
    ] as const)('batches background work from %s with previous start offset %s', async (status, offset, delay) => {
        const { markDerivedMetricsDirtyAndMaybeQueue } = await import('./derived-metrics.service');
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 9, 17));
        const now = Date.now();
        hoisted.transactionGet.mockResolvedValueOnce({ exists: true, data: () => ({
            status, generation: 12, eventMutationVersion: 9, workoutInputsVersion: 5,
            startedAtMs: offset === null ? null : now + offset,
            requestedAtMs: now - 1_200_000, dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
        }) });
        const response = await markDerivedMetricsDirtyAndMaybeQueue('user-1', [DERIVED_METRIC_KINDS.Acwr],
            { background: true, incrementEventMutationVersion: true });
        expect(response).toMatchObject({ queued: true, generation: 13 });
        expect(hoisted.enqueueDerivedMetricsTask.mock.calls).toEqual([
            delay ? ['user-1', 13, delay] : ['user-1', 13],
        ]);
        expect(hoisted.transactionSet).toHaveBeenCalledWith(hoisted.coordinatorRef, expect.objectContaining({
            buildNotBeforeMs: now + delay * 1000, pendingImmediate: false,
            eventMutationVersion: 10, workoutInputsVersion: 6,
            dirtyMetricKinds: expect.arrayContaining([DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.Acwr]),
        }), { merge: true });
    });

    it('uses the transaction time when an earlier request observes a newly completed build', async () => {
        const { markDerivedMetricsDirtyAndMaybeQueue } = await import('./derived-metrics.service');
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 9, 17));
        const enteredAt = Date.now();
        hoisted.transactionGet.mockResolvedValueOnce({ exists: true, data: () => ({
            status: 'idle', generation: 12, startedAtMs: enteredAt + 10_000, dirtyMetricKinds: [],
        }) });
        hoisted.runTransaction.mockImplementation(async (callback: (transaction: unknown) => Promise<void>) => {
            vi.setSystemTime(enteredAt + 30_000);
            await callback({ get: hoisted.transactionGet, set: hoisted.transactionSet });
        });
        await markDerivedMetricsDirtyAndMaybeQueue('user-1', [DERIVED_METRIC_KINDS.Form], { background: true });
        expect(hoisted.enqueueDerivedMetricsTask).toHaveBeenCalledWith('user-1', 13, 100);
        expect(hoisted.transactionSet).toHaveBeenCalledWith(hoisted.coordinatorRef,
            expect.objectContaining({ buildNotBeforeMs: enteredAt + 130_000 }), { merge: true });
    });

    it.each([true, false])('preserves a fixed queued deadline or promotes it for an explicit edit (background=%s)', async background => {
        const { markDerivedMetricsDirtyAndMaybeQueue } = await import('./derived-metrics.service');
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 9, 17));
        const now = Date.now();
        hoisted.transactionGet.mockResolvedValueOnce({ exists: true, data: () => ({
            status: 'queued', generation: 12, buildNotBeforeMs: now + 70_000,
            requestedAtMs: now - 20_000, dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
        }) });
        const response = await markDerivedMetricsDirtyAndMaybeQueue('user-1', [DERIVED_METRIC_KINDS.Acwr], { background });
        expect(response).toMatchObject({ queued: !background, generation: background ? 12 : 13 });
        const update = hoisted.transactionSet.mock.calls[0][1];
        expect(update.dirtyMetricKinds).toEqual(expect.arrayContaining([DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.Acwr]));
        if (background) {
            expect(update).not.toHaveProperty('buildNotBeforeMs');
            expect(update).not.toHaveProperty('requestedAtMs');
            expect(hoisted.enqueueDerivedMetricsTask).not.toHaveBeenCalled();
        } else {
            expect(update.buildNotBeforeMs).toBe(now);
            expect(hoisted.enqueueDerivedMetricsTask).toHaveBeenCalledWith('user-1', 13);
        }
    });

    it.each([true, false])('retains explicit priority during processing (later background=%s)', async background => {
        const { markDerivedMetricsDirtyAndMaybeQueue } = await import('./derived-metrics.service');
        hoisted.transactionGet.mockResolvedValueOnce({ exists: true, data: () => ({
            status: 'processing', generation: 12, startedAtMs: Date.now(),
            pendingImmediate: background, dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form],
        }) });
        await markDerivedMetricsDirtyAndMaybeQueue('user-1', [DERIVED_METRIC_KINDS.Form],
            { background, preserveWorkoutInputs: true });
        if (!background) {
            expect(hoisted.transactionSet).toHaveBeenCalledWith(hoisted.coordinatorRef,
                expect.objectContaining({ pendingImmediate: true }), { merge: true });
        } else {
            // An identical recovery-only invalidation need not write; priority stays true.
            expect(hoisted.transactionSet).not.toHaveBeenCalled();
        }
        expect(hoisted.enqueueDerivedMetricsTask).not.toHaveBeenCalled();
    });

    it('invalidates workout reuse on an explicit repair even when its dirty set is unchanged', async () => {
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
            'test-user-uid',
            [DERIVED_METRIC_KINDS.Form],
        );

        expect(response).toEqual({
            accepted: true,
            queued: false,
            generation: 12,
            metricKinds: [DERIVED_METRIC_KINDS.Form],
        });
        expect(hoisted.transactionSet).toHaveBeenCalledWith(hoisted.coordinatorRef,
            expect.objectContaining({ workoutInputsVersion: 1 }), { merge: true });
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
            'test-user-uid',
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
            'test-user-uid',
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
        expect(hoisted.enqueueDerivedMetricsTask).toHaveBeenCalledWith('test-user-uid', 22);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[derived-metrics] Coordinator appears stuck; forcing requeue.',
            expect.objectContaining({
                uid: 'test-user-uid',
                status: 'queued',
                generation: 21,
            }),
        );
    });

    it('retains in-flight kinds when a sleep-only ingress replaces a stuck workout build', async () => {
        const { markDerivedMetricsDirtyAndMaybeQueue } = await import('./derived-metrics.service');
        const nowMs = Date.now();
        hoisted.transactionGet.mockResolvedValueOnce({ exists: true, data: () => ({
            status: 'processing', generation: 30, dirtyMetricKinds: [],
            startedAtMs: nowMs - 20 * 60_000,
            processingMetricKinds: [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.TrainingDurability],
        }) });
        await markDerivedMetricsDirtyAndMaybeQueue('test-user-uid', [DERIVED_METRIC_KINDS.TrainingReadiness],
            { preserveWorkoutInputs: true });
        expect(hoisted.transactionSet).toHaveBeenCalledWith(hoisted.coordinatorRef, expect.objectContaining({
            status: 'queued', generation: 31, processingMetricKinds: [],
            dirtyMetricKinds: expect.arrayContaining([DERIVED_METRIC_KINDS.Form,
                DERIVED_METRIC_KINDS.TrainingDurability, DERIVED_METRIC_KINDS.TrainingReadiness]),
        }), { merge: true });
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
            'test-user-uid',
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
        expect(hoisted.enqueueDerivedMetricsTask).toHaveBeenCalledWith('test-user-uid', 31);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[derived-metrics] Coordinator appears stuck; forcing requeue.',
            expect.objectContaining({
                uid: 'test-user-uid',
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
            'test-user-uid',
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
            'test-user-uid',
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
            'test-user-uid',
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
        mockTransactionDeletionGuardDefaults();
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
        const call = hoisted.transactionSet.mock.calls.find((setCall) => setCall?.[1]?.metricKind === metricKind);
        return (call?.[1] || {}) as Record<string, unknown>;
    }

    it('uses modeled load for Form, ACWR and weekly load while retaining excluded workout volume', async () => {
        const { writeDerivedMetricSnapshotsReady } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 0, 3, 12);
        const sources = [
            { id: 'corrected', load: 7.6, excluded: false },
            { id: 'zero', load: 0, excluded: false },
            { id: 'excluded', load: 999, excluded: true },
        ].map(({ id, load, excluded }) => {
            const data = { startDate: Date.UTC(2026, 0, 3, 8), stats: {
                'Training Stress Score': 87.3, [DataActivityTypes.type]: [ActivityTypes.Walking], [DataDuration.type]: 3600,
            } };
            attachEffectiveTrainingLoad(data, resolveEffectiveTrainingLoad(data,
                { version: 1, revision: 1, excluded, controls: { leg: { override: load } } },
                [{ id: 'leg', type: ActivityTypes.Walking, stats: data.stats }]));
            return { id, data: () => data };
        });
        await writeDerivedMetricSnapshotsReady('user-1', [DERIVED_METRIC_KINDS.Form,
            DERIVED_METRIC_KINDS.Acwr, DERIVED_METRIC_KINDS.MonotonyStrain, DERIVED_METRIC_KINDS.TrainingSummary],
        { formDocs: sources as never, trainingActivities: buildTrainingActivitySources(sources), recoveryNowDocs: [] },
        { buildAtMs: nowMs });
        expect(findPersistedPayload(DERIVED_METRIC_KINDS.Form).payload).toMatchObject({ dailyLoads: [
            { dayMs: Date.UTC(2026, 0, 3), load: 7.6, activityCount: 2 },
        ] });
        expect(findPersistedPayload(DERIVED_METRIC_KINDS.Acwr).payload).toMatchObject({ acuteLoad7: 7.6 });
        expect(findPersistedPayload(DERIVED_METRIC_KINDS.MonotonyStrain).payload).toMatchObject({ weeklyLoad7: 7.6 });
        expect(findPersistedPayload(DERIVED_METRIC_KINDS.TrainingSummary).payload).toMatchObject({ disciplines:
            expect.arrayContaining([expect.objectContaining({ discipline: 'walking-hiking', current28d:
                expect.objectContaining({ activityCount: 3, durationSeconds: 10800 }) })]),
        });
        expect(sources.map(source => source.data().stats['Training Stress Score'])).toEqual([87.3, 87.3, 87.3]);
    });

    it('rejects a reused Form context when exact daily counts do not match sourceEventCount', async () => {
        const { writeDerivedMetricSnapshotsReady } = await import('./derived-metrics.service');
        await expect(writeDerivedMetricSnapshotsReady(
            'user-1',
            [DERIVED_METRIC_KINDS.FormNow],
            { formDocs: [], recoveryNowDocs: [] },
            {
                formDailyLoads: [{
                    dayMs: Date.UTC(2026, 8, 14),
                    load: 50,
                    activityCount: 1,
                }],
                formSourceEventCount: 2,
                formSourceDocCount: 2,
            },
        )).rejects.toThrow('daily activity counts must match sourceEventCount');
        expect(hoisted.transactionSet).not.toHaveBeenCalled();
    });

    it('warms internal reuse metadata and retains original source counts and expiry on recovery-only writes', async () => {
        const { writeDerivedMetricSnapshotsReady } = await import('./derived-metrics.service');
        const { resolveTrainingBuildWorkoutSeed, trainingBuildSettingsKey } = await import('./training-build-workout-seed');
        const nowMs = Date.UTC(2026, 8, 14, 10);
        const kind = DERIVED_METRIC_KINDS.TrainingBuildComparison;
        await writeDerivedMetricSnapshotsReady('user-1', [kind], {
            formDocs: [buildEventDoc({})], trainingActivityDocs: [buildEventDoc({})], trainingActivities: [],
        }, { buildAtMs: nowMs, builtFromEventMutationVersion: 7, workoutInputsVersion: 3 });
        const full = findPersistedPayload(kind);
        const seed = resolveTrainingBuildWorkoutSeed(full, { nowMs: nowMs + 1000, eventMutationVersion: 7,
            sourceVersion: 3, settingsKey: trainingBuildSettingsKey({}) });
        expect(seed).not.toBeNull();
        hoisted.transactionSet.mockClear();
        await writeDerivedMetricSnapshotsReady('user-1', [kind], { trainingBuildWorkoutSeed: seed },
            { buildAtMs: nowMs + 1000, builtFromEventMutationVersion: 7, workoutInputsVersion: 3 });
        const reused = findPersistedPayload(kind);
        expect(reused.payload).toEqual(full.payload);
        expect(reused.sourceDocCount).toBe(3);
        expect(reused.sourceEventCount).toBe(full.sourceEventCount);
        expect(reused.workoutInputsReuse).toEqual(full.workoutInputsReuse);
    });

    it('reuses prejoined Training activities supplied by the worker', async () => {
        const { writeDerivedMetricSnapshotsReady } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 14, 12);
        vi.useFakeTimers();
        vi.setSystemTime(nowMs);
        const trainingActivities = buildTrainingActivitySources([{
            id: 'run-1',
            data: () => ({
                startDate: Date.UTC(2026, 6, 10, 8),
                stats: {
                    [DataActivityTypes.type]: [ActivityTypes.Running],
                    [DataDuration.type]: 3_600,
                },
            }),
        }]);

        await writeDerivedMetricSnapshotsReady(
            'user-1',
            [DERIVED_METRIC_KINDS.TrainingSummary],
            {
                formDocs: [],
                trainingActivityDocs: [],
                trainingActivities,
            },
            { buildAtMs: nowMs },
        );

        const persisted = findPersistedPayload(DERIVED_METRIC_KINDS.TrainingSummary);
        expect(persisted.sourceEventCount).toBe(1);
        expect(persisted.payload).toMatchObject({
            disciplines: [
                { discipline: 'running', current28d: { activityCount: 1, durationSeconds: 3_600 } },
                { discipline: 'cycling', current28d: { activityCount: 0 } },
                { discipline: 'swimming', current28d: { activityCount: 0 } },
                { discipline: 'rowing', current28d: { activityCount: 0 } },
                { discipline: 'walking-hiking', current28d: { activityCount: 0 } },
                { discipline: 'nordic-skiing', current28d: { activityCount: 0 } },
                { discipline: 'strength', current28d: { activityCount: 0 } },
                { discipline: 'fitness-gym', current28d: { activityCount: 0 } },
                { discipline: 'paddling', current28d: { activityCount: 0 } },
                { discipline: 'wheelchair', current28d: { activityCount: 0 } },
                { discipline: 'climbing-mountaineering', current28d: { activityCount: 0 } },
                { discipline: 'mountain-snow', current28d: { activityCount: 0 } },
                { discipline: 'skating', current28d: { activityCount: 0 } },
                { discipline: 'combat-martial-arts', current28d: { activityCount: 0 } },
                { discipline: 'dance', current28d: { activityCount: 0 } },
                { discipline: 'team-sports', current28d: { activityCount: 0 } },
                { discipline: 'racket-sports', current28d: { activityCount: 0 } },
                { discipline: 'precision-sports', current28d: { activityCount: 0 } },
                { discipline: 'water-sports', current28d: { activityCount: 0 } },
                { discipline: 'diving', current28d: { activityCount: 0 } },

                { discipline: 'performance-sports', current28d: { activityCount: 0 } },
                { discipline: 'outdoor-adventures', current28d: { activityCount: 0 } },
                { discipline: 'aerial-sports', current28d: { activityCount: 0 } },
                { discipline: 'motorized-activities', current28d: { activityCount: 0 } },
                { discipline: 'other-training', current28d: { activityCount: 0 } },
            ],
        });
    });

    it('rejects an oversized complete power snapshot before persisting any queued metric', async () => {
        const { writeDerivedMetricSnapshotsReady } = await import('./derived-metrics.service');
        const sportsLib = await import('@sports-alliance/sports-lib');
        const originalFit = sportsLib.fitThreeDimensionalCapacityModel;
        const fitSpy = vi.spyOn(sportsLib, 'fitThreeDimensionalCapacityModel').mockImplementation((...args) => ({
            ...originalFit(...args), sourceFingerprint: 'x'.repeat(DERIVED_TRAINING_POWER_SYSTEMS_MAX_SNAPSHOT_BYTES),
        }));
        const nowMs = Date.UTC(2026, 6, 20, 12);
        const activities = buildTrainingActivitySources([{
            id: 'rowing-event',
            data: () => ({ startDate: Date.UTC(2026, 6, 19), stats: {
                [DataActivityTypes.type]: [ActivityTypes.Rowing], [DataDuration.type]: 3600,
                [POWER_CURVE_STAT_TYPE]: [{ duration: 180, power: 350 }],
            } }),
        }]);
        try {
            await expect(writeDerivedMetricSnapshotsReady('user-1', [
                DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.TrainingPowerSystems,
            ], { trainingActivities: activities }, { buildAtMs: nowMs }))
                .rejects.toThrow('Power-system snapshot exceeds its fixed storage bound');
            expect(hoisted.transactionSet).not.toHaveBeenCalled();
            expect(hoisted.runTransaction).not.toHaveBeenCalled();
        } finally {
            fitSpy.mockRestore();
        }
    });

    it('writes a schema-compatible rolling power-systems snapshot through the targeted lifecycle', async () => {
        const { writeDerivedMetricSnapshotsReady } = await import('./derived-metrics.service');
        const nowMs = Date.UTC(2026, 6, 20, 12);
        const activityDayMs = Date.UTC(2026, 6, 19);
        vi.useFakeTimers();
        vi.setSystemTime(nowMs);
        const powerCurve = [
            { duration: 5, power: 900 },
            { duration: 180, power: 350 },
            { duration: 1_200, power: 260 },
        ];
        const trainingActivities = buildTrainingActivitySources([{
            id: 'cycling-event',
            data: () => ({
                startDate: activityDayMs,
                stats: {
                    [DataActivityTypes.type]: [ActivityTypes.Cycling],
                    [DataDuration.type]: 3_600,
                    [POWER_CURVE_STAT_TYPE]: powerCurve,
                },
            }),
        }]);

        await writeDerivedMetricSnapshotsReady(
            'user-1',
            [DERIVED_METRIC_KINDS.TrainingPowerSystems],
            {
                formDocs: [],
                trainingActivityDocs: [],
                trainingActivities,
            },
            {
                buildAtMs: nowMs,
                builtFromEventMutationVersion: 73,
            },
        );

        const persisted = findPersistedPayload(DERIVED_METRIC_KINDS.TrainingPowerSystems);
        expect(persisted).toMatchObject({
            entryType: 'snapshot',
            metricKind: DERIVED_METRIC_KINDS.TrainingPowerSystems,
            schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
            status: 'ready',
            builtFromEventMutationVersion: 73,
            sourceEventCount: 1,
            lastError: null,
        });
        expect(persisted.legacyPowerSystemsPolicy1).toMatchObject({
            policyVersion: 1,
            asOfDayMs: Date.UTC(2026, 6, 20),
            activityTypes: [{ activityType: ActivityTypes.Cycling }],
        });
        expect(persisted.payload).not.toHaveProperty('legacyPowerSystemsPolicy1');
        expect(Buffer.byteLength(JSON.stringify(persisted), 'utf8')).toBeLessThan(DERIVED_TRAINING_POWER_SYSTEMS_MAX_SNAPSHOT_BYTES);
        const { isDerivedMetricSnapshotReadableByMcp } = await import('./ensure-derived-metrics');
        expect(isDerivedMetricSnapshotReadableByMcp(DERIVED_METRIC_KINDS.TrainingPowerSystems, persisted.payload,
            persisted.sourceEventCount, persisted.legacyPowerSystemsPolicy1)).toBe(true);
        expect(isDerivedMetricSnapshotReadableByMcp(DERIVED_METRIC_KINDS.TrainingPowerSystems, persisted.payload,
            persisted.sourceEventCount)).toBe(false);
        expect(persisted.payload).toMatchObject({
            asOfDayMs: Date.UTC(2026, 6, 20),
            policyVersion: DERIVED_TRAINING_POWER_SYSTEMS_POLICY_VERSION,
            windowDays: 42,
            historyDays: 84,
            activityTypes: [{
                activityType: ActivityTypes.Cycling,
                current: {
                    effectiveDayMs: Date.UTC(2026, 6, 20),
                    status: 'insufficient-evidence',
                    diagnostics: { sourceCount: 1 },
                },
                history: [
                    { effectiveDayMs: activityDayMs, status: 'insufficient-evidence' },
                    { effectiveDayMs: Date.UTC(2026, 6, 20), status: 'insufficient-evidence' },
                ],
            }],
        });
    });

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
                trainingActivities: buildTrainingActivitySources(formDocs.map((doc, index) => ({
                    id: `source-${index}`,
                    data: () => ({ ...doc.data(), stats: { ...doc.data().stats, [DataActivityTypes.type]: [ActivityTypes.Running] } }),
                }))),
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
        expect(formPayload.payloadVersion).toBe(DERIVED_FORM_PAYLOAD_VERSION);
        expect(formPayload.dailyLoads).toEqual([
            { dayMs: Date.UTC(2026, 0, 1), load: 10, activityCount: 1 },
            { dayMs: Date.UTC(2026, 0, 2), load: 20, activityCount: 1 },
            { dayMs: Date.UTC(2026, 0, 3), load: 30, activityCount: 1 },
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
        expect(monotonyPayload.monotony).toBe(2.4495);
        expect(monotonyPayload.strain).toBe(146.97);

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

    it('writes the five corrected intensity snapshots as current and publicly readable', async () => {
        const { writeDerivedMetricSnapshotsReady } = await import('./derived-metrics.service');
        const { isMcpTrainingMetricPayloadReadable } = await import('../mcp/data.service');
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 5, 30, 12));
        const formDocs = [buildEventDoc({ startDate: Date.UTC(2026, 5, 29, 8), stats: {
            [DataDuration.type]: 1500, [DataActivityTypes.type]: [ActivityTypes.Running],
            [DataHeartRateZoneOneDuration.type]: 100, [DataHeartRateZoneTwoDuration.type]: 200,
            [DataHeartRateZoneThreeDuration.type]: 300, [DataHeartRateZoneFourDuration.type]: 400,
            [DataHeartRateZoneFiveDuration.type]: 500,
        } })];
        const kinds = [DERIVED_METRIC_KINDS.IntensityDistribution, DERIVED_METRIC_KINDS.EasyPercent,
            DERIVED_METRIC_KINDS.HardPercent, DERIVED_METRIC_KINDS.TrainingSummary, DERIVED_METRIC_KINDS.TrainingBuildComparison];
        await writeDerivedMetricSnapshotsReady('user-1', kinds, {
            formDocs, trainingActivities: buildTrainingActivitySources(formDocs),
        }, { builtFromEventMutationVersion: 42 });
        for (const kind of kinds) {
            const snapshot = findPersistedPayload(kind);
            expect(snapshot.payload).toMatchObject({ intensityPolicyVersion: 1 });
            expect(isMcpTrainingMetricPayloadReadable(kind, snapshot.payload)).toBe(true);
        }
        expect(findPersistedPayload(DERIVED_METRIC_KINDS.EasyPercent).payload).toMatchObject({ value: 20 });
        expect(findPersistedPayload(DERIVED_METRIC_KINDS.HardPercent).payload).toMatchObject({ value: 60 });
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
                startDate: Date.UTC(2026, 0, 2, 23, 59, 0),
                stats: {
                    'Power Training Stress Score': 5,
                },
            }),
            buildEventDoc({
                startDate: Date.UTC(2026, 0, 3, 0, 1, 0),
                stats: {
                    'Training Stress Score': 0,
                },
            }),
            buildEventDoc({
                startDate: Date.UTC(2026, 0, 3, 7, 0, 0),
                stats: {
                    [DataDuration.type]: 1_800,
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
        expect(formPersistedSnapshot.sourceEventCount).toBe(4);
        const formPayload = formPersistedSnapshot.payload as Record<string, unknown>;
        expect(formPayload.dailyLoads).toEqual([
            { dayMs: Date.UTC(2026, 0, 2), load: 45, activityCount: 2 },
            { dayMs: Date.UTC(2026, 0, 3), load: 10, activityCount: 2 },
        ]);

        const recoveryPayload = findPersistedPayload(DERIVED_METRIC_KINDS.RecoveryNow).payload as Record<string, unknown>;
        expect(recoveryPayload.totalSeconds).toBe(5_000);
        expect(recoveryPayload.latestWorkoutSeconds).toBe(1_000);
        expect((recoveryPayload.segments as unknown[]).length).toBe(2);
    });
});


describe('source-specific intensity grouping', () => {
    const startDate = Date.UTC(2026, 5, 29, 8);
    const hrStats = {
        [DataHeartRateZoneOneDuration.type]: 100, [DataHeartRateZoneTwoDuration.type]: 200,
        [DataHeartRateZoneThreeDuration.type]: 300, [DataHeartRateZoneFourDuration.type]: 400,
        [DataHeartRateZoneFiveDuration.type]: 500,
    };
    it('retains both sources in a multisport event and counts its parent once', async () => {
        const { joinTrainingActivitySources, buildIntensityDistributionMetricPayload } = await import('./derived-metrics.service');
        const events = [
            { id: 'multi', data: () => ({ startDate, isMerge: true, mergeType: 'multi' }) },
            { id: 'benchmark', data: () => ({ startDate, isMerge: true, mergeType: 'benchmark' }) },
        ];
        const activity = (id: string, stats: Record<string, unknown>, eventID = 'multi', start = startDate) => ({
            id, data: () => ({ startDate: start, type: ActivityTypes.Running, eventID, stats }),
        });
        const activities = joinTrainingActivitySources([
            activity('power', { ...hrStats, [DataPowerZoneOneDuration.type]: 10,
                [DataPowerZoneFourDuration.type]: 40, [DataPowerZoneFiveDuration.type]: 50 }),
            activity('hr', hrStats), activity('missing', { [DataPowerZoneOneDuration.type]: -1 }),
            activity('excluded-only-week', {}, 'multi', startDate + 7 * 86400000),
            activity('benchmark-child', hrStats, 'benchmark'), activity('orphan', hrStats, 'missing-parent'),
        ], events);
        const result = buildIntensityDistributionMetricPayload(activities);
        expect(result.sourceEventCount).toBe(1);
        expect(result.payload.intensityPolicyVersion).toBe(1);
        expect(result.payload.weeks).toEqual([{
            weekStartMs: Date.UTC(2026, 5, 29), easySeconds: 310, moderateSeconds: 340,
            hardSeconds: 950, source: 'power',
        }]);
        expect(result.payload.coverageWeeks).toEqual([
            { weekStartMs: Date.UTC(2026, 5, 29), powerActivityCount: 1, heartRateActivityCount: 1,
                excludedActivityCount: 1, powerZoneSeconds: 100, heartRateZoneSeconds: 1500 },
            { weekStartMs: Date.UTC(2026, 6, 6), powerActivityCount: 0, heartRateActivityCount: 0,
                excludedActivityCount: 1, powerZoneSeconds: 0, heartRateZoneSeconds: 0 },
        ]);
        expect(result.payload.latestEasyPercent).toBe(19.38);
        expect(result.payload.latestModeratePercent).toBe(21.25);
        expect(result.payload.latestHardPercent).toBe(59.38);
        expect(buildIntensityDistributionMetricPayload([]).payload.latestHardPercent).toBeNull();
    });
    it('uses the same HR grouping for weekly distribution, Training Mix and both build windows', async () => {
        const { buildIntensityDistributionMetricPayload, buildTrainingSummaryMetricPayload,
            buildTrainingBuildComparisonMetricPayload } = await import('./derived-metrics.service');
        const activities = buildTrainingActivitySources([startDate, Date.UTC(2026, 0, 30)].map((start, index) => ({
            id: `event-${index}`, data: () => ({ startDate: start,
                stats: { ...hrStats, [DataActivityTypes.type]: [ActivityTypes.Running], [DataDuration.type]: 1500 } }),
        })));
        const nowMs = Date.UTC(2026, 5, 30, 12);
        const weekly = buildIntensityDistributionMetricPayload(activities).payload.weeks.at(-1);
        const mix = buildTrainingSummaryMetricPayload(activities, nowMs).payload.disciplines.find(d => d.discipline === 'running');
        const build = buildTrainingBuildComparisonMetricPayload(activities, { trainingSettings: { buildBenchmarks: {
            running: { mode: 'period', durationWeeks: 8, endDayMs: Date.UTC(2026, 2, 10) },
        } } }, nowMs).payload.disciplines.find(d => d.discipline === 'running');
        const expected = { easySeconds: 300, moderateSeconds: 300, hardSeconds: 900 };
        expect(weekly).toMatchObject(expected);
        expect(mix?.current28d).toMatchObject(expected);
        expect(build?.current).toMatchObject(expected);
        expect(build?.benchmark).toMatchObject(expected);
    });
});
