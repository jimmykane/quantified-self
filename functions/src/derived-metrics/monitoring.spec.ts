import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metrics';
import { observeDerivedMetricAttempt, recordDerivedIngress, recordDerivedMetricCommit,
    recordDerivedMetricsSample, recordDerivedMetricsUnavailable } from './monitoring';
vi.mock('firebase-functions/logger', () => ({ info: vi.fn() }));

describe('derived metrics privacy-safe observations', () => {
    beforeEach(() => vi.clearAllMocks());
    it('emits only canonical, deduplicated metric kinds and fixed dimensions', () => {
        recordDerivedMetricCommit('snapshot_commit', 'ready', [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.Form, 'private-uid-canary']);
        expect(logger.info).toHaveBeenCalledExactlyOnceWith('[DerivedMetrics]', {
            telemetryVersion: 1, event: 'snapshot_commit', outcome: 'ready', metricKind: DERIVED_METRIC_KINDS.Form,
        });
        recordDerivedMetricCommit('coordinator_commit', 'enqueue_failed', ['private-uid-canary']);
        expect(logger.info).toHaveBeenLastCalledWith('[DerivedMetrics]', expect.objectContaining({ metricKind: 'unknown' }));
        expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('private-uid-canary');
    });
    it('acknowledges ordinary returns without claiming publication and rethrows the identical exception', async () => {
        expect(await observeDerivedMetricAttempt('ingress', async () => 42)).toBe(42);
        expect(logger.info).toHaveBeenLastCalledWith('[DerivedMetrics]', expect.objectContaining({ event: 'worker_attempt', stage: 'ingress', outcome: 'acknowledged' }));
        const error = new Error('private-error-canary');
        await expect(observeDerivedMetricAttempt('calculation', async () => { throw error; })).rejects.toBe(error);
        expect(logger.info).toHaveBeenLastCalledWith('[DerivedMetrics]', expect.objectContaining({ stage: 'calculation', outcome: 'failed' }));
        expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain(error.message);
    });
    it('does not turn logger failures into retry, commit failure or lost return values', async () => {
        vi.mocked(logger.info).mockImplementationOnce(() => { throw new Error('log unavailable'); });
        expect(await observeDerivedMetricAttempt('calculation', async () => 'result')).toBe('result');
        recordDerivedIngress('coalesced');
        expect(logger.info).toHaveBeenLastCalledWith('[DerivedMetrics]', expect.objectContaining({ outcome: 'coalesced' }));
        recordDerivedMetricCommit('coordinator_commit', 'settled', { private: true });
        recordDerivedMetricCommit('coordinator_commit', 'settled', [{ toString() { throw new Error('PRIVATE'); } }]);
        expect(logger.info).toHaveBeenLastCalledWith('[DerivedMetrics]', expect.objectContaining({ metricKind: 'unknown' }));
    });
    it('retains positive lower bounds but withholds unknown/saturated healthy zeroes and extra fields', () => {
        const sample = { state: 'queued' as const, pendingSample: 0, ageLowerBoundMs: 0, unknownSample: 0, excludedSample: 0, truncated: false };
        recordDerivedMetricsSample({ ...sample, uid: 'private-owner-canary' } as typeof sample);
        expect(logger.info).toHaveBeenLastCalledWith('[DerivedMetrics]', expect.objectContaining({ pendingSample: 0, ageLowerBoundMs: 0 }));
        for (const extra of [{ unknownSample: 1 }, { truncated: true }]) {
            recordDerivedMetricsSample({ ...sample, ...extra });
            expect(vi.mocked(logger.info).mock.calls.at(-1)![1]).not.toHaveProperty('pendingSample');
        }
        recordDerivedMetricsSample({ ...sample, truncated: true, pendingSample: 1, ageLowerBoundMs: 1_800_000 });
        expect(logger.info).toHaveBeenLastCalledWith('[DerivedMetrics]', expect.objectContaining({ pendingSample: 1, ageLowerBoundMs: 1_800_000 }));
        expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('private-owner-canary');
    });
    it('emits all three idle-independent heartbeat groups on observation failure', () => {
        recordDerivedMetricsUnavailable();
        expect(vi.mocked(logger.info).mock.calls.map(call => call[1])).toEqual(['queued', 'processing', 'failed'].map(state => ({
            telemetryVersion: 1, event: 'queue_sample_unavailable', state,
        })));
    });
});
