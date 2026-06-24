import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { RouteDeliverySyncRouteId } from '../../../shared/route-delivery-sync-routes';
import { enqueueRouteDeliverySyncTask, generateIDFromParts } from '../utils';
import { RouteDeliverySyncQueueItemInterface } from '../queue/queue-item.interface';
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
import { ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME } from './constants';

export interface EnqueueRouteDeliverySyncQueueItemParams {
    routeId: RouteDeliverySyncRouteId;
    sourceServiceName: ServiceNames;
    destinationServiceName: ServiceNames;
    userID: string;
    savedRouteID: string;
    sourceRevisionKey: string;
    sourceProviderRouteId?: string;
    sourceProviderUserId?: string;
    manual: boolean;
}

export interface EnqueueRouteDeliverySyncQueueItemResult {
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

function normalizeNonEmptyString(value: unknown): string {
    return `${value || ''}`.trim();
}

async function deleteQueueDocAfterDeletionGuard(
    db: admin.firestore.Firestore,
    queueDocRef: admin.firestore.DocumentReference,
    queueItemId: string,
    userID: string,
): Promise<void> {
    try {
        const tombstoneWritten = await markQueueItemDeletedForUserCleanup(
            ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME,
            queueItemId,
            QUEUE_CLEANUP_TOMBSTONE_REASONS.UserDeletionGuard,
        );
        if (!tombstoneWritten) {
            logger.error(`[RouteDeliverySync] Failed to write cleanup tombstone for queue item ${queueItemId}; leaving item in place to avoid missing-doc Cloud Task retries.`);
            return;
        }
        await db.recursiveDelete(queueDocRef);
        logger.info(`[RouteDeliverySync] Deleted queue item ${queueItemId} for deleting user ${userID} before Cloud Task dispatch.`);
    } catch (error) {
        logger.error(`[RouteDeliverySync] Failed to delete queue item ${queueItemId} after deletion guard tripped for user ${userID}`, error);
    }
}

async function canDispatchRouteDeliverySyncQueueItem(
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

async function markRouteDeliverySyncQueueItemDispatchedIfUserActive(
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
        logPrefix: 'RouteDeliverySync',
    });
    return result === QueueDispatchMarkerResult.Marked;
}

export async function buildRouteDeliverySyncQueueItemId(
    routeId: RouteDeliverySyncRouteId,
    userID: string,
    savedRouteID: string,
    sourceRevisionKey: string,
): Promise<string> {
    return generateIDFromParts(['routeDeliverySync', routeId, userID, savedRouteID, sourceRevisionKey]);
}

export async function enqueueRouteDeliverySyncQueueItem(
    params: EnqueueRouteDeliverySyncQueueItemParams,
): Promise<EnqueueRouteDeliverySyncQueueItemResult> {
    const userID = normalizeNonEmptyString(params.userID);
    const savedRouteID = normalizeNonEmptyString(params.savedRouteID);
    const sourceRevisionKey = normalizeNonEmptyString(params.sourceRevisionKey);
    if (!userID || !savedRouteID || !sourceRevisionKey) {
        throw new Error('userID, savedRouteID, and sourceRevisionKey are required for route delivery sync queue items.');
    }

    const queueItemId = await buildRouteDeliverySyncQueueItemId(params.routeId, userID, savedRouteID, sourceRevisionKey);
    const db = admin.firestore();
    const queueDocRef = db.collection(ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME).doc(queueItemId);
    const decision = await db.runTransaction(async (transaction): Promise<QueueInsertDecision> => {
        const existingSnapshot = await transaction.get(queueDocRef);
        let deletionGuard;
        try {
            deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
        } catch (error) {
            throw new UserDeletionGuardReadError(userID, 'route_delivery_sync_queue_transaction', error);
        }

        if (deletionGuard.shouldSkip) {
            return {
                enqueued: false,
                queueItemId,
                reason: 'user_deleted_or_deleting',
            };
        }

        if (existingSnapshot.exists) {
            const existingData = existingSnapshot.data() as Partial<RouteDeliverySyncQueueItemInterface>;
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
        const queueItem: RouteDeliverySyncQueueItemInterface = {
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
            userID,
            savedRouteID,
            sourceRevisionKey,
            sourceProviderRouteId: normalizeNonEmptyString(params.sourceProviderRouteId) || undefined,
            sourceProviderUserId: normalizeNonEmptyString(params.sourceProviderUserId) || undefined,
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
        if (!(await canDispatchRouteDeliverySyncQueueItem(db, queueDocRef, queueItemId, userID, 'route_delivery_sync_queue_dispatch_new'))) {
            return {
                enqueued: false,
                queueItemId,
                reason: 'user_deleted_or_deleting',
            };
        }
        const wasTaskEnqueued = await enqueueRouteDeliverySyncTask(queueItemId, decision.dateCreated || Date.now());
        if (wasTaskEnqueued) {
            if (!(await markRouteDeliverySyncQueueItemDispatchedIfUserActive(queueDocRef, queueItemId, userID, 'route_delivery_sync_queue_mark_new_dispatched'))) {
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
        if (!(await canDispatchRouteDeliverySyncQueueItem(db, queueDocRef, queueItemId, userID, 'route_delivery_sync_queue_redispatch_existing'))) {
            return {
                enqueued: false,
                queueItemId,
                reason: 'user_deleted_or_deleting',
            };
        }
        const wasTaskEnqueued = await enqueueRouteDeliverySyncTask(queueItemId, decision.dateCreated || Date.now());
        if (wasTaskEnqueued) {
            if (!(await markRouteDeliverySyncQueueItemDispatchedIfUserActive(queueDocRef, queueItemId, userID, 'route_delivery_sync_queue_mark_existing_dispatched'))) {
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
