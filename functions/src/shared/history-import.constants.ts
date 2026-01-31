export const HISTORY_IMPORT_ACTIVITIES_PER_DAY_LIMIT = 500;
// Per Garmin API docs: "Per user rate limit: 1 month since the first user connection per summary type"
export const GARMIN_HISTORY_IMPORT_COOLDOWN_DAYS = 30;
export const COROS_HISTORY_IMPORT_LIMIT_MONTHS = 3;
// Estimated processing capacity based on queue configuration (1000 items / 30 mins = 48k/day)
// Using a conservative 24k/day for user estimation
export const HISTORY_IMPORT_PROCESSING_CAPACITY_PER_DAY = 24000;
