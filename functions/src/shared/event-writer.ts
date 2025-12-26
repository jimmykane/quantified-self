import * as logger from 'firebase-functions/logger';
import { AppEventInterface } from './app-event.interface';


export interface FirestoreAdapter {
    setDoc(path: string[], data: any): Promise<void>;
    createBlob(data: Uint8Array): any;
    generateID(): string;
}

export interface StorageAdapter {
    uploadFile(path: string, data: any, metadata?: any): Promise<void>;
    getBucketName?(): string;  // Optional: some adapters may provide bucket name
}

export class EventWriter {
    constructor(private adapter: FirestoreAdapter, private storageAdapter?: StorageAdapter, private bucketName?: string) { }

    public async writeAllEventData(userID: string, event: AppEventInterface, originalFiles?: { data: any, extension: string, startDate?: Date }[] | { data: any, extension: string, startDate?: Date }): Promise<void> {
        logger.info('[EventWriter] writeAllEventData called', { userID, eventID: event.getID(), adapterPresent: !!this.storageAdapter });
        const writePromises: Promise<void>[] = [];

        // Ensure Event ID
        if (!event.getID()) {
            event.setID(this.adapter.generateID());
        }

        try {
            for (const activity of event.getActivities()) {
                // Ensure Activity ID
                if (!activity.getID()) {
                    activity.setID(this.adapter.generateID());
                }

                const activityJSON = activity.toJSON();
                delete (activityJSON as any).streams;

                // Write Activity
                writePromises.push(
                    this.adapter.setDoc(
                        ['users', userID, 'events', <string>event.getID(), 'activities', <string>activity.getID()],
                        activityJSON
                    )
                );
            }

            // Write Event
            const eventJSON: any = event.toJSON();
            delete (eventJSON as any).activities;

            // Normalize input to array or single
            let filesToUpload: { data: any, extension: string, startDate?: Date }[] = [];
            if (originalFiles) {
                if (Array.isArray(originalFiles)) {
                    filesToUpload = originalFiles;
                } else {
                    filesToUpload = [originalFiles];
                }
            }

            if (filesToUpload.length > 0 && this.storageAdapter) {
                const uploadedFilesMetadata: { path: string, bucket?: string, startDate?: Date }[] = [];

                for (let i = 0; i < filesToUpload.length; i++) {
                    const file = filesToUpload[i];
                    // If multiple files, append index to name. If single (legacy behavior), keep standard name
                    // BUT: if we are merging, we might have files with different extensions. 
                    // AND duplicate extensions.
                    // Safe naming: original_${i}.${extension}
                    // For legacy single file (length=1), we want to preserve "original.ext" if possible? 
                    // Yes, keeps URLs cleaner.

                    let filePath: string;
                    if (filesToUpload.length === 1) {
                        filePath = `users/${userID}/events/${event.getID()}/original.${file.extension}`;
                    } else {
                        filePath = `users/${userID}/events/${event.getID()}/original_${i}.${file.extension}`;
                    }

                    logger.info(`[EventWriter] Uploading file ${i + 1}/${filesToUpload.length} to`, filePath);
                    await this.storageAdapter.uploadFile(filePath, file.data);

                    uploadedFilesMetadata.push({
                        path: filePath,
                        bucket: this.storageAdapter.getBucketName?.() || this.bucketName,
                        startDate: file.startDate,
                    });
                }

                logger.info('[EventWriter] Upload complete. Adding metadata to eventJSON');

                // Write 'originalFiles' array and 'originalFile' legacy
                if (uploadedFilesMetadata.length > 0) {
                    logger.info('[EventWriter] Assigning metadata to eventJSON:', uploadedFilesMetadata.length);
                    eventJSON.originalFiles = uploadedFilesMetadata;
                    // Always set primary legacy pointer to the first file
                    eventJSON.originalFile = uploadedFilesMetadata[0];
                } else {
                    logger.info('[EventWriter] No metadata to assign (uploadedFilesMetadata empty)');
                }

            } else {
                logger.warn('[EventWriter] Skipping file upload.', 'storageAdapter:', !!this.storageAdapter);
            }

            writePromises.push(
                this.adapter.setDoc(['users', userID, 'events', <string>event.getID()], eventJSON)
            );

            await Promise.all(writePromises);
        } catch (e: any) {
            logger.error(e);
            throw new Error('Could not write event data: ' + e.message);
        }
    }
}
