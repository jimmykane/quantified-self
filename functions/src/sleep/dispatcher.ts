import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { MAX_PENDING_TASKS, QUEUE_SCHEDULE } from '../shared/queue-config';
import { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from './constants';
import { config } from '../config';
import { enqueueSleepSyncTask, getCloudTaskQueueDepthForQueue } from '../utils';

const MAX_SLEEP_SYNC_QUEUE_SCAN = 500;
const SLEEP_SYNC_REDISPATCH_STALE_MS = 2 * 60 * 60 * 1000;
const SLEEP_SYNC_RECONCILIATION_PAGE_SIZE = 100;

function toDispatchTimestamp(value: unknown): number | null {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function toDateCreatedTimestamp(value: unknown): number {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : 0;
}

export async function reconcileSleepSyncQueueDispatches(nowMs = Date.now()): Promise<{
    inspected: number;
    dispatched: number;
    skippedRecent: number;
}> {
    const cloudTaskQueueId = config.cloudtasks.sleepSyncQueue;
    const pendingCloudTasks = await getCloudTaskQueueDepthForQueue(cloudTaskQueueId, true);
    if (pendingCloudTasks >= MAX_PENDING_TASKS) {
        logger.info(`[SleepSyncDispatcher] Queue busy (${pendingCloudTasks} pending tasks), skipping dispatch reconciliation.`);
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

    const scannedDocs: admin.firestore.QueryDocumentSnapshot[] = [];
    const pageSize = Math.min(SLEEP_SYNC_RECONCILIATION_PAGE_SIZE, MAX_SLEEP_SYNC_QUEUE_SCAN, MAX_PENDING_TASKS);
    let pageCursor: admin.firestore.QueryDocumentSnapshot | undefined;

    while (scannedDocs.length < MAX_SLEEP_SYNC_QUEUE_SCAN) {
        const remainingScanCapacity = MAX_SLEEP_SYNC_QUEUE_SCAN - scannedDocs.length;
        const currentPageSize = Math.min(pageSize, remainingScanCapacity);

        let query = admin.firestore()
            .collection(SLEEP_SYNC_QUEUE_COLLECTION_NAME)
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
            const data = doc.data() as Partial<SleepSyncQueueItemInterface>;
            const dispatchedToCloudTask = toDispatchTimestamp(data.dispatchedToCloudTask);
            const isUndispatched = dispatchedToCloudTask === null;
            const isStale = !isUndispatched && (nowMs - dispatchedToCloudTask) >= SLEEP_SYNC_REDISPATCH_STALE_MS;
            return {
                doc,
                isUndispatched,
                isStale,
                dispatchedToCloudTask,
                dateCreated: toDateCreatedTimestamp(data.dateCreated),
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
            const wasTaskEnqueued = await enqueueSleepSyncTask(candidate.doc.id, candidate.dateCreated);
            if (!wasTaskEnqueued) {
                logger.info(`[SleepSyncDispatcher] Task not enqueued for ${candidate.doc.id}; leaving dispatch marker unchanged.`);
                continue;
            }
            await candidate.doc.ref.update({ dispatchedToCloudTask: nowMs });
            dispatched += 1;
        } catch (error) {
            logger.error(`[SleepSyncDispatcher] Failed to dispatch queue item ${candidate.doc.id}`, error);
        }
    }

    return {
        inspected: candidates.length,
        dispatched,
        skippedRecent,
    };
}

export const dispatchSleepSyncQueue = functions.region('europe-west2').runWith({
    timeoutSeconds: 300,
    memory: '256MB',
    maxInstances: 1,
}).pubsub.schedule(QUEUE_SCHEDULE).onRun(async () => {
    const result = await reconcileSleepSyncQueueDispatches();
    logger.info('[SleepSyncDispatcher] Reconciliation completed', result);
});
