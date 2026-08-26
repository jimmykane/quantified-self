import { getSleepBackfillWindowDays } from '../../../shared/sleep-backfill';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import { COROS_DAILY_MAX_RECORDS } from '../coros/constants';

export const SLEEP_SYNC_QUEUE_COLLECTION_NAME = 'sleepSyncQueue';
export const SLEEP_SYNC_RECENT_WINDOW_DAYS = 7;
export const SUUNTO_SLEEP_MAX_WINDOW_DAYS = getSleepBackfillWindowDays(SLEEP_PROVIDERS.SuuntoApp) || 28;
export const COROS_DAILY_MAX_WINDOW_DAYS = COROS_DAILY_MAX_RECORDS;
