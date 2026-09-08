import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import type { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import { isCurrentSleepQueueTransition } from '../queue-utils';
import { clearRevisionProcessingLeaseUpdate } from '../queue/revision-processing-lease';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { areTokenCredentialSnapshotsEqual, getTokenCredentialSnapshot } from '../token-refresh-coordinator';
import { getSuuntoWebhookWriteLifecycleAuthorityDigest, type SuuntoWebhookWriteLifecycleGuards } from './health-webhook-binding-lifecycle';

export interface SuuntoHealthProgress {
  nextStartMs: number;
  targetWindowMs: number;
  authorityDigest: string;
  recordsWritten: number;
  recordsUnchanged: number;
  recordsStale: number;
  lastObservedAtMs: number;
}

export function isValidSuuntoHealthProgress(queue: SleepSyncQueueItemInterface): boolean {
  const progress = queue.suuntoHealthProgress;
  if (progress === undefined) return true;
  const day = 86_400_000;
  return queue.type === 'suunto_health_poll' && queue.provider === 'SuuntoApp'
    && !!progress && typeof progress === 'object' && !Array.isArray(progress)
    && Object.keys(progress).length === 7
    && Number.isSafeInteger(progress.nextStartMs)
    && progress.nextStartMs > Number(queue.rangeStartMs)
    && progress.nextStartMs < Number(queue.rangeEndMs)
    && Number.isSafeInteger(progress.targetWindowMs)
    && progress.targetWindowMs >= Math.min(day / 2, Number(queue.rangeEndMs) - Number(queue.rangeStartMs))
    && progress.targetWindowMs <= 26 * day
    && typeof progress.authorityDigest === 'string' && /^[a-f0-9]{64}$/.test(progress.authorityDigest)
    && [progress.recordsWritten, progress.recordsUnchanged, progress.recordsStale]
      .every(value => Number.isSafeInteger(value) && value >= 0 && value <= 100_000)
    && Number.isSafeInteger(progress.lastObservedAtMs) && progress.lastObservedAtMs >= 0;
}

/** Only called after every record in the completed target window was written. */
export async function checkpointSuuntoHealthProgress(
  queue: SleepSyncQueueItemInterface,
  userID: string,
  guards: SuuntoWebhookWriteLifecycleGuards,
  next: SuuntoHealthProgress,
): Promise<'deleted' | 'superseded' | 'lifecycle_changed' | { continuationRevision: string }> {
  if (!isValidSuuntoHealthProgress({ ...queue, suuntoHealthProgress: next })
    || next.nextStartMs <= (queue.suuntoHealthProgress?.nextStartMs ?? Number(queue.rangeStartMs))
    || next.authorityDigest !== getSuuntoWebhookWriteLifecycleAuthorityDigest(guards)) {
    throw new Error('Invalid Suunto Health progress transition.');
  }
  const db = admin.firestore();
  const continuationRevision = randomUUID();
  try {
    return await db.runTransaction(async transaction => {
      if ((await getUserDeletionGuardStateInTransaction(db, transaction, userID)).shouldSkip) return 'deleted';
      const snapshot = await transaction.get(queue.ref!);
      if (!snapshot.exists) return 'superseded';
      const current = snapshot.data() as SleepSyncQueueItemInterface;
      if (current.processed || current.userID !== userID
        || current.type !== queue.type || current.provider !== queue.provider
        || current.providerUserId !== queue.providerUserId
        || current.rangeStartMs !== queue.rangeStartMs || current.rangeEndMs !== queue.rangeEndMs
        || current.processingOwner !== queue.processingOwner
        || current.processingRevision !== queue.processingRevision
        || !isCurrentSleepQueueTransition(current as unknown as Record<string, unknown>, queue)
        || (current.suuntoHealthProgress?.nextStartMs ?? current.rangeStartMs)
          !== (queue.suuntoHealthProgress?.nextStartMs ?? queue.rangeStartMs)) return 'superseded';
      // Read the exact token plus binding/root/connection fields in this same
      // transaction. A disconnect cannot create new work after this fence.
      const token = await transaction.get(guards.requiredExistingDocumentRef);
      if (!token.exists || !areTokenCredentialSnapshotsEqual(
        getTokenCredentialSnapshot(token.data()), guards.requiredExistingTokenCredential,
      )) return 'lifecycle_changed';
      for (const guard of [guards.requiredDocumentFieldValues, ...guards.additionalRequiredDocumentFieldValues]) {
        const document = await transaction.get(guard.documentRef);
        const data = document.exists ? document.data() : undefined;
        if (!data || Object.entries(guard.expectedFields).some(([key, value]) => data[key] !== value)) {
          return 'lifecycle_changed';
        }
      }
      transaction.update(queue.ref!, {
        suuntoHealthProgress: next,
        queueRevision: continuationRevision,
        retryCount: 0,
        dispatchedToCloudTask: null,
        providerOperationStartedAt: null,
        ...clearRevisionProcessingLeaseUpdate(),
      });
      return { continuationRevision };
    });
  } catch {
    // Datastore errors can include raw account IDs in document paths.
    throw new Error('Suunto Health checkpoint failed.');
  }
}
