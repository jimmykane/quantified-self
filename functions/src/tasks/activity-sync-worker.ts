import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';
import { enqueueActivitySyncTask } from '../shared/cloud-tasks';
import { QueueResult } from '../queue-utils';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from '../activity-sync/constants';
import { ActivitySyncQueueItemInterface } from '../queue/queue-item.interface';
import { processActivitySyncQueueItem } from '../activity-sync/process-queue-item';
import { isQueueItemDeletedForUserCleanup } from '../queue/cleanup-tombstone';
import { shouldSkipQueueWorkForDeletedUser } from '../queue/user-deletion-skip';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';

interface ActivitySyncTaskPayload {
    queueItemId: string;
}

const MAX_RETRY_REASON_LENGTH = 300;

function getProviderStatusPollDelaySeconds(retryCount: unknown): number {
    // Pending polls consume the queue retry budget, so mirror the configured
    // Cloud Tasks backoff before scheduling the next explicit status check.
    const completedPolls = Number.isFinite(Number(retryCount))
        ? Math.max(0, Math.floor(Number(retryCount)))
        : 0;
    const backoffExponent = Math.min(
        Math.max(0, completedPolls - 1),
        CLOUD_TASK_RETRY_CONFIG.maxDoublings,
    );
    return Math.min(
        CLOUD_TASK_RETRY_CONFIG.maxBackoffSeconds,
        CLOUD_TASK_RETRY_CONFIG.minBackoffSeconds * (2 ** backoffExponent),
    );
}

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
    secrets: FUNCTION_SECRET_BINDINGS.processActivitySyncTask,
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
        const processingQueueItem = Object.assign({
            id: queueDoc.id,
            ref: queueDoc.ref,
        }, queueItem) as ActivitySyncQueueItemInterface;
        const result = await processActivitySyncQueueItem(processingQueueItem);

        switch (result) {
            case QueueResult.Processed:
                logger.info(`[ActivitySyncTaskWorker] Successfully processed item ${queueItemId}`);
                break;
            case QueueResult.Skipped:
                logger.error(`[ActivitySyncTaskWorker] Item ${queueItemId} requires manual reconciliation; stopping automatic retries.`);
                break;
            case QueueResult.Deferred:
                logger.warn(`[ActivitySyncTaskWorker] Deferred item ${queueItemId}; it remains queued for a future dispatcher run.`);
                break;
            case QueueResult.ProviderStatusPending: {
                if (await shouldSkipQueueWorkForDeletedUser(
                    processingQueueItem.userID,
                    processingQueueItem.destinationServiceName,
                    queueItemId,
                    'before_activity_sync_pending_status_poll_enqueue',
                )) {
                    logger.info(`[ActivitySyncTaskWorker] Skipping pending COROS status poll for item ${queueItemId} because the account is deleted or deleting.`);
                    break;
                }
                const pollDelaySeconds = getProviderStatusPollDelaySeconds(processingQueueItem.retryCount);
                const taskEnqueued = await enqueueActivitySyncTask(
                    queueItemId,
                    Date.now(),
                    pollDelaySeconds,
                );
                logger.info('[ActivitySyncTaskWorker] COROS activity upload is still processing; status poll is scheduled.', {
                    queueItemId,
                    destinationServiceName: processingQueueItem.destinationServiceName,
                    providerStatus: 1,
                    pollDelaySeconds,
                    retryCount: processingQueueItem.retryCount,
                    taskEnqueued,
                });
                break;
            }
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
