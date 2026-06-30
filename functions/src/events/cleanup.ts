import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

async function shouldSkipEventCleanup(userId: string, eventId: string, phase: string): Promise<boolean> {
    try {
        const currentEventSnapshot = await admin.firestore().doc(`users/${userId}/events/${eventId}`).get();
        if (currentEventSnapshot.exists) {
            logger.warn('[Cleanup] stale_delete_trigger_skipped: event exists again, skipping destructive cleanup.', {
                userId,
                eventId,
                phase,
            });
            return true;
        }
        return false;
    } catch (error) {
        logger.error('[Cleanup] stale_delete_guard_failed: could not verify event absence, skipping destructive cleanup.', {
            userId,
            eventId,
            phase,
            error,
        });
        return true;
    }
}

interface ActivityCleanupResult {
    skipped: boolean;
    deletedCount: number;
}

async function deleteLinkedActivitiesIfEventStillMissing(userId: string, eventId: string): Promise<ActivityCleanupResult> {
    const db = admin.firestore();
    const eventRef = db.doc(`users/${userId}/events/${eventId}`);
    const activitiesQuery = db.collection(`users/${userId}/activities`).where('eventID', '==', eventId);

    const result = await db.runTransaction(async (transaction): Promise<ActivityCleanupResult> => {
        const currentEventSnapshot = await transaction.get(eventRef);
        if (currentEventSnapshot.exists) {
            return { skipped: true, deletedCount: 0 };
        }

        const activitySnapshot = await transaction.get(activitiesQuery);
        if (activitySnapshot.empty) {
            return { skipped: false, deletedCount: 0 };
        }

        activitySnapshot.docs.forEach((doc) => {
            // Flat activity documents do not own cleanup-managed subcollections.
            transaction.delete(doc.ref);
        });

        return { skipped: false, deletedCount: activitySnapshot.size };
    });

    if (result.skipped) {
        logger.warn('[Cleanup] stale_delete_trigger_skipped: event exists again, skipping destructive cleanup.', {
            userId,
            eventId,
            phase: 'activity_transaction',
        });
    } else if (result.deletedCount === 0) {
        logger.info(`[Cleanup] No flat activities found for event ${eventId}`);
    } else {
        logger.info(`[Cleanup] Successfully deleted ${result.deletedCount} linked activities for event ${eventId}`);
    }

    return result;
}

export const cleanupEventFile = onDocumentDeleted({
    document: 'users/{userId}/events/{eventId}',
    region: 'europe-west2',
    memory: '1GiB',
    maxInstances: 10,
    concurrency: 5,
    timeoutSeconds: 300,
}, async (event) => {
    const snap = event.data;
    const eventId = event.params.eventId;
    const userId = event.params.userId;

    if (!snap) {
        logger.info(`[Cleanup] No data associated with event ${eventId} for user ${userId}.`);
        return;
    }

    logger.info(`[Cleanup] Event ${eventId} for user ${userId} deleted. Checking for original file.`);

    // Delete linked activities (Flat structure)
    try {
        const activityCleanup = await deleteLinkedActivitiesIfEventStillMissing(userId, eventId);
        if (activityCleanup.skipped) {
            return;
        }
    } catch (error) {
        logger.error(`[Cleanup] Failed to delete linked activities for event ${eventId}`, error);
        return;
    }

    // Delete linked metaData (Subcollection)
    try {
        if (await shouldSkipEventCleanup(userId, eventId, 'before_metadata_cleanup')) {
            return;
        }
        const metaDataRef = admin.firestore().collection(`users/${userId}/events/${eventId}/metaData`);
        // Using recursiveDelete to efficiently remove the entire subcollection
        await admin.firestore().recursiveDelete(metaDataRef);
        logger.info(`[Cleanup] Successfully requested recursive delete for metaData of event ${eventId}`);
    } catch (error) {
        logger.error(`[Cleanup] Failed to delete metaData for event ${eventId}`, error);
    }

    const prefix = `users/${userId}/events/${eventId}/`;

    try {
        if (await shouldSkipEventCleanup(userId, eventId, 'before_storage_cleanup')) {
            return;
        }
        logger.info(`[Cleanup] Deleting all files with prefix ${prefix}`);
        await admin.storage().bucket().deleteFiles({ prefix });
        logger.info(`[Cleanup] Successfully deleted files with prefix ${prefix}`);
    } catch (error) {
        logger.error(`[Cleanup] Failed to delete files with prefix ${prefix}`, error);
    }
});
