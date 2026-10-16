import * as logger from 'firebase-functions/logger';
import { normalizeDerivedMetricKindsStrict } from '../../../shared/derived-metric-kinds';

export const DERIVED_MONITORING_STATES = ['queued', 'processing', 'failed'] as const;
export type DerivedMonitoringState = typeof DERIVED_MONITORING_STATES[number];
type CommitEvent = 'snapshot_commit' | 'coordinator_commit';
type CommitOutcome = 'ready' | 'failed' | 'settled' | 'requeued' | 'enqueue_failed';

function emit(fields: Record<string, string | number | boolean>): void {
    // Observations never authorize work or alter the original retry/commit result.
    try { logger.info('[DerivedMetrics]', { telemetryVersion: 1, ...fields }); } catch { /* best effort */ }
}

/** Call after a guarded transaction resolves, not from its retriable callback. */
export function recordDerivedMetricCommit(event: CommitEvent, outcome: CommitOutcome, kinds: unknown): void {
    // Never coerce untrusted persisted objects or let malformed legacy metadata
    // turn an already committed write into a failed task.
    const normalized = normalizeDerivedMetricKindsStrict(Array.isArray(kinds) ? kinds.filter(kind => typeof kind === 'string') : []);
    for (const metricKind of normalized.length ? normalized : ['unknown']) emit({ event, outcome, metricKind });
}

export function recordDerivedIngress(outcome: 'queued' | 'coalesced' | 'excluded' | 'invalid'): void {
    emit({ event: 'ingress', outcome });
}

/** A normal return is acknowledgement, not publication or a fresh current snapshot. */
export async function observeDerivedMetricAttempt<T>(stage: 'ingress' | 'calculation', operation: () => Promise<T>): Promise<T> {
    const started = Date.now();
    let outcome = 'failed';
    try {
        const result = await operation();
        outcome = 'acknowledged';
        return result;
    } finally {
        emit({ event: 'worker_attempt', stage, outcome, durationMs: Math.max(0, Date.now() - started) });
    }
}

export interface DerivedMetricsSample {
    state: DerivedMonitoringState;
    pendingSample: number;
    ageLowerBoundMs: number;
    unknownSample: number;
    excludedSample: number;
    truncated: boolean;
}

export function recordDerivedMetricsSample(sample: DerivedMetricsSample): void {
    if (!DERIVED_MONITORING_STATES.includes(sample.state)) return;
    const { state, pendingSample, ageLowerBoundMs, unknownSample, excludedSample, truncated } = sample;
    if ([pendingSample, ageLowerBoundMs, unknownSample, excludedSample].some(value => !Number.isSafeInteger(value) || value < 0)
        || typeof truncated !== 'boolean') return recordDerivedMetricsUnavailable();
    emit({ event: 'queue_sample', state, unknownSample, excludedSample, truncated,
        // A capped/unknown prefix cannot establish a healthy zero. Positive results remain lower bounds.
        ...(pendingSample > 0 || !truncated && unknownSample === 0 ? { pendingSample, ageLowerBoundMs } : {}),
    });
}

export function recordDerivedMetricsUnavailable(): void {
    for (const state of DERIVED_MONITORING_STATES) emit({ event: 'queue_sample_unavailable', state });
}
