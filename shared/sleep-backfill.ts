import { SLEEP_PROVIDERS, SleepProvider } from './sleep';

// These are request policies, not guarantees that a provider has data for the
// entire range. Provider-reported minimum dates can narrow them further.
export const GARMIN_HEALTH_BACKFILL_LOOKBACK_YEARS = 5;
export const SUUNTO_HEALTH_BACKFILL_START_DATE_ISO = '2000-01-01T00:00:00.000Z';
export const SLEEP_BACKFILL_COOLDOWN_DAYS = 7;
export const SLEEP_BACKFILL_COOLDOWN_MS = SLEEP_BACKFILL_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
export const COROS_SLEEP_BACKFILL_LOOKBACK_MONTHS = 3;
export const GARMIN_SLEEP_BACKFILL_REQUIRED_PERMISSIONS = ['HISTORICAL_DATA_EXPORT', 'HEALTH_EXPORT'] as const;

export const SLEEP_BACKFILL_PROVIDER_WINDOW_DAYS: Partial<Record<SleepProvider, number>> = {
  [SLEEP_PROVIDERS.GarminAPI]: 89,
  [SLEEP_PROVIDERS.SuuntoApp]: 28,
  [SLEEP_PROVIDERS.COROSAPI]: 30,
};

export const SLEEP_BACKFILL_PROVIDER_COOLDOWN_DAYS: Partial<Record<SleepProvider, number>> = {
  [SLEEP_PROVIDERS.GarminAPI]: 30,
  [SLEEP_PROVIDERS.SuuntoApp]: SLEEP_BACKFILL_COOLDOWN_DAYS,
  [SLEEP_PROVIDERS.COROSAPI]: SLEEP_BACKFILL_COOLDOWN_DAYS,
};

export interface SleepBackfillQueueResponse {
  queued: number;
  sleepQueued?: number;
  healthQueued?: number;
  startDate: string;
  endDate: string;
  nextAllowedAtMs: number;
}

export interface SuuntoHealthSyncAvailabilityResponse {
  available: boolean;
}

export interface GarminHealthSyncAvailabilityResponse {
  available: boolean;
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

export function getCorosSleepBackfillStartMs(nowMs = Date.now()): number {
  if (!Number.isFinite(nowMs) || !Number.isFinite(new Date(nowMs).getTime())) {
    throw new Error('Invalid COROS sleep backfill end time.');
  }

  const now = new Date(nowMs);
  const targetYear = now.getUTCFullYear();
  const targetMonth = now.getUTCMonth() - COROS_SLEEP_BACKFILL_LOOKBACK_MONTHS;
  const targetMonthLastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return Date.UTC(
    targetYear,
    targetMonth,
    Math.min(now.getUTCDate(), targetMonthLastDay),
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds(),
    now.getUTCMilliseconds(),
  );
}

/** Shared by Sleep/Health imports, UI copy, and operator catch-up planning. */
export function getHealthBackfillStartMs(provider: SleepProvider, nowMs = Date.now()): number {
  const now = new Date(nowMs);
  if (!Number.isFinite(nowMs) || !Number.isFinite(now.getTime())) {
    throw new Error('Invalid Health backfill request time.');
  }
  switch (provider) {
    case SLEEP_PROVIDERS.SuuntoApp:
      return Date.parse(SUUNTO_HEALTH_BACKFILL_START_DATE_ISO);
    case SLEEP_PROVIDERS.COROSAPI:
      return getCorosSleepBackfillStartMs(nowMs);
    case SLEEP_PROVIDERS.GarminAPI: {
      const year = now.getUTCFullYear() - GARMIN_HEALTH_BACKFILL_LOOKBACK_YEARS;
      const month = now.getUTCMonth();
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      // Clamp leap day rather than letting Date roll forward into March.
      return Date.UTC(year, month, Math.min(now.getUTCDate(), lastDay),
        now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds());
    }
    default:
      throw new Error('Health history is not supported for this provider.');
  }
}
