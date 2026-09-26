import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { performance } from 'node:perf_hooks';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';
import { QueueResult } from '../queue-utils';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from '../sleep/constants';
import { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import { processSleepSyncQueueItem } from '../sleep/queue';
import { isQueueItemDeletedForUserCleanup } from '../queue/cleanup-tombstone';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import { isCurrentSleepQueueRevision } from '../sleep/queue-revision';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import { isGarminSupportedSummaryType } from '../garmin/health-summary-types';
import { SleepSyncQueueItemType } from '../queue/queue-item.interface';

interface SleepSyncTaskPayload {
    queueItemId: string;
    queueRevision?: string;
    queueDateCreated?: number;
}

const TELEMETRY_QUEUE_TYPES = new Set<SleepSyncQueueItemType>([
    'garmin_push',
    'garmin_ping',
    'garmin_ping_batch',
    'suunto_webhook',
    'suunto_poll',
    'suunto_health_poll',
    'garmin_health_backfill',
    'coros_poll',
]);

function safeWorkloadFields(queueItem: SleepSyncQueueItemInterface | undefined) {
    const provider = queueItem?.provider === SLEEP_PROVIDERS.GarminAPI
        ? SLEEP_PROVIDERS.GarminAPI
        : queueItem?.provider === SLEEP_PROVIDERS.SuuntoApp
            ? SLEEP_PROVIDERS.SuuntoApp
            : queueItem?.provider === SLEEP_PROVIDERS.COROSAPI
                ? SLEEP_PROVIDERS.COROSAPI
                : 'unknown';
    const queueType = queueItem && TELEMETRY_QUEUE_TYPES.has(queueItem.type)
        ? queueItem.type
        : 'unknown';
    const isGarminPing = provider === 'GarminAPI'
        && (queueType === 'garmin_ping' || queueType === 'garmin_ping_batch');
    const effectiveGarminSummaryType = queueItem?.garminSummaryType || 'sleeps';
    const garminSummaryType = isGarminPing
        ? isGarminSupportedSummaryType(effectiveGarminSummaryType)
            ? effectiveGarminSummaryType
            : 'unknown'
        : 'none';
    return {
        provider,
        queueType,
        healthTrigger: provider === SLEEP_PROVIDERS.SuuntoApp
            && queueType === 'suunto_health_poll'
            && (queueItem?.healthTrigger === 'poll'
                || queueItem?.healthTrigger === 'webhook'
                || queueItem?.healthTrigger === 'backfill')
            ? queueItem.healthTrigger
            : 'none',
        garminSummaryType,
    };
}

export const processSleepSyncTask = onTaskDispatched({
    retryConfig: CLOUD_TASK_RETRY_CONFIG,
    secrets: FUNCTION_SECRET_BINDINGS.processSleepSyncTask,
    memory: '1GiB',
    timeoutSeconds: 540,
    region: 'europe-west2',
}, async (request) => {
    const startedAtMs = performance.now();
    let queueItem: SleepSyncQueueItemInterface | undefined;
    let outcome = 'error';
    try {
        const { queueItemId, queueRevision, queueDateCreated } = request.data as SleepSyncTaskPayload;

        const queueRef = admin.firestore().collection(SLEEP_SYNC_QUEUE_COLLECTION_NAME).doc(queueItemId);
        const queueDoc = await queueRef.get();

        if (!queueDoc.exists) {
            const failedJobDoc = await admin.firestore().collection('failed_jobs').doc(queueItemId).get();
            if (failedJobDoc.exists) {
                outcome = 'already_failed';
                logger.warn(`[SleepSyncTaskWorker] Queue item ${queueItemId} not found but exists in failed_jobs. Stopping retry.`);
                return;
            }
            if (await isQueueItemDeletedForUserCleanup(SLEEP_SYNC_QUEUE_COLLECTION_NAME, queueItemId)) {
                outcome = 'deleted_for_cleanup';
                logger.warn(`[SleepSyncTaskWorker] Queue item ${queueItemId} was deleted during queue cleanup. Stopping retry.`);
                return;
            }
            outcome = 'missing';
            throw new Error(`[SleepSyncTaskWorker] Queue item ${queueItemId} not found in ${SLEEP_SYNC_QUEUE_COLLECTION_NAME}`);
        }

        queueItem = queueDoc.data() as SleepSyncQueueItemInterface | undefined;
        const hasBoundIdentity = typeof queueRevision === 'string' && queueRevision.trim().length > 0
            || Number.isFinite(Number(queueDateCreated));
        if (queueItem && hasBoundIdentity && !isCurrentSleepQueueRevision(queueItem, {
            queueRevision,
            dateCreated: Number(queueDateCreated),
        })) {
            outcome = 'stale_revision';
            logger.info(`[SleepSyncTaskWorker] Task identity for ${queueItemId} is stale; leaving the replacement revision queued.`);
            return;
        }
        if (queueItem?.processed) {
            outcome = 'already_processed';
            logger.info(`[SleepSyncTaskWorker] Item ${queueItemId} already processed, skipping.`);
            return;
        }
        if (queueItem?.type === 'garmin_health_backfill') {
            outcome = 'wrong_worker';
            logger.warn(`[SleepSyncTaskWorker] Item ${queueItemId} belongs to the dedicated Garmin Health backfill worker.`);
            return;
        }

        const result = await processSleepSyncQueueItem(Object.assign({
            id: queueDoc.id,
            ref: queueDoc.ref,
        }, queueItem) as SleepSyncQueueItemInterface);

        switch (result) {
            case QueueResult.Processed:
                outcome = 'processed';
                return;
            case QueueResult.Deferred:
                outcome = 'deferred';
                logger.warn(`[SleepSyncTaskWorker] Deferred item ${queueItemId}; it remains queued for a future dispatcher run.`);
                return;
            case QueueResult.MovedToDLQ:
                outcome = 'moved_to_dlq';
                logger.warn(`[SleepSyncTaskWorker] Item ${queueItemId} was moved to DLQ.`);
                return;
            case QueueResult.RetryIncremented:
                outcome = 'retry_incremented';
                throw new Error(`Item ${queueItemId} failed and was scheduled for retry.`);
            case QueueResult.Failed:
                outcome = 'failed';
                throw new Error(`Fatal failure updating sleep sync item ${queueItemId}`);
            default:
                throw new Error(`Unexpected result for sleep sync item ${queueItemId}: ${result}`);
        }
    } finally {
        try {
            logger.info('[SleepSyncTaskWorker] Invocation summary', {
                ...safeWorkloadFields(queueItem),
                outcome,
                durationMs: Math.max(0, Math.round(performance.now() - startedAtMs)),
            });
        } catch {
            // Cost telemetry must not change task acknowledgement or retries.
        }
    }
});
