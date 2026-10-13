import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { HistoryLifecycleChangedError } from '../connection-history/execution';
import { currentHistoryExecution } from '../connection-history/context';
import { normalizeQueueRevision } from '../queue/revision-identity';
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
import { ROUTE_SYNC_QUEUE_COLLECTION_NAME, isRouteHistoryDispatchDue } from './route-sync.constants';
import { getCloudTaskRetryBackoffSeconds } from '../shared/queue-config';
import { observeRouteDispatch, recordRouteDispatchFailure } from './monitoring';

interface EnqueueRouteSyncQueueItemParams {
    sourceServiceName: ServiceNames;
    providerUserId: string;
    providerRouteId: string;
    providerRouteName?: string | null;
    providerRouteCreatedAt?: number | null;
    providerRouteModifiedAt?: number | null;
    manual: boolean;
    firebaseUserID: string;
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
    queueRevision?: string;
    retryCount?: number;
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
    throw new ProviderQueueUserNotConnectedError(
        params.sourceServiceName,
        providerUserId,
        queueItemId,
    );
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
            recordRouteDispatchFailure('import', null, 'immediate', 'cleanup');
            logger.error(`[RouteSync] Failed to write cleanup tombstone for queue item ${queueItemId}; leaving item in place to avoid missing-doc Cloud Task retries.`);
            return;
        }
        await db.recursiveDelete(queueDocRef);
        logger.info(`[RouteSync] Deleted queue item ${queueItemId} for deleting user ${userID} before Cloud Task dispatch.`);
    } catch (error) {
        recordRouteDispatchFailure('import', null, 'immediate', 'cleanup');
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
    historyIdentity?: { runId: string; queueRevision: string; dateCreated: number; retryCount: number },
): Promise<boolean> {
    const result = await markQueueItemDispatchedIfUserActive({
        queueItemDocument: queueDocRef,
        queueItemId,
        userID,
        phase,
        dispatchedAtMs: Date.now(),
        logPrefix: 'RouteSync',
        ...(historyIdentity ? { isCurrent: (current: Record<string, unknown>) => current.processed !== true
            && current.firebaseUserID === userID && current.connectionHistoryRunId === historyIdentity.runId
            && normalizeQueueRevision(current.queueRevision) === historyIdentity.queueRevision
            && current.dateCreated === historyIdentity.dateCreated
            && Number(current.retryCount || 0) === historyIdentity.retryCount } : {}),
    });
    return result === QueueDispatchMarkerResult.Marked || result === QueueDispatchMarkerResult.NotCurrent;
}

export async function buildRouteSyncQueueItemId(
    sourceServiceName: ServiceNames,
    providerUserId: string,
    providerRouteId: string,
    firebaseUserID: string,
    connectionHistoryRunId?: string,
): Promise<string> {
    const normalizedFirebaseUserID = normalizeNonEmptyString(firebaseUserID);
    return generateIDFromParts([
        'routeSync',
        sourceServiceName,
        providerUserId,
        providerRouteId,
        ...(normalizedFirebaseUserID ? [normalizedFirebaseUserID] : []),
        ...(connectionHistoryRunId ? ['connectionHistory', connectionHistoryRunId] : []),
    ]);
}

export async function enqueueRouteSyncQueueItem(
    params: EnqueueRouteSyncQueueItemParams,
): Promise<EnqueueRouteSyncQueueItemResult> {
    const providerUserId = normalizeNonEmptyString(params.providerUserId);
    const providerRouteId = normalizeNonEmptyString(params.providerRouteId);
    if (!providerUserId || !providerRouteId) {
        throw new Error('providerUserId and providerRouteId are required for route sync queue items.');
    }

    const execution = currentHistoryExecution();
    if (execution && (execution.userID !== params.firebaseUserID || execution.serviceName !== params.sourceServiceName
        || execution.providerUserId !== providerUserId)) throw new HistoryLifecycleChangedError();
    const queueItemId = await buildRouteSyncQueueItemId(
        params.sourceServiceName,
        providerUserId,
        providerRouteId,
        params.firebaseUserID,
        execution?.runId,
    );
    const firebaseUserID = await resolveFirebaseUserIDForRouteSync(params, queueItemId);
    const db = admin.firestore();
    const queueDocRef = db.collection(ROUTE_SYNC_QUEUE_COLLECTION_NAME).doc(queueItemId);
    const decision = await db.runTransaction(async (transaction): Promise<QueueInsertDecision> => {
        const existingSnapshot = await transaction.get(queueDocRef);
        await execution?.inTransaction(transaction);
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

        if (execution && existingSnapshot.exists) {
            const existingData = existingSnapshot.data() as Partial<RouteSyncQueueItemInterface>;
            // A checkpoint replay observes the same child, including its terminal result.
            return { enqueued: false, queueItemId, reason: 'already_pending',
                dateCreated: Number(existingData.dateCreated) || Date.now(),
                queueRevision: normalizeQueueRevision(existingData.queueRevision) || undefined,
                retryCount: Number(existingData.retryCount || 0),
                shouldDispatchExisting: isRouteHistoryDispatchDue(existingData) };
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
            ...(execution ? { connectionHistoryRunId: execution.runId, queueRevision: randomUUID() } : {}),
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
            ...(execution ? { queueRevision: queueItem.queueRevision, retryCount: 0 } : {}),
        };
    });

    execution?.onQueued(queueDocRef.path);
    const historyIdentity = execution && decision.queueRevision ? { runId: execution.runId,
        queueRevision: decision.queueRevision, dateCreated: decision.dateCreated!, retryCount: decision.retryCount ?? 0 } : undefined;
    const enqueueTask = () => historyIdentity
        ? enqueueRouteSyncTask(queueItemId, historyIdentity.dateCreated, undefined, {
            queueRevision: historyIdentity.queueRevision, queueDateCreated: historyIdentity.dateCreated,
            recoveryTaskKey: Math.floor(Date.now() / 60_000),
            recoveryScheduleDelaySeconds: getCloudTaskRetryBackoffSeconds(historyIdentity.retryCount),
        })
        : enqueueRouteSyncTask(queueItemId, decision.dateCreated || Date.now());
    if (decision.enqueued) {
        if (!(await observeRouteDispatch('import', params, 'guard', () => canDispatchRouteSyncQueueItem(db, queueDocRef, queueItemId, firebaseUserID, 'route_sync_queue_dispatch_new')))) {
            return {
                enqueued: false,
                queueItemId,
                reason: 'user_deleted_or_deleting',
            };
        }
        const wasTaskEnqueued = await observeRouteDispatch('import', params, 'enqueue', enqueueTask);
        if (wasTaskEnqueued) {
            if (!(await observeRouteDispatch('import', params, 'marker', () => markRouteSyncQueueItemDispatchedIfUserActive(queueDocRef, queueItemId, firebaseUserID, 'route_sync_queue_mark_new_dispatched', historyIdentity)))) {
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
        if (!(await observeRouteDispatch('import', params, 'guard', () => canDispatchRouteSyncQueueItem(db, queueDocRef, queueItemId, firebaseUserID, 'route_sync_queue_redispatch_existing')))) {
            return {
                enqueued: false,
                queueItemId,
                reason: 'user_deleted_or_deleting',
            };
        }
        const wasTaskEnqueued = await observeRouteDispatch('import', params, 'enqueue', enqueueTask);
        if (wasTaskEnqueued) {
            if (!(await observeRouteDispatch('import', params, 'marker', () => markRouteSyncQueueItemDispatchedIfUserActive(queueDocRef, queueItemId, firebaseUserID, 'route_sync_queue_mark_existing_dispatched', historyIdentity)))) {
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
