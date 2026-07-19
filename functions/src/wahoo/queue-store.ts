import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { enqueueWorkoutTask } from '../shared/cloud-tasks';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import { MAX_RETRY_COUNT } from '../shared/queue-config';
import { getUserDeletionGuardStateInTransaction, UserDeletionGuardReadError } from '../shared/user-deletion-guard';
import { updateQueueItemIfUserActive, QueueItemUserGuardedUpdateResult } from '../queue/dispatch-marker';
import { WahooAPIWorkoutQueueItemInterface } from '../queue/queue-item.interface';
import { QueueResult } from '../queue-utils';
import { SERVICE_NAME, WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME } from './constants';

export type WahooQueueDispatchMode = 'immediate' | 'deferred';
export type WahooQueueClaimResult = 'claimed' | 'superseded';

const PROCESSING_LEASE_MS = 10 * 60 * 1000;

export class WahooQueueRevisionBusyError extends Error {
  constructor(queueItemID: string) {
    super(`Wahoo queue item ${queueItemID} is already being processed.`);
    this.name = 'WahooQueueRevisionBusyError';
  }
}

function revisionTime(value: unknown): number {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasSameRevision(
  current: Partial<WahooAPIWorkoutQueueItemInterface>,
  queueItem: Pick<WahooAPIWorkoutQueueItemInterface, 'workoutSummaryID' | 'summaryUpdatedAt'>,
): boolean {
  return current.workoutSummaryID === queueItem.workoutSummaryID
    && current.summaryUpdatedAt === queueItem.summaryUpdatedAt;
}

function isNewerRevision(
  existing: Partial<WahooAPIWorkoutQueueItemInterface>,
  incoming: Pick<WahooAPIWorkoutQueueItemInterface, 'workoutSummaryID' | 'summaryUpdatedAt'>,
): boolean {
  const incomingRevision = revisionTime(incoming.summaryUpdatedAt);
  const existingRevision = revisionTime(existing.summaryUpdatedAt);
  const existingSummaryID = `${existing.workoutSummaryID || ''}`.trim();
  const incomingSummaryID = `${incoming.workoutSummaryID || ''}`.trim();
  return incomingRevision > existingRevision
    || (incomingRevision === existingRevision
      && existingSummaryID.length > 0
      && incomingSummaryID.length > 0
      && existingSummaryID !== incomingSummaryID);
}

function processingLeaseFields(
  existing: Partial<WahooAPIWorkoutQueueItemInterface> | null,
  now: number,
): Pick<WahooAPIWorkoutQueueItemInterface, 'processingOwner' | 'processingRevision' | 'processingLeaseExpiresAt'> | Record<string, never> {
  const processingOwner = `${existing?.processingOwner || ''}`.trim();
  const processingRevision = `${existing?.processingRevision || ''}`.trim();
  const processingLeaseExpiresAt = Number(existing?.processingLeaseExpiresAt || 0);
  if (!processingOwner || !processingRevision || processingLeaseExpiresAt <= now) return {};
  return { processingOwner, processingRevision, processingLeaseExpiresAt };
}

function clearProcessingLeaseUpdate(): Record<string, admin.firestore.FieldValue> {
  return {
    processingOwner: admin.firestore.FieldValue.delete(),
    processingRevision: admin.firestore.FieldValue.delete(),
    processingLeaseExpiresAt: admin.firestore.FieldValue.delete(),
  };
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
    if (existing && !isNewerRevision(existing, input)) {
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
      ...processingLeaseFields(existing, now),
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

export async function claimWahooWorkoutQueueRevision(
  queueItem: WahooAPIWorkoutQueueItemInterface,
  processingOwner: string,
): Promise<WahooQueueClaimResult> {
  if (!queueItem.ref) throw new Error(`No document reference supplied for Wahoo queue item ${queueItem.id}`);
  const now = Date.now();
  return admin.firestore().runTransaction(async (transaction) => {
    const deletionGuard = await getUserDeletionGuardStateInTransaction(
      admin.firestore(),
      transaction,
      queueItem.firebaseUserID!,
      now,
    );
    if (deletionGuard.shouldSkip) return 'superseded';
    const snapshot = await transaction.get(queueItem.ref!);
    if (!snapshot.exists || !hasSameRevision(snapshot.data() || {}, queueItem)) return 'superseded';

    const current = snapshot.data() as Partial<WahooAPIWorkoutQueueItemInterface>;
    const activeOwner = `${current.processingOwner || ''}`.trim();
    const leaseExpiresAt = Number(current.processingLeaseExpiresAt || 0);
    if (activeOwner && activeOwner !== processingOwner && leaseExpiresAt > now) {
      throw new WahooQueueRevisionBusyError(queueItem.id);
    }

    transaction.update(queueItem.ref!, {
      processingOwner,
      processingRevision: queueItem.summaryUpdatedAt,
      processingLeaseExpiresAt: now + PROCESSING_LEASE_MS,
    });
    return 'claimed';
  });
}

export async function isClaimedWahooWorkoutQueueRevisionCurrent(
  queueItem: WahooAPIWorkoutQueueItemInterface,
  processingOwner: string,
): Promise<boolean> {
  if (!queueItem.ref) return false;
  const snapshot = await queueItem.ref.get();
  if (!snapshot.exists) return false;
  const current = snapshot.data() as Partial<WahooAPIWorkoutQueueItemInterface>;
  return hasSameRevision(current, queueItem) && current.processingOwner === processingOwner;
}

export async function completeWahooWorkoutQueueRevision(
  queueItem: WahooAPIWorkoutQueueItemInterface,
  processingOwner: string,
  additionalData: Record<string, unknown> = {},
): Promise<QueueResult.Processed> {
  if (!queueItem.ref) throw new Error(`No document reference supplied for Wahoo queue item ${queueItem.id}`);
  const now = Date.now();
  await admin.firestore().runTransaction(async (transaction) => {
    const deletionGuard = await getUserDeletionGuardStateInTransaction(
      admin.firestore(),
      transaction,
      queueItem.firebaseUserID!,
      now,
    );
    if (deletionGuard.shouldSkip) return;
    const snapshot = await transaction.get(queueItem.ref!);
    if (!snapshot.exists) return;
    const current = snapshot.data() as Partial<WahooAPIWorkoutQueueItemInterface>;
    if (current.processingOwner !== processingOwner) return;

    if (hasSameRevision(current, queueItem)) {
      transaction.update(queueItem.ref!, {
        processed: true,
        processedAt: now,
        ...additionalData,
        ...clearProcessingLeaseUpdate(),
      });
      return;
    }

    // A newer summary arrived while this worker held the lease. Release it and
    // make that revision dispatchable; the older worker must not complete it.
    transaction.update(queueItem.ref!, {
      processed: false,
      dispatchedToCloudTask: null,
      ...clearProcessingLeaseUpdate(),
    });
  });
  return QueueResult.Processed;
}

export async function failWahooWorkoutQueueRevision(
  queueItem: WahooAPIWorkoutQueueItemInterface,
  processingOwner: string,
  error: Error,
): Promise<QueueResult.Processed | QueueResult.RetryIncremented | QueueResult.MovedToDLQ | QueueResult.Failed> {
  if (!queueItem.ref) throw new Error(`No document reference supplied for Wahoo queue item ${queueItem.id}`);
  try {
    return await admin.firestore().runTransaction(async (transaction) => {
      const deletionGuard = await getUserDeletionGuardStateInTransaction(
        admin.firestore(),
        transaction,
        queueItem.firebaseUserID!,
      );
      if (deletionGuard.shouldSkip) return QueueResult.Processed;
      const snapshot = await transaction.get(queueItem.ref!);
      if (!snapshot.exists) return QueueResult.Processed;
      const current = snapshot.data() as WahooAPIWorkoutQueueItemInterface;
      if (current.processingOwner !== processingOwner) return QueueResult.Processed;

      if (!hasSameRevision(current, queueItem)) {
        transaction.update(queueItem.ref!, {
          processed: false,
          dispatchedToCloudTask: null,
          ...clearProcessingLeaseUpdate(),
        });
        return QueueResult.Processed;
      }

      const retryCount = Number(current.retryCount || 0) + 1;
      const totalRetryCount = Number(current.totalRetryCount || 0) + 1;
      const errors = [...(Array.isArray(current.errors) ? current.errors : []), {
        error: error.message,
        atRetryCount: totalRetryCount,
        date: Date.now(),
      }];
      if (retryCount >= MAX_RETRY_COUNT) {
        const failedItem: Record<string, unknown> = {
          ...current,
          error: error.message,
          errors,
          failedAt: Date.now(),
          originalCollection: WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME,
          context: 'MAX_RETRY_REACHED',
          expireAt: getExpireAtTimestamp(TTL_CONFIG.FAILED_JOBS_IN_DAYS),
        };
        delete failedItem.processingOwner;
        delete failedItem.processingRevision;
        delete failedItem.processingLeaseExpiresAt;
        transaction.set(admin.firestore().collection('failed_jobs').doc(queueItem.id), failedItem);
        transaction.delete(queueItem.ref!);
        return QueueResult.MovedToDLQ;
      }

      transaction.update(queueItem.ref!, {
        retryCount,
        totalRetryCount,
        errors,
        dispatchedToCloudTask: null,
        ...clearProcessingLeaseUpdate(),
      });
      return QueueResult.RetryIncremented;
    });
  } catch (transactionError) {
    logger.error(`Could not update Wahoo retry state for ${queueItem.id}`, transactionError);
    return QueueResult.Failed;
  }
}
