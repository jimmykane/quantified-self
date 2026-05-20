import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ActivitySyncRouteId } from '../../../shared/activity-sync-routes';
import { enqueueActivitySyncTask, generateIDFromParts } from '../utils';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from './constants';
import { ActivitySyncOriginalFileMetadata, ActivitySyncQueueItemInterface } from '../queue/queue-item.interface';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import {
    getUserDeletionGuardState,
    getUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import {
    markQueueItemDispatchedIfUserActive,
    QueueDispatchMarkerResult,
} from '../queue/dispatch-marker';
import {
    markQueueItemDeletedForUserCleanup,
    QUEUE_CLEANUP_TOMBSTONE_REASONS,
} from '../queue/cleanup-tombstone';

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

async function deleteQueueDocAfterDeletionGuard(
    db: admin.firestore.Firestore,
    queueDocRef: admin.firestore.DocumentReference,
    queueItemId: string,
    userID: string,
): Promise<void> {
    try {
        await markQueueItemDeletedForUserCleanup(
            ACTIVITY_SYNC_QUEUE_COLLECTION_NAME,
            queueItemId,
            QUEUE_CLEANUP_TOMBSTONE_REASONS.UserDeletionGuard,
        );
        await db.recursiveDelete(queueDocRef);
        logger.info(`[ActivitySync] Deleted queue item ${queueItemId} for deleting user ${userID} before Cloud Task dispatch.`);
    } catch (error) {
        logger.error(`[ActivitySync] Failed to delete queue item ${queueItemId} after deletion guard tripped for user ${userID}`, error);
    }
}

async function canDispatchActivitySyncQueueItem(
    db: admin.firestore.Firestore,
    queueDocRef: admin.firestore.DocumentReference,
    queueItemId: string,
    userID: string,
    phase: string,
): Promise<boolean> {
    let deletionGuard;
    try {
        deletionGuard = await getUserDeletionGuardState(db, userID);
    } catch (error) {
        throw new UserDeletionGuardReadError(userID, phase, error);
    }

    if (!deletionGuard.shouldSkip) {
        return true;
    }

    await deleteQueueDocAfterDeletionGuard(db, queueDocRef, queueItemId, userID);
    return false;
}

async function markActivitySyncQueueItemDispatchedIfUserActive(
    queueDocRef: admin.firestore.DocumentReference,
    queueItemId: string,
    userID: string,
    phase: string,
): Promise<boolean> {
    const result = await markQueueItemDispatchedIfUserActive({
        queueItemDocument: queueDocRef,
        queueItemId,
        userID,
        phase,
        dispatchedAtMs: Date.now(),
        logPrefix: 'ActivitySync',
    });
    return result === QueueDispatchMarkerResult.Marked;
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
        let deletionGuard;
        try {
            deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, params.userID);
        } catch (error) {
            throw new UserDeletionGuardReadError(params.userID, 'activity_sync_queue_transaction', error);
        }

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
        if (!(await canDispatchActivitySyncQueueItem(db, queueDocRef, queueItemId, params.userID, 'activity_sync_queue_dispatch_new'))) {
            return {
                enqueued: false,
                queueItemId,
                reason: 'user_deleted_or_deleting',
            };
        }
        const wasTaskEnqueued = await enqueueActivitySyncTask(queueItemId, decision.dateCreated || Date.now());
        if (wasTaskEnqueued) {
            if (!(await markActivitySyncQueueItemDispatchedIfUserActive(queueDocRef, queueItemId, params.userID, 'activity_sync_queue_mark_new_dispatched'))) {
                return {
                    enqueued: false,
                    queueItemId,
                    reason: 'user_deleted_or_deleting',
                };
            }
        }
        return {
            enqueued: true,
            queueItemId,
        };
    }

    let redispatched = false;
    if (decision.shouldDispatchExisting) {
        if (!(await canDispatchActivitySyncQueueItem(db, queueDocRef, queueItemId, params.userID, 'activity_sync_queue_redispatch_existing'))) {
            return {
                enqueued: false,
                queueItemId,
                reason: 'user_deleted_or_deleting',
            };
        }
        const wasTaskEnqueued = await enqueueActivitySyncTask(queueItemId, decision.dateCreated || Date.now());
        if (wasTaskEnqueued) {
            if (!(await markActivitySyncQueueItemDispatchedIfUserActive(queueDocRef, queueItemId, params.userID, 'activity_sync_queue_mark_existing_dispatched'))) {
                return {
                    enqueued: false,
                    queueItemId,
                    reason: 'user_deleted_or_deleting',
                };
            }
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
