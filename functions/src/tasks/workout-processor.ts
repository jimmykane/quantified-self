import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { parseWorkoutQueueItemForServiceName } from '../queue';
import { getServiceWorkoutQueueName } from '../shared/queue-names';
import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';

/**
 * Task worker that processes a single workout queue item.
 * This is triggered via a Cloud Task.
 * Force update: 2025-12-25 21:12
 */
export const processWorkoutTask = onTaskDispatched({
    retryConfig: CLOUD_TASK_RETRY_CONFIG,
    memory: '4GiB',
    timeoutSeconds: 540,
    region: 'europe-west2',
}, async (request) => {
    const { queueItemId, serviceName } = request.data as { queueItemId: string; serviceName: ServiceNames };

    const collectionName = getServiceWorkoutQueueName(serviceName);
    logger.info(`[TaskWorker] Starting task for ${serviceName} item: ${queueItemId} in collection ${collectionName}`);

    const queueRef = admin.firestore().collection(collectionName).doc(queueItemId);
    const queueDoc = await queueRef.get();

    if (!queueDoc.exists) {
        logger.error(`[TaskWorker] Queue item ${queueItemId} not found in ${collectionName}`);
        return;
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
        await parseWorkoutQueueItemForServiceName(serviceName, Object.assign({
            id: queueDoc.id,
            ref: queueDoc.ref,
        }, queueItem) as any);
        logger.info(`[TaskWorker] Successfully processed ${serviceName} item: ${queueItemId}`);
    } catch (error) {
        logger.error(`[TaskWorker] Error processing ${serviceName} item ${queueItemId}:`, error);
        // Throwing an error here triggers the Cloud Task retry with exponential backoff
        throw error;
    }
});
