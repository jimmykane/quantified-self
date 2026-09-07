import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HEALTH_METRIC_IDS, HEALTH_UNITS } from '../../../shared/health';
import { MANUAL_HEALTH_SOURCE_RECORD_TYPE } from '../../../shared/manual-health';
import { encodeHealthMetricSportsLibData } from '../../../shared/sports-lib-health-data';

const hoisted = vi.hoisted(() => {
    const get = vi.fn();
    const limit = vi.fn();
    const select = vi.fn();
    const orderBy = vi.fn();
    const where = vi.fn();
    const documentId = vi.fn(() => '__name__');
    const chain = { where, orderBy, select, limit, get };
    const healthCollection = { where };
    const userRef = { collection: vi.fn(() => healthCollection) };
    const usersCollection = { doc: vi.fn(() => userRef) };
    const firestore = vi.fn(() => ({ collection: vi.fn(() => usersCollection) }));
    return { get, limit, select, orderBy, where, documentId, chain, healthCollection, userRef, usersCollection, firestore };
});

vi.mock('firebase-admin', () => ({ firestore: hoisted.firestore }));
vi.mock('firebase-admin/firestore', () => ({ FieldPath: { documentId: hoisted.documentId } }));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../shared/cloud-tasks', () => ({ enqueueDerivedMetricsTask: vi.fn() }));

import {
    buildTrainingCapacityMetricPayload,
    fetchDerivedMetricsHealthDocs,
    hasAnyDerivedMetricsHealthRecord,
} from './derived-metrics.service';

describe('derived Health source queries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.where.mockReturnValue(hoisted.chain);
        hoisted.orderBy.mockReturnValue(hoisted.chain);
        hoisted.select.mockReturnValue(hoisted.chain);
        hoisted.limit.mockReturnValue(hoisted.chain);
        hoisted.get.mockResolvedValue({ docs: [], empty: true });
    });

    it('loads one metric through the existing metric/date index with a hard document cap', async () => {
        hoisted.get.mockResolvedValueOnce({ docs: [{ id: 'weight' }], empty: false });

        const docs = await fetchDerivedMetricsHealthDocs(
            'owner',
            HEALTH_METRIC_IDS.BodyWeight,
            '2026-01-01',
            '2026-02-28',
        );

        expect(hoisted.where).toHaveBeenNthCalledWith(1, 'metricIds', 'array-contains', HEALTH_METRIC_IDS.BodyWeight);
        expect(hoisted.where).toHaveBeenNthCalledWith(2, 'calendarDate', '>=', '2026-01-01');
        expect(hoisted.where).toHaveBeenNthCalledWith(3, 'calendarDate', '<=', '2026-02-28');
        expect(hoisted.orderBy).toHaveBeenNthCalledWith(1, 'calendarDate', 'asc');
        expect(hoisted.orderBy).toHaveBeenNthCalledWith(2, '__name__', 'asc');
        expect(hoisted.documentId).toHaveBeenCalledTimes(1);
        expect(hoisted.limit).toHaveBeenCalledWith(2_049);
        expect(docs).toEqual([{ id: 'weight' }]);
    });

    it('filters provider VO2 and manual Weight before applying the cap and retains a usable manual reference', async () => {
        const manual = {
            kind: 'point_measurement',
            source: { provider: 'QuantifiedSelf', accountKey: 'opaque', sourceRecordType: MANUAL_HEALTH_SOURCE_RECORD_TYPE },
            calendarDate: '2026-02-27',
            endTimeMs: Date.UTC(2026, 1, 27, 12),
            metricIds: [HEALTH_METRIC_IDS.Vo2Max],
            metrics: [encodeHealthMetricSportsLibData({
                kind: 'value', metricId: HEALTH_METRIC_IDS.Vo2Max, valueType: 'number',
                aggregation: 'measurement', semanticVariant: 'manual_running_lab_test',
                origin: 'recorded', recordingMethod: 'manual', normalizationStatus: 'canonical',
                quality: { status: 'valid' }, coverage: { status: 'complete' },
                native: { metric: 'VO2 Max', value: 57, unit: HEALTH_UNITS.MillilitersPerKilogramPerMinute, qualifiers: { context: 'running', method: 'lab_test' } },
                canonical: { value: 57, unit: HEALTH_UNITS.MillilitersPerKilogramPerMinute },
            })],
            unselectedPrivateField: 'must-not-be-read',
        };
        const records = [
            ...Array.from({ length: 2_050 }, () => ({ ...manual, source: { ...manual.source, provider: 'GarminAPI', sourceRecordType: 'userMetrics' } })),
            ...Array.from({ length: 2_050 }, () => ({ ...manual, metricIds: [HEALTH_METRIC_IDS.BodyWeight] })),
            manual,
        ];
        const readPath = (record: any, field: string): any => field.split('.').reduce((value, key) => value?.[key], record);
        hoisted.get.mockImplementationOnce(async () => {
            const matching = records.filter(record => hoisted.where.mock.calls.every(([field, operator, value]) => {
                const actual = readPath(record, field);
                if (operator === 'array-contains') return actual.includes(value);
                if (operator === '==') return actual === value;
                if (operator === '>=') return actual >= value;
                if (operator === '<=') return actual <= value;
                throw new Error(`Unsupported test predicate: ${operator}`);
            }));
            const fields = hoisted.select.mock.calls[0];
            return { docs: matching.slice(0, hoisted.limit.mock.calls[0][0]).map((record, index) => {
                const projected: Record<string, any> = {};
                fields.forEach((field: string) => {
                    const keys = field.split('.');
                    const leaf = keys.pop()!;
                    const parent = keys.reduce((value, key) => (value[key] ??= {}), projected);
                    parent[leaf] = readPath(record, field);
                });
                return { id: `fixture-${index}`, data: () => projected };
            }) };
        });
        const docs = await fetchDerivedMetricsHealthDocs(
            'owner',
            HEALTH_METRIC_IDS.Vo2Max,
            '2000-01-01',
            '2026-02-28',
        );

        expect(hoisted.where).toHaveBeenNthCalledWith(
            1,
            'metricIds',
            'array-contains',
            HEALTH_METRIC_IDS.Vo2Max,
        );
        expect(hoisted.where).toHaveBeenCalledWith('source.sourceRecordType', '==', MANUAL_HEALTH_SOURCE_RECORD_TYPE);
        expect(docs).toHaveLength(1);
        expect(docs[0].data()).not.toHaveProperty('unselectedPrivateField');
        const built = buildTrainingCapacityMetricPayload([], Date.UTC(2026, 1, 28, 12), docs);
        expect(built.payload.disciplines.find(item => item.discipline === 'running')?.referenceVo2Max)
            .toMatchObject({ value: 57, method: 'lab-test', provenance: 'manual-health-measurement' });
    });

    it('still fails explicitly when the relevant manual VO2 history exceeds the bound', async () => {
        hoisted.get.mockResolvedValueOnce({ docs: Array.from({ length: 2_049 }, () => ({ id: 'manual' })) });
        await expect(fetchDerivedMetricsHealthDocs('owner', HEALTH_METRIC_IDS.Vo2Max, '2000-01-01', '2026-02-28'))
            .rejects.toThrow('bounded document limit');
    });

    it('checks all-history Weight presence with one indexed document read', async () => {
        hoisted.get.mockResolvedValueOnce({ docs: [{ id: 'old-weight' }], empty: false });

        await expect(hasAnyDerivedMetricsHealthRecord(
            'owner',
            HEALTH_METRIC_IDS.BodyWeight,
            '2000-01-01',
            '2026-02-28',
        )).resolves.toBe(true);

        expect(hoisted.where).toHaveBeenNthCalledWith(1, 'metricIds', 'array-contains', HEALTH_METRIC_IDS.BodyWeight);
        expect(hoisted.where).toHaveBeenNthCalledWith(2, 'calendarDate', '>=', '2000-01-01');
        expect(hoisted.where).toHaveBeenNthCalledWith(3, 'calendarDate', '<=', '2026-02-28');
        expect(hoisted.select).toHaveBeenCalledWith('kind');
        expect(hoisted.limit).toHaveBeenCalledWith(1);
    });
});
