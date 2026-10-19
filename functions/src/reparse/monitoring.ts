import * as logger from 'firebase-functions/logger';

export const REPARSE_TIERS = ['normal', 'heavy', 'route'] as const;
export type ReparseTier = typeof REPARSE_TIERS[number];
type Observation = { tier: ReparseTier } & (
  | { event: 'worker_attempt'; outcome: 'acknowledged' | 'failed' | 'rollout_wait'; durationMs: number }
  | { event: 'job_commit'; outcome: 'completed' | 'skipped' | 'superseded' }
  | { event: 'enqueue_attempt'; outcome: 'queued' | 'deduplicated' | 'failed' }
  | { event: 'scan_attempt'; outcome: 'acknowledged' | 'failed'; durationMs: number }
  | { event: 'queue_sample_unavailable' }
  | { event: 'queue_sample'; pendingSample?: number; ageLowerBoundMs?: number; unknownSample: number; truncated: boolean; stalled: boolean }
);

/** Literal dimensions only. Telemetry must never change the processing result. */
export function emitReparseMonitoring(observation: Observation): void {
  try {
    const fields: Record<string, unknown> = { telemetryVersion: 1, event: observation.event, tier: observation.tier };
    if (!REPARSE_TIERS.includes(observation.tier)) return;
    if ('outcome' in observation) fields.outcome = observation.outcome;
    for (const key of ['durationMs', 'pendingSample', 'ageLowerBoundMs', 'unknownSample'] as const) {
      const value = key in observation ? (observation as unknown as Record<string, unknown>)[key] : undefined;
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) fields[key] = Math.floor(value);
    }
    if (observation.event === 'queue_sample') {
      fields.truncated = observation.truncated === true;
      fields.stalled = observation.stalled === true;
    }
    logger.info('[Reparse]', fields);
  } catch { /* Observability is not a processing dependency. */ }
}

export async function monitorReparseEnqueue(tier: ReparseTier, enqueue: () => Promise<boolean>): Promise<boolean> {
  try {
    const created = await enqueue();
    emitReparseMonitoring({ tier, event: 'enqueue_attempt', outcome: created ? 'queued' : 'deduplicated' });
    return created;
  } catch (error) {
    emitReparseMonitoring({ tier, event: 'enqueue_attempt', outcome: 'failed' });
    throw error;
  }
}

export async function monitorReparseAttempt<T>(tier: ReparseTier, event: 'worker_attempt' | 'scan_attempt',
  operation: () => Promise<T>, clock = Date.now): Promise<T> {
  const start = clock();
  try {
    const result = await operation();
    emitReparseMonitoring({ tier, event, outcome: 'acknowledged', durationMs: Math.max(0, clock() - start) });
    return result;
  } catch (error) {
    // This existing worker exception deliberately waits for a deployment rollout.
    const rollout = event === 'worker_attempt' && error instanceof Error
      && /^\[sports-lib-reparse-worker\] Runtime sports-lib version ".*" is behind job target ".*"\. Retrying after rollout\.$/.test(error.message);
    if (rollout) emitReparseMonitoring({ tier, event: 'worker_attempt', outcome: 'rollout_wait', durationMs: Math.max(0, clock() - start) });
    else emitReparseMonitoring({ tier, event, outcome: 'failed', durationMs: Math.max(0, clock() - start) });
    throw error;
  }
}
