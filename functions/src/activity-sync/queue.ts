import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ActivitySyncRouteId } from '../../../shared/activity-sync-routes';
import { enqueueActivitySyncTask, generateIDFromParts } from '../utils';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from './constants';
import { ActivitySyncOriginalFileMetadata, ActivitySyncQueueItemInterface } from '../queue/queue-item.interface';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';

export interface EnqueueActivitySyncQueueItemParams {
    routeId: ActivitySyncRouteId;
    sourceServiceName: ServiceNames;
    destinationServiceName: ServiceNames;
    userID: string;
    eventID: string;
    sourceActivityID?: string;
    originalFile: ActivitySyncOriginalFileMetadata;
    manual: boolean;
}

export interface EnqueueActivitySyncQueueItemResult {
    enqueued: boolean;
    queueItemId: string;
    reason?: 'already_pending' | 'already_processed' | 'user_deleted_or_deleting';
    redispatched?: boolean;
}

interface QueueInsertDecision {
    enqueued: boolean;
    queueItemId: string;
    reason?: 'already_pending' | 'already_processed' | 'user_deleted_or_deleting';
    dateCreated?: number;
    shouldDispatchExisting?: boolean;
}

export async function buildActivitySyncQueueItemId(
    routeId: ActivitySyncRouteId,
    userID: string,
    eventID: string,
): Promise<string> {
    return generateIDFromParts(['activitySync', routeId, userID, eventID]);
}

export async function enqueueActivitySyncQueueItem(
    params: EnqueueActivitySyncQueueItemParams,
): Promise<EnqueueActivitySyncQueueItemResult> {
    const queueItemId = await buildActivitySyncQueueItemId(params.routeId, params.userID, params.eventID);
    const db = admin.firestore();
    const queueDocRef = db.collection(ACTIVITY_SYNC_QUEUE_COLLECTION_NAME).doc(queueItemId);
    const decision = await db.runTransaction(async (transaction): Promise<QueueInsertDecision> => {
        const existingSnapshot = await transaction.get(queueDocRef);
        const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, params.userID);
        if (deletionGuard.shouldSkip) {
            return {
                enqueued: false,
                queueItemId,
                reason: 'user_deleted_or_deleting',
            };
        }

        if (existingSnapshot.exists) {
            const existingData = existingSnapshot.data() as Partial<ActivitySyncQueueItemInterface>;
            if (!existingData.processed) {
                return {
                    enqueued: false,
                    queueItemId,
                    reason: 'already_pending',
                    dateCreated: Number(existingData.dateCreated) || Date.now(),
                    shouldDispatchExisting: existingData.dispatchedToCloudTask === null || existingData.dispatchedToCloudTask === undefined,
                };
            }

            if (params.manual !== true) {
                return {
                    enqueued: false,
                    queueItemId,
                    reason: 'already_processed',
                };
            }
        }

        const dateCreated = Date.now();
        const queueItem: ActivitySyncQueueItemInterface = {
            id: queueItemId,
            dateCreated,
            processed: false,
            retryCount: 0,
            totalRetryCount: 0,
            errors: [],
            dispatchedToCloudTask: null,
            expireAt: getExpireAtTimestamp(TTL_CONFIG.QUEUE_ITEM_IN_DAYS),
            routeId: params.routeId,
            sourceServiceName: params.sourceServiceName,
            destinationServiceName: params.destinationServiceName,
            userID: params.userID,
            eventID: params.eventID,
            sourceActivityID: params.sourceActivityID || '',
            originalFile: params.originalFile,
            manual: params.manual === true,
        };

        transaction.set(queueDocRef, queueItem);
        return {
            enqueued: true,
            queueItemId,
            dateCreated,
        };
    });

    if (decision.enqueued) {
        const wasTaskEnqueued = await enqueueActivitySyncTask(queueItemId, decision.dateCreated || Date.now());
        if (wasTaskEnqueued) {
            await queueDocRef.update({ dispatchedToCloudTask: Date.now() });
        }
        return {
            enqueued: true,
            queueItemId,
        };
    }

    let redispatched = false;
    if (decision.shouldDispatchExisting) {
        const wasTaskEnqueued = await enqueueActivitySyncTask(queueItemId, decision.dateCreated || Date.now());
        if (wasTaskEnqueued) {
            await queueDocRef.update({ dispatchedToCloudTask: Date.now() });
            redispatched = true;
        }
    }

    return {
        enqueued: false,
        queueItemId,
        reason: decision.reason,
        redispatched: redispatched ? true : undefined,
    };
}
