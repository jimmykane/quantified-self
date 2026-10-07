import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { performance } from 'node:perf_hooks';
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
import { logGarminDispatchSummary, type GarminDispatchOutcome, type QueueWriteKind } from './dispatch-telemetry';

type GarminPingBatchDispatchResult =
    | 'ignored'
    | 'stale'
    | 'leased'
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
    return classifyGarminPingBatchWrite(beforeExists, beforeQueueItem, afterQueueItem) === 'dispatch_candidate';
}

function classifyGarminPingBatchWrite(
    beforeExists: boolean,
    beforeQueueItem: unknown,
    afterQueueItem: unknown,
): GarminDispatchOutcome | 'dispatch_candidate' {
    if (!afterQueueItem || typeof afterQueueItem !== 'object') return 'missing_data';
    const candidate = afterQueueItem as Record<string, unknown>;
    if (candidate.type !== 'garmin_ping_batch' || candidate.provider !== SLEEP_PROVIDERS.GarminAPI) {
        return 'other_provider_or_type';
    }
    if (candidate.processed === true) return 'already_processed';
    if (candidate.dispatchedToCloudTask != null) return 'already_dispatched';
    if (!beforeExists) return 'dispatch_candidate';
    if (!beforeQueueItem || typeof beforeQueueItem !== 'object') return 'invalid_revision';

    const beforeRevision = getSleepQueueRevisionIdentity(
        beforeQueueItem as { queueRevision?: unknown; dateCreated?: unknown },
    );
    const afterRevision = getSleepQueueRevisionIdentity(
        afterQueueItem as { queueRevision?: unknown; dateCreated?: unknown },
    );
    if (afterRevision === null) return 'invalid_revision';
    return afterRevision !== beforeRevision ? 'dispatch_candidate' : 'same_revision';
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
    observation?: { enqueueConfirmed: boolean },
): Promise<GarminPingBatchDispatchResult> {
    if (!isUndispatchedGarminPingBatch(eventQueueItem)) {
        return 'ignored';
    }
    if (getActiveRevisionProcessingLease(eventQueueItem, nowMs)) return 'leased';

    const currentSnapshot = await queueItemRef.get();
    const currentQueueItem = currentSnapshot.exists
        ? currentSnapshot.data() as SleepSyncQueueItemInterface
        : null;
    if (!currentQueueItem
        || !isUndispatchedGarminPingBatch(currentQueueItem)
        || !isCurrentSleepQueueRevision(currentQueueItem, eventQueueItem)) {
        return 'stale';
    }
    if (getActiveRevisionProcessingLease(currentQueueItem, nowMs)) return 'leased';

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
    try {
        if (observation) observation.enqueueConfirmed = true;
    } catch {
        // Recording confirmation must not change the durable marker transition.
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
    memory: '512MiB',
    maxInstances: 100,
    concurrency: 10,
    retry: true,
}, async event => {
    const startedAtMs = performance.now();
    let queueItem: SleepSyncQueueItemInterface | undefined;
    let outcome: GarminDispatchOutcome = 'error';
    let writeKind: QueueWriteKind = 'unknown';
    const observation = { enqueueConfirmed: false };
    try {
        const before = event.data?.before;
        const after = event.data?.after;
        writeKind = before?.exists ? after?.exists ? 'update' : 'delete' : after?.exists ? 'create' : 'unknown';
        if (!after?.exists) {
            outcome = before?.exists ? 'deleted_write' : 'missing_data';
            return;
        }
        queueItem = after.data() as SleepSyncQueueItemInterface | undefined;
        const beforeQueueItem = before?.exists ? before.data() : undefined;
        const decision = classifyGarminPingBatchWrite(before?.exists === true, beforeQueueItem, queueItem);
        if (decision !== 'dispatch_candidate') {
            outcome = decision;
            return;
        }
        const result = await dispatchGarminPingBatchQueueRevision(
            `${event.params.queueItemId || after.id}`,
            after.ref,
            queueItem as SleepSyncQueueItemInterface,
            `${event.id || ''}`,
            Date.now(),
            observation,
        );
        outcome = result === 'ignored' ? 'stale' : result;
    } finally {
        try {
            // Stop the handler timer before sampling and diagnostic snapshot decoding.
            const durationMs = Math.max(0, performance.now() - startedAtMs);
            // Decode a deleted write's before snapshot only when it is sampled; no I/O.
            logGarminDispatchSummary({
                queueItem: () => queueItem ?? (event.data?.before?.exists ? event.data.before.data() : undefined),
                outcome, writeKind, durationMs, enqueueConfirmed: observation.enqueueConfirmed,
            });
        } catch {
            // Even malformed diagnostic snapshots must not change delivery behavior.
        }
    }
});
