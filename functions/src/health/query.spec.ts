import { describe, expect, it, vi } from 'vitest';
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
} from '../../../shared/health';
import { readHealthRange } from './query';

interface Operation {
    method: string;
    args: unknown[];
}

function fakeDatabase(recordDocs: HealthSourceRecord[]) {
    const operations = new Map<string, Operation[]>();
    const makeQuery = (collectionId: string) => {
        const queryOperations: Operation[] = [];
        operations.set(collectionId, queryOperations);
        const query = {
            where: vi.fn((...args: unknown[]) => {
                queryOperations.push({ method: 'where', args });
                return query;
            }),
            orderBy: vi.fn((...args: unknown[]) => {
                queryOperations.push({ method: 'orderBy', args });
                return query;
            }),
            startAfter: vi.fn((...args: unknown[]) => {
                queryOperations.push({ method: 'startAfter', args });
                return query;
            }),
            limit: vi.fn((...args: unknown[]) => {
                queryOperations.push({ method: 'limit', args });
                return query;
            }),
            get: vi.fn(async () => ({
                docs: collectionId === 'healthRecords'
                    ? recordDocs.map(record => ({ id: record.id, data: () => record }))
                    : [],
            })),
        };
        return query;
    };
    const db = {
        collection: vi.fn(() => ({
            doc: vi.fn(() => ({
                collection: vi.fn((collectionId: string) => makeQuery(collectionId)),
            })),
        })),
        runTransaction: vi.fn(async (runner: (transaction: { get: (query: { get: () => unknown }) => unknown }) => unknown) => runner({
            get: (query: { get: () => unknown }) => query.get(),
        })),
    };
    return { db, operations };
}

function record(): HealthSourceRecord {
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

describe('server health range reader', () => {
    it('executes the shared bounded plan and projects stored records', async () => {
        const fake = fakeDatabase([record()]);
        const result = await readHealthRange('user-1', {
            startDate: '2026-01-01',
            endDate: '2026-01-07',
            providers: [HEALTH_PROVIDERS.GarminAPI],
            metricIds: [HEALTH_METRIC_IDS.Steps],
            recordLimit: 10,
        }, { db: fake.db as never, nowMs: Date.parse('2026-01-02T00:00:00.000Z') });

        expect(result.observations).toHaveLength(1);
        expect(fake.operations.get('healthRecords')).toEqual(expect.arrayContaining([
            { method: 'where', args: ['calendarDate', '>=', '2026-01-01'] },
            { method: 'where', args: ['calendarDate', '<=', '2026-01-07'] },
            { method: 'where', args: ['source.provider', '==', HEALTH_PROVIDERS.GarminAPI] },
            { method: 'limit', args: [11] },
        ]));
        expect(fake.operations.has('healthSampleChunks')).toBe(false);
        expect(fake.db.runTransaction).toHaveBeenCalledWith(expect.any(Function), { readOnly: true });
    });

    it('applies the stable date/id cursor and separately bounds sample chunks', async () => {
        const fake = fakeDatabase([]);
        await readHealthRange('user-1', {
            startDate: '2026-01-01',
            endDate: '2026-01-07',
            includeSamples: true,
            recordCursor: { calendarDate: '2026-01-02', id: 'record-2' },
            chunkCursor: { calendarDate: '2026-01-03', id: 'chunk-3' },
            chunkLimit: 8,
        }, { db: fake.db as never });

        expect(fake.operations.get('healthRecords')).toEqual(expect.arrayContaining([
            { method: 'startAfter', args: ['2026-01-02', 'record-2'] },
        ]));
        expect(fake.operations.get('healthSampleChunks')).toEqual(expect.arrayContaining([
            { method: 'startAfter', args: ['2026-01-03', 'chunk-3'] },
            { method: 'limit', args: [9] },
        ]));
    });
});
