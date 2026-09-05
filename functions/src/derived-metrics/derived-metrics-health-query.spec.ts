import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HEALTH_METRIC_IDS } from '../../../shared/health';

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

    it('keeps VO2 reads metric-first so unrelated manual Weight cannot consume the cap', async () => {
        await fetchDerivedMetricsHealthDocs(
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
