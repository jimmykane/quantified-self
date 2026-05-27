import { SLEEP_PROVIDERS, SleepProvider } from './sleep';

export const SLEEP_BACKFILL_START_DATE_ISO = '2016-01-01T00:00:00.000Z';
export const SLEEP_BACKFILL_COOLDOWN_DAYS = 7;
export const SLEEP_BACKFILL_COOLDOWN_MS = SLEEP_BACKFILL_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
export const GARMIN_SLEEP_BACKFILL_REQUIRED_PERMISSIONS = ['HISTORICAL_DATA_EXPORT', 'HEALTH_EXPORT'] as const;

export const SLEEP_BACKFILL_PROVIDER_WINDOW_DAYS: Partial<Record<SleepProvider, number>> = {
  [SLEEP_PROVIDERS.GarminAPI]: 89,
  [SLEEP_PROVIDERS.SuuntoApp]: 28,
};

export const SLEEP_BACKFILL_PROVIDER_COOLDOWN_DAYS: Partial<Record<SleepProvider, number>> = {
  [SLEEP_PROVIDERS.GarminAPI]: 30,
  [SLEEP_PROVIDERS.SuuntoApp]: SLEEP_BACKFILL_COOLDOWN_DAYS,
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

export function getSleepBackfillCooldownDays(provider: SleepProvider): number | null {
  const cooldownDays = SLEEP_BACKFILL_PROVIDER_COOLDOWN_DAYS[provider];
  return typeof cooldownDays === 'number' && Number.isFinite(cooldownDays) && cooldownDays > 0
    ? cooldownDays
    : null;
}

export function getSleepBackfillCooldownMs(provider: SleepProvider): number | null {
  const cooldownDays = getSleepBackfillCooldownDays(provider);
  return cooldownDays === null
    ? null
    : cooldownDays * 24 * 60 * 60 * 1000;
}
