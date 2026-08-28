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

/** Runtime and HTTP dispatch deadline for the paced Garmin Health history worker. */
export const GARMIN_HEALTH_BACKFILL_TASK_TIMEOUT_SECONDS = 1_800;

// Keep shared activity-sync bursts below provider-side rate limits. These are
// half of the queue's previous deployed limits while provider-specific
// throttling is investigated.
export const ACTIVITY_SYNC_TASK_RATE_LIMITS = {
    maxConcurrentDispatches: 500,
    maxDispatchesPerSecond: 250,
} as const;

/**
 * Return the configured delay after a completed retry-state transition. A
 * retry count of one is the first retry and therefore uses the minimum delay.
 */
export function getCloudTaskRetryBackoffSeconds(retryCount: unknown): number {
    const completedRetries = Number.isFinite(Number(retryCount))
        ? Math.max(0, Math.floor(Number(retryCount)))
        : 0;
    const backoffExponent = Math.min(
        Math.max(0, completedRetries - 1),
        CLOUD_TASK_RETRY_CONFIG.maxDoublings,
    );
    return Math.min(
        CLOUD_TASK_RETRY_CONFIG.maxBackoffSeconds,
        CLOUD_TASK_RETRY_CONFIG.minBackoffSeconds * (2 ** backoffExponent),
    );
}

export const REPARSE_HEAVY_TASK_RETRY_CONFIG = {
    maxAttempts: CLOUD_TASK_RETRY_CONFIG.maxAttempts,
    minBackoffSeconds: 900,    // 15 minutes
    maxBackoffSeconds: 14400,  // 4 hours
    maxDoublings: 4,
} as const;

/** Max pending Cloud Tasks before skipping dispatch to preserve finding quota permissions */
export const MAX_PENDING_TASKS = 1000;

/** Time window to spread dispatched tasks (seconds) - 15 minutes */
export const DISPATCH_SPREAD_SECONDS = 15 * 60;
