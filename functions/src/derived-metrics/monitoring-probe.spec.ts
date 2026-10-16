import { afterEach, describe, expect, it, vi } from 'vitest';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metric-kinds';
import * as logger from 'firebase-functions/logger';
import { derivedMetricsPendingAge, observeDerivedMetricsQueue, DERIVED_METRICS_PROBE_TIMEOUT_MS } from './monitoring-probe';
vi.mock('firebase-functions/logger', () => ({ info: vi.fn() }));

const now = 1_800_000_000_000;
const row = () => ({ entryType: 'coordinator', status: 'queued', generation: 2,
    dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form], processingMetricKinds: [DERIVED_METRIC_KINDS.Form],
    requestedAtMs: now - 60 * 60_000, startedAtMs: now - 40 * 60_000, updatedAtMs: now - 5 * 60_000 });
describe('derived generation-only observation timing', () => {
    afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
    it('uses pending-generation timestamps even while coalescing keeps updating metadata', () => {
        expect(derivedMetricsPendingAge(row(), now)).toBe(60 * 60_000);
        expect(derivedMetricsPendingAge({ ...row(), updatedAtMs: now }, now)).toBe(60 * 60_000);
        expect(derivedMetricsPendingAge({ ...row(), status: 'processing' }, now)).toBe(40 * 60_000);
        expect(derivedMetricsPendingAge({ ...row(), status: 'idle', completedAtMs: 1, activityDate: 1 }, now)).toBe('excluded');
    });
    it('excludes the maximum native retry backoff and observes genuinely stranded failures afterward', () => {
        expect(derivedMetricsPendingAge({ ...row(), status: 'failed' }, now)).toBe('excluded');
        const old = { ...row(), status: 'failed', requestedAtMs: now - 6 * 3_600_000, updatedAtMs: now - 4 * 3_600_000 };
        expect(derivedMetricsPendingAge(old, now)).toBe(6 * 3_600_000);
        expect(derivedMetricsPendingAge({ ...old, updatedAtMs: old.updatedAtMs + 1 }, now)).toBe('excluded');
    });
    it.each([
        { requestedAtMs: null }, { requestedAtMs: '1' }, { requestedAtMs: -1 }, { requestedAtMs: Infinity },
        { updatedAtMs: NaN }, { generation: 1.2 }, { generation: null }, { generation: -1 },
        { requestedAtMs: now + DERIVED_METRICS_PROBE_TIMEOUT_MS + 1 }, { dirtyMetricKinds: [] },
        { dirtyMetricKinds: ['PRIVATE_METRIC'] }, { dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.Form] },
        { entryType: 'snapshot' },
    ])('keeps malformed coordinator metadata unknown: %j', patch => {
        expect(derivedMetricsPendingAge({ ...row(), ...patch }, now)).toBe('unknown');
    });
    it('allows only the short observation race window, never negative ages', () => {
        expect(derivedMetricsPendingAge({ ...row(), requestedAtMs: now + 1 }, now)).toBe(0);
    });
    it('bounds a stalled query and suppresses a late healthy result', async () => {
        vi.useFakeTimers();
        let resolve: (value: unknown) => void = () => undefined;
        const query = { where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(), get: () => new Promise(done => { resolve = done; }) };
        const db = { collectionGroup: () => query } as unknown as FirebaseFirestore.Firestore;
        const run = observeDerivedMetricsQueue(db, now);
        await vi.advanceTimersByTimeAsync(DERIVED_METRICS_PROBE_TIMEOUT_MS + 1);
        await run;
        expect(logger.info).toHaveBeenCalledTimes(3);
        resolve({ docs: [], size: 0 }); await vi.runAllTimersAsync();
        expect(logger.info).toHaveBeenCalledTimes(3);
        expect(vi.mocked(logger.info).mock.calls.every(([, fields]) => fields.event === 'queue_sample_unavailable')).toBe(true);
    });
});
