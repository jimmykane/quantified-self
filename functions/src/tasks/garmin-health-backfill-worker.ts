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
import { performance } from 'node:perf_hooks';
import { healthSleepWorkloadFields, healthSleepFailureOutcome } from '../sleep/monitoring';

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
  const started = performance.now();
  let item: SleepSyncQueueItemInterface | undefined;
  let outcome = 'error';
  try {
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
        outcome = failedJobDoc.exists ? 'already_failed' : 'deleted_for_cleanup';
        logger.info(`[GarminHealthBackfillTaskWorker] Queue item ${queueItemId} already reached a terminal state.`);
        return;
      }
      throw new Error(`[GarminHealthBackfillTaskWorker] Queue item ${queueItemId} is missing.`);
    }

    const queueItem = queueDoc.data() as SleepSyncQueueItemInterface | undefined;
    item = queueItem;
    const hasBoundIdentity = typeof queueRevision === 'string' && queueRevision.trim().length > 0
      || Number.isFinite(Number(queueDateCreated));
    if (queueItem && hasBoundIdentity && !isCurrentSleepQueueRevision(queueItem, {
      queueRevision,
      dateCreated: Number(queueDateCreated),
    })) {
      outcome = 'stale_revision';
      logger.info(`[GarminHealthBackfillTaskWorker] Task identity for ${queueItemId} is stale.`);
      return;
    }
    if (queueItem?.processed) { outcome = 'already_processed'; return; }
    if (queueItem?.type !== 'garmin_health_backfill') {
      outcome = 'wrong_worker';
      logger.warn(`[GarminHealthBackfillTaskWorker] Queue item ${queueItemId} belongs to the ordinary Sleep worker.`);
      return;
    }

    const result = await processGarminHealthBackfillQueueItem(Object.assign({
      id: queueDoc.id,
      ref: queueDoc.ref,
    }, queueItem) as SleepSyncQueueItemInterface);

    switch (result) {
      case QueueResult.Processed:
        outcome = 'processed';
        return;
      case QueueResult.MovedToDLQ:
        outcome = 'moved_to_dlq';
        return;
      case QueueResult.RetryIncremented:
        outcome = 'retry_incremented';
        throw new Error(`Garmin Health backfill item ${queueItemId} was scheduled for retry.`);
      case QueueResult.Failed:
        outcome = 'failed';
        throw new Error(`Garmin Health backfill item ${queueItemId} could not persist its transition.`);
      default:
        throw new Error(`Unexpected Garmin Health backfill result for ${queueItemId}: ${result}`);
    }
  } catch (error) {
    if (outcome === 'error') outcome = healthSleepFailureOutcome(error);
    throw error;
  } finally {
    try {
      logger.info('[GarminHealthBackfillTaskWorker] Invocation summary', {
        telemetryVersion: 1, ...healthSleepWorkloadFields(item), workload: 'garmin_health_backfill',
        outcome, durationMs: Math.max(0, Math.round(performance.now() - started)),
      });
    } catch { /* Telemetry cannot change acknowledgement or retry behavior. */ }
  }
});
