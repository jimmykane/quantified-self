import { HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { onAdminCall } from '../../shared/auth';
import { getCloudTaskQueueDepthForQueue } from '../../utils';
import { GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME } from '../../garmin/constants';
import { SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME } from '../../suunto/constants';
import { COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME } from '../../coros/constants';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { config } from '../../config';
import {
    SPORTS_LIB_REPARSE_HEAVY_REASONS,
    SPORTS_LIB_REPARSE_PROCESSING_TIERS,
    SPORTS_LIB_REPARSE_TARGET_VERSION,
} from '../../reparse/sports-lib-reparse.config';
import {
    DERIVED_METRICS_COLLECTION_ID,
    DERIVED_METRICS_ENTRY_TYPES,
    normalizeDerivedMetricKindsStrict,
} from '../../../../shared/derived-metrics';
import { normalizeError } from '../shared/error.utils';
import { toEpochMillis, toSafeNumber } from '../shared/date.utils';
import {
    DerivedMetricsCoordinatorDocData,
    DerivedMetricsCoordinatorStats,
    DerivedMetricsFailurePreview,
    GetQueueStatsRequest,
    QueueStatsResponse,
    RetrySportsLibReparseHeavyJobRequest,
    RetrySportsLibReparseHeavyJobResponse,
    SportsLibReparseJobDocData,
} from '../shared/types';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from '../../activity-sync/constants';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from '../../sleep/constants';
import { getDisabledSleepProviders } from '../../sleep/provider-flags';
import { SLEEP_PROVIDERS, SleepProvider } from '../../../../shared/sleep';
import { enqueueSportsLibReparseHeavyTask } from '../../shared/cloud-tasks';
import { getUserDeletionGuardState, getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';

const SPORTS_LIB_REPARSE_JOBS_COLLECTION = 'sportsLibReparseJobs';
const SPORTS_LIB_REPARSE_CHECKPOINT_DOC_PATH = 'systemJobs/sportsLibReparse';
const SPORTS_LIB_REPARSE_FAILURE_PREVIEW_LIMIT = 10;
const DERIVED_METRICS_FAILURE_PREVIEW_LIMIT = 10;
const DERIVED_METRICS_STALE_QUEUED_THRESHOLD_MS = 10 * 60 * 1000;
const DERIVED_METRICS_STALE_PROCESSING_THRESHOLD_MS = 15 * 60 * 1000;
const INGESTION_DLQ_PREVIEW_LIMIT = 50;
const ACTIVITY_SYNC_DLQ_PREVIEW_LIMIT = 50;
const SLEEP_SYNC_DLQ_PREVIEW_LIMIT = 50;
const SLEEP_PROVIDER_LABELS: Record<SleepProvider, string> = {
    [SLEEP_PROVIDERS.GarminAPI]: 'Garmin',
    [SLEEP_PROVIDERS.SuuntoApp]: 'Suunto',
    [SLEEP_PROVIDERS.COROSAPI]: 'COROS',
};
const SPORTS_LIB_REPARSE_MANUAL_HEAVY_RETRY_TASK_SUFFIX_PREFIX = 'manual';

const DERIVED_METRICS_COORDINATOR_STATUSES = ['idle', 'queued', 'processing', 'failed'] as const;
type DerivedMetricsCoordinatorStatus = typeof DERIVED_METRICS_COORDINATOR_STATUSES[number];

function isDerivedMetricsCoordinatorStatus(value: unknown): value is DerivedMetricsCoordinatorStatus {
    return DERIVED_METRICS_COORDINATOR_STATUSES.includes(`${value}` as DerivedMetricsCoordinatorStatus);
}

function toFiniteEpochMs(value: unknown): number | null {
    const epochMs = toEpochMillis(value);
    if (epochMs !== null && Number.isFinite(epochMs)) {
        return epochMs;
    }
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return null;
    }
    return numericValue;
}

function toFiniteNumberOrNull(value: unknown): number | null {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

/**
 * Gets aggregated statistics for all workout queues.
 * Uses efficient Firestore count() queries.
 */
export const getQueueStats = onAdminCall<GetQueueStatsRequest, QueueStatsResponse>({
    region: FUNCTIONS_MANIFEST.getQueueStats.region,
    memory: '256MiB',
}, async (request) => {
    const includeAnalysis = request.data?.includeAnalysis ?? false;
    const PROVIDER_QUEUES: Record<string, string[]> = {
        'Suunto': [SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME],
        'COROS': [COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME],
        'Garmin': [GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME]
    };

    try {
        const db = admin.firestore();
        const {
            workoutQueue,
            activitySyncQueue,
            sleepSyncQueue,
            sportsLibReparseQueue,
            sportsLibReparseHeavyQueue,
            derivedMetricsQueue,
        } = config.cloudtasks;
        const [
            workoutCloudTaskDepth,
            activitySyncCloudTaskDepth,
            sleepSyncCloudTaskDepth,
            sportsLibReparseCloudTaskDepth,
            sportsLibReparseHeavyCloudTaskDepth,
            derivedMetricsCloudTaskDepth,
        ] = await Promise.all([
            getCloudTaskQueueDepthForQueue(workoutQueue).catch(e => {
                logger.error(`Error getting Cloud Task depth for queue ${workoutQueue}:`, e);
                return 0;
            }),
            getCloudTaskQueueDepthForQueue(activitySyncQueue).catch(e => {
                logger.error(`Error getting Cloud Task depth for queue ${activitySyncQueue}:`, e);
                return 0;
            }),
            getCloudTaskQueueDepthForQueue(sleepSyncQueue).catch(e => {
                logger.error(`Error getting Cloud Task depth for queue ${sleepSyncQueue}:`, e);
                return 0;
            }),
            getCloudTaskQueueDepthForQueue(sportsLibReparseQueue).catch(e => {
                logger.error(`Error getting Cloud Task depth for queue ${sportsLibReparseQueue}:`, e);
                return 0;
            }),
            getCloudTaskQueueDepthForQueue(sportsLibReparseHeavyQueue).catch(e => {
                logger.error(`Error getting Cloud Task depth for queue ${sportsLibReparseHeavyQueue}:`, e);
                return 0;
            }),
            getCloudTaskQueueDepthForQueue(derivedMetricsQueue).catch(e => {
                logger.error(`Error getting Cloud Task depth for queue ${derivedMetricsQueue}:`, e);
                return 0;
            }),
        ]);
        const reparseCloudTaskDepth = sportsLibReparseCloudTaskDepth + sportsLibReparseHeavyCloudTaskDepth;
        const totalCloudTaskDepth = workoutCloudTaskDepth + activitySyncCloudTaskDepth + sleepSyncCloudTaskDepth + reparseCloudTaskDepth + derivedMetricsCloudTaskDepth;
        const reparseJobsCollection = db.collection(SPORTS_LIB_REPARSE_JOBS_COLLECTION);

        const [
            reparseTotalJobs,
            reparsePendingJobs,
            reparseProcessingJobs,
            reparseCompletedJobs,
            reparseFailedJobs,
        ] = await Promise.all([
            reparseJobsCollection.count().get().catch(e => {
                logger.error(`[admin/getQueueStats] Failed to count total reparse jobs:`, e);
                return null;
            }),
            reparseJobsCollection.where('status', '==', 'pending').count().get().catch(e => {
                logger.error(`[admin/getQueueStats] Failed to count pending reparse jobs:`, e);
                return null;
            }),
            reparseJobsCollection.where('status', '==', 'processing').count().get().catch(e => {
                logger.error(`[admin/getQueueStats] Failed to count processing reparse jobs:`, e);
                return null;
            }),
            reparseJobsCollection.where('status', '==', 'completed').count().get().catch(e => {
                logger.error(`[admin/getQueueStats] Failed to count completed reparse jobs:`, e);
                return null;
            }),
            reparseJobsCollection.where('status', '==', 'failed').count().get().catch(e => {
                logger.error(`[admin/getQueueStats] Failed to count failed reparse jobs:`, e);
                return null;
            }),
        ]);

        const derivedMetricsCoordinatorSnapshot = await db.collectionGroup(DERIVED_METRICS_COLLECTION_ID)
            .where('entryType', '==', DERIVED_METRICS_ENTRY_TYPES.Coordinator)
            .get()
            .catch(e => {
                // Keep queue observability available even if coordinator aggregation fails (e.g. missing index/transient read issue).
                logger.error('[admin/getQueueStats] Failed to query derived metrics coordinators:', e);
                return null;
            });

        const derivedCoordinatorCounts: DerivedMetricsCoordinatorStats = {
            idle: 0,
            queued: 0,
            processing: 0,
            staleQueued: 0,
            staleProcessing: 0,
            failed: 0,
            total: 0,
        };
        const derivedFailures: DerivedMetricsFailurePreview[] = [];
        const nowMs = Date.now();

        (derivedMetricsCoordinatorSnapshot?.docs || []).forEach((doc) => {
            const rawData = doc.data() as DerivedMetricsCoordinatorDocData;
            const rawStatus = `${rawData.status || ''}`.trim();
            const status = isDerivedMetricsCoordinatorStatus(rawStatus) ? rawStatus : null;
            const generation = Math.max(0, Math.floor(toSafeNumber(rawData.generation)));
            const requestedAtMs = toFiniteEpochMs(rawData.requestedAtMs);
            const startedAtMs = toFiniteEpochMs(rawData.startedAtMs);
            const updatedAtMs = Math.max(0, toFiniteEpochMs(rawData.updatedAtMs) ?? 0);
            const dirtyMetricKinds = normalizeDerivedMetricKindsStrict(
                Array.isArray(rawData.dirtyMetricKinds) ? rawData.dirtyMetricKinds : [],
            );
            const lastError = `${rawData.lastError || ''}`.trim();
            const uid = `${doc.ref.parent?.parent?.id || ''}`.trim();
            derivedCoordinatorCounts.total += 1;

            const queuedSinceMs = requestedAtMs ?? updatedAtMs;
            const processingSinceMs = startedAtMs ?? updatedAtMs;
            const isStaleQueued = status === 'queued'
                && Number.isFinite(queuedSinceMs)
                && (nowMs - queuedSinceMs) >= DERIVED_METRICS_STALE_QUEUED_THRESHOLD_MS;
            const isStaleProcessing = status === 'processing'
                && Number.isFinite(processingSinceMs)
                && (nowMs - processingSinceMs) >= DERIVED_METRICS_STALE_PROCESSING_THRESHOLD_MS;

            // Exclude stale in-flight docs from active queued/processing counts.
            // They remain recoverable via ensure/event-write paths without inflating
            // queue-health dashboards with permanently dormant coordinator docs.
            if (isStaleQueued || isStaleProcessing) {
                if (isStaleQueued) {
                    derivedCoordinatorCounts.staleQueued += 1;
                }
                if (isStaleProcessing) {
                    derivedCoordinatorCounts.staleProcessing += 1;
                }
                return;
            }

            if (status) {
                derivedCoordinatorCounts[status] += 1;
            }

            if (status === 'failed') {
                derivedFailures.push({
                    uid,
                    generation,
                    dirtyMetricKinds,
                    lastError,
                    updatedAtMs,
                });
            }
        });

        if (derivedCoordinatorCounts.staleQueued > 0 || derivedCoordinatorCounts.staleProcessing > 0) {
            logger.warn('[admin/getQueueStats] Classified stale derived-metrics coordinators in queue stats.', {
                staleQueuedCount: derivedCoordinatorCounts.staleQueued,
                staleProcessingCount: derivedCoordinatorCounts.staleProcessing,
            });
        }

        derivedFailures.sort((left, right) => right.updatedAtMs - left.updatedAtMs);

        const checkpointSnapshot = await admin.firestore().doc(SPORTS_LIB_REPARSE_CHECKPOINT_DOC_PATH).get().catch(e => {
            logger.error('[admin/getQueueStats] Failed to read sports-lib reparse checkpoint:', e);
            return null;
        });
        const checkpointData = checkpointSnapshot?.data() as Record<string, unknown> | undefined;
        const checkpointOverrideCursors = checkpointData?.overrideCursorByUid;
        const overrideCursorByUid = (checkpointOverrideCursors && typeof checkpointOverrideCursors === 'object')
            ? (checkpointOverrideCursors as Record<string, string | null>)
            : {};
        const overrideUsersInProgress = Object.values(overrideCursorByUid).filter(cursor => !!cursor).length;

        const recentReparseJobsSnapshot = await reparseJobsCollection
            .where('status', '==', 'failed')
            .orderBy('updatedAt', 'desc')
            .limit(SPORTS_LIB_REPARSE_FAILURE_PREVIEW_LIMIT)
            .get()
            .catch(e => {
                logger.error('[admin/getQueueStats] Failed to load recent reparse jobs:', e);
                return null;
            });
        const recentReparseFailures = (recentReparseJobsSnapshot?.docs || [])
            .map(doc => ({
                data: doc.data() as SportsLibReparseJobDocData,
                jobId: doc.id,
                uid: '',
                eventId: '',
                attemptCount: 0,
                lastError: '',
                updatedAt: null as unknown,
                targetSportsLibVersion: '',
                processingTier: '',
                heavyReason: '',
                eventDurationMs: null as number | null,
            }))
            .map(entry => ({
                jobId: entry.jobId,
                uid: `${entry.data.uid || ''}`,
                eventId: `${entry.data.eventId || ''}`,
                attemptCount: toSafeNumber(entry.data.attemptCount),
                lastError: `${entry.data.lastError || ''}`,
                updatedAt: entry.data.updatedAt || null,
                targetSportsLibVersion: `${entry.data.targetSportsLibVersion || ''}`,
                processingTier: `${entry.data.processingTier || ''}`,
                heavyReason: `${entry.data.heavyReason || ''}`,
                eventDurationMs: toFiniteNumberOrNull(entry.data.eventDurationMs),
            }));

        let totalPending = 0;
        let totalSucceeded = 0;
        let totalStuck = 0;
        // Advanced stats
        let totalThroughput = 0;
        let maxLagMs = 0;
        const retryHistogram = { '0-3': 0, '4-7': 0, '8-9': 0 };

        const ONE_HOUR_AGO = Date.now() - (60 * 60 * 1000);
        const activitySyncCollection = db.collection(ACTIVITY_SYNC_QUEUE_COLLECTION_NAME);

        const [
            activitySyncPendingSnap,
            activitySyncSucceededSnap,
            activitySyncStuckSnap,
            activitySyncRetry0to3Snap,
            activitySyncRetry4to7Snap,
            activitySyncRetry8to9Snap,
            activitySyncThroughputSnap,
            activitySyncOldestPendingSnap,
            activitySyncDeadSnap,
        ] = await Promise.all([
            activitySyncCollection.where('processed', '==', false).where('retryCount', '<', 10).count().get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to count activity sync pending jobs:', e);
                return null;
            }),
            activitySyncCollection.where('resultStatus', '==', 'success').count().get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to count activity sync succeeded jobs:', e);
                return null;
            }),
            activitySyncCollection.where('processed', '==', false).where('retryCount', '>=', 10).count().get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to count activity sync stuck jobs:', e);
                return null;
            }),
            activitySyncCollection.where('processed', '==', false).where('retryCount', '<', 4).count().get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to count activity sync retry bucket 0-3:', e);
                return null;
            }),
            activitySyncCollection.where('processed', '==', false).where('retryCount', '>=', 4).where('retryCount', '<', 8).count().get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to count activity sync retry bucket 4-7:', e);
                return null;
            }),
            activitySyncCollection.where('processed', '==', false).where('retryCount', '>=', 8).where('retryCount', '<', 10).count().get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to count activity sync retry bucket 8-9:', e);
                return null;
            }),
            activitySyncCollection.where('successProcessedAt', '>', ONE_HOUR_AGO).count().get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to count activity sync throughput:', e);
                return null;
            }),
            activitySyncCollection.where('processed', '==', false).orderBy('dateCreated', 'asc').limit(1).get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to query oldest activity sync pending job:', e);
                return null;
            }),
            db.collection('failed_jobs').where('originalCollection', '==', ACTIVITY_SYNC_QUEUE_COLLECTION_NAME).count().get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to count activity sync dead-letter jobs:', e);
                return null;
            }),
        ]);

        const activitySyncPending = activitySyncPendingSnap?.data().count || 0;
        const activitySyncSucceeded = activitySyncSucceededSnap?.data().count || 0;
        const activitySyncStuck = activitySyncStuckSnap?.data().count || 0;
        const activitySyncDead = activitySyncDeadSnap?.data().count || 0;
        const activitySyncRetryHistogram = {
            '0-3': activitySyncRetry0to3Snap?.data().count || 0,
            '4-7': activitySyncRetry4to7Snap?.data().count || 0,
            '8-9': activitySyncRetry8to9Snap?.data().count || 0,
        };
        const activitySyncThroughput = activitySyncThroughputSnap?.data().count || 0;
        let activitySyncMaxLagMs = 0;
        const activitySyncOldestPendingDate = activitySyncOldestPendingSnap?.empty === false
            ? activitySyncOldestPendingSnap.docs[0]?.data()?.dateCreated
            : null;
        if (activitySyncOldestPendingDate) {
            activitySyncMaxLagMs = Math.max(0, Date.now() - activitySyncOldestPendingDate);
        }

        const sleepSyncCollection = db.collection(SLEEP_SYNC_QUEUE_COLLECTION_NAME);
        const [
            sleepSyncPendingSnap,
            sleepSyncSucceededSnap,
            sleepSyncProviderDisabledSnap,
            sleepSyncStuckSnap,
            sleepSyncRetry0to3Snap,
            sleepSyncRetry4to7Snap,
            sleepSyncRetry8to9Snap,
            sleepSyncThroughputSnap,
            sleepSyncOldestPendingSnap,
            sleepSyncDeadSnap,
        ] = await Promise.all([
            sleepSyncCollection.where('processed', '==', false).where('retryCount', '<', 10).count().get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to count sleep sync pending jobs:', e);
                return null;
            }),
            sleepSyncCollection.where('resultStatus', '==', 'success').count().get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to count sleep sync succeeded jobs:', e);
                return null;
            }),
            sleepSyncCollection.where('resultStatus', '==', 'provider_disabled').count().get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to count sleep sync provider-disabled jobs:', e);
                return null;
            }),
            sleepSyncCollection.where('processed', '==', false).where('retryCount', '>=', 10).count().get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to count sleep sync stuck jobs:', e);
                return null;
            }),
            sleepSyncCollection.where('processed', '==', false).where('retryCount', '<', 4).count().get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to count sleep sync retry bucket 0-3:', e);
                return null;
            }),
            sleepSyncCollection.where('processed', '==', false).where('retryCount', '>=', 4).where('retryCount', '<', 8).count().get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to count sleep sync retry bucket 4-7:', e);
                return null;
            }),
            sleepSyncCollection.where('processed', '==', false).where('retryCount', '>=', 8).where('retryCount', '<', 10).count().get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to count sleep sync retry bucket 8-9:', e);
                return null;
            }),
            sleepSyncCollection.where('processedAt', '>', ONE_HOUR_AGO).count().get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to count sleep sync throughput:', e);
                return null;
            }),
            sleepSyncCollection.where('processed', '==', false).orderBy('dateCreated', 'asc').limit(1).get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to query oldest sleep sync pending job:', e);
                return null;
            }),
            db.collection('failed_jobs').where('originalCollection', '==', SLEEP_SYNC_QUEUE_COLLECTION_NAME).count().get().catch(e => {
                logger.error('[admin/getQueueStats] Failed to count sleep sync dead-letter jobs:', e);
                return null;
            }),
        ]);

        const sleepSyncPending = sleepSyncPendingSnap?.data().count || 0;
        const sleepSyncSucceeded = sleepSyncSucceededSnap?.data().count || 0;
        const sleepSyncProviderDisabled = sleepSyncProviderDisabledSnap?.data().count || 0;
        const sleepSyncStuck = sleepSyncStuckSnap?.data().count || 0;
        const sleepSyncDead = sleepSyncDeadSnap?.data().count || 0;
        const sleepSyncRetryHistogram = {
            '0-3': sleepSyncRetry0to3Snap?.data().count || 0,
            '4-7': sleepSyncRetry4to7Snap?.data().count || 0,
            '8-9': sleepSyncRetry8to9Snap?.data().count || 0,
        };
        const sleepSyncThroughput = sleepSyncThroughputSnap?.data().count || 0;
        let sleepSyncMaxLagMs = 0;
        const sleepSyncOldestPendingDate = sleepSyncOldestPendingSnap?.empty === false
            ? sleepSyncOldestPendingSnap.docs[0]?.data()?.dateCreated
            : null;
        if (sleepSyncOldestPendingDate) {
            sleepSyncMaxLagMs = Math.max(0, Date.now() - sleepSyncOldestPendingDate);
        }

        const sleepProviderStats = await Promise.all(Object.values(SLEEP_PROVIDERS).map(async (provider) => {
            const providerQuery = sleepSyncCollection.where('provider', '==', provider);
            const [
                providerPendingSnap,
                providerSucceededSnap,
                providerDisabledSnap,
                providerStuckSnap,
                providerDeadSnap,
            ] = await Promise.all([
                providerQuery.where('processed', '==', false).where('retryCount', '<', 10).count().get().catch(e => {
                    logger.error(`[admin/getQueueStats] Failed to count sleep sync pending jobs for ${provider}:`, e);
                    return null;
                }),
                providerQuery.where('resultStatus', '==', 'success').count().get().catch(e => {
                    logger.error(`[admin/getQueueStats] Failed to count sleep sync succeeded jobs for ${provider}:`, e);
                    return null;
                }),
                providerQuery.where('resultStatus', '==', 'provider_disabled').count().get().catch(e => {
                    logger.error(`[admin/getQueueStats] Failed to count sleep sync provider-disabled jobs for ${provider}:`, e);
                    return null;
                }),
                providerQuery.where('processed', '==', false).where('retryCount', '>=', 10).count().get().catch(e => {
                    logger.error(`[admin/getQueueStats] Failed to count sleep sync stuck jobs for ${provider}:`, e);
                    return null;
                }),
                db.collection('failed_jobs')
                    .where('originalCollection', '==', SLEEP_SYNC_QUEUE_COLLECTION_NAME)
                    .where('provider', '==', provider)
                    .count()
                    .get()
                    .catch(e => {
                        logger.error(`[admin/getQueueStats] Failed to count sleep sync dead-letter jobs for ${provider}:`, e);
                        return null;
                    }),
            ]);

            return {
                provider: SLEEP_PROVIDER_LABELS[provider],
                pending: providerPendingSnap?.data().count || 0,
                succeeded: providerSucceededSnap?.data().count || 0,
                providerDisabled: providerDisabledSnap?.data().count || 0,
                stuck: providerStuckSnap?.data().count || 0,
                dead: providerDeadSnap?.data().count || 0,
            };
        }));

        const providers: { name: string; pending: number; succeeded: number; stuck: number; dead: number }[] = [];

        // Map over providers to get individual and total stats
        for (const [providerName, collections] of Object.entries(PROVIDER_QUEUES)) {
            let providerPending = 0;
            let providerSucceeded = 0;
            let providerStuck = 0;

            await Promise.all(collections.map(async (collectionName) => {
                const col = db.collection(collectionName);

                // Base stats + Retry Histogram + Throughput
                const [
                    p, s, f,
                    retry0to3, retry4to7, retry8to9,
                    throughput
                ] = await Promise.all([
                    // Standard stats
                    col.where('processed', '==', false).where('retryCount', '<', 10).count().get(),
                    col.where('processed', '==', true).count().get(),
                    col.where('processed', '==', false).where('retryCount', '>=', 10).count().get(),

                    // Retry Histogram
                    col.where('processed', '==', false).where('retryCount', '<', 4).count().get(),
                    col.where('processed', '==', false).where('retryCount', '>=', 4).where('retryCount', '<', 8).count().get(),
                    col.where('processed', '==', false).where('retryCount', '>=', 8).where('retryCount', '<', 10).count().get(),

                    // Throughput (Processed in last hour)
                    col.where('processed', '==', true).where('processedAt', '>', ONE_HOUR_AGO).count().get()
                ]);

                // Max Lag (Oldest pending item)
                const oldestPendingSnap = await col.where('processed', '==', false).orderBy('dateCreated', 'asc').limit(1).get();
                if (!oldestPendingSnap.empty) {
                    const oldestDate = oldestPendingSnap.docs[0].data().dateCreated;
                    if (oldestDate) {
                        const lag = Date.now() - oldestDate;
                        if (lag > maxLagMs) maxLagMs = lag;
                    }
                }

                providerPending += p.data().count;
                providerSucceeded += s.data().count;
                providerStuck += f.data().count;

                retryHistogram['0-3'] += retry0to3.data().count;
                retryHistogram['4-7'] += retry4to7.data().count;
                retryHistogram['8-9'] += retry8to9.data().count;

                totalThroughput += throughput.data().count;
            }));

            // Get Dead/Failed count for this provider (efficient count query)
            const deadSnap = await db.collection('failed_jobs')
                .where('originalCollection', 'in', collections)
                .count()
                .get();
            const providerDead = deadSnap.data().count;

            totalPending += providerPending;
            totalSucceeded += providerSucceeded;
            totalStuck += providerStuck;

            providers.push({
                name: providerName,
                pending: providerPending,
                succeeded: providerSucceeded,
                stuck: providerStuck,
                dead: providerDead
            });
        }

        // Dead Letter Queue stats & Error Clustering (Expensive)
        let dlq: QueueStatsResponse['dlq'] = undefined;
        let topErrors: { error: string; count: number }[] = [];
        let activitySyncTopErrors: { error: string; count: number }[] = [];
        let activitySyncByContext: { context: string; count: number }[] = [];
        let sleepSyncTopErrors: { error: string; count: number }[] = [];
        let sleepSyncByContext: { context: string; count: number }[] = [];

        if (includeAnalysis) {
            const dlqCol = db.collection('failed_jobs');
            const ingestionDlqCollections = Array.from(new Set(Object.values(PROVIDER_QUEUES).flat()));
            const ingestionDlqQuery = dlqCol.where('originalCollection', 'in', ingestionDlqCollections);

            // Use filtered + limited queries for ingestion clustering to save reads and avoid mixing activity-sync entries.
            const [dlqCountSnap, dlqRecentSnap] = await Promise.all([
                ingestionDlqQuery.count().get(),
                ingestionDlqQuery
                    .orderBy('failedAt', 'desc')
                    .limit(INGESTION_DLQ_PREVIEW_LIMIT)
                    .get()
                    .catch(async (e) => {
                        logger.error('[admin/getQueueStats] Failed to load ordered ingestion DLQ preview:', e);
                        return ingestionDlqQuery
                            .limit(INGESTION_DLQ_PREVIEW_LIMIT)
                            .get()
                            .catch(fallbackError => {
                                logger.error('[admin/getQueueStats] Failed to load fallback ingestion DLQ preview:', fallbackError);
                                return null;
                            });
                    })
            ]);

            const dlqByContext: Record<string, number> = {};
            const dlqByProvider: Record<string, number> = {};
            const errorCounts: Record<string, number> = {};

            (dlqRecentSnap?.docs || []).forEach(doc => {
                const data = doc.data();
                const context = data.context || 'UNKNOWN';
                const originalCollection = data.originalCollection || 'unknown';
                const errorMsg = normalizeError(data.error || 'Unknown Error');

                dlqByContext[context] = (dlqByContext[context] || 0) + 1;
                dlqByProvider[originalCollection] = (dlqByProvider[originalCollection] || 0) + 1;
                errorCounts[errorMsg] = (errorCounts[errorMsg] || 0) + 1;
            });

            dlq = {
                total: dlqCountSnap.data().count,
                byContext: Object.entries(dlqByContext).map(([context, count]) => ({ context, count })),
                byProvider: Object.entries(dlqByProvider).map(([provider, count]) => ({ provider, count }))
            };

            topErrors = Object.entries(errorCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([error, count]) => ({ error, count }));

            const activitySyncDlqQuery = dlqCol.where('originalCollection', '==', ACTIVITY_SYNC_QUEUE_COLLECTION_NAME);
            const activitySyncRecentDlqSnap = await activitySyncDlqQuery
                .orderBy('failedAt', 'desc')
                .limit(ACTIVITY_SYNC_DLQ_PREVIEW_LIMIT)
                .get()
                .catch(async (e) => {
                    logger.error('[admin/getQueueStats] Failed to load ordered activity sync DLQ preview:', e);
                    return activitySyncDlqQuery
                        .limit(ACTIVITY_SYNC_DLQ_PREVIEW_LIMIT)
                        .get()
                        .catch(fallbackError => {
                            logger.error('[admin/getQueueStats] Failed to load fallback activity sync DLQ preview:', fallbackError);
                            return null;
                        });
                });
            const activitySyncContextCounts: Record<string, number> = {};
            const activitySyncErrorCounts: Record<string, number> = {};
            for (const doc of (activitySyncRecentDlqSnap?.docs || [])) {
                const data = doc.data();
                const context = `${data.context || 'UNKNOWN'}`;
                const errorMsg = normalizeError(data.error || 'Unknown Error');
                activitySyncContextCounts[context] = (activitySyncContextCounts[context] || 0) + 1;
                activitySyncErrorCounts[errorMsg] = (activitySyncErrorCounts[errorMsg] || 0) + 1;
            }
            activitySyncByContext = Object.entries(activitySyncContextCounts)
                .map(([context, count]) => ({ context, count }))
                .sort((a, b) => b.count - a.count);
            activitySyncTopErrors = Object.entries(activitySyncErrorCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([error, count]) => ({ error, count }));

            const sleepSyncDlqQuery = dlqCol.where('originalCollection', '==', SLEEP_SYNC_QUEUE_COLLECTION_NAME);
            const sleepSyncRecentDlqSnap = await sleepSyncDlqQuery
                .orderBy('failedAt', 'desc')
                .limit(SLEEP_SYNC_DLQ_PREVIEW_LIMIT)
                .get()
                .catch(async (e) => {
                    logger.error('[admin/getQueueStats] Failed to load ordered sleep sync DLQ preview:', e);
                    return sleepSyncDlqQuery
                        .limit(SLEEP_SYNC_DLQ_PREVIEW_LIMIT)
                        .get()
                        .catch(fallbackError => {
                            logger.error('[admin/getQueueStats] Failed to load fallback sleep sync DLQ preview:', fallbackError);
                            return null;
                        });
                });
            const sleepSyncContextCounts: Record<string, number> = {};
            const sleepSyncErrorCounts: Record<string, number> = {};
            for (const doc of (sleepSyncRecentDlqSnap?.docs || [])) {
                const data = doc.data();
                const context = `${data.context || 'UNKNOWN'}`;
                const errorMsg = normalizeError(data.error || 'Unknown Error');
                sleepSyncContextCounts[context] = (sleepSyncContextCounts[context] || 0) + 1;
                sleepSyncErrorCounts[errorMsg] = (sleepSyncErrorCounts[errorMsg] || 0) + 1;
            }
            sleepSyncByContext = Object.entries(sleepSyncContextCounts)
                .map(([context, count]) => ({ context, count }))
                .sort((a, b) => b.count - a.count);
            sleepSyncTopErrors = Object.entries(sleepSyncErrorCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([error, count]) => ({ error, count }));
        }

        return {
            pending: totalPending,
            succeeded: totalSucceeded,
            stuck: totalStuck,
            cloudTasks: {
                pending: totalCloudTaskDepth,
                queues: {
                    workout: {
                        queueId: workoutQueue,
                        pending: workoutCloudTaskDepth,
                    },
                    activitySync: {
                        queueId: activitySyncQueue,
                        pending: activitySyncCloudTaskDepth,
                    },
                    sleepSync: {
                        queueId: sleepSyncQueue,
                        pending: sleepSyncCloudTaskDepth,
                    },
                    sportsLibReparse: {
                        queueId: sportsLibReparseQueue,
                        pending: sportsLibReparseCloudTaskDepth,
                    },
                    sportsLibReparseHeavy: {
                        queueId: sportsLibReparseHeavyQueue,
                        pending: sportsLibReparseHeavyCloudTaskDepth,
                    },
                    derivedMetrics: {
                        queueId: derivedMetricsQueue,
                        pending: derivedMetricsCloudTaskDepth,
                    },
                },
            },
            reparse: {
                queuePending: reparseCloudTaskDepth,
                targetSportsLibVersion: `${checkpointData?.targetSportsLibVersion || SPORTS_LIB_REPARSE_TARGET_VERSION}`,
                jobs: {
                    total: reparseTotalJobs?.data().count || 0,
                    pending: reparsePendingJobs?.data().count || 0,
                    processing: reparseProcessingJobs?.data().count || 0,
                    completed: reparseCompletedJobs?.data().count || 0,
                    failed: reparseFailedJobs?.data().count || 0,
                },
                checkpoint: {
                    cursorEventPath: (checkpointData?.cursorEventPath as string | null) || null,
                    lastScanAt: checkpointData?.lastScanAt || null,
                    lastPassStartedAt: checkpointData?.lastPassStartedAt || null,
                    lastPassCompletedAt: checkpointData?.lastPassCompletedAt || null,
                    lastScanCount: toSafeNumber(checkpointData?.lastScanCount),
                    lastEnqueuedCount: toSafeNumber(checkpointData?.lastEnqueuedCount),
                    overrideUsersInProgress,
                },
                recentFailures: recentReparseFailures,
            },
            derivedMetrics: {
                coordinators: derivedCoordinatorCounts,
                recentFailures: derivedFailures.slice(0, DERIVED_METRICS_FAILURE_PREVIEW_LIMIT),
            },
            providers,
            dlq,
            advanced: {
                throughput: totalThroughput,
                maxLagMs,
                retryHistogram,
                topErrors
            },
            activitySync: {
                pending: activitySyncPending,
                succeeded: activitySyncSucceeded,
                stuck: activitySyncStuck,
                dead: activitySyncDead,
                dlqByContext: activitySyncByContext,
                advanced: {
                    throughput: activitySyncThroughput,
                    maxLagMs: activitySyncMaxLagMs,
                    retryHistogram: activitySyncRetryHistogram,
                    topErrors: activitySyncTopErrors,
                },
            },
            sleepSync: {
                pending: sleepSyncPending,
                succeeded: sleepSyncSucceeded,
                providerDisabled: sleepSyncProviderDisabled,
                stuck: sleepSyncStuck,
                dead: sleepSyncDead,
                disabledProviders: getDisabledSleepProviders().map((provider) => SLEEP_PROVIDER_LABELS[provider] || provider),
                providers: sleepProviderStats,
                dlqByContext: sleepSyncByContext,
                advanced: {
                    throughput: sleepSyncThroughput,
                    maxLagMs: sleepSyncMaxLagMs,
                    retryHistogram: sleepSyncRetryHistogram,
                    topErrors: sleepSyncTopErrors,
                },
            },
        };
    } catch (error: unknown) {
        logger.error('Error getting queue stats:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to get queue statistics';
        throw new HttpsError('internal', errorMessage);
    }
});

export const retrySportsLibReparseHeavyJob = onAdminCall<
    RetrySportsLibReparseHeavyJobRequest,
    RetrySportsLibReparseHeavyJobResponse
>({
    region: FUNCTIONS_MANIFEST.retrySportsLibReparseHeavyJob.region,
    memory: '256MiB',
}, async (request) => {
    const jobId = `${request.data?.jobId || ''}`.trim();
    if (!jobId) {
        throw new HttpsError('invalid-argument', 'jobId is required.');
    }

    const db = admin.firestore();
    const jobRef = db.collection(SPORTS_LIB_REPARSE_JOBS_COLLECTION).doc(jobId);
    const claimedRetry = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(jobRef);
        if (!snapshot.exists) {
            throw new HttpsError('not-found', `Reparse job ${jobId} was not found.`);
        }

        const jobData = snapshot.data() as SportsLibReparseJobDocData;
        if (jobData.status !== 'failed') {
            throw new HttpsError('failed-precondition', `Reparse job ${jobId} must be failed before heavy retry.`);
        }

        const uid = `${jobData.uid || ''}`.trim();
        if (!uid) {
            throw new HttpsError('failed-precondition', `Reparse job ${jobId} is missing uid.`);
        }

        let deletionGuard;
        try {
            deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid);
        } catch (error) {
            logger.error('[admin/retrySportsLibReparseHeavyJob] Failed to read user deletion guard.', {
                jobId,
                uid,
                error: error instanceof Error ? error.message : `${error}`,
            });
            throw new HttpsError('unavailable', `Could not verify user deletion state for ${uid}.`);
        }
        if (deletionGuard.shouldSkip) {
            logger.info('[admin/retrySportsLibReparseHeavyJob] Skipping heavy retry because user is missing or deletion is in progress.', {
                jobId,
                uid,
                userExists: deletionGuard.userExists,
                deletionInProgress: deletionGuard.deletionInProgress,
            });
            throw new HttpsError('failed-precondition', `User ${uid} is missing or deletion is in progress.`);
        }

        transaction.set(jobRef, {
            status: 'pending',
            processingTier: SPORTS_LIB_REPARSE_PROCESSING_TIERS.Heavy,
            heavyReason: SPORTS_LIB_REPARSE_HEAVY_REASONS.ManualAdmin,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            enqueuedAt: admin.firestore.FieldValue.serverTimestamp(),
            processedAt: admin.firestore.FieldValue.delete(),
            lastError: admin.firestore.FieldValue.delete(),
        }, { merge: true });

        return { uid };
    });

    try {
        const taskCreated = await enqueueSportsLibReparseHeavyTask(jobId, {
            taskNameSuffix: `${SPORTS_LIB_REPARSE_MANUAL_HEAVY_RETRY_TASK_SUFFIX_PREFIX}-${Date.now()}-${randomUUID()}`,
        });
        if (!taskCreated) {
            throw new Error(`Manual heavy reparse retry task already exists for job ${jobId}.`);
        }
        logger.info('[admin/retrySportsLibReparseHeavyJob] Enqueued heavy reparse retry.', {
            jobId,
            taskCreated,
        });
        return {
            success: true,
            jobId,
            taskCreated,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : `${error}`;
        let deletionGuard;
        try {
            deletionGuard = await getUserDeletionGuardState(db, claimedRetry.uid);
        } catch (guardError) {
            logger.error('[admin/retrySportsLibReparseHeavyJob] Failed to read user deletion guard before restoring failed status.', {
                jobId,
                uid: claimedRetry.uid,
                error: guardError instanceof Error ? guardError.message : `${guardError}`,
            });
            throw new HttpsError('unavailable', `Could not verify user deletion state for ${claimedRetry.uid}.`);
        }
        if (deletionGuard.shouldSkip) {
            logger.info('[admin/retrySportsLibReparseHeavyJob] Skipping failed-status restore because user is missing or deletion is in progress.', {
                jobId,
                uid: claimedRetry.uid,
                userExists: deletionGuard.userExists,
                deletionInProgress: deletionGuard.deletionInProgress,
            });
            throw new HttpsError('failed-precondition', `User ${claimedRetry.uid} is missing or deletion is in progress.`);
        }
        await jobRef.set({
            status: 'failed',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastError: errorMessage,
            enqueuedAt: admin.firestore.FieldValue.delete(),
        }, { merge: true });
        logger.error('[admin/retrySportsLibReparseHeavyJob] Failed to enqueue heavy retry.', {
            jobId,
            error: errorMessage,
        });
        throw new HttpsError('internal', errorMessage);
    }
});
