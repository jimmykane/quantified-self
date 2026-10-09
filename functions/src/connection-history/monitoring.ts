import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';

export const HISTORY_PROVIDERS = ['garmin', 'suunto', 'coros', 'wahoo'] as const;
export type HistoryProvider = typeof HISTORY_PROVIDERS[number] | 'unknown';
export function historyMonitoringProvider(service: unknown): HistoryProvider {
  switch (service) {
    case ServiceNames.GarminAPI: return 'garmin';
    case ServiceNames.SuuntoApp: return 'suunto';
    case ServiceNames.COROSAPI: return 'coros';
    case ServiceNames.WahooAPI: return 'wahoo';
    default: return 'unknown';
  }
}
type Signal = {
  event: 'dispatch_attempt' | 'worker_attempt' | 'checkpoint' | 'operation_retry' | 'recovery_run' | 'queue_sample' | 'queue_sample_unavailable';
  provider?: HistoryProvider;
  outcome?: 'accepted' | 'acknowledged' | 'failed' | 'active' | 'requested' | 'processed' | 'skipped' | 'completed' | 'expected_contention';
  durationMs?: number;
  dueSample?: number;
  ageLowerBoundMs?: number;
  unknownSample?: number;
  truncated?: boolean;
};
const events: readonly string[] = ['dispatch_attempt', 'worker_attempt', 'checkpoint', 'operation_retry', 'recovery_run', 'queue_sample', 'queue_sample_unavailable'];
const outcomes: readonly string[] = ['accepted', 'acknowledged', 'failed', 'active', 'requested', 'processed', 'skipped', 'completed', 'expected_contention'];

export function historyExpectedContention(error: unknown): boolean {
  return error instanceof Error && ['ProviderOperationStillInFlightError', 'TokenRefreshInProgressError', 'TokenRefreshSupersededError'].includes(error.name);
}

/** Reconstruct the allowlisted payload; never spread a run, error or caller object. */
export function emitHistoryMonitoring(signal: Signal): void {
  if (!events.includes(signal.event)) return;
  const payload: Record<string, unknown> = { telemetryVersion: 1, event: signal.event,
    provider: HISTORY_PROVIDERS.includes(signal.provider as typeof HISTORY_PROVIDERS[number]) ? signal.provider : 'unknown' };
  if (signal.outcome && outcomes.includes(signal.outcome)) payload.outcome = signal.outcome;
  for (const [field, max] of [['durationMs', 360_000], ['ageLowerBoundMs', 315_360_000_000], ['dueSample', 100], ['unknownSample', 100]] as const) {
    const value = signal[field];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) payload[field] = Math.min(max, Math.floor(value));
  }
  if (typeof signal.truncated === 'boolean') payload.truncated = signal.truncated;
  // Observability cannot turn a committed checkpoint/ACK into another task retry.
  try {
    if (signal.outcome === 'failed' || signal.event === 'operation_retry' || signal.event === 'queue_sample_unavailable') logger.warn('[ConnectionHistory]', payload);
    else logger.info('[ConnectionHistory]', payload);
  } catch { /* Best effort only. Missing telemetry has a separate heartbeat policy. */ }
}
