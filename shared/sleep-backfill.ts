import { SLEEP_PROVIDERS, SleepProvider } from './sleep';

export const SLEEP_BACKFILL_START_DATE_ISO = '2016-01-01T00:00:00.000Z';
export const SLEEP_BACKFILL_COOLDOWN_DAYS = 7;
export const SLEEP_BACKFILL_COOLDOWN_MS = SLEEP_BACKFILL_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export const SLEEP_BACKFILL_PROVIDER_WINDOW_DAYS: Partial<Record<SleepProvider, number>> = {
  [SLEEP_PROVIDERS.SuuntoApp]: 28,
};

export interface SleepBackfillQueueResponse {
  queued: number;
  startDate: string;
  endDate: string;
  nextAllowedAtMs: number;
}

export function getSleepBackfillWindowDays(provider: SleepProvider): number | null {
  const windowDays = SLEEP_BACKFILL_PROVIDER_WINDOW_DAYS[provider];
  return typeof windowDays === 'number' && Number.isFinite(windowDays) && windowDays > 0
    ? windowDays
    : null;
}
