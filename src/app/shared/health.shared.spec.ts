import {
    HEALTH_COVERAGE_STATUSES,
    HEALTH_MAX_QUERY_FETCH_BYTES,
    HEALTH_METRIC_CATALOG,
    HEALTH_METRIC_IDS,
    HEALTH_NORMALIZATION_STATUSES,
    HEALTH_PROVIDERS,
    HEALTH_QUALITY_STATUSES,
    HEALTH_RECORDING_METHODS,
    HEALTH_RECORD_KINDS,
    HEALTH_SCHEMA_VERSION,
    HEALTH_SLEEP_REFERENCE_METRIC_IDS,
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
    findHealthConflicts,
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
    deviceKey?: string;
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
        device: input.deviceKey ? { deviceKey: input.deviceKey } : undefined,
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
        receivedAtMs: startTimeMs + DAY_MS + 1_000,
        timezoneOffsetSeconds: 0,
        seriesKey: 'heart-rate',
        chunkIndex: Number(input.id.replace(/\D/g, '')) || 0,
        offsetMs,
        nativeValues: offsetMs.map((_, index) => 60 + index),
        canonicalValues: offsetMs.map((_, index) => 60 + index),
        coverage: { status: HEALTH_COVERAGE_STATUSES.Complete, sampleCount: input.pointCount },
        revision: { order: 1, token: 'revision-1', digest: 'digest-garmin-record' },
        createdAtMs: startTimeMs + DAY_MS,
        updatedAtMs: startTimeMs + DAY_MS,
    };
}

describe('unified health shared contract', () => {
    it('publishes stable metric definitions and canonical units', () => {
        expect(Object.isFrozen(HEALTH_METRIC_CATALOG)).toBe(true);
        expect(Object.isFrozen(HEALTH_METRIC_CATALOG[HEALTH_METRIC_IDS.ActiveEnergy])).toBe(true);
        expect(Object.isFrozen(HEALTH_SLEEP_REFERENCE_METRIC_IDS)).toBe(true);
        expect(Object.isFrozen(HEALTH_SLEEP_REFERENCE_METRIC_IDS[HEALTH_SLEEP_REFERENCE_FIELDS.AverageHrv])).toBe(true);
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
            recordLimit: 32,
            chunkLimit: 8,
            samplePointLimit: 10_000,
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
        [{ startDate: '2026-01-01', endDate: '2026-01-01', providers: new Array(1) }, 'supported providers'],
        [{ startDate: '2026-01-01', endDate: '2026-01-01', metricIds: new Array(1) }, 'supported metric IDs'],
        [{ startDate: '2026-01-01', endDate: '2026-01-01', recordLimit: 33 }, '1 to 32'],
        [{ startDate: '2026-01-01', endDate: '2026-01-01', chunkLimit: 9 }, '1 to 8'],
        [{ startDate: '2026-01-01', endDate: '2026-01-01', samplePointLimit: 1_439 }, '1440 to 11520'],
        [{
            startDate: '2026-01-01',
            endDate: '2026-01-01',
            recordCursor: { calendarDate: '2026-01-01', id: 'nested/path' },
        }, 'safe bounded document ID'],
    ])('rejects invalid or unbounded query input %#', (query, message) => {
        expect(() => normalizeHealthRangeQuery(query)).toThrowError(new RegExp(message));
        expect(() => normalizeHealthRangeQuery(query)).toThrow(HealthQueryValidationError);
    });

    it('keeps the maximum source-page fetch below a bounded callable response envelope', () => {
        expect(HEALTH_MAX_QUERY_FETCH_BYTES).toBeLessThan(17 * 1024 * 1024);
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
                deviceKey: 'garmin-watch-1',
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
                    coverage: { status: HEALTH_COVERAGE_STATUSES.Unknown },
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
            sources: [
                { provider: HEALTH_PROVIDERS.COROSAPI, accountKey: `account-${HEALTH_PROVIDERS.COROSAPI}` },
                { provider: HEALTH_PROVIDERS.GarminAPI, accountKey: `account-${HEALTH_PROVIDERS.GarminAPI}` },
            ],
            semanticVariant: 'provider_daily_summary',
            origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
            recordingMethods: [HEALTH_RECORDING_METHODS.ProviderCalculated],
        })]);
        expect(result.observations.find(item => item.recordId === 'garmin-record')?.device).toEqual({
            deviceKey: 'garmin-watch-1',
        });
        expect(result.observations.find(item => item.recordId === 'coros-record')?.coverage.status)
            .toBe(HEALTH_COVERAGE_STATUSES.Partial);
        expect(result.dailySummaries[0].sleepReferenceIds).toEqual(['sleep-session-1']);
        expect(result.coverage.find(item => item.provider === HEALTH_PROVIDERS.GarminAPI && item.metricId === HEALTH_METRIC_IDS.Steps)).toMatchObject({
            requestedDays: 3,
            recordedDays: 1,
            missingDays: 2,
            partialDays: 0,
            unknownDays: 0,
        });
        expect(result.coverage.find(item => item.provider === HEALTH_PROVIDERS.COROSAPI)).toMatchObject({
            recordedDays: 1,
            partialDays: 1,
            unknownDays: 0,
        });
        expect(result.coverage.find(item => item.provider === HEALTH_PROVIDERS.WahooAPI)).toMatchObject({
            recordedDays: 1,
            missingDays: 2,
            partialDays: 0,
            unknownDays: 1,
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
            aggregations: ['total'],
            origins: [HEALTH_VALUE_ORIGINS.ProviderSummary],
            recordingMethods: [HEALTH_RECORDING_METHODS.ProviderCalculated],
        });
    });

    it('keeps coverage and freshness separate across aggregation, origin, and recording method', () => {
        const record = sourceRecord({
            id: 'separate-semantics',
            provider: HEALTH_PROVIDERS.GarminAPI,
            metrics: [
                valueEntry(),
                valueEntry({
                    aggregation: 'average',
                    origin: HEALTH_VALUE_ORIGINS.Recorded,
                    recordingMethod: HEALTH_RECORDING_METHODS.Device,
                }),
            ],
        });

        const result = projectHealthRange([record], [], {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
        });

        expect(result.coverage).toEqual(expect.arrayContaining([
            expect.objectContaining({
                aggregation: 'average',
                origin: HEALTH_VALUE_ORIGINS.Recorded,
                recordingMethod: HEALTH_RECORDING_METHODS.Device,
            }),
            expect.objectContaining({
                aggregation: 'total',
                origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
                recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
            }),
        ]));
        expect(result.coverage).toHaveLength(2);
        expect(result.freshness).toHaveLength(2);
    });

    it('keeps coverage and freshness separate for multiple accounts at one provider', () => {
        const records = [
            sourceRecord({
                id: 'garmin-primary',
                provider: HEALTH_PROVIDERS.GarminAPI,
                accountKey: 'garmin-account-primary',
            }),
            sourceRecord({
                id: 'garmin-secondary',
                provider: HEALTH_PROVIDERS.GarminAPI,
                accountKey: 'garmin-account-secondary',
                metrics: [valueEntry({
                    native: { metric: 'steps', value: 120, unit: 'count' },
                    canonical: { value: 120, unit: HEALTH_UNITS.Count },
                })],
            }),
        ];

        const result = projectHealthRange(records, [], {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
        });

        expect(result.coverage.map(item => item.accountKey)).toEqual([
            'garmin-account-primary',
            'garmin-account-secondary',
        ]);
        expect(result.freshness.map(item => item.accountKey)).toEqual([
            'garmin-account-primary',
            'garmin-account-secondary',
        ]);
        expect(result.conflicts).toEqual([expect.objectContaining({
            providers: [HEALTH_PROVIDERS.GarminAPI],
            sources: [
                { provider: HEALTH_PROVIDERS.GarminAPI, accountKey: 'garmin-account-primary' },
                { provider: HEALTH_PROVIDERS.GarminAPI, accountKey: 'garmin-account-secondary' },
            ],
        })]);
    });

    it('does not merge distinct conflict identities containing delimiter characters', () => {
        const records = [
            sourceRecord({
                id: 'garmin-delimiter-record',
                provider: HEALTH_PROVIDERS.GarminAPI,
                metrics: [valueEntry({
                    aggregation: 'average\u0000overnight',
                    semanticVariant: 'provider_summary',
                    canonical: { value: 60, unit: HEALTH_UNITS.Count },
                })],
            }),
            sourceRecord({
                id: 'coros-delimiter-record',
                provider: HEALTH_PROVIDERS.COROSAPI,
                metrics: [valueEntry({
                    aggregation: 'average',
                    semanticVariant: 'overnight\u0000provider_summary',
                    canonical: { value: 70, unit: HEALTH_UNITS.Count },
                })],
            }),
        ];

        const result = projectHealthRange(records, [], {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
        });

        expect(result.conflicts).toEqual([]);
    });

    it('orders conflict groups by their complete semantic identity', () => {
        const total = valueEntry({ aggregation: 'total', canonical: { value: 100, unit: HEALTH_UNITS.Count } });
        const average = valueEntry({ aggregation: 'average', canonical: { value: 10, unit: HEALTH_UNITS.Count } });
        const records = [
            sourceRecord({
                id: 'garmin-conflicts',
                provider: HEALTH_PROVIDERS.GarminAPI,
                metrics: [total, average],
            }),
            sourceRecord({
                id: 'coros-conflicts',
                provider: HEALTH_PROVIDERS.COROSAPI,
                metrics: [
                    valueEntry({ aggregation: 'average', canonical: { value: 20, unit: HEALTH_UNITS.Count } }),
                    valueEntry({ aggregation: 'total', canonical: { value: 200, unit: HEALTH_UNITS.Count } }),
                ],
            }),
        ];

        const result = projectHealthRange(records, [], {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
        });

        expect(result.conflicts.map(conflict => conflict.aggregation)).toEqual(['average', 'total']);
    });

    it('does not report same-day values whose observation intervals do not overlap', () => {
        const dayStartMs = Date.parse('2026-01-01T00:00:00.000Z');
        const records = [
            sourceRecord({
                id: 'garmin-morning',
                provider: HEALTH_PROVIDERS.GarminAPI,
                startTimeMs: dayStartMs,
                endTimeMs: dayStartMs + 60_000,
                metrics: [valueEntry({ canonical: { value: 60, unit: HEALTH_UNITS.Count } })],
            }),
            sourceRecord({
                id: 'coros-evening',
                provider: HEALTH_PROVIDERS.COROSAPI,
                startTimeMs: dayStartMs + 12 * 60 * 60 * 1_000,
                endTimeMs: dayStartMs + 12 * 60 * 60 * 1_000 + 60_000,
                metrics: [valueEntry({ canonical: { value: 70, unit: HEALTH_UNITS.Count } })],
            }),
        ];

        const result = projectHealthRange(records, [], {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
        });

        expect(result.conflicts).toEqual([]);
    });

    it('orders provider semantic variants independently of the runtime locale', () => {
        const records = [
            sourceRecord({
                id: 'unicode-variant',
                provider: HEALTH_PROVIDERS.GarminAPI,
                metrics: [
                    valueEntry({ semanticVariant: 'ä-provider-summary' }),
                    valueEntry({ semanticVariant: 'z-provider-summary' }),
                ],
            }),
        ];

        const result = projectHealthRange(records, [], {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
        });

        expect(result.discovery[0].semanticVariants).toEqual([
            'z-provider-summary',
            'ä-provider-summary',
        ]);
    });

    it('keeps provider calendar dates and offsets stable across a DST transition', () => {
        const beforeTransition = sourceRecord({
            id: 'before-dst',
            provider: HEALTH_PROVIDERS.GarminAPI,
            calendarDate: '2026-03-07',
            startTimeMs: Date.parse('2026-03-07T05:00:00.000Z'),
            endTimeMs: Date.parse('2026-03-08T04:59:59.999Z'),
        });
        beforeTransition.timezoneOffsetSeconds = -5 * 60 * 60;
        const transitionDay = sourceRecord({
            id: 'dst-day',
            provider: HEALTH_PROVIDERS.GarminAPI,
            calendarDate: '2026-03-08',
            startTimeMs: Date.parse('2026-03-08T05:00:00.000Z'),
            endTimeMs: Date.parse('2026-03-09T03:59:59.999Z'),
        });
        transitionDay.timezoneOffsetSeconds = -4 * 60 * 60;

        const result = projectHealthRange([transitionDay, beforeTransition], [], {
            startDate: '2026-03-07',
            endDate: '2026-03-08',
        });

        expect(result.dailySummaries.map(summary => summary.calendarDate)).toEqual(['2026-03-07', '2026-03-08']);
        expect(result.observations.map(observation => ({
            date: observation.calendarDate,
            offset: observation.timezoneOffsetSeconds,
            durationMs: observation.endTimeMs - observation.startTimeMs + 1,
        }))).toEqual([
            { date: '2026-03-07', offset: -18_000, durationMs: DAY_MS },
            { date: '2026-03-08', offset: -14_400, durationMs: 23 * 60 * 60 * 1000 },
        ]);
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
            sampleAggregateComplete: false,
            chunkCursor: { calendarDate: '2026-01-01', id: 'chunk-1' },
        });
        expect(result.discovery[0]).toMatchObject({
            metricId: HEALTH_METRIC_IDS.HeartRate,
            hasSamples: true,
        });
        expect(result.freshness.find(item => item.semanticVariant === 'device_sample')?.lastReceivedAtMs)
            .toBe(chunks[0].receivedAtMs);
    });

    it('suppresses sample chunks from a mismatched known parent revision', () => {
        const record = sourceRecord({
            id: 'garmin-record',
            provider: HEALTH_PROVIDERS.GarminAPI,
        });
        const staleChunk = sampleChunk({ id: 'chunk-1', pointCount: 10 });
        staleChunk.revision = { order: 0, token: 'stale', digest: 'stale-digest' };

        const result = projectHealthRange([record], [staleChunk], {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
            includeSamples: true,
        });

        expect(result.sampleChunks).toEqual([]);
        expect(result.pageInfo).toMatchObject({
            sampleRevisionMismatchCount: 1,
            sampleAggregateComplete: false,
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
        expect(firstPage.pageInfo.recordAggregateComplete).toBe(false);

        const secondPage = projectHealthRange(records, [], {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
            providers: [HEALTH_PROVIDERS.GarminAPI],
            recordLimit: 1,
            recordCursor: firstPage.pageInfo.recordCursor,
        });
        expect(secondPage.observations.map(item => item.recordId)).toEqual(['c']);
        expect(secondPage.pageInfo.recordAggregateComplete).toBe(false);
    });

    it('supports deterministic conflict recomputation across record page boundaries', () => {
        const records = [
            sourceRecord({
                id: 'a-garmin',
                provider: HEALTH_PROVIDERS.GarminAPI,
                metrics: [valueEntry({ canonical: { value: 100, unit: HEALTH_UNITS.Count } })],
            }),
            sourceRecord({
                id: 'b-coros',
                provider: HEALTH_PROVIDERS.COROSAPI,
                metrics: [valueEntry({ canonical: { value: 120, unit: HEALTH_UNITS.Count } })],
            }),
        ];
        const query = {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
            recordLimit: 1,
        };
        const firstPage = projectHealthRange(records, [], query);
        const secondPage = projectHealthRange(records, [], {
            ...query,
            recordCursor: firstPage.pageInfo.recordCursor,
        });

        expect(firstPage.conflicts).toEqual([]);
        expect(secondPage.conflicts).toEqual([]);
        expect(findHealthConflicts([...firstPage.observations, ...secondPage.observations])).toEqual([
            expect.objectContaining({
                metricId: HEALTH_METRIC_IDS.Steps,
                observationIds: ['a-garmin:0', 'b-coros:0'],
            }),
        ]);
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
            chunkLimit: 8,
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
            fetchLimit: 9,
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
