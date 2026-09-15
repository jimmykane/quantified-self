import { SLEEP_SPORTS_LIB_METRIC_FIELDS } from '../../../shared/sleep';

// Shared by query projections and trigger invalidation. Keep new builder inputs here.
export const DERIVED_METRICS_EVENT_FIELDS = ['startDate', 'endDate', 'stats', 'tags', 'benchmarkReviewTags', 'name', 'isMerge', 'mergeType', 'creator', 'serviceName', 'sourceServiceName'] as const;
export const DERIVED_METRICS_ACTIVITY_FIELDS = ['eventID', 'startDate', 'endDate', 'type', 'stats', 'creator', 'serviceName', 'sourceServiceName'] as const;
export const DERIVED_METRICS_TRAINING_SLEEP_FIELDS = [
    'source.provider',
    'source.providerUserId',
    'sleepDate',
    'startTimeMs',
    'endTimeMs',
    'timezoneOffsetSeconds',
    'durationSeconds',
    'sportsLibData.schemaVersion',
    `sportsLibData.metrics.${SLEEP_SPORTS_LIB_METRIC_FIELDS.Duration}`,
    `sportsLibData.metrics.${SLEEP_SPORTS_LIB_METRIC_FIELDS.OvernightHrv}`,
    `sportsLibData.metrics.${SLEEP_SPORTS_LIB_METRIC_FIELDS.AverageHrv}`,
    'isNap',
    'providerFields.suunto.timestamp',
    'vitals.overnightHrvMs',
    'vitals.averageHrvMs',
] as const;
export const DERIVED_METRICS_TRAINING_READINESS_SLEEP_FIELDS = [
    'source.provider',
    'source.providerUserId',
    'sleepDate',
    'startTimeMs',
    'endTimeMs',
    'timezoneOffsetSeconds',
    'durationSeconds',
    'sportsLibData.schemaVersion',
    `sportsLibData.metrics.${SLEEP_SPORTS_LIB_METRIC_FIELDS.Duration}`,
    `sportsLibData.metrics.${SLEEP_SPORTS_LIB_METRIC_FIELDS.Score}`,
    `sportsLibData.metrics.${SLEEP_SPORTS_LIB_METRIC_FIELDS.OvernightHrv}`,
    `sportsLibData.metrics.${SLEEP_SPORTS_LIB_METRIC_FIELDS.AverageHrv}`,
    `sportsLibData.metrics.${SLEEP_SPORTS_LIB_METRIC_FIELDS.AverageHeartRate}`,
    `sportsLibData.metrics.${SLEEP_SPORTS_LIB_METRIC_FIELDS.MinimumHeartRate}`,
    'isNap',
    'score.value',
    'providerFields.suunto.timestamp',
    'vitals.overnightHrvMs',
    'vitals.averageHrvMs',
    'vitals.averageHeartRateBpm',
    'vitals.minimumHeartRateBpm',
] as const;
