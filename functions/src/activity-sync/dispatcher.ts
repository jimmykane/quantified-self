import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { MAX_PENDING_TASKS, QUEUE_SCHEDULE } from '../shared/queue-config';
import { ActivitySyncQueueItemInterface } from '../queue/queue-item.interface';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from './constants';
import { config } from '../config';
import { enqueueActivitySyncTask, getCloudTaskQueueDepthForQueue } from '../utils';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';
import {
    PENDING_DISCONNECT_QUEUE_DISPATCH_MARKER,
    PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
} from '../queue-utils';
import {
    markQueueItemDispatchedIfUserActive,
    QueueDispatchMarkerResult,
} from '../queue/dispatch-marker';
import {
    markQueueItemDeletedForUserCleanup,
    QUEUE_CLEANUP_TOMBSTONE_REASONS,
} from '../queue/cleanup-tombstone';

const ACTIVITY_SYNC_REDISPATCH_STALE_MS = 2 * 60 * 60 * 1000;
const MAX_ACTIVITY_SYNC_QUEUE_SCAN = 500;
const ACTIVITY_SYNC_RECONCILIATION_PAGE_SIZE = 100;

function toDispatchTimestamp(value: unknown): number | null {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function toDateCreatedTimestamp(value: unknown): number {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : 0;
}

function toUserID(value: unknown): string | null {
    const userID = `${value || ''}`.trim();
    return userID.length > 0 ? userID : null;
}

function hasExpectedProviderStatusPollResumeState(
    queueItem: Partial<ActivitySyncQueueItemInterface>,
): boolean {
    if (`${queueItem.destinationUploadID ?? ''}`.trim().length === 0) {
        return false;
    }
    if (queueItem.destinationServiceName === ServiceNames.WahooAPI) {
        return true;
    }
    return queueItem.destinationServiceName === ServiceNames.COROSAPI
        && `${queueItem.destinationProviderUserID ?? ''}`.trim().length > 0;
}

function isFutureScheduledProviderStatusPoll(
    queueItem: Partial<ActivitySyncQueueItemInterface>,
    nowMs: number,
): boolean {
    const scheduledAtMs = toDispatchTimestamp(queueItem.dispatchedToCloudTask);
    return scheduledAtMs !== null
        && scheduledAtMs > nowMs
        && scheduledAtMs !== PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER
        && scheduledAtMs !== PENDING_DISCONNECT_QUEUE_DISPATCH_MARKER
        && hasExpectedProviderStatusPollResumeState(queueItem);
}

async function deleteActivitySyncCandidateBeforeDispatch(
    doc: admin.firestore.QueryDocumentSnapshot,
    reason: string,
): Promise<void> {
    try {
        const tombstoneWritten = await markQueueItemDeletedForUserCleanup(
            ACTIVITY_SYNC_QUEUE_COLLECTION_NAME,
            doc.id,
            QUEUE_CLEANUP_TOMBSTONE_REASONS.DispatcherCleanup,
        );
        if (!tombstoneWritten) {
            logger.error(`[ActivitySyncDispatcher] Failed to write cleanup tombstone for ${doc.id}; leaving queue item in place to avoid missing-doc Cloud Task retries.`);
            return;
        }
        await admin.firestore().recursiveDelete(doc.ref);
        logger.info(`[ActivitySyncDispatcher] Deleted queue item ${doc.id} instead of dispatching: ${reason}.`);
    } catch (error) {
        logger.error(`[ActivitySyncDispatcher] Failed to delete queue item ${doc.id} before dispatch after ${reason}`, error);
    }
}

async function shouldDispatchActivitySyncCandidate(
    doc: admin.firestore.QueryDocumentSnapshot,
    userID: string | null,
): Promise<boolean> {
    if (!userID) {
        await deleteActivitySyncCandidateBeforeDispatch(doc, 'missing userID');
        return false;
    }

    try {
        const deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
        if (!deletionGuard.shouldSkip) {
            return true;
        }

        await deleteActivitySyncCandidateBeforeDispatch(doc, `user ${userID} is missing or deletion is in progress`);
        return false;
    } catch (error) {
        logger.error(`[ActivitySyncDispatcher] Failed to check deletion guard for queue item ${doc.id} and user ${userID}; leaving item undispatched for a future run.`, error);
        return false;
    }
}

export async function reconcileActivitySyncQueueDispatches(nowMs = Date.now()): Promise<{
    inspected: number;
    dispatched: number;
    skippedRecent: number;
}> {
    const cloudTaskQueueId = config.cloudtasks.activitySyncQueue;
    const pendingCloudTasks = await getCloudTaskQueueDepthForQueue(cloudTaskQueueId, true);
    if (pendingCloudTasks >= MAX_PENDING_TASKS) {
        logger.info(`[ActivitySyncDispatcher] Queue busy (${pendingCloudTasks} pending tasks), skipping dispatch reconciliation.`);
        return {
            inspected: 0,
            dispatched: 0,
            skippedRecent: 0,
        };
    }

    const availableSlots = Math.max(0, MAX_PENDING_TASKS - pendingCloudTasks);
    if (availableSlots === 0) {
        return {
            inspected: 0,
            dispatched: 0,
            skippedRecent: 0,
        };
    }

    const scanLimit = MAX_ACTIVITY_SYNC_QUEUE_SCAN;
    const pageSize = Math.min(ACTIVITY_SYNC_RECONCILIATION_PAGE_SIZE, MAX_ACTIVITY_SYNC_QUEUE_SCAN, MAX_PENDING_TASKS);
    const candidateDocs: admin.firestore.QueryDocumentSnapshot[] = [];
    let inspected = 0;
    let skippedScheduledProviderPolls = 0;
    let pageCursor: admin.firestore.QueryDocumentSnapshot | undefined;

    while (candidateDocs.length < scanLimit) {
        const remainingScanCapacity = scanLimit - candidateDocs.length;

        let query = admin.firestore()
            .collection(ACTIVITY_SYNC_QUEUE_COLLECTION_NAME)
            .where('processed', '==', false)
            .orderBy('dateCreated', 'asc')
            .limit(pageSize);

        if (pageCursor) {
            query = query.startAfter(pageCursor);
        }

        const pageSnapshot = await query.get();
        if (pageSnapshot.empty) {
            break;
        }

        inspected += pageSnapshot.docs.length;
        const nonScheduledPollDocs = pageSnapshot.docs.filter(doc => {
            const data = doc.data() as Partial<ActivitySyncQueueItemInterface>;
            return !isFutureScheduledProviderStatusPoll(data, nowMs);
        });
        // A future provider status-only poll is already backed by a delayed Cloud
        // Task. It must not consume this reconciliation pass's finite
        // candidate budget, otherwise enough old polls hide newer work.
        skippedScheduledProviderPolls += pageSnapshot.docs.length - nonScheduledPollDocs.length;
        candidateDocs.push(...nonScheduledPollDocs.slice(0, remainingScanCapacity));
        if (pageSnapshot.docs.length < pageSize) {
            break;
        }

        pageCursor = pageSnapshot.docs[pageSnapshot.docs.length - 1];
    }

    if (!candidateDocs.length) {
        return {
            inspected,
            dispatched: 0,
            skippedRecent: skippedScheduledProviderPolls,
        };
    }

    const candidates = candidateDocs
        .map((doc) => {
            const data = doc.data() as Partial<ActivitySyncQueueItemInterface>;
            const dispatchedToCloudTask = toDispatchTimestamp(data.dispatchedToCloudTask);
            const isUndispatched = dispatchedToCloudTask === null;
            const isProviderOperationClaim = dispatchedToCloudTask === PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER;
            const providerOperationStartedAt = toDispatchTimestamp(data.providerOperationStartedAt);
            // An acknowledged asynchronous provider poll stores its planned
            // dispatch time in this marker. A future timestamp therefore
            // remains recent until the delayed task is genuinely overdue.
            const dispatchAgeTimestamp = isProviderOperationClaim
                ? providerOperationStartedAt
                : dispatchedToCloudTask;
            const isStale = !isUndispatched && (
                dispatchAgeTimestamp === null
                || (nowMs - dispatchAgeTimestamp) >= ACTIVITY_SYNC_REDISPATCH_STALE_MS
            );
            return {
                doc,
                isUndispatched,
                isStale,
                isProviderOperationClaim,
                dispatchedToCloudTask,
                dispatchAgeTimestamp,
                dateCreated: toDateCreatedTimestamp(data.dateCreated),
                userID: toUserID(data.userID),
            };
        })
        .sort((left, right) => {
            const leftPriority = left.isUndispatched ? 0 : (left.isStale ? 1 : 2);
            const rightPriority = right.isUndispatched ? 0 : (right.isStale ? 1 : 2);
            if (leftPriority !== rightPriority) {
                return leftPriority - rightPriority;
            }

            return (left.dispatchAgeTimestamp || 0) - (right.dispatchAgeTimestamp || 0);
        });

    let dispatched = 0;
    let skippedRecent = skippedScheduledProviderPolls;
    const dispatchLimit = Math.min(availableSlots, candidates.length);

    for (const candidate of candidates) {
        if (dispatched >= dispatchLimit) {
            break;
        }

        if (!candidate.isUndispatched && !candidate.isStale) {
            skippedRecent += 1;
            continue;
        }

        try {
            if (!(await shouldDispatchActivitySyncCandidate(candidate.doc, candidate.userID))) {
                continue;
            }

            const wasTaskEnqueued = await enqueueActivitySyncTask(candidate.doc.id, candidate.dateCreated);
            if (!wasTaskEnqueued) {
                logger.info(`[ActivitySyncDispatcher] Task not enqueued for ${candidate.doc.id}; leaving dispatch marker unchanged.`);
                continue;
            }
            if (!candidate.userID) {
                continue;
            }
            if (candidate.isProviderOperationClaim) {
                // Preserve the claim so the worker resumes persisted provider
                // state or fails closed; replacing it with a dispatch timestamp
                // would allow the provider create/upload to run again.
                dispatched += 1;
                continue;
            }
            const markerResult = await markQueueItemDispatchedIfUserActive({
                queueItemDocument: candidate.doc.ref,
                queueItemId: candidate.doc.id,
                userID: candidate.userID,
                phase: 'activity_sync_dispatch_marker',
                dispatchedAtMs: nowMs,
                logPrefix: 'ActivitySyncDispatcher',
                isCurrent: currentQueueItem => currentQueueItem.processed !== true
                    && toDateCreatedTimestamp(currentQueueItem.dateCreated) === candidate.dateCreated
                    && toDispatchTimestamp(currentQueueItem.dispatchedToCloudTask) === candidate.dispatchedToCloudTask,
            });
            if (markerResult !== QueueDispatchMarkerResult.Marked) {
                continue;
            }
            dispatched += 1;
        } catch (error) {
            logger.error(`[ActivitySyncDispatcher] Failed to dispatch queue item ${candidate.doc.id}`, error);
        }
    }

    return {
        inspected,
        dispatched,
        skippedRecent,
    };
}

export const dispatchActivitySyncQueue = functions.region('europe-west2').runWith({
    timeoutSeconds: 300,
    memory: '256MB',
    maxInstances: 1,
}).pubsub.schedule(QUEUE_SCHEDULE).onRun(async () => {
    const result = await reconcileActivitySyncQueueDispatches();
    logger.info('[ActivitySyncDispatcher] Reconciliation completed', result);
});
