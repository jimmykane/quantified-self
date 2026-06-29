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

    if (await shouldSkipEventCleanup(userId, eventId, 'before_activity_cleanup')) {
        return;
    }

    // Delete linked activities (Flat structure)
    try {
        const activitiesRef = admin.firestore().collection(`users/${userId}/activities`);
        const snapshot = await activitiesRef.where('eventID', '==', eventId).get();

        if (snapshot.empty) {
            logger.info(`[Cleanup] No flat activities found for event ${eventId}`);
        } else {
            logger.info(`[Cleanup] Found ${snapshot.size} flat activities linked to event ${eventId}. Deleting...`);
            const batch = admin.firestore().batch();
            snapshot.docs.forEach((doc) => {
                batch.delete(doc.ref);
            });
            await batch.commit();
            logger.info(`[Cleanup] Successfully deleted linked activities for event ${eventId}`);
        }

    } catch (error) {
        logger.error(`[Cleanup] Failed to delete linked activities for event ${eventId}`, error);
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
