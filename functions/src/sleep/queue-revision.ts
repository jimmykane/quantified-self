import * as admin from 'firebase-admin';
import { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import {
  clearRevisionProcessingLeaseUpdate,
  getActiveRevisionProcessingLease,
} from '../queue/revision-processing-lease';
import {
  getQueueRevisionIdentity,
  hasMatchingQueueRevision,
  isCurrentQueueRevision,
} from '../queue/revision-identity';
import {
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import {
  buildQueueCleanupTombstoneData,
  getQueueCleanupTombstoneDocumentRef,
  type QueueCleanupTombstoneReason,
} from '../queue/cleanup-tombstone';

export type SleepQueueClaimResult = 'claimed' | 'superseded' | 'busy' | 'deleted_user';

// Sleep task workers run for at most nine minutes. Keep the lease longer than
// the worker, but shorter than the normal Cloud Tasks retry interval.
export const SLEEP_QUEUE_PROCESSING_LEASE_MS = 12 * 60 * 1000;

export interface SleepQueueRevisionFields {
  queueRevision?: unknown;
  dateCreated?: unknown;
}

function legacySleepQueueIdentity(queueItem: SleepQueueRevisionFields): string | null {
  const dateCreated = Number(queueItem.dateCreated);
  return Number.isFinite(dateCreated) ? `legacy-date:${dateCreated}` : null;
}

export function getSleepQueueRevisionIdentity(
  queueItem: SleepQueueRevisionFields,
): string | null {
  return getQueueRevisionIdentity(queueItem, legacySleepQueueIdentity(queueItem));
}

export function hasSameSleepQueueRevision(
  currentQueueItem: Partial<SleepSyncQueueItemInterface>,
  attemptedQueueItem: SleepQueueRevisionFields,
): boolean {
  return hasMatchingQueueRevision({
    currentQueueItem,
    attemptedQueueItem,
    legacyIdentityMatches: currentQueueItem.dateCreated === attemptedQueueItem.dateCreated,
  });
}

export function isCurrentSleepQueueRevision(
  currentQueueItem: Partial<SleepSyncQueueItemInterface>,
  attemptedQueueItem: SleepQueueRevisionFields,
): boolean {
  return isCurrentQueueRevision({
    currentQueueItem,
    attemptedQueueItem,
    legacyIdentityMatches: currentQueueItem.dateCreated === attemptedQueueItem.dateCreated,
  });
}

function requireSleepQueueReference(queueItem: SleepSyncQueueItemInterface): admin.firestore.DocumentReference {
  if (!queueItem.ref) {
    throw new Error(`No document reference supplied for Sleep queue item ${queueItem.id}`);
  }
  return queueItem.ref;
}

function isSleepQueueOwnedByUser(
  queueItem: Partial<SleepSyncQueueItemInterface>,
  userID: string,
): boolean {
  const storedUserID = typeof queueItem.userID === 'string' ? queueItem.userID.trim() : '';
  // Legacy provider-only rows predate the durable uid. Their token lookup is
  // still required before this claim; every new row must match exactly.
  return !storedUserID || storedUserID === userID;
}

export async function claimSleepQueueRevision(
  queueItem: SleepSyncQueueItemInterface,
  userID: string,
  processingOwner: string,
): Promise<SleepQueueClaimResult> {
  const queueRef = requireSleepQueueReference(queueItem);
  const processingRevision = getSleepQueueRevisionIdentity(queueItem);
  if (!processingRevision) {
    throw new Error(`No revision identity supplied for Sleep queue item ${queueItem.id}`);
  }

  const db = admin.firestore();
  return db.runTransaction(async transaction => {
    const nowMs = Date.now();
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID, nowMs);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, 'sleep_queue_revision_claim', error);
    }
    if (deletionGuard.shouldSkip) return 'deleted_user';

    const snapshot = await transaction.get(queueRef);
    if (!snapshot.exists) return 'superseded';
    const current = snapshot.data() as Partial<SleepSyncQueueItemInterface>;
    if (!isSleepQueueOwnedByUser(current, userID)) return 'superseded';

    const activeLease = getActiveRevisionProcessingLease(current, nowMs);
    const currentIsProcessed = (current as { processed?: unknown }).processed === true;
    // The worker's initial document read and this transaction are separated by
    // token/lifecycle lookups. A duplicate task can complete the same revision
    // in between; never reclaim a row after any terminal transition wins.
    if (currentIsProcessed) return 'superseded';
    if (!isCurrentSleepQueueRevision(current, queueItem)) {
      if (!activeLease
        && current.processingRevision === processingRevision
        && typeof current.processingOwner === 'string'
        && current.processingOwner.trim()) {
        transaction.update(queueRef, {
          processed: false,
          dispatchedToCloudTask: null,
          ...clearRevisionProcessingLeaseUpdate(),
        });
      }
      return 'superseded';
    }

    if (activeLease && activeLease.processingOwner !== processingOwner) return 'busy';

    transaction.update(queueRef, {
      processingOwner,
      processingRevision,
      processingLeaseExpiresAt: nowMs + SLEEP_QUEUE_PROCESSING_LEASE_MS,
    });
    return 'claimed';
  });
}

export async function releaseSleepQueueRevision(
  queueItem: SleepSyncQueueItemInterface,
  userID: string,
  processingOwner: string,
): Promise<void> {
  const queueRef = requireSleepQueueReference(queueItem);
  const processingRevision = getSleepQueueRevisionIdentity(queueItem);
  if (!processingRevision) return;

  const db = admin.firestore();
  await db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, 'sleep_queue_revision_release', error);
    }
    if (deletionGuard.shouldSkip) return;

    const snapshot = await transaction.get(queueRef);
    if (!snapshot.exists) return;
    const current = snapshot.data() as Partial<SleepSyncQueueItemInterface>;
    if (!isSleepQueueOwnedByUser(current, userID)
      || current.processingOwner !== processingOwner
      || current.processingRevision !== processingRevision) return;

    const currentIsProcessed = (current as { processed?: unknown }).processed === true;
    transaction.update(queueRef, {
      ...(!hasSameSleepQueueRevision(current, queueItem) && !currentIsProcessed
        ? { processed: false, dispatchedToCloudTask: null }
        : {}),
      ...clearRevisionProcessingLeaseUpdate(),
    });
  });
}

export async function deleteSleepQueueRevisionWithTombstone(
  queueItemRef: admin.firestore.DocumentReference,
  queueItemID: string,
  attemptedQueueItem: SleepQueueRevisionFields,
  collectionName: string,
  reason: QueueCleanupTombstoneReason,
): Promise<boolean> {
  const db = admin.firestore();
  const tombstoneRef = getQueueCleanupTombstoneDocumentRef(db, collectionName, queueItemID);
  return db.runTransaction(async transaction => {
    const currentSnapshot = await transaction.get(queueItemRef);
    if (!currentSnapshot.exists || !isCurrentSleepQueueRevision(
      currentSnapshot.data() as Partial<SleepSyncQueueItemInterface>,
      attemptedQueueItem,
    )) return false;

    transaction.set(
      tombstoneRef,
      buildQueueCleanupTombstoneData(collectionName, queueItemID, reason),
      { merge: true },
    );
    transaction.delete(queueItemRef);
    return true;
  });
}
