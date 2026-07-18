import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { enqueueWorkoutTask } from '../shared/cloud-tasks';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import { getUserDeletionGuardStateInTransaction, UserDeletionGuardReadError } from '../shared/user-deletion-guard';
import { updateQueueItemIfUserActive, QueueItemUserGuardedUpdateResult } from '../queue/dispatch-marker';
import { WahooAPIWorkoutQueueItemInterface } from '../queue/queue-item.interface';
import { SERVICE_NAME, WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME } from './constants';

export type WahooQueueDispatchMode = 'immediate' | 'deferred';

function revisionTime(value: unknown): number {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function upsertWahooWorkoutQueueItem(
  input: Omit<WahooAPIWorkoutQueueItemInterface, 'id' | 'dateCreated' | 'processed' | 'retryCount' | 'dispatchedToCloudTask'> & { id: string },
  dispatchMode: WahooQueueDispatchMode,
): Promise<{ ref: admin.firestore.DocumentReference; queued: boolean }> {
  const db = admin.firestore();
  const ref = db.collection(WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME).doc(input.id);
  const now = Date.now();
  const result = await db.runTransaction(async (transaction) => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, input.firebaseUserID!);
    } catch (error) {
      throw new UserDeletionGuardReadError(input.firebaseUserID!, 'wahoo_queue_upsert', error);
    }
    if (deletionGuard.shouldSkip) return { queued: false, dateCreated: now };

    const existingSnapshot = await transaction.get(ref);
    const existing = existingSnapshot.exists ? existingSnapshot.data() as Partial<WahooAPIWorkoutQueueItemInterface> : null;
    const incomingRevision = revisionTime(input.summaryUpdatedAt);
    const existingRevision = revisionTime(existing?.summaryUpdatedAt);
    if (existing && incomingRevision <= existingRevision) {
      if ((existing as Record<string, unknown>).processed !== true && existing.FITFileURI !== input.FITFileURI) {
        transaction.update(ref, { FITFileURI: input.FITFileURI });
      }
      return { queued: false, dateCreated: Number(existing.dateCreated || now) };
    }

    transaction.set(ref, {
      ...input,
      dateCreated: now,
      processed: false,
      retryCount: 0,
      totalRetryCount: 0,
      dispatchedToCloudTask: null,
      expireAt: getExpireAtTimestamp(TTL_CONFIG.QUEUE_ITEM_IN_DAYS),
    });
    return { queued: true, dateCreated: now };
  });

  if (!result.queued || dispatchMode === 'deferred') return { ref, queued: result.queued };

  const taskCreated = await enqueueWorkoutTask(SERVICE_NAME, input.id, result.dateCreated);
  if (!taskCreated) {
    logger.warn('Wahoo queue item remains available for scheduled dispatch', { queueItemId: input.id });
    return { ref, queued: true };
  }
  const markerResult = await updateQueueItemIfUserActive({
    queueItemDocument: ref,
    queueItemId: input.id,
    userID: input.firebaseUserID!,
    phase: 'wahoo_queue_dispatch_marker',
    updateData: { dispatchedToCloudTask: Date.now() },
    logPrefix: 'WahooQueue',
    actionDescription: 'Cloud Task dispatch marker',
  });
  return { ref, queued: markerResult === QueueItemUserGuardedUpdateResult.Updated };
}
