import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import {
    markQueueItemDispatchedIfUserActive,
    QueueDispatchMarkerResult,
} from '../queue/dispatch-marker';
import { QUEUE_CLEANUP_TOMBSTONE_REASONS } from '../queue/cleanup-tombstone';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';
import { enqueueSleepSyncTask } from '../utils';
import { getActiveRevisionProcessingLease } from '../queue/revision-processing-lease';
import {
    deleteSleepQueueRevisionWithTombstone,
    getSleepQueueRevisionIdentity,
    isCurrentSleepQueueRevision,
} from './queue-revision';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from './constants';

type GarminPingBatchDispatchResult =
    | 'ignored'
    | 'stale'
    | 'deleted'
    | 'deferred'
    | 'dispatched';

function isUndispatchedGarminPingBatch(
    queueItem: unknown,
): boolean {
    const candidate = queueItem && typeof queueItem === 'object'
        ? queueItem as Record<string, unknown>
        : null;
    return candidate?.type === 'garmin_ping_batch'
        && candidate.provider === SLEEP_PROVIDERS.GarminAPI
        && candidate.processed !== true
        && candidate.dispatchedToCloudTask == null;
}

/**
 * Dispatch only a newly durable batch revision. Retry bookkeeping can clear
 * dispatchedToCloudTask on the same revision; Cloud Tasks must own that
 * delivery's backoff instead of this write trigger starting a fresh task.
 */
export function shouldDispatchGarminPingBatchWrite(
    beforeExists: boolean,
    beforeQueueItem: unknown,
    afterQueueItem: unknown,
): boolean {
    if (!isUndispatchedGarminPingBatch(afterQueueItem)) return false;
    if (!beforeExists) return true;
    if (!beforeQueueItem || typeof beforeQueueItem !== 'object') return false;

    const beforeRevision = getSleepQueueRevisionIdentity(
        beforeQueueItem as { queueRevision?: unknown; dateCreated?: unknown },
    );
    const afterRevision = getSleepQueueRevisionIdentity(
        afterQueueItem as { queueRevision?: unknown; dateCreated?: unknown },
    );
    return afterRevision !== null && afterRevision !== beforeRevision;
}

function nonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Dispatches one durable Garmin Ping batch outside the provider HTTP request.
 * The scheduled Sleep dispatcher remains the recovery path for failed trigger
 * delivery or an ambiguous Cloud Tasks response.
 */
export async function dispatchGarminPingBatchQueueRevision(
    queueItemId: string,
    queueItemRef: admin.firestore.DocumentReference,
    eventQueueItem: SleepSyncQueueItemInterface,
    eventId: string,
    nowMs = Date.now(),
): Promise<GarminPingBatchDispatchResult> {
    if (!isUndispatchedGarminPingBatch(eventQueueItem)
        || getActiveRevisionProcessingLease(eventQueueItem, nowMs)) {
        return 'ignored';
    }

    const currentSnapshot = await queueItemRef.get();
    const currentQueueItem = currentSnapshot.exists
        ? currentSnapshot.data() as SleepSyncQueueItemInterface
        : null;
    if (!currentQueueItem
        || !isUndispatchedGarminPingBatch(currentQueueItem)
        || !isCurrentSleepQueueRevision(currentQueueItem, eventQueueItem)
        || getActiveRevisionProcessingLease(currentQueueItem, nowMs)) {
        return 'stale';
    }

    const userID = nonEmptyString(currentQueueItem.userID);
    const providerUserId = nonEmptyString(currentQueueItem.providerUserId);
    const dateCreated = currentQueueItem.dateCreated;
    const queueRevision = nonEmptyString(currentQueueItem.queueRevision);
    if (!userID
        || !providerUserId
        || !Number.isSafeInteger(dateCreated)
        || dateCreated < 0) {
        logger.warn('[GarminPingBatchDispatcher] Leaving malformed batch for scheduled reconciliation.', {
            queueItemId,
        });
        return 'deferred';
    }

    const deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
    if (deletionGuard.shouldSkip) {
        const deleted = await deleteSleepQueueRevisionWithTombstone(
            queueItemRef,
            queueItemId,
            currentQueueItem,
            SLEEP_SYNC_QUEUE_COLLECTION_NAME,
            QUEUE_CLEANUP_TOMBSTONE_REASONS.UserDeletionGuard,
        );
        return deleted ? 'deleted' : 'stale';
    }

    const queueIdentity = {
        queueRevision: queueRevision || undefined,
        dateCreated,
    };
    const taskIdentity = {
        queueRevision: queueRevision || undefined,
        queueDateCreated: dateCreated,
        recoveryTaskKey: `firestore-${eventId}`,
    };
    const wasTaskEnqueued = await enqueueSleepSyncTask(
        queueItemId,
        dateCreated,
        undefined,
        taskIdentity,
    );
    if (!wasTaskEnqueued) {
        logger.warn('[GarminPingBatchDispatcher] Cloud Task state was ambiguous; leaving batch for scheduled reconciliation.', {
            queueItemId,
        });
        // Keep the Firestore event retryable as the fast recovery path. The
        // scheduled dispatcher independently recovers the same unmarked row.
        throw new Error('Garmin Ping batch Cloud Task dispatch was not confirmed.');
    }

    const markerResult = await markQueueItemDispatchedIfUserActive({
        queueItemDocument: queueItemRef,
        queueItemId,
        userID,
        phase: 'garmin_ping_batch_firestore_dispatch_marker',
        dispatchedAtMs: nowMs,
        logPrefix: 'GarminPingBatchDispatcher',
        cleanupOnDeletedUser: false,
        isCurrent: candidate => isUndispatchedGarminPingBatch(candidate)
            && isCurrentSleepQueueRevision(candidate, queueIdentity),
    });
    if (markerResult === QueueDispatchMarkerResult.Marked) return 'dispatched';
    if (markerResult === QueueDispatchMarkerResult.NotCurrent) return 'stale';
    const deleted = await deleteSleepQueueRevisionWithTombstone(
        queueItemRef,
        queueItemId,
        queueIdentity,
        SLEEP_SYNC_QUEUE_COLLECTION_NAME,
        QUEUE_CLEANUP_TOMBSTONE_REASONS.UserDeletionGuard,
    );
    return deleted ? 'deleted' : 'stale';
}

export const dispatchGarminPingBatchOnWrite = onDocumentWritten({
    document: 'sleepSyncQueue/{queueItemId}',
    region: 'europe-west2',
    memory: '256MiB',
    maxInstances: 100,
    concurrency: 10,
    retry: true,
}, async event => {
    const before = event.data?.before;
    const after = event.data?.after;
    if (!after?.exists) return;
    const queueItem = after.data() as SleepSyncQueueItemInterface | undefined;
    const beforeQueueItem = before?.exists ? before.data() : undefined;
    if (!queueItem || !shouldDispatchGarminPingBatchWrite(
        before?.exists === true,
        beforeQueueItem,
        queueItem,
    )) return;
    await dispatchGarminPingBatchQueueRevision(
        `${event.params.queueItemId || after.id}`,
        after.ref,
        queueItem,
        `${event.id || ''}`,
    );
});
