
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

export const cleanupEventFile = functions.firestore
    .document('users/{userId}/events/{eventId}')
    .onDelete(async (snap, context) => {
        const deletedData = snap.data();
        const eventId = context.params.eventId;
        const userId = context.params.userId;

        console.log(`[Cleanup] Event ${eventId} for user ${userId} deleted. Checking for original file.`);

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
