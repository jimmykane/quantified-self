import { HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { onAdminCall } from '../../shared/auth';
import { getCloudTaskQueueDepthForQueue } from '../../utils';
import { GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME } from '../../garmin/constants';
import { SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME } from '../../suunto/constants';
import { COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME } from '../../coros/constants';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { config } from '../../config';
import { SPORTS_LIB_REPARSE_TARGET_VERSION } from '../../reparse/sports-lib-reparse.config';
import { DERIVED_METRICS_COORDINATOR_DOC_ID, normalizeDerivedMetricKindsStrict } from '../../../../shared/derived-metrics';
import { normalizeError } from '../shared/error.utils';
import { toEpochMillis, toSafeNumber } from '../shared/date.utils';
import {
    DerivedMetricsCoordinatorDocData,
    DerivedMetricsCoordinatorStats,
    DerivedMetricsFailurePreview,
    GetQueueStatsRequest,
    QueueStatsResponse,
    SportsLibReparseJobDocData,
} from '../shared/types';

const SPORTS_LIB_REPARSE_JOBS_COLLECTION = 'sportsLibReparseJobs';
const SPORTS_LIB_REPARSE_CHECKPOINT_DOC_PATH = 'systemJobs/sportsLibReparse';
const SPORTS_LIB_REPARSE_FAILURE_PREVIEW_LIMIT = 10;
const DERIVED_METRICS_FAILURE_PREVIEW_LIMIT = 10;

const DERIVED_METRICS_COORDINATOR_STATUSES = ['idle', 'queued', 'processing', 'failed'] as const;
type DerivedMetricsCoordinatorStatus = typeof DERIVED_METRICS_COORDINATOR_STATUSES[number];

function isDerivedMetricsCoordinatorStatus(value: unknown): value is DerivedMetricsCoordinatorStatus {
    return DERIVED_METRICS_COORDINATOR_STATUSES.includes(`${value}` as DerivedMetricsCoordinatorStatus);
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
        const { workoutQueue, sportsLibReparseQueue, derivedMetricsQueue } = config.cloudtasks;
        const [workoutCloudTaskDepth, sportsLibReparseCloudTaskDepth, derivedMetricsCloudTaskDepth] = await Promise.all([
            getCloudTaskQueueDepthForQueue(workoutQueue).catch(e => {
                logger.error(`Error getting Cloud Task depth for queue ${workoutQueue}:`, e);
                return 0;
            }),
            getCloudTaskQueueDepthForQueue(sportsLibReparseQueue).catch(e => {
                logger.error(`Error getting Cloud Task depth for queue ${sportsLibReparseQueue}:`, e);
                return 0;
            }),
            getCloudTaskQueueDepthForQueue(derivedMetricsQueue).catch(e => {
                logger.error(`Error getting Cloud Task depth for queue ${derivedMetricsQueue}:`, e);
                return 0;
            }),
        ]);
        const totalCloudTaskDepth = workoutCloudTaskDepth + sportsLibReparseCloudTaskDepth + derivedMetricsCloudTaskDepth;
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

        // Querying the `meta` collection group by coordinator doc ID gives one coordinator snapshot per user.
        const derivedMetricsCoordinatorSnapshot = await db.collectionGroup('meta')
            .where(admin.firestore.FieldPath.documentId(), '==', DERIVED_METRICS_COORDINATOR_DOC_ID)
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
            failed: 0,
            total: 0,
        };
        const derivedFailures: DerivedMetricsFailurePreview[] = [];

        (derivedMetricsCoordinatorSnapshot?.docs || []).forEach((doc) => {
            const rawData = doc.data() as DerivedMetricsCoordinatorDocData;
            const rawStatus = `${rawData.status || ''}`.trim();
            const status = isDerivedMetricsCoordinatorStatus(rawStatus) ? rawStatus : null;
            const generation = Math.max(0, Math.floor(toSafeNumber(rawData.generation)));
            const updatedAtMs = Math.max(
                0,
                toEpochMillis(rawData.updatedAtMs) ?? toSafeNumber(rawData.updatedAtMs),
            );
            const dirtyMetricKinds = normalizeDerivedMetricKindsStrict(
                Array.isArray(rawData.dirtyMetricKinds) ? rawData.dirtyMetricKinds : [],
            );
            const lastError = `${rawData.lastError || ''}`.trim();
            const uid = `${doc.ref.parent?.parent?.id || ''}`.trim();

            derivedCoordinatorCounts.total += 1;
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
            }))
            .map(entry => ({
                jobId: entry.jobId,
                uid: `${entry.data.uid || ''}`,
                eventId: `${entry.data.eventId || ''}`,
                attemptCount: toSafeNumber(entry.data.attemptCount),
                lastError: `${entry.data.lastError || ''}`,
                updatedAt: entry.data.updatedAt || null,
                targetSportsLibVersion: `${entry.data.targetSportsLibVersion || ''}`,
            }));

        let totalPending = 0;
        let totalSucceeded = 0;
        let totalStuck = 0;
        // Advanced stats
        let totalThroughput = 0;
        let maxLagMs = 0;
        const retryHistogram = { '0-3': 0, '4-7': 0, '8-9': 0 };

        const ONE_HOUR_AGO = Date.now() - (60 * 60 * 1000);

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

        if (includeAnalysis) {
            const dlqCol = db.collection('failed_jobs');

            // Use limited query for clustering to save reads
            const [dlqCountSnap, dlqRecentSnap] = await Promise.all([
                dlqCol.count().get(),
                dlqCol.orderBy('failedAt', 'desc').limit(50).get()
            ]);

            const dlqByContext: Record<string, number> = {};
            const dlqByProvider: Record<string, number> = {};
            const errorCounts: Record<string, number> = {};

            dlqRecentSnap.docs.forEach(doc => {
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
                    sportsLibReparse: {
                        queueId: sportsLibReparseQueue,
                        pending: sportsLibReparseCloudTaskDepth,
                    },
                    derivedMetrics: {
                        queueId: derivedMetricsQueue,
                        pending: derivedMetricsCloudTaskDepth,
                    },
                },
            },
            reparse: {
                queuePending: sportsLibReparseCloudTaskDepth,
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
            }
        };
    } catch (error: unknown) {
        logger.error('Error getting queue stats:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to get queue statistics';
        throw new HttpsError('internal', errorMessage);
    }
});
