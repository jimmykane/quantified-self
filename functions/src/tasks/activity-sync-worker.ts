import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';
import { QueueResult } from '../queue-utils';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from '../activity-sync/constants';
import { ActivitySyncQueueItemInterface } from '../queue/queue-item.interface';
import { processActivitySyncQueueItem } from '../activity-sync/process-queue-item';
import { isQueueItemDeletedForUserCleanup } from '../queue/cleanup-tombstone';

interface ActivitySyncTaskPayload {
    queueItemId: string;
}

const MAX_RETRY_REASON_LENGTH = 300;

function getSafeRetryReason(queueItem: ActivitySyncQueueItemInterface): string | undefined {
    const errors = Array.isArray(queueItem.errors) ? queueItem.errors : [];
    const latestError = errors[errors.length - 1];
    const message = `${latestError?.error || ''}`.trim();
    if (!message) {
        return undefined;
    }

    return message
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
        .replace(/\b(access_token|refresh_token|id_token|client_secret|authorization|token|api[_-]?key|x-sig|signature|sig)=([^&\s]+)/gi, '$1=[redacted]')
        .replace(/\b(access_token|refresh_token|id_token|client_secret|authorization|token|api[_-]?key|x-sig|signature|sig)["']?\s*:\s*["'][^"']+["']/gi, '$1: "[redacted]"')
        .replace(/https?:\/\/[^\s]+/gi, '[url]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_RETRY_REASON_LENGTH);
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
        if (await isQueueItemDeletedForUserCleanup(ACTIVITY_SYNC_QUEUE_COLLECTION_NAME, queueItemId)) {
            logger.warn(`[ActivitySyncTaskWorker] Queue item ${queueItemId} was deleted during queue cleanup. Stopping retry.`);
            return;
        }

        throw new Error(`[ActivitySyncTaskWorker] Queue item ${queueItemId} not found in ${ACTIVITY_SYNC_QUEUE_COLLECTION_NAME}`);
    }

    const queueItem = queueDoc.data() as ActivitySyncQueueItemInterface | undefined;
    if (!queueItem) {
        throw new Error(`[ActivitySyncTaskWorker] Queue item ${queueItemId} has no data.`);
    }
    if (queueItem.processed) {
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
            case QueueResult.Deferred:
                logger.warn(`[ActivitySyncTaskWorker] Deferred item ${queueItemId}; it remains queued for a future dispatcher run.`);
                break;
            case QueueResult.MovedToDLQ:
                logger.warn(`[ActivitySyncTaskWorker] Item ${queueItemId} was moved to DLQ.`);
                break;
            case QueueResult.RetryIncremented: {
                const retryReason = getSafeRetryReason(queueItem);
                logger.warn(`[ActivitySyncTaskWorker] Item ${queueItemId} failed and retry count was incremented.`, {
                    ...(retryReason ? { retryReason } : {}),
                });
                throw new Error(`Item ${queueItemId} failed and was scheduled for retry${retryReason ? `: ${retryReason}` : '.'}`);
            }
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
