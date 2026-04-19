import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';
import { QueueResult } from '../queue-utils';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from '../activity-sync/constants';
import { ActivitySyncQueueItemInterface } from '../queue/queue-item.interface';
import { processActivitySyncQueueItem } from '../activity-sync/process-queue-item';

interface ActivitySyncTaskPayload {
    queueItemId: string;
}

export const processActivitySyncTask = onTaskDispatched({
    retryConfig: CLOUD_TASK_RETRY_CONFIG,
    memory: '1GiB',
    timeoutSeconds: 540,
    region: 'europe-west2',
}, async (request) => {
    const { queueItemId } = request.data as ActivitySyncTaskPayload;
    logger.info(`[ActivitySyncTaskWorker] Starting task for queue item ${queueItemId}`);

    const queueRef = admin.firestore().collection(ACTIVITY_SYNC_QUEUE_COLLECTION_NAME).doc(queueItemId);
    const queueDoc = await queueRef.get();

    if (!queueDoc.exists) {
        const failedJobDoc = await admin.firestore().collection('failed_jobs').doc(queueItemId).get();
        if (failedJobDoc.exists) {
            logger.warn(`[ActivitySyncTaskWorker] Queue item ${queueItemId} not found in ${ACTIVITY_SYNC_QUEUE_COLLECTION_NAME} but exists in failed_jobs. Stopping retry.`);
            return;
        }

        throw new Error(`[ActivitySyncTaskWorker] Queue item ${queueItemId} not found in ${ACTIVITY_SYNC_QUEUE_COLLECTION_NAME}`);
    }

    const queueItem = queueDoc.data() as ActivitySyncQueueItemInterface | undefined;
    if (queueItem?.processed) {
        logger.info(`[ActivitySyncTaskWorker] Item ${queueItemId} already processed, skipping.`);
        return;
    }

    try {
        const result = await processActivitySyncQueueItem(Object.assign({
            id: queueDoc.id,
            ref: queueDoc.ref,
        }, queueItem) as ActivitySyncQueueItemInterface);

        switch (result) {
            case QueueResult.Processed:
                logger.info(`[ActivitySyncTaskWorker] Successfully processed item ${queueItemId}`);
                break;
            case QueueResult.MovedToDLQ:
                logger.warn(`[ActivitySyncTaskWorker] Item ${queueItemId} was moved to DLQ.`);
                break;
            case QueueResult.RetryIncremented:
                logger.warn(`[ActivitySyncTaskWorker] Item ${queueItemId} failed and retry count was incremented.`);
                throw new Error(`Item ${queueItemId} failed and was scheduled for retry.`);
            case QueueResult.Failed:
                logger.error(`[ActivitySyncTaskWorker] Fatal failure updating state for item ${queueItemId}`);
                throw new Error(`Fatal failure updating state for activity sync item ${queueItemId}`);
            default:
                logger.error(`[ActivitySyncTaskWorker] Unexpected result for item ${queueItemId}: ${result}`);
                throw new Error(`Unexpected result for activity sync item ${queueItemId}: ${result}`);
        }
    } catch (error) {
        logger.error(`[ActivitySyncTaskWorker] Error processing item ${queueItemId}:`, error);
        throw error;
    }
});
