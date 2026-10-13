import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';
import { QueueResult } from '../queue-utils';
import { isQueueItemDeletedForUserCleanup } from '../queue/cleanup-tombstone';
import { RouteSyncQueueItemInterface } from '../queue/queue-item.interface';
import { ROUTE_SYNC_QUEUE_COLLECTION_NAME } from '../routes/route-sync.constants';
import { processRouteSyncQueueItem } from '../routes/process-route-sync-queue-item';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import { recordRouteQueueAttempt, routeQueueFailureOutcome, type RouteQueueAttempt } from '../routes/monitoring';
import { hasMatchingQueueRevision, normalizeQueueRevision } from '../queue/revision-identity';

interface RouteSyncTaskPayload {
    queueItemId: string;
    queueRevision?: string;
    queueDateCreated?: number;
}

export const processRouteSyncTask = onTaskDispatched({
    retryConfig: CLOUD_TASK_RETRY_CONFIG,
    secrets: FUNCTION_SECRET_BINDINGS.processRouteSyncTask,
    memory: '1GiB',
    timeoutSeconds: 540,
    region: 'europe-west2',
}, async (request) => {
    const startedAt = Date.now();
    let observedItem: unknown;
    let outcome: RouteQueueAttempt = 'failed';
    let queueItemId: string | undefined;

    try {
        const payload = request.data as RouteSyncTaskPayload;
        ({ queueItemId } = payload);
        logger.info(`[RouteSyncTaskWorker] Starting task for queue item ${queueItemId}`);
        const queueRef = admin.firestore().collection(ROUTE_SYNC_QUEUE_COLLECTION_NAME).doc(queueItemId);
        const queueDoc = await queueRef.get();

        if (!queueDoc.exists) {
            const failedJobDoc = await admin.firestore().collection('failed_jobs').doc(queueItemId).get();
            if (failedJobDoc.exists) {
                outcome = 'already_failed';
                logger.warn(`[RouteSyncTaskWorker] Queue item ${queueItemId} not found in ${ROUTE_SYNC_QUEUE_COLLECTION_NAME} but exists in failed_jobs. Stopping retry.`);
                return;
            }
            if (await isQueueItemDeletedForUserCleanup(ROUTE_SYNC_QUEUE_COLLECTION_NAME, queueItemId)) {
                outcome = 'cleanup_removed';
                logger.warn(`[RouteSyncTaskWorker] Queue item ${queueItemId} was deleted during queue cleanup. Stopping retry.`);
                return;
            }

            throw new Error(`[RouteSyncTaskWorker] Queue item ${queueItemId} not found in ${ROUTE_SYNC_QUEUE_COLLECTION_NAME}`);
        }

        const queueItem = queueDoc.data() as RouteSyncQueueItemInterface | undefined;
        observedItem = queueItem;
        if (queueItem?.processed) {
            outcome = 'already_processed';
            logger.info(`[RouteSyncTaskWorker] Item ${queueItemId} already processed, skipping.`);
            return;
        }
        if (payload.queueRevision !== undefined || payload.queueDateCreated !== undefined) {
            const invalidIdentity = payload.queueRevision !== undefined && !normalizeQueueRevision(payload.queueRevision)
                || payload.queueDateCreated !== undefined && (typeof payload.queueDateCreated !== 'number'
                    || !Number.isSafeInteger(payload.queueDateCreated) || payload.queueDateCreated < 0
                    || payload.queueDateCreated !== queueItem?.dateCreated);
            if (invalidIdentity || !hasMatchingQueueRevision({ currentQueueItem: queueItem || {}, attemptedQueueItem: payload,
                legacyIdentityMatches: payload.queueDateCreated !== undefined && payload.queueDateCreated === queueItem?.dateCreated })) {
                // ACK only the obsolete task, without a committed import outcome.
                outcome = 'acknowledged';
                logger.info('[RouteSyncTaskWorker] Task identity is stale; leaving the replacement revision queued.');
                return;
            }
        }

        const result = await processRouteSyncQueueItem(Object.assign({
            id: queueDoc.id,
            ref: queueDoc.ref,
        }, queueItem) as RouteSyncQueueItemInterface);

        switch (result) {
            case QueueResult.Processed:
                outcome = 'acknowledged';
                logger.info(`[RouteSyncTaskWorker] Successfully processed item ${queueItemId}`);
                return;
            case QueueResult.Deferred:
                outcome = 'deferred';
                logger.warn(`[RouteSyncTaskWorker] Deferred item ${queueItemId}; it remains queued for a future dispatcher run.`);
                return;
            case QueueResult.MovedToDLQ:
                outcome = 'dead_lettered';
                logger.warn(`[RouteSyncTaskWorker] Item ${queueItemId} was moved to DLQ.`);
                return;
            case QueueResult.RetryIncremented:
                outcome = 'retry';
                logger.warn(`[RouteSyncTaskWorker] Item ${queueItemId} failed and retry count was incremented.`);
                throw new Error(`Item ${queueItemId} failed and was scheduled for retry.`);
            case QueueResult.Failed:
                throw new Error(`Fatal failure updating state for route sync item ${queueItemId}`);
            default:
                throw new Error(`Unexpected result for route sync item ${queueItemId}: ${result}`);
        }
    } catch (error) {
        if (outcome === 'failed') outcome = routeQueueFailureOutcome(error);
        logger.error(`[RouteSyncTaskWorker] Error processing item ${queueItemId}:`, error);
        throw error;
    } finally {
        recordRouteQueueAttempt('import', observedItem, outcome, Date.now() - startedAt);
    }
});
