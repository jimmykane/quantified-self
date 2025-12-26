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

    const deletedData = snap.data();

    logger.info(`[Cleanup] Event ${eventId} for user ${userId} deleted. Checking for original file.`);

    // Delete subcollections (activities, streams, etc.)
    try {
        const path = `users/${userId}/events/${eventId}/activities`;
        logger.info(`[Cleanup] Recursively deleting activities at ${path}`);
        await admin.firestore().recursiveDelete(admin.firestore().collection(path));
        logger.info(`[Cleanup] Successfully deleted activities for event ${eventId}`);
    } catch (error) {
        logger.error(`[Cleanup] Failed to delete activities for event ${eventId}`, error);
    }

    if (deletedData && deletedData.originalFile && deletedData.originalFile.path) {
        const filePath = deletedData.originalFile.path;
        logger.info(`[Cleanup] Found original file at ${filePath}. Deleting...`);
        try {
            await admin.storage().bucket().file(filePath).delete();
            logger.info(`[Cleanup] Successfully deleted ${filePath}`);
        } catch (error) {
            logger.error(`[Cleanup] Failed to delete file ${filePath}`, error);
        }
    } else {
        logger.info(`[Cleanup] No originalFile record found for ${eventId}.`);
    }
});
