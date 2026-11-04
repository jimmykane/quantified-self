import { getSleepBackfillWindowDays } from '../../../shared/sleep-backfill';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import { SUUNTO_HEALTH_MAX_TARGET_WINDOW_DAYS } from './health-window';

export const SUUNTO_HISTORY_WINDOWS_PER_BATCH = 4;
export function suuntoHistoryWindowDays(resource: 'sleep' | 'health'): number {
  return resource === 'health' ? SUUNTO_HEALTH_MAX_TARGET_WINDOW_DAYS
    : getSleepBackfillWindowDays(SLEEP_PROVIDERS.SuuntoApp)!;
}
export function suuntoHistoryBatchDays(resource: 'sleep' | 'health'): number {
  return suuntoHistoryWindowDays(resource) * SUUNTO_HISTORY_WINDOWS_PER_BATCH;
}
/** The selected end is inclusive; queue ranges are exclusive. No cursor gap. */
export function suuntoHistoryBatchRange(startMs: number, endMs: number, resource: 'sleep' | 'health', windowDays?: number) {
  const maxDays = suuntoHistoryBatchDays(resource);
  const days = Math.min(windowDays ?? maxDays, maxDays);
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs + 1) || startMs > endMs
    || !Number.isFinite(windowDays ?? maxDays) || days <= 0) throw new Error('Invalid Suunto history batch range.');
  const endExclusiveMs = Math.min(endMs + 1, startMs + days * 86_400_000);
  return { endMs: endExclusiveMs, nextStartMs: endExclusiveMs };
}
