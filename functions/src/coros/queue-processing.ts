import * as admin from 'firebase-admin';
import { QueueResult } from '../queue-utils';
import { COROSAPIWorkoutQueueItemInterface } from '../queue/queue-item.interface';
import {
  clearRevisionProcessingLeaseUpdate,
  getActiveRevisionProcessingLease,
} from '../queue/revision-processing-lease';
import {
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import {
  getCOROSQueueRevisionIdentity,
  isSameCOROSQueueRevision,
} from './queue-revision';

export type COROSQueueClaimResult = 'claimed' | 'superseded' | 'busy';

// The workout task has a 9-minute runtime cap. Keeping the lease valid for
// 12 minutes prevents a replacement revision from persisting concurrently,
// while the 15-minute Cloud Tasks backoff can reclaim a crashed worker.
export const COROS_EVENT_WRITE_LEASE_MS = 12 * 60 * 1000;

function requireQueueReference(
  queueItem: COROSAPIWorkoutQueueItemInterface,
): admin.firestore.DocumentReference {
  if (!queueItem.ref) {
    throw new Error(`No document reference supplied for COROS queue item ${queueItem.id}`);
  }
  return queueItem.ref;
}

function requireQueueRevisionIdentity(
  queueItem: COROSAPIWorkoutQueueItemInterface,
): string {
  const revisionIdentity = getCOROSQueueRevisionIdentity(queueItem);
  if (!revisionIdentity) {
    throw new Error(`No revision identity supplied for COROS queue item ${queueItem.id}`);
  }
  return revisionIdentity;
}

function isQueueOwnedByUser(
  queueItem: Partial<COROSAPIWorkoutQueueItemInterface>,
  userID: string,
): boolean {
  const storedUserID = typeof queueItem.firebaseUserID === 'string'
    ? queueItem.firebaseUserID.trim()
    : '';
  // Legacy rows predate the explicit owner field and remain bound through the
  // active token lookup. Every new webhook/history row must match exactly.
  return !storedUserID || storedUserID === userID;
}

export async function claimCOROSEventWriteRevision(
  queueItem: COROSAPIWorkoutQueueItemInterface,
  userID: string,
  processingOwner: string,
): Promise<COROSQueueClaimResult> {
  const queueRef = requireQueueReference(queueItem);
  const processingRevision = requireQueueRevisionIdentity(queueItem);
  const db = admin.firestore();
  return db.runTransaction(async transaction => {
    const nowMs = Date.now();
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(
        db,
        transaction,
        userID,
        nowMs,
      );
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, 'coros_event_write_claim', error);
    }
    if (deletionGuard.shouldSkip) return 'superseded';

    const snapshot = await transaction.get(queueRef);
    if (!snapshot.exists) return 'superseded';
    const current = snapshot.data() as Partial<COROSAPIWorkoutQueueItemInterface>;
    if (!isQueueOwnedByUser(current, userID)) return 'superseded';
    const activeLease = getActiveRevisionProcessingLease(current, nowMs);

    if (!isSameCOROSQueueRevision(current, queueItem)) {
      // Recover a replacement revision left behind by a crashed older worker.
      // Its task retry arrives after this lease expires; making the replacement
      // undispatched lets the normal dispatcher enqueue the current revision.
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

    if (activeLease && activeLease.processingOwner !== processingOwner) {
      return 'busy';
    }

    transaction.update(queueRef, {
      processingOwner,
      processingRevision,
      processingLeaseExpiresAt: nowMs + COROS_EVENT_WRITE_LEASE_MS,
    });
    return 'claimed';
  });
}

export async function completeCOROSEventWriteRevision(
  queueItem: COROSAPIWorkoutQueueItemInterface,
  userID: string,
  processingOwner: string,
  additionalData: Record<string, unknown> = {},
): Promise<QueueResult.Processed> {
  const queueRef = requireQueueReference(queueItem);
  const processingRevision = requireQueueRevisionIdentity(queueItem);
  const db = admin.firestore();
  await db.runTransaction(async transaction => {
    const nowMs = Date.now();
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(
        db,
        transaction,
        userID,
        nowMs,
      );
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, 'coros_event_write_completion', error);
    }
    if (deletionGuard.shouldSkip) return;

    const snapshot = await transaction.get(queueRef);
    if (!snapshot.exists) return;
    const current = snapshot.data() as Partial<COROSAPIWorkoutQueueItemInterface>;
    if (!isQueueOwnedByUser(current, userID)
      || current.processingOwner !== processingOwner
      || current.processingRevision !== processingRevision) {
      return;
    }

    if (isSameCOROSQueueRevision(current, queueItem)) {
      transaction.update(queueRef, {
        processed: true,
        processedAt: nowMs,
        ...Object.fromEntries(
          Object.entries(additionalData).filter(([, value]) => value !== undefined),
        ),
        ...clearRevisionProcessingLeaseUpdate(),
      });
      return;
    }

    // History installed a newer payload while this worker held the lease.
    // Release it as undispatched only after the older event and fan-out writes
    // finish, so the newer revision necessarily processes last.
    transaction.update(queueRef, {
      processed: false,
      dispatchedToCloudTask: null,
      ...clearRevisionProcessingLeaseUpdate(),
    });
  });
  return QueueResult.Processed;
}

export async function releaseCOROSEventWriteRevision(
  queueItem: COROSAPIWorkoutQueueItemInterface,
  userID: string,
  processingOwner: string,
): Promise<void> {
  const queueRef = requireQueueReference(queueItem);
  const processingRevision = requireQueueRevisionIdentity(queueItem);
  const db = admin.firestore();
  await db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(
        db,
        transaction,
        userID,
      );
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, 'coros_event_write_release', error);
    }
    if (deletionGuard.shouldSkip) return;

    const snapshot = await transaction.get(queueRef);
    if (!snapshot.exists) return;
    const current = snapshot.data() as Partial<COROSAPIWorkoutQueueItemInterface>;
    if (!isQueueOwnedByUser(current, userID)
      || current.processingOwner !== processingOwner
      || current.processingRevision !== processingRevision) {
      return;
    }

    transaction.update(queueRef, {
      ...(!isSameCOROSQueueRevision(current, queueItem)
        ? { processed: false, dispatchedToCloudTask: null }
        : {}),
      ...clearRevisionProcessingLeaseUpdate(),
    });
  });
}
