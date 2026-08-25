import {
    HEALTH_COVERAGE_STATUSES,
    HEALTH_METRIC_CATALOG,
    HEALTH_METRIC_IDS,
    HEALTH_NORMALIZATION_STATUSES,
    HEALTH_PROVIDERS,
    HEALTH_QUALITY_STATUSES,
    HEALTH_RECORDING_METHODS,
    HEALTH_RECORD_KINDS,
    HEALTH_SCHEMA_VERSION,
    HEALTH_SLEEP_REFERENCE_FIELDS,
    HEALTH_UNITS,
    HEALTH_VALUE_ORIGINS,
    HEALTH_VALUE_TYPES,
    HealthMetricEntry,
    HealthMetricId,
    HealthMetricValue,
    HealthProvider,
    HealthSampleChunk,
    HealthSourceRecord,
} from '@shared/health';
import {
    HealthQueryValidationError,
    canonicalUnitForMetric,
    normalizeHealthRangeQuery,
    projectHealthRange,
} from '@shared/health-query';
import { planHealthFirestoreQueries } from '@shared/health-firestore-query';

const DAY_MS = 24 * 60 * 60 * 1000;

function valueEntry(overrides: Partial<HealthMetricValue> = {}): HealthMetricValue {
    return {
        kind: 'value',
        metricId: HEALTH_METRIC_IDS.Steps,
        valueType: HEALTH_VALUE_TYPES.Number,
        aggregation: 'total',
        semanticVariant: 'provider_daily_summary',
        origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
        recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
        quality: { status: HEALTH_QUALITY_STATUSES.Valid },
        coverage: {
            status: HEALTH_COVERAGE_STATUSES.Complete,
            expectedUpdateIntervalMs: DAY_MS,
        },
        normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
        native: { metric: 'steps', value: 100, unit: 'count' },
        canonical: { value: 100, unit: HEALTH_UNITS.Count },
        ...overrides,
    };
}

function sourceRecord(input: {
    id: string;
    provider: HealthProvider;
    accountKey?: string;
    calendarDate?: string;
    metrics?: HealthMetricEntry[];
    coverageStatus?: 'complete' | 'partial' | 'unknown';
    startTimeMs?: number;
    endTimeMs?: number;
}): HealthSourceRecord {
    const calendarDate = input.calendarDate || '2026-01-01';
    const startTimeMs = input.startTimeMs ?? Date.parse(`${calendarDate}T00:00:00.000Z`);
    return {
        schemaVersion: HEALTH_SCHEMA_VERSION,
        id: input.id,
        userID: 'user-1',
        kind: HEALTH_RECORD_KINDS.DailySummary,
        source: {
            provider: input.provider,
            accountKey: input.accountKey || `account-${input.provider}`,
            sourceRecordType: 'daily',
            sourceRecordKey: input.id,
            revision: { order: 1, token: 'revision-1', digest: `digest-${input.id}` },
            receivedAtMs: startTimeMs + DAY_MS,
        },
        calendarDate,
        startTimeMs,
        endTimeMs: input.endTimeMs ?? startTimeMs + DAY_MS - 1,
        timezoneOffsetSeconds: 0,
        metrics: input.metrics || [valueEntry()],
        metricIds: [...new Set((input.metrics || [valueEntry()]).map(metric => metric.metricId))],
        coverage: { status: input.coverageStatus || HEALTH_COVERAGE_STATUSES.Complete },
        sampleChunkIds: [],
        createdAtMs: startTimeMs + DAY_MS,
        updatedAtMs: startTimeMs + DAY_MS,
    };
}

function sampleChunk(input: {
    id: string;
    pointCount: number;
    calendarDate?: string;
    provider?: HealthProvider;
    metricId?: HealthMetricId;
}): HealthSampleChunk {
    const calendarDate = input.calendarDate || '2026-01-01';
    const startTimeMs = Date.parse(`${calendarDate}T00:00:00.000Z`);
    const offsetMs = Array.from({ length: input.pointCount }, (_, index) => index * 60_000);
    const metricId = input.metricId || HEALTH_METRIC_IDS.HeartRate;
    return {
        schemaVersion: HEALTH_SCHEMA_VERSION,
        id: input.id,
        userID: 'user-1',
        parentRecordId: 'garmin-record',
        provider: input.provider || HEALTH_PROVIDERS.GarminAPI,
        accountKey: 'garmin-account',
        metricId,
        valueType: HEALTH_VALUE_TYPES.Number,
        aggregation: 'sample',
        semanticVariant: 'device_sample',
        origin: HEALTH_VALUE_ORIGINS.Recorded,
        recordingMethod: HEALTH_RECORDING_METHODS.Device,
        normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
        nativeMetric: metricId,
        nativeUnit: HEALTH_METRIC_CATALOG[metricId].canonicalUnit,
        canonicalUnit: HEALTH_METRIC_CATALOG[metricId].canonicalUnit,
        calendarDate,
        startTimeMs,
        endTimeMs: startTimeMs + (offsetMs.at(-1) || 0),
        timezoneOffsetSeconds: 0,
        seriesKey: 'heart-rate',
        chunkIndex: Number(input.id.replace(/\D/g, '')) || 0,
        offsetMs,
        nativeValues: offsetMs.map((_, index) => 60 + index),
        canonicalValues: offsetMs.map((_, index) => 60 + index),
        coverage: { status: HEALTH_COVERAGE_STATUSES.Complete, sampleCount: input.pointCount },
        revision: { order: 1, token: 'revision-1', digest: 'digest-record' },
        createdAtMs: startTimeMs + DAY_MS,
        updatedAtMs: startTimeMs + DAY_MS,
    };
}

describe('unified health shared contract', () => {
    it('publishes stable metric definitions and canonical units', () => {
        expect(HEALTH_METRIC_CATALOG[HEALTH_METRIC_IDS.ActiveEnergy]).toMatchObject({
            valueType: HEALTH_VALUE_TYPES.Number,
            canonicalUnit: HEALTH_UNITS.Kilocalorie,
        });
        expect(HEALTH_METRIC_CATALOG[HEALTH_METRIC_IDS.StressState]).toMatchObject({
            valueType: HEALTH_VALUE_TYPES.Category,
            canonicalUnit: HEALTH_UNITS.Category,
        });
        expect(HEALTH_METRIC_CATALOG[HEALTH_METRIC_IDS.SleepDuration]).toMatchObject({
            category: 'sleep',
            canonicalUnit: HEALTH_UNITS.Second,
        });
        expect(canonicalUnitForMetric(HEALTH_METRIC_IDS.HeartRateVariability)).toBe(HEALTH_UNITS.Millisecond);
    });

    it('normalizes a bounded summary query', () => {
        expect(normalizeHealthRangeQuery({
            startDate: '2026-01-01',
            endDate: '2026-01-03',
            providers: [HEALTH_PROVIDERS.GarminAPI, HEALTH_PROVIDERS.GarminAPI],
        })).toMatchObject({
            providers: [HEALTH_PROVIDERS.GarminAPI],
            metricIds: [],
            includeSamples: false,
            recordLimit: 250,
            chunkLimit: 100,
            samplePointLimit: 25_000,
            recordCursor: null,
            chunkCursor: null,
        });
    });

    it.each([
        [{ startDate: '2026-02-30', endDate: '2026-03-01' }, 'valid calendar date'],
        [{ startDate: '2026-01-02', endDate: '2026-01-01' }, 'on or after'],
        [{ startDate: '2025-01-01', endDate: '2026-01-02' }, '366-day limit'],
        [{ startDate: '2026-01-01', endDate: '2026-02-01', includeSamples: true }, '31-day limit'],
        [{ startDate: '2026-01-01', endDate: '2026-01-01', metricIds: ['unknown'] }, 'supported metric IDs'],
        [{ startDate: '2026-01-01', endDate: '2026-01-01', recordLimit: 1_001 }, '1 to 1000'],
        [{ startDate: '2026-01-01', endDate: '2026-01-01', samplePointLimit: 1_439 }, '1440 to 50000'],
        [{
            startDate: '2026-01-01',
            endDate: '2026-01-01',
            recordCursor: { calendarDate: '2026-01-01', id: 'nested/path' },
        }, 'safe bounded document ID'],
    ])('rejects invalid or unbounded query input %#', (query, message) => {
        expect(() => normalizeHealthRangeQuery(query)).toThrowError(new RegExp(message));
        expect(() => normalizeHealthRangeQuery(query)).toThrow(HealthQueryValidationError);
    });

    it('projects provider-aware observations without hiding conflicts or data gaps', () => {
        const sleepReference: HealthMetricEntry = {
            kind: 'sleep_reference',
            metricId: HEALTH_METRIC_IDS.HeartRate,
            valueType: HEALTH_VALUE_TYPES.Number,
            aggregation: 'average',
            semanticVariant: 'sleep_session',
            origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
            recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
            quality: { status: HEALTH_QUALITY_STATUSES.Valid },
            reference: {
                domain: 'sleep',
                documentId: 'sleep-session-1',
                field: HEALTH_SLEEP_REFERENCE_FIELDS.AverageHeartRate,
            },
        };
        const records = [
            sourceRecord({
                id: 'garmin-record',
                provider: HEALTH_PROVIDERS.GarminAPI,
                metrics: [valueEntry(), sleepReference],
            }),
            sourceRecord({
                id: 'coros-record',
                provider: HEALTH_PROVIDERS.COROSAPI,
                coverageStatus: HEALTH_COVERAGE_STATUSES.Partial,
                metrics: [valueEntry({
                    native: { metric: 'step', value: 120 },
                    canonical: { value: 120, unit: HEALTH_UNITS.Count },
                    coverage: { status: HEALTH_COVERAGE_STATUSES.Partial, expectedUpdateIntervalMs: DAY_MS },
                })],
            }),
            sourceRecord({
                id: 'suunto-record',
                provider: HEALTH_PROVIDERS.SuuntoApp,
                metrics: [valueEntry({
                    semanticVariant: 'ten_minute_bucket_total',
                    native: { metric: 'steps', value: 20 },
                    canonical: { value: 20, unit: HEALTH_UNITS.Count },
                })],
            }),
            sourceRecord({
                id: 'native-only-record',
                provider: HEALTH_PROVIDERS.WahooAPI,
                metrics: [valueEntry({
                    normalizationStatus: HEALTH_NORMALIZATION_STATUSES.NativeOnly,
                    native: { metric: 'vendorWellness', value: 'good' },
                    canonical: null,
                })],
            }),
        ];

        const result = projectHealthRange(records, [], {
            startDate: '2026-01-01',
            endDate: '2026-01-03',
        }, Date.parse('2026-01-05T00:00:00.000Z'));

        expect(result.observations).toHaveLength(5);
        expect(result.conflicts).toEqual([expect.objectContaining({
            metricId: HEALTH_METRIC_IDS.Steps,
            providers: [HEALTH_PROVIDERS.COROSAPI, HEALTH_PROVIDERS.GarminAPI],
            semanticVariant: 'provider_daily_summary',
        })]);
        expect(result.dailySummaries[0].sleepReferenceIds).toEqual(['sleep-session-1']);
        expect(result.coverage.find(item => item.provider === HEALTH_PROVIDERS.GarminAPI && item.metricId === HEALTH_METRIC_IDS.Steps)).toMatchObject({
            requestedDays: 3,
            recordedDays: 1,
            partialDays: 0,
        });
        expect(result.coverage.find(item => item.provider === HEALTH_PROVIDERS.COROSAPI)).toMatchObject({
            recordedDays: 1,
            partialDays: 1,
        });
        expect(result.freshness.find(item => item.provider === HEALTH_PROVIDERS.GarminAPI && item.metricId === HEALTH_METRIC_IDS.Steps)).toMatchObject({
            status: 'stale',
            staleAfterMs: DAY_MS,
        });
        expect(result.discovery.find(item => item.metricId === HEALTH_METRIC_IDS.Steps)).toMatchObject({
            providers: [
                HEALTH_PROVIDERS.COROSAPI,
                HEALTH_PROVIDERS.GarminAPI,
                HEALTH_PROVIDERS.SuuntoApp,
                HEALTH_PROVIDERS.WahooAPI,
            ],
            semanticVariants: ['provider_daily_summary', 'ten_minute_bucket_total'],
        });
    });

    it('keeps sample chunks whole when enforcing the point budget', () => {
        const record = sourceRecord({
            id: 'garmin-record',
            provider: HEALTH_PROVIDERS.GarminAPI,
            metrics: [valueEntry({
                metricId: HEALTH_METRIC_IDS.HeartRate,
                aggregation: 'average',
                semanticVariant: 'daily_average',
                native: { metric: 'averageHeartRate', value: 65, unit: 'bpm' },
                canonical: { value: 65, unit: HEALTH_UNITS.BeatsPerMinute },
            })],
        });
        const chunks = [
            sampleChunk({ id: 'chunk-1', pointCount: 1_000 }),
            sampleChunk({ id: 'chunk-2', pointCount: 700 }),
        ];

        const result = projectHealthRange([record], chunks, {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
            metricIds: [HEALTH_METRIC_IDS.HeartRate],
            includeSamples: true,
            samplePointLimit: 1_440,
        });

        expect(result.sampleChunks.map(chunk => chunk.id)).toEqual(['chunk-1']);
        expect(result.pageInfo).toMatchObject({
            returnedSamplePoints: 1_000,
            samplesTruncated: true,
            chunkCursor: { calendarDate: '2026-01-01', id: 'chunk-1' },
        });
        expect(result.discovery[0]).toMatchObject({
            metricId: HEALTH_METRIC_IDS.HeartRate,
            hasSamples: true,
        });
    });

    it('returns deterministic record cursors and respects provider filters', () => {
        const records = [
            sourceRecord({ id: 'a', provider: HEALTH_PROVIDERS.GarminAPI }),
            sourceRecord({ id: 'b', provider: HEALTH_PROVIDERS.COROSAPI }),
            sourceRecord({ id: 'c', provider: HEALTH_PROVIDERS.GarminAPI }),
        ];

        const firstPage = projectHealthRange(records, [], {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
            providers: [HEALTH_PROVIDERS.GarminAPI],
            recordLimit: 1,
        });
        expect(firstPage.observations.map(item => item.recordId)).toEqual(['a']);
        expect(firstPage.pageInfo.recordCursor).toEqual({ calendarDate: '2026-01-01', id: 'a' });

        const secondPage = projectHealthRange(records, [], {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
            providers: [HEALTH_PROVIDERS.GarminAPI],
            recordLimit: 1,
            recordCursor: firstPage.pageInfo.recordCursor,
        });
        expect(secondPage.observations.map(item => item.recordId)).toEqual(['c']);
    });

    it('mirrors metric-index paging when no provider filter is requested', () => {
        const records = [
            sourceRecord({
                id: 'a-heart-rate',
                provider: HEALTH_PROVIDERS.GarminAPI,
                metrics: [valueEntry({ metricId: HEALTH_METRIC_IDS.HeartRate })],
            }),
            sourceRecord({ id: 'b-steps', provider: HEALTH_PROVIDERS.GarminAPI }),
            sourceRecord({ id: 'c-steps', provider: HEALTH_PROVIDERS.COROSAPI }),
        ];

        const result = projectHealthRange(records, [], {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
            metricIds: [HEALTH_METRIC_IDS.Steps],
            recordLimit: 1,
        });

        expect(result.observations.map(item => item.recordId)).toEqual(['b-steps']);
        expect(result.pageInfo).toMatchObject({
            recordsTruncated: true,
            recordCursor: { calendarDate: '2026-01-01', id: 'b-steps' },
        });
    });

    it('advances through sparse provider pages before applying the secondary metric filter', () => {
        const chunks = [
            sampleChunk({ id: 'chunk-a', pointCount: 1, metricId: HEALTH_METRIC_IDS.Steps }),
            sampleChunk({ id: 'chunk-b', pointCount: 1, metricId: HEALTH_METRIC_IDS.Steps }),
            sampleChunk({ id: 'chunk-c', pointCount: 1, metricId: HEALTH_METRIC_IDS.HeartRate }),
        ];
        const query = {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
            providers: [HEALTH_PROVIDERS.GarminAPI],
            metricIds: [HEALTH_METRIC_IDS.HeartRate],
            includeSamples: true,
            chunkLimit: 2,
        };

        const firstPage = projectHealthRange([], chunks, query);
        expect(firstPage.sampleChunks).toEqual([]);
        expect(firstPage.pageInfo).toMatchObject({
            samplesTruncated: true,
            chunkCursor: { calendarDate: '2026-01-01', id: 'chunk-b' },
        });

        const secondPage = projectHealthRange([], chunks, {
            ...query,
            chunkCursor: firstPage.pageInfo.chunkCursor,
        });
        expect(secondPage.sampleChunks.map(chunk => chunk.id)).toEqual(['chunk-c']);
        expect(secondPage.pageInfo.samplesTruncated).toBe(false);
    });

    it('uses one bounded Firestore predicate per collection and leaves secondary filtering to the projector', () => {
        const plans = planHealthFirestoreQueries({
            startDate: '2026-01-01',
            endDate: '2026-01-07',
            providers: [HEALTH_PROVIDERS.GarminAPI, HEALTH_PROVIDERS.COROSAPI],
            metricIds: [HEALTH_METRIC_IDS.HeartRate],
            includeSamples: true,
            recordLimit: 10,
            chunkLimit: 20,
        });

        expect(plans.records).toMatchObject({
            filter: {
                field: 'source.provider',
                operator: 'in',
                value: [HEALTH_PROVIDERS.GarminAPI, HEALTH_PROVIDERS.COROSAPI],
            },
            fetchLimit: 11,
        });
        expect(plans.chunks).toMatchObject({
            filter: {
                field: 'provider',
                operator: 'in',
                value: [HEALTH_PROVIDERS.GarminAPI, HEALTH_PROVIDERS.COROSAPI],
            },
            fetchLimit: 21,
        });
    });

    it('uses metric indexes when no provider predicate is requested', () => {
        const plans = planHealthFirestoreQueries({
            startDate: '2026-01-01',
            endDate: '2026-01-07',
            metricIds: [HEALTH_METRIC_IDS.HeartRate, HEALTH_METRIC_IDS.HeartRateVariability],
            includeSamples: true,
        });

        expect(plans.records.filter).toMatchObject({ field: 'metricIds', operator: 'array-contains-any' });
        expect(plans.chunks?.filter).toMatchObject({ field: 'metricId', operator: 'in' });
    });
});
