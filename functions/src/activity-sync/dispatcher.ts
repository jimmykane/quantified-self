import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { MAX_PENDING_TASKS, QUEUE_SCHEDULE } from '../shared/queue-config';
import { ActivitySyncQueueItemInterface } from '../queue/queue-item.interface';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from './constants';
import { config } from '../config';
import { enqueueActivitySyncTask, getCloudTaskQueueDepthForQueue } from '../utils';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';
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
    const scannedDocs: admin.firestore.QueryDocumentSnapshot[] = [];
    let pageCursor: admin.firestore.QueryDocumentSnapshot | undefined;

    while (scannedDocs.length < scanLimit) {
        const remainingScanCapacity = scanLimit - scannedDocs.length;
        const currentPageSize = Math.min(pageSize, remainingScanCapacity);

        let query = admin.firestore()
            .collection(ACTIVITY_SYNC_QUEUE_COLLECTION_NAME)
            .where('processed', '==', false)
            .orderBy('dateCreated', 'asc')
            .limit(currentPageSize);

        if (pageCursor) {
            query = query.startAfter(pageCursor);
        }

        const pageSnapshot = await query.get();
        if (pageSnapshot.empty) {
            break;
        }

        scannedDocs.push(...pageSnapshot.docs);
        if (pageSnapshot.docs.length < currentPageSize) {
            break;
        }

        pageCursor = pageSnapshot.docs[pageSnapshot.docs.length - 1];
    }

    if (!scannedDocs.length) {
        return {
            inspected: 0,
            dispatched: 0,
            skippedRecent: 0,
        };
    }

    const candidates = scannedDocs
        .map((doc) => {
            const data = doc.data() as Partial<ActivitySyncQueueItemInterface>;
            const dispatchedToCloudTask = toDispatchTimestamp(data.dispatchedToCloudTask);
            const isUndispatched = dispatchedToCloudTask === null;
            const isStale = !isUndispatched && (nowMs - dispatchedToCloudTask) >= ACTIVITY_SYNC_REDISPATCH_STALE_MS;
            return {
                doc,
                isUndispatched,
                isStale,
                dispatchedToCloudTask,
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

            return (left.dispatchedToCloudTask || 0) - (right.dispatchedToCloudTask || 0);
        });

    let dispatched = 0;
    let skippedRecent = 0;
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
            const markerResult = await markQueueItemDispatchedIfUserActive({
                queueItemDocument: candidate.doc.ref,
                queueItemId: candidate.doc.id,
                userID: candidate.userID,
                phase: 'activity_sync_dispatch_marker',
                dispatchedAtMs: nowMs,
                logPrefix: 'ActivitySyncDispatcher',
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
        inspected: candidates.length,
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
