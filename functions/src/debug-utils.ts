import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { config } from './config';

/**
 * Uploads a file to the debug folder in Cloud Storage.
 * Swallow errors to ensure the main error handling flow is not interrupted.
 * 
 * @param fileData The raw file data (Buffer, string, or object)
 * @param extension File extension (e.g. 'fit', 'xml')
 * @param queueItemId ID of the queue item that failed
 * @param serviceName Name of the service (e.g. 'suunto', 'coros', 'garmin')
 * @param userId The Firebase user ID
 */
export async function uploadDebugFile(fileData: any, extension: string, queueItemId: string, serviceName: string, userId: string): Promise<void> {
    try {
        const bucket = admin.storage().bucket(config.debug.bucketName);
        const fileName = `${serviceName}/${userId}/${queueItemId}.${extension}`;
        const file = bucket.file(fileName);

        await file.save(fileData);

        logger.info(`[DebugUpload] Uploaded failed file to gs://${config.debug.bucketName}/${fileName}`);
    } catch (error) {
        logger.error('[DebugUpload] Failed to upload debug file:', error);
    }
}
