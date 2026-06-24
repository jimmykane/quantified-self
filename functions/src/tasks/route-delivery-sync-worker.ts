import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';
import { QueueResult } from '../queue-utils';
import { isQueueItemDeletedForUserCleanup } from '../queue/cleanup-tombstone';
import { RouteDeliverySyncQueueItemInterface } from '../queue/queue-item.interface';
import { ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME } from '../route-delivery-sync/constants';
import { processRouteDeliverySyncQueueItem } from '../route-delivery-sync/process-queue-item';

interface RouteDeliverySyncTaskPayload {
    queueItemId: string;
}

export const processRouteDeliverySyncTask = onTaskDispatched({
    retryConfig: CLOUD_TASK_RETRY_CONFIG,
    memory: '1GiB',
    timeoutSeconds: 540,
    region: 'europe-west2',
}, async (request) => {
    const { queueItemId } = request.data as RouteDeliverySyncTaskPayload;
    logger.info(`[RouteDeliverySyncTaskWorker] Starting task for queue item ${queueItemId}`);

    const queueRef = admin.firestore().collection(ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME).doc(queueItemId);
    const queueDoc = await queueRef.get();

    if (!queueDoc.exists) {
        const failedJobDoc = await admin.firestore().collection('failed_jobs').doc(queueItemId).get();
        if (failedJobDoc.exists) {
            logger.warn(`[RouteDeliverySyncTaskWorker] Queue item ${queueItemId} not found in ${ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME} but exists in failed_jobs. Stopping retry.`);
            return;
        }
        if (await isQueueItemDeletedForUserCleanup(ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME, queueItemId)) {
            logger.warn(`[RouteDeliverySyncTaskWorker] Queue item ${queueItemId} was deleted during queue cleanup. Stopping retry.`);
            return;
        }

        throw new Error(`[RouteDeliverySyncTaskWorker] Queue item ${queueItemId} not found in ${ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME}`);
    }

    const queueItem = queueDoc.data() as RouteDeliverySyncQueueItemInterface | undefined;
    if (queueItem?.processed) {
        logger.info(`[RouteDeliverySyncTaskWorker] Item ${queueItemId} already processed, skipping.`);
        return;
    }

    try {
        const result = await processRouteDeliverySyncQueueItem(Object.assign({
            id: queueDoc.id,
            ref: queueDoc.ref,
        }, queueItem) as RouteDeliverySyncQueueItemInterface);

        switch (result) {
            case QueueResult.Processed:
                logger.info(`[RouteDeliverySyncTaskWorker] Successfully processed item ${queueItemId}`);
                return;
            case QueueResult.Deferred:
                logger.warn(`[RouteDeliverySyncTaskWorker] Deferred item ${queueItemId}; it remains queued for a future dispatcher run.`);
                return;
            case QueueResult.MovedToDLQ:
                logger.warn(`[RouteDeliverySyncTaskWorker] Item ${queueItemId} was moved to DLQ.`);
                return;
            case QueueResult.RetryIncremented:
                logger.warn(`[RouteDeliverySyncTaskWorker] Item ${queueItemId} failed and retry count was incremented.`);
                throw new Error(`Item ${queueItemId} failed and was scheduled for retry.`);
            case QueueResult.Failed:
                throw new Error(`Fatal failure updating state for route delivery sync item ${queueItemId}`);
            default:
                throw new Error(`Unexpected result for route delivery sync item ${queueItemId}: ${result}`);
        }
    } catch (error) {
        logger.error(`[RouteDeliverySyncTaskWorker] Error processing item ${queueItemId}:`, error);
        throw error;
    }
});
