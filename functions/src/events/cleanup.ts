
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

export const cleanupEventFile = functions.region('europe-west1').firestore
    .document('users/{userId}/events/{eventId}')
    .onDelete(async (snap: functions.firestore.QueryDocumentSnapshot, context: functions.EventContext) => {
        const deletedData = snap.data();
        const eventId = context.params.eventId;
        const userId = context.params.userId;

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
        return null;
    });
