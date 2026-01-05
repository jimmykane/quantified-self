/**
 * Queue Processing Configuration
 *
 * This module centralizes all retry and scheduling settings for both
 * immediate (Cloud Tasks) and background (scheduled) processing.
 */

/** Maximum retry attempts before giving up on a queue item for background processing */
export const MAX_RETRY_COUNT = 10;

/** Cron schedule for background processing (every 15 minutes) */
export const QUEUE_SCHEDULE = '*/15 * * * *';

/** Cloud Tasks retry configuration for immediate processing */
export const CLOUD_TASK_RETRY_CONFIG = {
    maxAttempts: 8,
    minBackoffSeconds: 30,
    maxBackoffSeconds: 14400, // 4 hours
    maxDoublings: 4,
} as const;
