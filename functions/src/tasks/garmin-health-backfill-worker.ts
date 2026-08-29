import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import { isQueueItemDeletedForUserCleanup } from '../queue/cleanup-tombstone';
import { QueueResult } from '../queue-utils';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import {
  CLOUD_TASK_RETRY_CONFIG,
  GARMIN_HEALTH_BACKFILL_TASK_TIMEOUT_SECONDS,
} from '../shared/queue-config';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from '../sleep/constants';
import { isCurrentSleepQueueRevision } from '../sleep/queue-revision';
import { processGarminHealthBackfillQueueItem } from '../garmin/health-backfill';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';

interface GarminHealthBackfillTaskPayload {
  queueItemId: string;
  queueRevision?: string;
  queueDateCreated?: number;
}

export const processGarminHealthBackfillTask = onTaskDispatched({
  retryConfig: CLOUD_TASK_RETRY_CONFIG,
  rateLimits: {
    maxConcurrentDispatches: 1,
    maxDispatchesPerSecond: 1,
  },
  secrets: FUNCTION_SECRET_BINDINGS.processGarminHealthBackfillTask,
  memory: '512MiB',
  timeoutSeconds: GARMIN_HEALTH_BACKFILL_TASK_TIMEOUT_SECONDS,
  region: FUNCTIONS_MANIFEST.processGarminHealthBackfillTask.region,
}, async request => {
  const { queueItemId, queueRevision, queueDateCreated } = (
    request.data as unknown as GarminHealthBackfillTaskPayload
  );
  if (typeof queueItemId !== 'string' || !queueItemId.trim()) {
    throw new Error('[GarminHealthBackfillTaskWorker] Missing queue item id.');
  }

  const db = admin.firestore();
  const queueRef = db.collection(SLEEP_SYNC_QUEUE_COLLECTION_NAME).doc(queueItemId);
  const queueDoc = await queueRef.get();
  if (!queueDoc.exists) {
    const failedJobDoc = await db.collection('failed_jobs').doc(queueItemId).get();
    if (failedJobDoc.exists
      || await isQueueItemDeletedForUserCleanup(
        SLEEP_SYNC_QUEUE_COLLECTION_NAME,
        queueItemId,
      )) {
      logger.info(`[GarminHealthBackfillTaskWorker] Queue item ${queueItemId} already reached a terminal state.`);
      return;
    }
    throw new Error(`[GarminHealthBackfillTaskWorker] Queue item ${queueItemId} is missing.`);
  }

  const queueItem = queueDoc.data() as SleepSyncQueueItemInterface | undefined;
  const hasBoundIdentity = typeof queueRevision === 'string' && queueRevision.trim().length > 0
    || Number.isFinite(Number(queueDateCreated));
  if (queueItem && hasBoundIdentity && !isCurrentSleepQueueRevision(queueItem, {
    queueRevision,
    dateCreated: Number(queueDateCreated),
  })) {
    logger.info(`[GarminHealthBackfillTaskWorker] Task identity for ${queueItemId} is stale.`);
    return;
  }
  if (queueItem?.processed) return;
  if (queueItem?.type !== 'garmin_health_backfill') {
    logger.warn(`[GarminHealthBackfillTaskWorker] Queue item ${queueItemId} belongs to the ordinary Sleep worker.`);
    return;
  }

  const result = await processGarminHealthBackfillQueueItem(Object.assign({
    id: queueDoc.id,
    ref: queueDoc.ref,
  }, queueItem) as SleepSyncQueueItemInterface);

  switch (result) {
    case QueueResult.Processed:
    case QueueResult.MovedToDLQ:
      return;
    case QueueResult.RetryIncremented:
      throw new Error(`Garmin Health backfill item ${queueItemId} was scheduled for retry.`);
    case QueueResult.Failed:
      throw new Error(`Garmin Health backfill item ${queueItemId} could not persist its transition.`);
    default:
      throw new Error(`Unexpected Garmin Health backfill result for ${queueItemId}: ${result}`);
  }
});
