
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

export const cleanupEventFile = onDocumentDeleted({
    document: 'users/{userId}/events/{eventId}',
    region: 'europe-west2',
}, async (event) => {
    const snap = event.data;
    const eventId = event.params.eventId;
    const userId = event.params.userId;

    if (!snap) {
        console.log(`[Cleanup] No data associated with event ${eventId} for user ${userId}.`);
        return;
    }

    const deletedData = snap.data();

    console.log(`[Cleanup] Event ${eventId} for user ${userId} deleted. Checking for original file.`);

    // Delete subcollections (activities, streams, etc.)
    try {
        const path = `users/${userId}/events/${eventId}/activities`;
        console.log(`[Cleanup] Recursively deleting activities at ${path}`);
        await admin.firestore().recursiveDelete(admin.firestore().collection(path));
        console.log(`[Cleanup] Successfully deleted activities for event ${eventId}`);
    } catch (error) {
        console.error(`[Cleanup] Failed to delete activities for event ${eventId}`, error);
    }

    if (deletedData && deletedData.originalFile && deletedData.originalFile.path) {
        const filePath = deletedData.originalFile.path;
        console.log(`[Cleanup] Found original file at ${filePath}. Deleting...`);
        try {
            await admin.storage().bucket().file(filePath).delete();
            console.log(`[Cleanup] Successfully deleted ${filePath}`);
        } catch (error) {
            console.error(`[Cleanup] Failed to delete file ${filePath}`, error);
        }
    } else {
        console.log(`[Cleanup] No originalFile record found for ${eventId}.`);
    }
});
