import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { parseWorkoutQueueItemForServiceName } from '../queue';
import { getServiceWorkoutQueueName } from '../shared/queue-names';
import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';
import { QueueResult } from '../queue-utils';

/**
 * Task worker that processes a single workout queue item.
 * This is triggered via a Cloud Task.
 * Force update: 2025-12-25 21:12
 */
export const processWorkoutTask = onTaskDispatched({
    retryConfig: CLOUD_TASK_RETRY_CONFIG,
    memory: '1GiB',
    timeoutSeconds: 540,
    region: 'europe-west2',
}, async (request) => {
    const { queueItemId, serviceName } = request.data as { queueItemId: string; serviceName: ServiceNames };

    const collectionName = getServiceWorkoutQueueName(serviceName);
    logger.info(`[TaskWorker] Starting task for ${serviceName} item: ${queueItemId} in collection ${collectionName}`);

    const queueRef = admin.firestore().collection(collectionName).doc(queueItemId);
    const queueDoc = await queueRef.get();

    if (!queueDoc.exists) {
        // Check if the item is in the Dead Letter Queue (failed_jobs)
        // This handles cases where the task retry loop continues even after the item was securely moved to DLQ
        const failedJobDoc = await admin.firestore().collection('failed_jobs').doc(queueItemId).get();

        if (failedJobDoc.exists) {
            logger.warn(`[TaskWorker] Queue item ${queueItemId} not found in ${collectionName} but exists in failed_jobs. Stopping retry.`);
            return;
        }

        // Throw error so Cloud Tasks retries with exponential backoff.
        // This handles race conditions where the task executes before Firestore write propagates.
        throw new Error(`[TaskWorker] Queue item ${queueItemId} not found in ${collectionName}`);
    }

    const queueItem = queueDoc.data();
    if (queueItem?.processed === true) {
        logger.info(`[TaskWorker] Item ${queueItemId} already processed, skipping.`);
        return;
    }

    try {
        // Process the individual item reusing the core logic
        // We pass null for caches/pendingWrites as this worker focuses on a single item
        // and Cloud Tasks handles the concurrency at the queue level.
        const result = await parseWorkoutQueueItemForServiceName(serviceName, Object.assign({
            id: queueDoc.id,
            ref: queueDoc.ref,
        }, queueItem) as any);

        switch (result) {
            case QueueResult.Processed:
                logger.info(`[TaskWorker] Successfully processed ${serviceName} item: ${queueItemId}`);
                break;
            case QueueResult.MovedToDLQ:
                logger.warn(`[TaskWorker] Item ${queueItemId} for ${serviceName} was moved to DLQ (failed_jobs).`);
                break;
            case QueueResult.RetryIncremented:
                logger.warn(`[TaskWorker] Item ${queueItemId} for ${serviceName} failed and retry count was incremented.`);
                throw new Error(`Item ${queueItemId} failed and was scheduled for retry.`);
            case QueueResult.Failed:
                logger.error(`[TaskWorker] Fatal failure updating state for ${serviceName} item: ${queueItemId}`);
                throw new Error(`Fatal failure updating state for ${serviceName} item: ${queueItemId}`);

            default:
                logger.error(`[TaskWorker] Unexpected result for ${serviceName} item: ${queueItemId}: ${result}`);
                throw new Error(`Unexpected result for ${queueItemId}: ${result}`);
        }

    } catch (error) {
        logger.error(`[TaskWorker] Error processing ${serviceName} item ${queueItemId}:`, error);
        // Throwing an error here triggers the Cloud Task retry with exponential backoff
        throw error;
    }
});
