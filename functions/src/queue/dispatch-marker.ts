import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    getUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import {
    markQueueItemDeletedForUserCleanup,
    QUEUE_CLEANUP_TOMBSTONE_REASONS,
} from './cleanup-tombstone';

export enum QueueDispatchMarkerResult {
    Marked = 'marked',
    SkippedDeletedUser = 'skipped_deleted_user',
}

export enum QueueItemUserGuardedUpdateResult {
    Updated = 'updated',
    SkippedDeletedUser = 'skipped_deleted_user',
    NotCurrent = 'not_current',
}

export interface UpdateQueueItemIfUserActiveParams {
    queueItemDocument: admin.firestore.DocumentReference;
    queueItemId: string;
    userID: string;
    phase: string;
    updateData: Record<string, unknown>;
    logPrefix: string;
    actionDescription: string;
    /**
     * Optional optimistic-concurrency guard for a queue item that can be
     * replaced by a newer provider revision between enqueue and marker write.
     */
    isCurrent?: (queueItem: Record<string, unknown>) => boolean;
}

export interface MarkQueueItemDispatchedIfUserActiveParams {
    queueItemDocument: admin.firestore.DocumentReference;
    queueItemId: string;
    userID: string;
    phase: string;
    dispatchedAtMs: number;
    logPrefix: string;
}

export async function markQueueItemDispatchedIfUserActive(
    params: MarkQueueItemDispatchedIfUserActiveParams,
): Promise<QueueDispatchMarkerResult> {
    const result = await updateQueueItemIfUserActive({
        queueItemDocument: params.queueItemDocument,
        queueItemId: params.queueItemId,
        userID: params.userID,
        phase: params.phase,
        updateData: {
            dispatchedToCloudTask: params.dispatchedAtMs,
        },
        logPrefix: params.logPrefix,
        actionDescription: 'dispatch marker write',
    });

    return result === QueueItemUserGuardedUpdateResult.Updated
        ? QueueDispatchMarkerResult.Marked
        : QueueDispatchMarkerResult.SkippedDeletedUser;
}

export async function updateQueueItemIfUserActive(
    params: UpdateQueueItemIfUserActiveParams,
): Promise<QueueItemUserGuardedUpdateResult> {
    const db = admin.firestore();
    const result = await db.runTransaction(async (transaction) => {
        let deletionGuard;
        try {
            deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, params.userID);
        } catch (error) {
            throw new UserDeletionGuardReadError(params.userID, params.phase, error);
        }

        if (deletionGuard.shouldSkip) {
            logger.warn(
                `[${params.logPrefix}] Skipping ${params.actionDescription} for queue item ${params.queueItemId} because user ${params.userID} is missing or deletion is in progress.`,
            );
            return QueueItemUserGuardedUpdateResult.SkippedDeletedUser;
        }

        if (params.isCurrent) {
            const queueItemSnapshot = await transaction.get(params.queueItemDocument);
            const currentQueueItem = queueItemSnapshot.exists
                ? queueItemSnapshot.data() as Record<string, unknown>
                : null;
            if (!currentQueueItem || !params.isCurrent(currentQueueItem)) {
                logger.info(
                    `[${params.logPrefix}] Skipping ${params.actionDescription} for stale queue item ${params.queueItemId}.`,
                );
                return QueueItemUserGuardedUpdateResult.NotCurrent;
            }
        }

        await Promise.resolve(transaction.update(params.queueItemDocument, params.updateData));
        return QueueItemUserGuardedUpdateResult.Updated;
    });

    if (result === QueueItemUserGuardedUpdateResult.SkippedDeletedUser) {
        try {
            const collectionName = params.queueItemDocument.parent?.id;
            if (!collectionName) {
                logger.error(
                    `[${params.logPrefix}] Cannot determine queue collection for item ${params.queueItemId}; leaving item in place to avoid missing-doc Cloud Task retries.`,
                );
                return result;
            }
            const tombstoneWritten = await markQueueItemDeletedForUserCleanup(
                collectionName,
                params.queueItemId,
                QUEUE_CLEANUP_TOMBSTONE_REASONS.UserDeletionGuard,
            );
            if (!tombstoneWritten) {
                logger.error(
                    `[${params.logPrefix}] Failed to write cleanup tombstone for queue item ${params.queueItemId}; leaving item in place to avoid missing-doc Cloud Task retries.`,
                );
                return result;
            }
            await db.recursiveDelete(params.queueItemDocument);
            logger.info(
                `[${params.logPrefix}] Deleted queue item ${params.queueItemId} after deletion guard tripped before ${params.actionDescription}.`,
            );
        } catch (error) {
            logger.error(
                `[${params.logPrefix}] Failed to delete queue item ${params.queueItemId} after deletion guard tripped before ${params.actionDescription}.`,
                error,
            );
        }
    }

    return result;
}
