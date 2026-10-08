import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';
import { QueueResult } from '../queue-utils';
import { isQueueItemDeletedForUserCleanup } from '../queue/cleanup-tombstone';
import { RouteDeliverySyncQueueItemInterface } from '../queue/queue-item.interface';
import { ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME } from '../route-delivery-sync/constants';
import { processRouteDeliverySyncQueueItem } from '../route-delivery-sync/process-queue-item';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import { recordRouteQueueAttempt, routeQueueFailureOutcome, type RouteQueueAttempt } from '../routes/monitoring';

interface RouteDeliverySyncTaskPayload {
    queueItemId: string;
}

export const processRouteDeliverySyncTask = onTaskDispatched({
    retryConfig: CLOUD_TASK_RETRY_CONFIG,
    secrets: FUNCTION_SECRET_BINDINGS.processRouteDeliverySyncTask,
    memory: '1GiB',
    timeoutSeconds: 540,
    region: 'europe-west2',
}, async (request) => {
    const startedAt = Date.now();
    let observedItem: unknown;
    let outcome: RouteQueueAttempt = 'failed';
    let queueItemId: string | undefined;

    try {
        ({ queueItemId } = request.data as RouteDeliverySyncTaskPayload);
        logger.info(`[RouteDeliverySyncTaskWorker] Starting task for queue item ${queueItemId}`);
        const queueRef = admin.firestore().collection(ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME).doc(queueItemId);
        const queueDoc = await queueRef.get();

        if (!queueDoc.exists) {
            const failedJobDoc = await admin.firestore().collection('failed_jobs').doc(queueItemId).get();
            if (failedJobDoc.exists) {
                outcome = 'already_failed';
                logger.warn(`[RouteDeliverySyncTaskWorker] Queue item ${queueItemId} not found in ${ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME} but exists in failed_jobs. Stopping retry.`);
                return;
            }
            if (await isQueueItemDeletedForUserCleanup(ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME, queueItemId)) {
                outcome = 'cleanup_removed';
                logger.warn(`[RouteDeliverySyncTaskWorker] Queue item ${queueItemId} was deleted during queue cleanup. Stopping retry.`);
                return;
            }

            throw new Error(`[RouteDeliverySyncTaskWorker] Queue item ${queueItemId} not found in ${ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME}`);
        }

        const queueItem = queueDoc.data() as RouteDeliverySyncQueueItemInterface | undefined;
        observedItem = queueItem;
        if (queueItem?.processed) {
            outcome = 'already_processed';
            logger.info(`[RouteDeliverySyncTaskWorker] Item ${queueItemId} already processed, skipping.`);
            return;
        }

        const result = await processRouteDeliverySyncQueueItem(Object.assign({
            id: queueDoc.id,
            ref: queueDoc.ref,
        }, queueItem) as RouteDeliverySyncQueueItemInterface);

        switch (result) {
            case QueueResult.Processed:
                outcome = 'acknowledged';
                logger.info(`[RouteDeliverySyncTaskWorker] Successfully processed item ${queueItemId}`);
                return;
            case QueueResult.Deferred:
                outcome = 'deferred';
                logger.warn(`[RouteDeliverySyncTaskWorker] Deferred item ${queueItemId}; it remains queued for a future dispatcher run.`);
                return;
            case QueueResult.MovedToDLQ:
                outcome = 'dead_lettered';
                logger.warn(`[RouteDeliverySyncTaskWorker] Item ${queueItemId} was moved to DLQ.`);
                return;
            case QueueResult.Skipped:
                outcome = 'manual_reconciliation';
                logger.error(`[RouteDeliverySyncTaskWorker] Item ${queueItemId} requires manual reconciliation; stopping automatic retries.`);
                return;
            case QueueResult.RetryIncremented:
                outcome = 'retry';
                logger.warn(`[RouteDeliverySyncTaskWorker] Item ${queueItemId} failed and retry count was incremented.`);
                throw new Error(`Item ${queueItemId} failed and was scheduled for retry.`);
            case QueueResult.Failed:
                throw new Error(`Fatal failure updating state for route delivery sync item ${queueItemId}`);
            default:
                throw new Error(`Unexpected result for route delivery sync item ${queueItemId}: ${result}`);
        }
    } catch (error) {
        if (outcome === 'failed') outcome = routeQueueFailureOutcome(error);
        logger.error(`[RouteDeliverySyncTaskWorker] Error processing item ${queueItemId}:`, error);
        throw error;
    } finally {
        recordRouteQueueAttempt('delivery', observedItem, outcome, Date.now() - startedAt);
    }
});
