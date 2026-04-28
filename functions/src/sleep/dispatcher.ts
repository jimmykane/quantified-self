import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { MAX_PENDING_TASKS, QUEUE_SCHEDULE } from '../shared/queue-config';
import { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from './constants';
import { config } from '../config';
import { enqueueSleepSyncTask, getCloudTaskQueueDepthForQueue } from '../utils';

const MAX_SLEEP_SYNC_QUEUE_SCAN = 500;

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
}> {
    const cloudTaskQueueId = config.cloudtasks.sleepSyncQueue;
    const pendingCloudTasks = await getCloudTaskQueueDepthForQueue(cloudTaskQueueId, true);
    if (pendingCloudTasks >= MAX_PENDING_TASKS) {
        logger.info(`[SleepSyncDispatcher] Queue busy (${pendingCloudTasks} pending tasks), skipping dispatch reconciliation.`);
        return {
            inspected: 0,
            dispatched: 0,
        };
    }

    const availableSlots = Math.max(0, MAX_PENDING_TASKS - pendingCloudTasks);
    const snapshot = await admin.firestore()
        .collection(SLEEP_SYNC_QUEUE_COLLECTION_NAME)
        .where('processed', '==', false)
        .orderBy('dateCreated', 'asc')
        .limit(Math.min(MAX_SLEEP_SYNC_QUEUE_SCAN, availableSlots))
        .get();

    let dispatched = 0;
    for (const doc of snapshot.docs) {
        const data = doc.data() as Partial<SleepSyncQueueItemInterface>;
        if (toDispatchTimestamp(data.dispatchedToCloudTask) !== null) {
            continue;
        }
        try {
            const dateCreated = toDateCreatedTimestamp(data.dateCreated);
            const wasTaskEnqueued = await enqueueSleepSyncTask(doc.id, dateCreated);
            if (!wasTaskEnqueued) {
                continue;
            }
            await doc.ref.update({ dispatchedToCloudTask: nowMs });
            dispatched += 1;
        } catch (error) {
            logger.error(`[SleepSyncDispatcher] Failed to dispatch queue item ${doc.id}`, error);
        }
    }

    return {
        inspected: snapshot.size,
        dispatched,
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
