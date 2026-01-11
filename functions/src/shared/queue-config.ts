/**
 * Queue Processing Configuration
 *
 * This module centralizes all retry and scheduling settings for both
 * immediate (Cloud Tasks) and background (scheduled) processing.
 */

/** Maximum retry attempts before giving up on a queue item for background processing */
export const MAX_RETRY_COUNT = 10;

/** Cron schedule for background processing (every 30 minutes) */
export const QUEUE_SCHEDULE = '*/30 * * * *';

/** Cloud Tasks retry configuration - totals ~24 hours */
export const CLOUD_TASK_RETRY_CONFIG = {
    maxAttempts: 10,
    minBackoffSeconds: 900,    // 15 minutes
    maxBackoffSeconds: 14400,  // 4 hours
    maxDoublings: 4,
} as const;

/** Max pending Cloud Tasks before skipping dispatch to preserve finding quota permissions */
export const MAX_PENDING_TASKS = 1000;

/** Time window to spread dispatched tasks (seconds) - 15 minutes */
export const DISPATCH_SPREAD_SECONDS = 15 * 60;
