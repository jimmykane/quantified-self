import { AppEventInterface } from './app-event.interface';

/**
 * Logger adapter interface for cross-environment compatibility.
 * Allows EventWriter to work in both browser (Angular) and Node.js (Firebase Functions) environments.
 */
export interface LogAdapter {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string | Error, ...args: unknown[]): void;
}

/**
 * Default console-based logger for environments where no logger is provided.
 * Used by the frontend Angular application.
 */
export const consoleLogAdapter: LogAdapter = {
    info: (message: string, ...args: unknown[]) => console.log('[EventWriter]', message, ...args),
    warn: (message: string, ...args: unknown[]) => console.warn('[EventWriter]', message, ...args),
    error: (message: string | Error, ...args: unknown[]) => console.error('[EventWriter]', message, ...args),
};

export interface FirestoreAdapter {
    setDoc(path: string[], data: unknown): Promise<void>;
    createBlob(data: Uint8Array): unknown;
    generateID(): string;
}

export interface StorageAdapter {
    uploadFile(path: string, data: unknown, metadata?: unknown): Promise<void>;
    getBucketName?(): string;  // Optional: some adapters may provide bucket name
}

export interface OriginalFile {
    data: unknown;
    extension: string;
    startDate: Date;
    originalFilename?: string;
}

export class EventWriter {
    private logger: LogAdapter;

    constructor(
        private adapter: FirestoreAdapter,
        private storageAdapter?: StorageAdapter,
        private bucketName?: string,
        logger?: LogAdapter
    ) {
        this.logger = logger || consoleLogAdapter;
    }

    /**
     * Writes event data, activities, and original file(s) to Firestore and Storage.
     * 
     * ## Original File Storage Strategy
     * 
     * This method implements a dual-field strategy for storing original file metadata:
     * 
     * - **`originalFiles`** (array): The canonical field. Always stored as an array, even for
     *   single file uploads. This supports merged events (multiple source files) and provides
     *   a consistent data structure for the reader.
     * 
     * - **`originalFile`** (object): Legacy/convenience field. Always points to the first file
     *   in the array. Provides backwards compatibility with older code and simpler access
     *   for single-file cases.
     * 
     * ### Write Behavior
     * - Single file passed → Normalized to array internally → Both fields written
     * - Array of files passed → Both fields written (originalFile = first element)
     * - No files passed → Preserves existing metadata from event object
     * 
     * ### Read Behavior (in AppEventService)
     * - Readers should check `originalFiles` first (canonical source)
     * - Fall back to `originalFile` only for events written before this normalization
     * 
     * @param userID - The user's Firebase UID
     * @param event - The event to write (must have activities attached)
     * @param originalFiles - Optional original file(s) to upload to Storage
     */
    public async writeAllEventData(userID: string, event: AppEventInterface, originalFiles?: OriginalFile[] | OriginalFile): Promise<void> {
        this.logger.info('writeAllEventData called', { userID, eventID: event.getID(), adapterPresent: !!this.storageAdapter });
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                delete (activityJSON as any).streams;

                // Write Activity
                // Add flat structure metadata
                (activityJSON as any).userID = userID;
                (activityJSON as any).eventID = event.getID();
                // Ensure eventStartDate is present for sorting
                if (event.startDate) {
                    (activityJSON as any).eventStartDate = event.startDate;
                }


                writePromises.push(
                    this.adapter.setDoc(
                        // New path: users/{userID}/activities/{activityID}
                        ['users', userID, 'activities', <string>activity.getID()],
                        activityJSON
                    )
                );
            }

            // Write Event
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const eventJSON: any = event.toJSON();
            delete eventJSON.activities;

            // Normalize input to array or single
            let filesToUpload: { data: unknown, extension: string, startDate: Date, originalFilename?: string }[] = [];
            if (originalFiles) {
                if (Array.isArray(originalFiles)) {
                    filesToUpload = originalFiles;
                } else {
                    filesToUpload = [originalFiles];
                }
            }

            if (filesToUpload.length > 0 && this.storageAdapter) {
                const uploadedFilesMetadata: { path: string, bucket?: string, startDate: Date, originalFilename?: string }[] = [];

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

                    this.logger.info(`Uploading file ${i + 1}/${filesToUpload.length} to`, filePath);
                    await this.storageAdapter.uploadFile(filePath, file.data);

                    uploadedFilesMetadata.push({
                        path: filePath,
                        bucket: this.storageAdapter.getBucketName?.() || this.bucketName,
                        startDate: file.startDate,
                        originalFilename: file.originalFilename // Save if present
                    });
                }

                this.logger.info('Upload complete. Adding metadata to eventJSON');

                // Dual-field strategy: Write both originalFiles (canonical) and originalFile (legacy)
                // See method JSDoc for full explanation of this pattern
                if (uploadedFilesMetadata.length > 0) {
                    this.logger.info('Assigning metadata to eventJSON:', uploadedFilesMetadata.length);
                    // Canonical: Always an array, even for single files
                    eventJSON.originalFiles = uploadedFilesMetadata;
                    // Legacy: Always points to first file for backwards compatibility
                    eventJSON.originalFile = uploadedFilesMetadata[0];
                } else {
                    this.logger.info('No metadata to assign (uploadedFilesMetadata empty)');
                }

            } else {
                this.logger.warn('Skipping file upload.', 'storageAdapter:', !!this.storageAdapter);
                // Preserve existing file metadata if no new files are being uploaded
                if (event.originalFiles) {
                    eventJSON.originalFiles = event.originalFiles;
                }
                if (event.originalFile) {
                    eventJSON.originalFile = event.originalFile;
                }
            }

            writePromises.push(
                this.adapter.setDoc(['users', userID, 'events', <string>event.getID()], eventJSON)
            );

            await Promise.all(writePromises);
        } catch (e) {
            const error = e as Error;
            this.logger.error(error);
            throw new Error('Could not write event data: ' + error.message);
        }
    }
}

