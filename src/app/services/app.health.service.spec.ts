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
    HEALTH_RECORD_KINDS,
    HEALTH_SCHEMA_VERSION,
    HEALTH_UNITS,
    HEALTH_VALUE_ORIGINS,
    HEALTH_VALUE_TYPES,
    HealthSourceRecord,
} from '@shared/health';
import {
    Firestore,
    collection,
    collectionData,
    documentId,
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
        limit: vi.fn((value: number) => ({ type: 'limit', value })),
        orderBy: vi.fn((field: string, direction: string) => ({ type: 'orderBy', field, direction })),
        query: vi.fn((collectionRef: unknown, ...constraints: unknown[]) => ({ collectionRef, constraints })),
        startAfter: vi.fn((...values: unknown[]) => ({ type: 'startAfter', values })),
        where: vi.fn((field: string, operator: string, value: unknown) => ({ type: 'where', field, operator, value })),
    };
});

function healthRecord(): HealthSourceRecord {
    const startTimeMs = Date.parse('2026-01-01T00:00:00.000Z');
    return {
        schemaVersion: HEALTH_SCHEMA_VERSION,
        id: 'record-1',
        userID: 'user-1',
        kind: HEALTH_RECORD_KINDS.DailySummary,
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

describe('AppHealthService', () => {
    let service: AppHealthService;
    let functions: { call: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(collectionData).mockReturnValue(of([]));
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
        expect(result.query.recordLimit).toBe(32);
        expect(collection).not.toHaveBeenCalled();
    });

    it('uses the shared provider-first plan for the default direct Firestore read', async () => {
        vi.mocked(collectionData).mockImplementation((target: unknown) => {
            const path = (target as { collectionRef?: { path?: string[] } }).collectionRef?.path || [];
            return of(path.at(-1) === 'healthRecords' ? [healthRecord()] : []) as never;
        });

        const result = await firstValueFrom(service.watchRange('user-1', {
            startDate: '2026-01-01',
            endDate: '2026-01-07',
            providers: [HEALTH_PROVIDERS.GarminAPI],
            metricIds: [HEALTH_METRIC_IDS.Steps],
            includeSamples: true,
            recordLimit: 10,
            chunkLimit: 8,
            recordCursor: { calendarDate: '2025-12-31', id: 'previous-record' },
        }));

        expect(result.observations).toHaveLength(1);
        expect(collection).toHaveBeenCalledWith(expect.anything(), 'users', 'user-1', 'healthRecords');
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
});
