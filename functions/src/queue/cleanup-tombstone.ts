import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';

export const QUEUE_CLEANUP_TOMBSTONES_COLLECTION_NAME = 'queueCleanupTombstones';

export const QUEUE_CLEANUP_TOMBSTONE_REASONS = {
    AccountDeletionCleanup: 'account_deletion_cleanup',
    ServiceDisconnectCleanup: 'service_disconnect_cleanup',
    DispatcherCleanup: 'dispatcher_cleanup',
    UserDeletionGuard: 'user_deletion_guard',
} as const;

export type QueueCleanupTombstoneReason =
    typeof QUEUE_CLEANUP_TOMBSTONE_REASONS[keyof typeof QUEUE_CLEANUP_TOMBSTONE_REASONS];

function tombstoneDocumentID(collectionName: string, queueItemId: string): string {
    return `${encodeURIComponent(collectionName)}__${encodeURIComponent(queueItemId)}`;
}

export async function markQueueItemDeletedForUserCleanup(
    collectionName: string,
    queueItemId: string,
    reason: QueueCleanupTombstoneReason,
): Promise<boolean> {
    try {
        await admin.firestore()
            .collection(QUEUE_CLEANUP_TOMBSTONES_COLLECTION_NAME)
            .doc(tombstoneDocumentID(collectionName, queueItemId))
            .set({
                originalCollection: collectionName,
                queueItemId,
                reason,
                deletedAt: admin.firestore.FieldValue.serverTimestamp(),
                expireAt: getExpireAtTimestamp(TTL_CONFIG.QUEUE_ITEM_IN_DAYS),
            }, { merge: true });
        return true;
    } catch (error) {
        logger.error(
            `[QueueCleanup] Failed to write cleanup tombstone for ${collectionName}/${queueItemId}. Continuing with cleanup.`,
            error,
        );
        return false;
    }
}

export async function isQueueItemDeletedForUserCleanup(
    collectionName: string,
    queueItemId: string,
): Promise<boolean> {
    try {
        const snapshot = await admin.firestore()
            .collection(QUEUE_CLEANUP_TOMBSTONES_COLLECTION_NAME)
            .doc(tombstoneDocumentID(collectionName, queueItemId))
            .get();
        if (!snapshot.exists) {
            return false;
        }

        const data = snapshot.data() as { originalCollection?: unknown } | undefined;
        return data?.originalCollection === collectionName;
    } catch (error) {
        logger.error(
            `[QueueCleanup] Failed to read cleanup tombstone for ${collectionName}/${queueItemId}. Keeping normal retry behavior.`,
            error,
        );
        return false;
    }
}
