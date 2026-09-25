import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { getTrainingDeliveryQueueStats } from './training-delivery-queue.stats';

type Row = Record<string, unknown>;
type FakeQuery = {
    where(field: string, operation: string, value: unknown): FakeQuery;
    orderBy(): FakeQuery;
    limit(): FakeQuery;
    count(): { get(): Promise<{ data(): { count: number } }> };
    get(): Promise<{ empty: boolean; docs: { data(): Row }[] }>;
};

function database(jobs: Row[], statuses: Row[], statusIndexAvailable = true): Firestore {
    function filteredRows(rows: Row[], filters: { field: string; value: unknown; operation: string }[]) {
        return rows.filter(row => filters.every(({ field, value, operation }) => operation === '<='
            ? Number(row[field]) <= Number(value) : row[field] === value)).sort((a, b) =>
            Number(a.dueAtMs ?? 0) - Number(b.dueAtMs ?? 0));
    }
    const filteredQuery = (rows: Row[], filters: { field: string; value: unknown; operation: string }[] = [], limited = false): FakeQuery => {
        const filtered = () => filteredRows(rows, filters);
        return {
            where: (field: string, operation: string, value: unknown) => filteredQuery(rows, [...filters, { field, operation, value }], limited),
            orderBy: () => filteredQuery(rows, filters, limited),
            limit: () => filteredQuery(rows, filters, true),
            count: () => ({ get: async () => {
                if (rows === statuses && !statusIndexAvailable) throw new Error('index unavailable');
                return { data: () => ({ count: filtered().length }) };
            } }),
            get: async () => ({ empty: filtered().length === 0,
                docs: filtered().slice(0, limited ? 1 : undefined).map(row => ({ data: () => row })) }),
        };
    };
    return {
        collection: vi.fn(() => filteredQuery(jobs)),
        collectionGroup: vi.fn(() => filteredQuery(statuses)),
    } as unknown as Firestore;
}

describe('Training delivery admin queue aggregates', () => {
    it('separates due jobs, future markers and current workout outcomes by service', async () => {
        const db = database([
            { uid: 'private-user', kind: 'delivery', provider: 'garmin', dueAtMs: 900 },
            { uid: 'private-user', kind: 'verification', provider: 'suunto', dueAtMs: 1200 },
            { uid: 'other-user', kind: 'reconcile', dueAtMs: 1400 },
        ], [
            { provider: 'garmin', status: 'delivered', hasRemoteCopy: true, remoteId: 'secret-id' },
            { provider: 'garmin', status: 'delivered', hasRemoteCopy: false },
            { provider: 'suunto', status: 'retrying' },
            { provider: 'suunto', status: 'needs_attention' },
            { provider: 'wahoo', status: 'failed' },
        ]);
        const result = await getTrainingDeliveryQueueStats(db, 1000);
        expect(result.jobs).toEqual({ total: 3, due: 1, reconcile: 1, delivery: 1, verification: 1, oldestDueLagMs: 100 });
        expect(result.outcomes).toEqual({ delivered: 1, retrying: 1, failed: 1, needsAttention: 1 });
        expect(result.providers.find(item => item.provider === 'suunto')).toEqual({
            provider: 'suunto', queued: 1, delivered: 0, retrying: 1, failed: 0, needsAttention: 1,
        });
        expect(JSON.stringify(result)).not.toMatch(/private-user|other-user|secret-id/);
        expect(db.collectionGroup).toHaveBeenCalledWith('trainingDeliveryStatuses');
    });

    it('reports unavailable outcome counts without hiding job counts when an index is missing', async () => {
        const result = await getTrainingDeliveryQueueStats(database([{ kind: 'delivery', dueAtMs: 0 }], [], false), 1000);
        expect(result.jobsAvailable).toBe(true);
        expect(result.jobs.due).toBe(1);
        expect(result.statusCountsAvailable).toBe(false);
    });
});
