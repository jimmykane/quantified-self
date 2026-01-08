import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

export const cleanupEventFile = onDocumentDeleted({
    document: 'users/{userId}/events/{eventId}',
    region: 'europe-west2',
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

    const prefix = `users/${userId}/events/${eventId}/`;
    logger.info(`[Cleanup] Deleting all files with prefix ${prefix}`);

    try {
        await admin.storage().bucket().deleteFiles({ prefix });
        logger.info(`[Cleanup] Successfully deleted files with prefix ${prefix}`);
    } catch (error) {
        logger.error(`[Cleanup] Failed to delete files with prefix ${prefix}`, error);
    }
});
