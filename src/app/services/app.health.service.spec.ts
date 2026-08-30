import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    HEALTH_COVERAGE_STATUSES,
    HEALTH_METRIC_IDS,
    HEALTH_NORMALIZATION_STATUSES,
    HEALTH_PROVIDERS,
    HEALTH_QUALITY_STATUSES,
    HEALTH_RECORDING_METHODS,
    HEALTH_SOURCE_RECORD_KINDS,
    HEALTH_SCHEMA_VERSION,
    HEALTH_UNITS,
    HEALTH_VALUE_ORIGINS,
    HEALTH_VALUE_TYPES,
    HealthSourceRecord,
    HealthSampleChunk,
} from '@shared/health';
import {
    Firestore,
    collection,
    collectionData,
    documentId,
    getDocs,
    limit,
    orderBy,
    query,
    startAfter,
    where,
} from 'app/firebase/firestore';
import { AppFunctionsService } from './app.functions.service';
import { AppHealthService } from './app.health.service';

vi.mock('app/firebase/firestore', () => {
    class MockFirestore { }
    return {
        Firestore: MockFirestore,
        collection: vi.fn((_firestore, ...path: string[]) => ({ path })),
        collectionData: vi.fn(() => of([])),
        documentId: vi.fn(() => '__name__'),
        getDocs: vi.fn(),
        limit: vi.fn((value: number) => ({ type: 'limit', value })),
        orderBy: vi.fn((field: string, direction: string) => ({ type: 'orderBy', field, direction })),
        query: vi.fn((collectionRef: unknown, ...constraints: unknown[]) => ({ collectionRef, constraints })),
        startAfter: vi.fn((...values: unknown[]) => ({ type: 'startAfter', values })),
        where: vi.fn((field: string, operator: string, value: unknown) => ({ type: 'where', field, operator, value })),
    };
});

function healthSourceRecord(): HealthSourceRecord {
    const startTimeMs = Date.parse('2026-01-01T00:00:00.000Z');
    return {
        schemaVersion: HEALTH_SCHEMA_VERSION,
        id: 'record-1',
        userID: 'user-1',
        kind: HEALTH_SOURCE_RECORD_KINDS.DailySummary,
        source: {
            provider: HEALTH_PROVIDERS.GarminAPI,
            accountKey: 'opaque-account',
            sourceRecordType: 'daily',
            sourceRecordKey: '2026-01-01',
            revision: { order: 1, token: 'one', digest: 'digest' },
            receivedAtMs: startTimeMs + 1000,
        },
        calendarDate: '2026-01-01',
        startTimeMs,
        endTimeMs: startTimeMs + 86_399_999,
        metrics: [{
            kind: 'value',
            metricId: HEALTH_METRIC_IDS.Steps,
            valueType: HEALTH_VALUE_TYPES.Number,
            aggregation: 'total',
            semanticVariant: 'provider_daily_summary',
            origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
            recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
            quality: { status: HEALTH_QUALITY_STATUSES.Valid },
            normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
            native: { metric: 'steps', value: 100 },
            canonical: { value: 100, unit: HEALTH_UNITS.Count },
        }],
        metricIds: [HEALTH_METRIC_IDS.Steps],
        coverage: { status: HEALTH_COVERAGE_STATUSES.Complete },
        sampleChunkIds: [],
        createdAtMs: startTimeMs,
        updatedAtMs: startTimeMs,
    };
}

function healthSampleChunk(id: string, pointCount: number): HealthSampleChunk {
    const startTimeMs = Date.parse('2026-01-01T00:00:00.000Z');
    const offsetMs = Array.from({ length: pointCount }, (_, index) => index * 1_000);
    return {
        schemaVersion: HEALTH_SCHEMA_VERSION,
        id,
        userID: 'user-1',
        parentSourceRecordId: 'record-1',
        provider: HEALTH_PROVIDERS.GarminAPI,
        accountKey: 'opaque-account',
        metricId: HEALTH_METRIC_IDS.HeartRate,
        valueType: HEALTH_VALUE_TYPES.Number,
        aggregation: 'sample',
        semanticVariant: 'device_sample',
        origin: HEALTH_VALUE_ORIGINS.Recorded,
        recordingMethod: HEALTH_RECORDING_METHODS.Device,
        normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
        nativeMetric: 'heartRate',
        nativeUnit: 'bpm',
        canonicalUnit: HEALTH_UNITS.BeatsPerMinute,
        calendarDate: '2026-01-01',
        startTimeMs,
        endTimeMs: startTimeMs + (offsetMs.at(-1) || 0),
        receivedAtMs: startTimeMs + 1000,
        seriesKey: 'heart-rate',
        chunkIndex: Number(id.replace(/\D/g, '')) || 0,
        offsetMs,
        nativeValues: offsetMs.map(() => 60),
        canonicalValues: offsetMs.map(() => 60),
        coverage: { status: HEALTH_COVERAGE_STATUSES.Complete, sampleCount: pointCount },
        revision: { order: 1, token: 'one', digest: 'digest' },
        createdAtMs: startTimeMs,
        updatedAtMs: startTimeMs,
    };
}

function mockPagedReads(
    sourceRecords: readonly HealthSourceRecord[],
    chunks: readonly HealthSampleChunk[] = [],
): void {
    vi.mocked(getDocs).mockImplementation(async (target: unknown) => {
        const queryTarget = target as {
            collectionRef?: { path?: string[] };
            constraints?: Array<{ type?: string; value?: number; values?: unknown[] }>;
        };
        const collectionID = queryTarget.collectionRef?.path?.at(-1);
        const values = collectionID === 'healthSampleChunks' ? chunks : sourceRecords;
        const limitValue = queryTarget.constraints?.find(constraint => constraint.type === 'limit')?.value || values.length;
        const cursor = queryTarget.constraints?.find(constraint => constraint.type === 'startAfter')?.values;
        const cursorDate = `${cursor?.[0] || ''}`;
        const cursorID = `${cursor?.[1] || ''}`;
        const startIndex = cursor?.length
            ? values.findIndex(value => value.calendarDate > cursorDate
                || (value.calendarDate === cursorDate && value.id > cursorID))
            : 0;
        const page = startIndex < 0 ? [] : values.slice(startIndex, startIndex + limitValue);
        return {
            docs: page.map(value => ({
                id: value.id,
                data: () => value,
            })),
        } as never;
    });
}

describe('AppHealthService', () => {
    let service: AppHealthService;
    let functions: { call: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(collectionData).mockReturnValue(of([]));
        vi.mocked(getDocs).mockResolvedValue({ docs: [] } as never);
        functions = { call: vi.fn() };
        TestBed.configureTestingModule({
            providers: [
                AppHealthService,
                { provide: Firestore, useValue: {} },
                { provide: AppFunctionsService, useValue: functions },
            ],
        });
        service = TestBed.inject(AppHealthService);
    });

    it('returns the typed empty projection without creating listeners when the user is absent', async () => {
        const result = await firstValueFrom(service.watchRange('', {
            startDate: '2026-01-01',
            endDate: '2026-01-02',
        }));

        expect(result.observations).toEqual([]);
        expect(result.query.sourceRecordLimit).toBe(32);
        expect(collection).not.toHaveBeenCalled();
    });

    it('uses the shared provider-first plan for the default direct Firestore read', async () => {
        vi.mocked(collectionData).mockImplementation((target: unknown) => {
            const path = (target as { collectionRef?: { path?: string[] } }).collectionRef?.path || [];
            return of(path.at(-1) === 'healthSourceRecords' ? [healthSourceRecord()] : []) as never;
        });

        const result = await firstValueFrom(service.watchRange('user-1', {
            startDate: '2026-01-01',
            endDate: '2026-01-07',
            providers: [HEALTH_PROVIDERS.GarminAPI],
            metricIds: [HEALTH_METRIC_IDS.Steps],
            includeSamples: true,
            sourceRecordLimit: 10,
            chunkLimit: 8,
            sourceRecordCursor: { calendarDate: '2025-12-31', id: 'previous-record' },
        }));

        expect(result.observations).toHaveLength(1);
        expect(collection).toHaveBeenCalledWith(expect.anything(), 'users', 'user-1', 'healthSourceRecords');
        expect(collection).toHaveBeenCalledWith(expect.anything(), 'users', 'user-1', 'healthSampleChunks');
        expect(where).toHaveBeenCalledWith('source.provider', '==', HEALTH_PROVIDERS.GarminAPI);
        expect(where).toHaveBeenCalledWith('provider', '==', HEALTH_PROVIDERS.GarminAPI);
        expect(where).not.toHaveBeenCalledWith('metricIds', 'array-contains', HEALTH_METRIC_IDS.Steps);
        expect(documentId).toHaveBeenCalled();
        expect(startAfter).toHaveBeenCalledWith('2025-12-31', 'previous-record');
        expect(limit).toHaveBeenCalledWith(11);
        expect(limit).toHaveBeenCalledWith(9);
    });

    it('uses the metric index when no provider is requested', async () => {
        await firstValueFrom(service.watchRange('user-1', {
            startDate: '2026-01-01',
            endDate: '2026-01-07',
            metricIds: [HEALTH_METRIC_IDS.HeartRate],
        }));

        expect(where).toHaveBeenCalledWith('metricIds', 'array-contains', HEALTH_METRIC_IDS.HeartRate);
    });

    it('offers the authenticated callable as an explicit server-read alternative', async () => {
        const expected = { observations: [] };
        functions.call.mockResolvedValue({ data: expected });
        const queryValue = { startDate: '2026-01-01', endDate: '2026-01-02' };

        await expect(service.queryRangeViaServer(queryValue)).resolves.toBe(expected);
        expect(functions.call).toHaveBeenCalledWith('queryHealthRange', queryValue);
    });

    it('keeps sync-state listeners owner-scoped and bounded', async () => {
        await firstValueFrom(service.watchSyncStates('user-1'));

        expect(collection).toHaveBeenCalledWith(expect.anything(), 'users', 'user-1', 'healthSyncState');
        expect(limit).toHaveBeenCalledWith(6);
        expect(query).toHaveBeenCalled();
    });

    it('does not create a sync-state listener without a user', async () => {
        await expect(firstValueFrom(service.watchSyncStates(null))).resolves.toEqual([]);
        expect(collection).not.toHaveBeenCalled();
        expect(orderBy).not.toHaveBeenCalled();
    });

    it('loads the selected metric across pages before projecting conflicts and coverage', async () => {
        const records = Array.from({ length: 34 }, (_, index) => {
            const record = healthSourceRecord();
            const provider = index === 33 ? HEALTH_PROVIDERS.COROSAPI : HEALTH_PROVIDERS.GarminAPI;
            const value = index === 33 ? 120 : 100;
            return {
                ...record,
                id: `record-${index.toString().padStart(2, '0')}`,
                source: {
                    ...record.source,
                    provider,
                    accountKey: `account-${provider}`,
                    sourceRecordKey: `record-${index}`,
                    revision: { order: 1, token: 'one', digest: `digest-${index}` },
                },
                metrics: [{
                    ...record.metrics[0],
                    native: { metric: 'steps', value },
                    canonical: { value, unit: HEALTH_UNITS.Count },
                }],
            } as HealthSourceRecord;
        });
        mockPagedReads(records);

        const loaded = await service.loadMetricRange('user-1', {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
            metricId: HEALTH_METRIC_IDS.Steps,
            includeSamples: false,
        });

        expect(loaded.sourceRecordCount).toBe(34);
        expect(loaded.limitReached).toBeNull();
        expect(loaded.result.pageInfo.sourceRecordAggregateComplete).toBe(true);
        expect(loaded.result.conflicts).toHaveLength(1);
        expect(getDocs).toHaveBeenCalledTimes(2);
        expect(where).toHaveBeenCalledWith('metricIds', 'array-contains', HEALTH_METRIC_IDS.Steps);
        expect(where).not.toHaveBeenCalledWith('source.provider', '==', expect.anything());
    });

    it('stops at the source-record cap and exposes an explicit incomplete result', async () => {
        const record = healthSourceRecord();
        const records = Array.from({ length: 2_049 }, (_, index) => ({
            ...record,
            id: `record-${index.toString().padStart(4, '0')}`,
            source: {
                ...record.source,
                sourceRecordKey: `record-${index}`,
                revision: { order: index, token: `token-${index}`, digest: `digest-${index}` },
            },
            metrics: [],
            metricIds: [HEALTH_METRIC_IDS.Steps],
        } as HealthSourceRecord));
        mockPagedReads(records);

        const loaded = await service.loadMetricRange('user-1', {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
            metricId: HEALTH_METRIC_IDS.Steps,
            includeSamples: false,
        });

        expect(loaded).toMatchObject({
            sourceRecordCount: 2_048,
            limitReached: 'source_records',
        });
        expect(loaded.result.pageInfo).toMatchObject({
            sourceRecordsTruncated: true,
            sourceRecordAggregateComplete: false,
        });
    });

    it('keeps sample chunks whole at the aggregate point cap', async () => {
        const record = {
            ...healthSourceRecord(),
            metrics: [],
            metricIds: [HEALTH_METRIC_IDS.HeartRate],
            sampleChunkIds: ['sample-series'],
        } as HealthSourceRecord;
        const chunks = Array.from({ length: 70 }, (_, index) =>
            healthSampleChunk(`chunk-${index.toString().padStart(3, '0')}`, 1_440));
        mockPagedReads([record], chunks);

        const loaded = await service.loadMetricRange('user-1', {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
            metricId: HEALTH_METRIC_IDS.HeartRate,
            includeSamples: true,
        });

        expect(loaded.limitReached).toBe('sample_points');
        expect(loaded.sampleChunkCount).toBe(69);
        expect(loaded.samplePointCount).toBe(99_360);
        expect(loaded.result.pageInfo).toMatchObject({
            samplesTruncated: true,
            sampleAggregateComplete: false,
        });
    });

    it('stops at the sample-chunk cap before accepting a partial next chunk', async () => {
        const record = {
            ...healthSourceRecord(),
            metrics: [],
            metricIds: [HEALTH_METRIC_IDS.HeartRate],
            sampleChunkIds: ['sample-series'],
        } as HealthSourceRecord;
        const chunks = Array.from({ length: 257 }, (_, index) =>
            healthSampleChunk(`chunk-${index.toString().padStart(3, '0')}`, 1));
        mockPagedReads([record], chunks);

        const loaded = await service.loadMetricRange('user-1', {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
            metricId: HEALTH_METRIC_IDS.HeartRate,
            includeSamples: true,
        });

        expect(loaded).toMatchObject({
            limitReached: 'sample_chunks',
            sampleChunkCount: 256,
            samplePointCount: 256,
        });
        expect(loaded.result.pageInfo).toMatchObject({
            samplesTruncated: true,
            sampleAggregateComplete: false,
        });
    });

    it('stops before the cumulative serialized-data budget is exceeded', async () => {
        const record = healthSourceRecord();
        const payload = 'x'.repeat(1_000_000);
        const records = Array.from({ length: 18 }, (_, index) => ({
            ...record,
            id: `record-${index.toString().padStart(2, '0')}`,
            source: {
                ...record.source,
                sourceRecordType: payload,
                sourceRecordKey: `record-${index}`,
                revision: { order: index, token: `token-${index}`, digest: `digest-${index}` },
            },
        } as HealthSourceRecord));
        mockPagedReads(records);

        const loaded = await service.loadMetricRange('user-1', {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
            metricId: HEALTH_METRIC_IDS.Steps,
            includeSamples: false,
        });

        expect(loaded.limitReached).toBe('serialized_bytes');
        expect(loaded.sourceRecordCount).toBeLessThan(records.length);
        expect(loaded.serializedBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
        expect(loaded.result.pageInfo.sourceRecordAggregateComplete).toBe(false);
    });

    it('drops stale sample revisions after all source and chunk pages are loaded', async () => {
        const record = {
            ...healthSourceRecord(),
            metrics: [],
            metricIds: [HEALTH_METRIC_IDS.HeartRate],
            sampleChunkIds: ['sample-series'],
        } as HealthSourceRecord;
        const current = healthSampleChunk('chunk-1', 4);
        const stale = healthSampleChunk('chunk-2', 4);
        stale.revision = { order: 0, token: 'stale', digest: 'stale' };
        mockPagedReads([record], [current, stale]);

        const loaded = await service.loadMetricRange('user-1', {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
            metricId: HEALTH_METRIC_IDS.HeartRate,
            includeSamples: true,
        });

        expect(loaded.result.sampleChunks.map(chunk => chunk.id)).toEqual(['chunk-1']);
        expect(loaded.result.pageInfo).toMatchObject({
            sampleRevisionMismatchCount: 1,
            sampleAggregateComplete: false,
        });
    });

    it('returns an ownerless empty aggregate without Firestore reads', async () => {
        const loaded = await service.loadMetricRange(null, {
            startDate: '2026-01-01',
            endDate: '2026-01-01',
            metricId: HEALTH_METRIC_IDS.RestingHeartRate,
            includeSamples: false,
        });

        expect(loaded.result.observations).toEqual([]);
        expect(getDocs).not.toHaveBeenCalled();
    });
});
