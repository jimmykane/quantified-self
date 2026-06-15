import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';
import { QueueResult } from '../queue-utils';
import { isQueueItemDeletedForUserCleanup } from '../queue/cleanup-tombstone';
import { RouteSyncQueueItemInterface } from '../queue/queue-item.interface';
import { ROUTE_SYNC_QUEUE_COLLECTION_NAME } from '../routes/route-sync.constants';
import { processRouteSyncQueueItem } from '../routes/process-route-sync-queue-item';

interface RouteSyncTaskPayload {
    queueItemId: string;
}

export const processRouteSyncTask = onTaskDispatched({
    retryConfig: CLOUD_TASK_RETRY_CONFIG,
    memory: '1GiB',
    timeoutSeconds: 540,
    region: 'europe-west2',
}, async (request) => {
    const { queueItemId } = request.data as RouteSyncTaskPayload;
    logger.info(`[RouteSyncTaskWorker] Starting task for queue item ${queueItemId}`);

    const queueRef = admin.firestore().collection(ROUTE_SYNC_QUEUE_COLLECTION_NAME).doc(queueItemId);
    const queueDoc = await queueRef.get();

    if (!queueDoc.exists) {
        const failedJobDoc = await admin.firestore().collection('failed_jobs').doc(queueItemId).get();
        if (failedJobDoc.exists) {
            logger.warn(`[RouteSyncTaskWorker] Queue item ${queueItemId} not found in ${ROUTE_SYNC_QUEUE_COLLECTION_NAME} but exists in failed_jobs. Stopping retry.`);
            return;
        }
        if (await isQueueItemDeletedForUserCleanup(ROUTE_SYNC_QUEUE_COLLECTION_NAME, queueItemId)) {
            logger.warn(`[RouteSyncTaskWorker] Queue item ${queueItemId} was deleted during queue cleanup. Stopping retry.`);
            return;
        }

        throw new Error(`[RouteSyncTaskWorker] Queue item ${queueItemId} not found in ${ROUTE_SYNC_QUEUE_COLLECTION_NAME}`);
    }

    const queueItem = queueDoc.data() as RouteSyncQueueItemInterface | undefined;
    if (queueItem?.processed) {
        logger.info(`[RouteSyncTaskWorker] Item ${queueItemId} already processed, skipping.`);
        return;
    }

    try {
        const result = await processRouteSyncQueueItem(Object.assign({
            id: queueDoc.id,
            ref: queueDoc.ref,
        }, queueItem) as RouteSyncQueueItemInterface);

        switch (result) {
            case QueueResult.Processed:
                logger.info(`[RouteSyncTaskWorker] Successfully processed item ${queueItemId}`);
                return;
            case QueueResult.MovedToDLQ:
                logger.warn(`[RouteSyncTaskWorker] Item ${queueItemId} was moved to DLQ.`);
                return;
            case QueueResult.RetryIncremented:
                logger.warn(`[RouteSyncTaskWorker] Item ${queueItemId} failed and retry count was incremented.`);
                throw new Error(`Item ${queueItemId} failed and was scheduled for retry.`);
            case QueueResult.Failed:
                throw new Error(`Fatal failure updating state for route sync item ${queueItemId}`);
            default:
                throw new Error(`Unexpected result for route sync item ${queueItemId}: ${result}`);
        }
    } catch (error) {
        logger.error(`[RouteSyncTaskWorker] Error processing item ${queueItemId}:`, error);
        throw error;
    }
});
