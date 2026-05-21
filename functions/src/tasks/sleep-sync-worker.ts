import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';
import { QueueResult } from '../queue-utils';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from '../sleep/constants';
import { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import { processSleepSyncQueueItem } from '../sleep/queue';
import { isQueueItemDeletedForUserCleanup } from '../queue/cleanup-tombstone';

interface SleepSyncTaskPayload {
    queueItemId: string;
}

export const processSleepSyncTask = onTaskDispatched({
    retryConfig: CLOUD_TASK_RETRY_CONFIG,
    memory: '1GiB',
    timeoutSeconds: 540,
    region: 'europe-west2',
}, async (request) => {
    const { queueItemId } = request.data as SleepSyncTaskPayload;
    logger.info(`[SleepSyncTaskWorker] Starting task for queue item ${queueItemId}`);

    const queueRef = admin.firestore().collection(SLEEP_SYNC_QUEUE_COLLECTION_NAME).doc(queueItemId);
    const queueDoc = await queueRef.get();

    if (!queueDoc.exists) {
        const failedJobDoc = await admin.firestore().collection('failed_jobs').doc(queueItemId).get();
        if (failedJobDoc.exists) {
            logger.warn(`[SleepSyncTaskWorker] Queue item ${queueItemId} not found but exists in failed_jobs. Stopping retry.`);
            return;
        }
        if (await isQueueItemDeletedForUserCleanup(SLEEP_SYNC_QUEUE_COLLECTION_NAME, queueItemId)) {
            logger.warn(`[SleepSyncTaskWorker] Queue item ${queueItemId} was deleted during queue cleanup. Stopping retry.`);
            return;
        }
        throw new Error(`[SleepSyncTaskWorker] Queue item ${queueItemId} not found in ${SLEEP_SYNC_QUEUE_COLLECTION_NAME}`);
    }

    const queueItem = queueDoc.data() as SleepSyncQueueItemInterface | undefined;
    if (queueItem?.processed) {
        logger.info(`[SleepSyncTaskWorker] Item ${queueItemId} already processed, skipping.`);
        return;
    }

    const result = await processSleepSyncQueueItem(Object.assign({
        id: queueDoc.id,
        ref: queueDoc.ref,
    }, queueItem) as SleepSyncQueueItemInterface);

    switch (result) {
        case QueueResult.Processed:
            logger.info(`[SleepSyncTaskWorker] Successfully processed item ${queueItemId}`);
            return;
        case QueueResult.MovedToDLQ:
            logger.warn(`[SleepSyncTaskWorker] Item ${queueItemId} was moved to DLQ.`);
            return;
        case QueueResult.RetryIncremented:
            throw new Error(`Item ${queueItemId} failed and was scheduled for retry.`);
        case QueueResult.Failed:
            throw new Error(`Fatal failure updating sleep sync item ${queueItemId}`);
        default:
            throw new Error(`Unexpected result for sleep sync item ${queueItemId}: ${result}`);
    }
});
