import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    getUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';

export enum QueueDispatchMarkerResult {
    Marked = 'marked',
    SkippedDeletedUser = 'skipped_deleted_user',
}

export enum QueueItemUserGuardedUpdateResult {
    Updated = 'updated',
    SkippedDeletedUser = 'skipped_deleted_user',
}

export interface UpdateQueueItemIfUserActiveParams {
    queueItemDocument: admin.firestore.DocumentReference;
    queueItemId: string;
    userID: string;
    phase: string;
    updateData: Record<string, unknown>;
    logPrefix: string;
    actionDescription: string;
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

        await Promise.resolve(transaction.update(params.queueItemDocument, params.updateData));
        return QueueItemUserGuardedUpdateResult.Updated;
    });

    if (result === QueueItemUserGuardedUpdateResult.SkippedDeletedUser) {
        try {
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
