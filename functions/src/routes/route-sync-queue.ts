import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';

import { enqueueRouteSyncTask, generateIDFromParts } from '../utils';
import { RouteSyncQueueItemInterface } from '../queue/queue-item.interface';
import { isPendingDisconnectQueueItemDeferred } from '../queue-utils';
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
import {
    ProviderQueueUserDeletedOrDeletingError,
    ProviderQueueUserNotConnectedError,
} from '../queue/provider-queue-errors';
import { ROUTE_SYNC_QUEUE_COLLECTION_NAME } from './route-sync.constants';

interface EnqueueRouteSyncQueueItemParams {
    sourceServiceName: ServiceNames;
    providerUserId: string;
    providerRouteId: string;
    providerRouteName?: string | null;
    providerRouteCreatedAt?: number | null;
    providerRouteModifiedAt?: number | null;
    manual: boolean;
    firebaseUserID?: string | null;
}

export interface EnqueueRouteSyncQueueItemResult {
    enqueued: boolean;
    queueItemId: string;
    reason?: 'already_pending' | 'user_deleted_or_deleting';
    redispatched?: boolean;
}

interface QueueInsertDecision {
    enqueued: boolean;
    queueItemId: string;
    reason?: 'already_pending' | 'user_deleted_or_deleting';
    dateCreated?: number;
    shouldDispatchExisting?: boolean;
}

function normalizeNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function resolveFirebaseUserIDForRouteSync(
    params: EnqueueRouteSyncQueueItemParams,
    queueItemId: string,
): Promise<string> {
    const explicitFirebaseUserID = normalizeNonEmptyString(params.firebaseUserID);
    if (explicitFirebaseUserID) {
        return explicitFirebaseUserID;
    }

    const providerUserId = normalizeNonEmptyString(params.providerUserId) || 'unknown';
    const tokenSnapshot = await admin.firestore()
        .collectionGroup('tokens')
        .where('userName', '==', providerUserId)
        .where('serviceName', '==', params.sourceServiceName)
        .limit(1)
        .get();
    const firebaseUserID = tokenSnapshot.docs[0]?.ref.parent.parent?.id || null;
    if (!firebaseUserID) {
        throw new ProviderQueueUserNotConnectedError(params.sourceServiceName, providerUserId, queueItemId);
    }

    return firebaseUserID;
}

async function deleteQueueDocAfterDeletionGuard(
    db: admin.firestore.Firestore,
    queueDocRef: admin.firestore.DocumentReference,
    queueItemId: string,
    userID: string,
): Promise<void> {
    try {
        const tombstoneWritten = await markQueueItemDeletedForUserCleanup(
            ROUTE_SYNC_QUEUE_COLLECTION_NAME,
            queueItemId,
            QUEUE_CLEANUP_TOMBSTONE_REASONS.UserDeletionGuard,
        );
        if (!tombstoneWritten) {
            logger.error(`[RouteSync] Failed to write cleanup tombstone for queue item ${queueItemId}; leaving item in place to avoid missing-doc Cloud Task retries.`);
            return;
        }
        await db.recursiveDelete(queueDocRef);
        logger.info(`[RouteSync] Deleted queue item ${queueItemId} for deleting user ${userID} before Cloud Task dispatch.`);
    } catch (error) {
        logger.error(`[RouteSync] Failed to delete queue item ${queueItemId} after deletion guard tripped for user ${userID}`, error);
    }
}

async function canDispatchRouteSyncQueueItem(
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

async function markRouteSyncQueueItemDispatchedIfUserActive(
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
        logPrefix: 'RouteSync',
    });
    return result === QueueDispatchMarkerResult.Marked;
}

export async function buildRouteSyncQueueItemId(
    sourceServiceName: ServiceNames,
    providerUserId: string,
    providerRouteId: string,
): Promise<string> {
    return generateIDFromParts(['routeSync', sourceServiceName, providerUserId, providerRouteId]);
}

export async function enqueueRouteSyncQueueItem(
    params: EnqueueRouteSyncQueueItemParams,
): Promise<EnqueueRouteSyncQueueItemResult> {
    const providerUserId = normalizeNonEmptyString(params.providerUserId);
    const providerRouteId = normalizeNonEmptyString(params.providerRouteId);
    if (!providerUserId || !providerRouteId) {
        throw new Error('providerUserId and providerRouteId are required for route sync queue items.');
    }

    const queueItemId = await buildRouteSyncQueueItemId(params.sourceServiceName, providerUserId, providerRouteId);
    const firebaseUserID = await resolveFirebaseUserIDForRouteSync(params, queueItemId);
    const db = admin.firestore();
    const queueDocRef = db.collection(ROUTE_SYNC_QUEUE_COLLECTION_NAME).doc(queueItemId);
    const decision = await db.runTransaction(async (transaction): Promise<QueueInsertDecision> => {
        const existingSnapshot = await transaction.get(queueDocRef);
        let deletionGuard;
        try {
            deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, firebaseUserID);
        } catch (error) {
            throw new UserDeletionGuardReadError(firebaseUserID, 'route_sync_queue_transaction', error);
        }

        if (deletionGuard.shouldSkip) {
            throw new ProviderQueueUserDeletedOrDeletingError(
                params.sourceServiceName,
                firebaseUserID,
                providerUserId,
                queueItemId,
            );
        }

        if (existingSnapshot.exists) {
            const existingData = existingSnapshot.data() as Partial<RouteSyncQueueItemInterface>;
            const isDeferredForPendingDisconnect = isPendingDisconnectQueueItemDeferred(existingData);
            if (isDeferredForPendingDisconnect || !existingData.processed) {
                transaction.set(queueDocRef, {
                    providerRouteName: params.providerRouteName || existingData.providerRouteName || null,
                    providerRouteCreatedAt: params.providerRouteCreatedAt ?? existingData.providerRouteCreatedAt ?? null,
                    providerRouteModifiedAt: params.providerRouteModifiedAt ?? existingData.providerRouteModifiedAt ?? null,
                    manual: params.manual === true,
                }, { merge: true });
                return {
                    enqueued: false,
                    queueItemId,
                    reason: 'already_pending',
                    dateCreated: Number(existingData.dateCreated) || Date.now(),
                    shouldDispatchExisting: !isDeferredForPendingDisconnect
                        && (existingData.dispatchedToCloudTask === null || existingData.dispatchedToCloudTask === undefined),
                };
            }
        }

        const dateCreated = Date.now();
        const queueItem: RouteSyncQueueItemInterface = {
            id: queueItemId,
            dateCreated,
            processed: false,
            retryCount: 0,
            totalRetryCount: 0,
            errors: [],
            dispatchedToCloudTask: null,
            expireAt: getExpireAtTimestamp(TTL_CONFIG.QUEUE_ITEM_IN_DAYS),
            sourceServiceName: params.sourceServiceName,
            firebaseUserID,
            providerUserId,
            providerRouteId,
            providerRouteName: params.providerRouteName || undefined,
            providerRouteCreatedAt: params.providerRouteCreatedAt ?? null,
            providerRouteModifiedAt: params.providerRouteModifiedAt ?? null,
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
        if (!(await canDispatchRouteSyncQueueItem(db, queueDocRef, queueItemId, firebaseUserID, 'route_sync_queue_dispatch_new'))) {
            return {
                enqueued: false,
                queueItemId,
                reason: 'user_deleted_or_deleting',
            };
        }
        const wasTaskEnqueued = await enqueueRouteSyncTask(queueItemId, decision.dateCreated || Date.now());
        if (wasTaskEnqueued) {
            if (!(await markRouteSyncQueueItemDispatchedIfUserActive(queueDocRef, queueItemId, firebaseUserID, 'route_sync_queue_mark_new_dispatched'))) {
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
        if (!(await canDispatchRouteSyncQueueItem(db, queueDocRef, queueItemId, firebaseUserID, 'route_sync_queue_redispatch_existing'))) {
            return {
                enqueued: false,
                queueItemId,
                reason: 'user_deleted_or_deleting',
            };
        }
        const wasTaskEnqueued = await enqueueRouteSyncTask(queueItemId, decision.dateCreated || Date.now());
        if (wasTaskEnqueued) {
            if (!(await markRouteSyncQueueItemDispatchedIfUserActive(queueDocRef, queueItemId, firebaseUserID, 'route_sync_queue_mark_existing_dispatched'))) {
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
