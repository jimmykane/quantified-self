import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as logger from 'firebase-functions/logger';
import {
  enqueueWorkoutTaskWithDispatchRecovery,
  markWorkoutTaskDispatchedWithRetry,
} from '../shared/cloud-tasks';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import { MAX_RETRY_COUNT } from '../shared/queue-config';
import { getUserDeletionGuardStateInTransaction, UserDeletionGuardReadError } from '../shared/user-deletion-guard';
import {
  markQueueItemDeletedForUserCleanup,
  QUEUE_CLEANUP_TOMBSTONE_REASONS,
} from '../queue/cleanup-tombstone';
import { updateQueueItemIfUserActive, QueueItemUserGuardedUpdateResult } from '../queue/dispatch-marker';
import { WahooAPIWorkoutQueueItemInterface } from '../queue/queue-item.interface';
import { QueueResult } from '../queue-utils';
import type { EventWriteTransactionGuard } from '../utils';
import {
  SERVICE_NAME,
  WAHOO_API_USER_MAPPINGS_COLLECTION_NAME,
  WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME,
} from './constants';

export type WahooQueueDispatchMode = 'immediate' | 'deferred';
export type WahooQueueClaimResult = 'claimed' | 'superseded' | 'busy';

export interface WahooEventWriteOwnershipFence {
  firebaseUserID: string;
  wahooUserID: string;
  ownershipVersion: number;
}

interface WahooEventPublicationLease {
  leaseID: string;
  expiresAt: number;
}

export interface WahooEventPublicationFence extends WahooEventWriteOwnershipFence {
  publicationLease: WahooEventPublicationLease;
}

const PROCESSING_LEASE_MS = 10 * 60 * 1000;
// The task worker is limited to nine minutes. Keep the publication lease
// longer so an ownership transfer cannot overtake a still-running worker.
const EVENT_PUBLICATION_LEASE_MS = 10 * 60 * 1000;

function revisionTime(value: unknown): number {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function ownershipVersion(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function getActiveEventPublicationLeases(
  value: unknown,
  now: number = Date.now(),
): WahooEventPublicationLease[] {
  if (!Array.isArray(value)) return [];

  const leaseIDs = new Set<string>();
  return value.flatMap((candidate): WahooEventPublicationLease[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const record = candidate as Record<string, unknown>;
    const leaseID = `${record.leaseID || ''}`.trim();
    const expiresAt = Number(record.expiresAt);
    if (!leaseID || !Number.isFinite(expiresAt) || expiresAt <= now || leaseIDs.has(leaseID)) {
      return [];
    }
    leaseIDs.add(leaseID);
    return [{ leaseID, expiresAt }];
  });
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

function clearProcessingLeaseUpdate(): Record<string, admin.firestore.FieldValue> {
  return {
    processingOwner: admin.firestore.FieldValue.delete(),
    processingRevision: admin.firestore.FieldValue.delete(),
    processingLeaseExpiresAt: admin.firestore.FieldValue.delete(),
  };
}

function wahooDispatchRecoveryGeneration(
  queueItem: Pick<WahooAPIWorkoutQueueItemInterface, 'dispatchRecoveryGeneration'>,
): number {
  return typeof queueItem.dispatchRecoveryGeneration === 'number' && Number.isFinite(queueItem.dispatchRecoveryGeneration)
    ? Math.max(0, Math.floor(queueItem.dispatchRecoveryGeneration))
    : 0;
}

async function deleteWahooWorkoutQueueItemBeforeDispatch(
  queueItemDocument: admin.firestore.DocumentReference,
  queueItemID: string,
): Promise<void> {
  try {
    const tombstoneWritten = await markQueueItemDeletedForUserCleanup(
      WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME,
      queueItemID,
      QUEUE_CLEANUP_TOMBSTONE_REASONS.UserDeletionGuard,
    );
    if (!tombstoneWritten) {
      logger.error(`Failed to write cleanup tombstone for Wahoo queue item ${queueItemID}; leaving item in place to avoid missing-doc Cloud Task retries.`);
      return;
    }
    await admin.firestore().recursiveDelete(queueItemDocument);
    logger.info(`Deleted Wahoo queue item ${queueItemID} before dispatch recovery because the owning user is missing or deletion is in progress.`);
  } catch (error) {
    logger.error(`Failed to delete Wahoo queue item ${queueItemID} before dispatch recovery after the user deletion guard tripped.`, error);
  }
}

async function advanceWahooWorkoutQueueDispatchRecoveryGeneration(
  queueItemDocument: admin.firestore.DocumentReference,
  queueItem: WahooAPIWorkoutQueueItemInterface,
): Promise<WahooAPIWorkoutQueueItemInterface | null> {
  const db = admin.firestore();
  const attemptedGeneration = wahooDispatchRecoveryGeneration(queueItem);
  const result = await db.runTransaction(async (transaction) => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, queueItem.firebaseUserID!);
    } catch (error) {
      throw new UserDeletionGuardReadError(queueItem.firebaseUserID!, 'wahoo_queue_dispatch_recovery_generation', error);
    }
    if (deletionGuard.shouldSkip) return { status: 'skipped_deleted_user' as const };

    const snapshot = await transaction.get(queueItemDocument);
    if (!snapshot.exists) return { status: 'not_current' as const };
    const current = snapshot.data() as Partial<WahooAPIWorkoutQueueItemInterface>;
    if (!hasSameRevision(current, queueItem)
      || (current as { processed?: boolean }).processed === true
      || current.dispatchedToCloudTask !== null && current.dispatchedToCloudTask !== undefined) {
      return { status: 'not_current' as const };
    }

    const currentGeneration = wahooDispatchRecoveryGeneration(current as WahooAPIWorkoutQueueItemInterface);
    if (currentGeneration > attemptedGeneration) {
      return {
        status: 'advanced' as const,
        queueItem: Object.assign({}, queueItem, current, { id: queueItem.id, ref: queueItemDocument }) as WahooAPIWorkoutQueueItemInterface,
      };
    }

    const nextGeneration = Math.max(currentGeneration, attemptedGeneration) + 1;
    transaction.update(queueItemDocument, { dispatchRecoveryGeneration: nextGeneration });
    return {
      status: 'advanced' as const,
      queueItem: Object.assign({}, queueItem, current, {
        id: queueItem.id,
        ref: queueItemDocument,
        dispatchRecoveryGeneration: nextGeneration,
      }) as WahooAPIWorkoutQueueItemInterface,
    };
  });

  if (result.status === 'skipped_deleted_user') {
    await deleteWahooWorkoutQueueItemBeforeDispatch(queueItemDocument, queueItem.id);
    return null;
  }
  if (result.status === 'not_current') return null;
  return result.queueItem;
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

    // A newer summary supersedes any in-flight worker for the older revision.
    // `set` replaces the document, intentionally clearing its processing lease
    // so the task for this latest revision can claim it immediately.
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

  const queueItemForDispatch = {
    ...input,
    ref,
    dateCreated: result.dateCreated,
    processed: false,
    retryCount: 0,
    totalRetryCount: 0,
    dispatchedToCloudTask: null,
  } as WahooAPIWorkoutQueueItemInterface;
  const taskCreated = await enqueueWorkoutTaskWithDispatchRecovery({
    serviceName: SERVICE_NAME,
    queueItem: queueItemForDispatch,
    advanceDispatchRecoveryGeneration: (queueItem) => advanceWahooWorkoutQueueDispatchRecoveryGeneration(ref, queueItem),
  });
  if (!taskCreated) {
    logger.warn('Wahoo queue item remains available for scheduled dispatch', { queueItemId: input.id });
    return { ref, queued: true };
  }
  const markerWritten = await markWorkoutTaskDispatchedWithRetry({
    serviceName: SERVICE_NAME,
    queueItemId: input.id,
    markDispatched: async () => (await updateQueueItemIfUserActive({
      queueItemDocument: ref,
      queueItemId: input.id,
      userID: input.firebaseUserID!,
      phase: 'wahoo_queue_dispatch_marker',
      updateData: { dispatchedToCloudTask: Date.now() },
      logPrefix: 'WahooQueue',
      actionDescription: 'Cloud Task dispatch marker',
      isCurrent: (current) => current.processed !== true
        && current.dispatchedToCloudTask === null
        && hasSameRevision(current as Partial<WahooAPIWorkoutQueueItemInterface>, queueItemForDispatch),
    })) === QueueItemUserGuardedUpdateResult.Updated,
  });
  return { ref, queued: markerWritten };
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
      return 'busy';
    }

    transaction.update(queueItem.ref!, {
      processingOwner,
      processingRevision: queueItem.summaryUpdatedAt,
      processingLeaseExpiresAt: now + PROCESSING_LEASE_MS,
    });
    return 'claimed';
  });
}

export async function getClaimedWahooWorkoutQueueRevisionEventWriteFence(
  queueItem: WahooAPIWorkoutQueueItemInterface,
  processingOwner: string,
): Promise<WahooEventWriteOwnershipFence | null> {
  if (!queueItem.ref) return null;
  const db = admin.firestore();
  const mappingRef = db.collection(WAHOO_API_USER_MAPPINGS_COLLECTION_NAME).doc(queueItem.wahooUserID);
  return db.runTransaction(async (transaction) => {
    const [snapshot, mappingSnapshot] = await Promise.all([
      transaction.get(queueItem.ref!),
      transaction.get(mappingRef),
    ]);
    if (!snapshot.exists || !mappingSnapshot.exists) return null;
    const current = snapshot.data() as Partial<WahooAPIWorkoutQueueItemInterface>;
    const currentOwner = `${mappingSnapshot.data()?.firebaseUserID || ''}`.trim();
    const firebaseUserID = `${queueItem.firebaseUserID || ''}`.trim();
    if (!hasSameRevision(current, queueItem)
      || current.processingOwner !== processingOwner
      || currentOwner !== firebaseUserID) {
      return null;
    }
    return {
      firebaseUserID,
      wahooUserID: queueItem.wahooUserID,
      ownershipVersion: ownershipVersion(mappingSnapshot.data()?.ownershipVersion),
    };
  });
}

/**
 * Makes a Wahoo event publication mutually exclusive with an ownership
 * transfer. OAuth transfers read and honor the same mapping document, so the
 * transaction that creates this lease conflicts with a competing transfer.
 */
export async function acquireWahooEventPublicationLease(
  fence: WahooEventWriteOwnershipFence,
): Promise<WahooEventPublicationFence | null> {
  const db = admin.firestore();
  const mappingRef = db.collection(WAHOO_API_USER_MAPPINGS_COLLECTION_NAME).doc(fence.wahooUserID);
  const now = Date.now();
  const publicationLease: WahooEventPublicationLease = {
    leaseID: crypto.randomUUID(),
    expiresAt: now + EVENT_PUBLICATION_LEASE_MS,
  };

  return db.runTransaction(async (transaction) => {
    const mappingSnapshot = await transaction.get(mappingRef);
    if (!mappingSnapshot.exists) return null;

    const currentMapping = mappingSnapshot.data();
    const isCurrentOwner = `${currentMapping?.firebaseUserID || ''}`.trim() === fence.firebaseUserID
      && ownershipVersion(currentMapping?.ownershipVersion) === fence.ownershipVersion;
    if (!isCurrentOwner) return null;

    const activeLeases = getActiveEventPublicationLeases(
      currentMapping?.eventPublicationLeases,
      now,
    );
    transaction.update(mappingRef, {
      eventPublicationLeases: [...activeLeases, publicationLease],
    });
    return {
      ...fence,
      publicationLease,
    };
  });
}

export async function releaseWahooEventPublicationLease(
  fence: WahooEventPublicationFence,
): Promise<void> {
  const db = admin.firestore();
  const mappingRef = db.collection(WAHOO_API_USER_MAPPINGS_COLLECTION_NAME).doc(fence.wahooUserID);
  await db.runTransaction(async (transaction) => {
    const mappingSnapshot = await transaction.get(mappingRef);
    if (!mappingSnapshot.exists) return;

    const currentMapping = mappingSnapshot.data();
    const isCurrentOwner = `${currentMapping?.firebaseUserID || ''}`.trim() === fence.firebaseUserID
      && ownershipVersion(currentMapping?.ownershipVersion) === fence.ownershipVersion;
    if (!isCurrentOwner) return;

    const remainingLeases = getActiveEventPublicationLeases(currentMapping?.eventPublicationLeases)
      .filter(({ leaseID }) => leaseID !== fence.publicationLease.leaseID);
    transaction.update(mappingRef, {
      eventPublicationLeases: remainingLeases.length > 0
        ? remainingLeases
        : admin.firestore.FieldValue.delete(),
    });
  });
}

/**
 * Event documents own a metadata subtree, while activities are stored in a
 * sibling collection. Both roots must be recursively removed if a Wahoo
 * ownership fence rejects after any individual write has committed.
 */
export async function cleanupWahooPartialEventPersistence(
  userID: string,
  eventID: string,
): Promise<void> {
  const db = admin.firestore();
  const eventRef = db.collection('users').doc(userID).collection('events').doc(eventID);
  const activitiesSnapshot = await db
    .collection('users')
    .doc(userID)
    .collection('activities')
    .where('eventID', '==', eventID)
    .get();

  await Promise.all([
    db.recursiveDelete(eventRef),
    ...activitiesSnapshot.docs.map((activity) => db.recursiveDelete(activity.ref)),
  ]);
}

/**
 * Every event/activity document write reads this same mapping in its own
 * write transaction. A concurrent OAuth ownership transfer writes the mapping
 * and therefore conflicts with that transaction rather than racing after a
 * read-only precheck.
 */
export function createWahooEventWriteOwnershipGuard(
  fence: WahooEventPublicationFence,
): EventWriteTransactionGuard {
  const mappingRef = admin.firestore()
    .collection(WAHOO_API_USER_MAPPINGS_COLLECTION_NAME)
    .doc(fence.wahooUserID);
  return async (transaction) => {
    const mappingSnapshot = await transaction.get(mappingRef);
    if (!mappingSnapshot.exists) return false;
    const currentMapping = mappingSnapshot.data();
    return `${currentMapping?.firebaseUserID || ''}`.trim() === fence.firebaseUserID
      && ownershipVersion(currentMapping?.ownershipVersion) === fence.ownershipVersion
      && getActiveEventPublicationLeases(currentMapping?.eventPublicationLeases)
        .some(({ leaseID }) => leaseID === fence.publicationLease.leaseID);
  };
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
