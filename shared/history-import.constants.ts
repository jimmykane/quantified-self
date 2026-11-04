export const HISTORY_IMPORT_ACTIVITIES_PER_DAY_LIMIT = 500;
export const HISTORY_IMPORT_DEFAULT_RANGE_YEARS = 2;
// Per Garmin API docs: "Per user rate limit: 1 month since the first user connection per summary type"
export const GARMIN_HISTORY_IMPORT_COOLDOWN_DAYS = 30;
export const GARMIN_HISTORY_IMPORT_LIMIT_YEARS = 5;
export const COROS_HISTORY_IMPORT_LIMIT_MONTHS = 3;
/** Activity cooldown policy shared by manual and connection imports. */
export function activityHistoryNextAllowedAt(lastImportAtMs: number, processedCount: number, garmin = false): number {
  if (!Number.isFinite(lastImportAtMs) || lastImportAtMs <= 0) return 0;
  const days = garmin ? GARMIN_HISTORY_IMPORT_COOLDOWN_DAYS : Math.max(0, Number(processedCount) || 0) / HISTORY_IMPORT_ACTIVITIES_PER_DAY_LIMIT;
  return lastImportAtMs + days * 86_400_000;
}
