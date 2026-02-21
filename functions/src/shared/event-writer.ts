import { AppEventInterface, FirestoreActivityJSON, FirestoreEventJSON } from './app-event.interface';
import { sanitizeActivityFirestoreWritePayload, sanitizeEventFirestoreWritePayload } from './firestore-write-sanitizer';

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

function collectUndefinedPaths(
    value: unknown,
    maxPaths: number = 20,
): string[] {
    const paths: string[] = [];
    const visited = new WeakSet<object>();

    const walk = (node: unknown, currentPath: string): void => {
        if (paths.length >= maxPaths) {
            return;
        }

        if (node === undefined) {
            paths.push(currentPath || '<root>');
            return;
        }

        if (node === null || typeof node !== 'object') {
            return;
        }

        const nodeObject = node as object;
        if (visited.has(nodeObject)) {
            return;
        }
        visited.add(nodeObject);

        if (Array.isArray(node)) {
            node.forEach((item, index) => {
                const nextPath = currentPath ? `${currentPath}[${index}]` : `[${index}]`;
                walk(item, nextPath);
            });
            return;
        }

        Object.entries(node as Record<string, unknown>).forEach(([key, child]) => {
            const nextPath = currentPath ? `${currentPath}.${key}` : key;
            walk(child, nextPath);
        });
    };

    walk(value, '');
    return paths;
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
        const startTotal = Date.now();
        this.logger.info('writeAllEventData called', { userID, eventID: event.getID(), adapterPresent: !!this.storageAdapter });
        const writePromises: Promise<void>[] = [];

        // Ensure Event ID
        if (!event.getID()) {
            event.setID(this.adapter.generateID());
        }

        try {
            const startActivities = Date.now();
            const activities = event.getActivities();
            for (const activity of activities) {
                // Ensure Activity ID
                if (!activity.getID()) {
                    activity.setID(this.adapter.generateID());
                }

                // Mandatory shared write policy: all activity payloads are sanitized via helper.
                const sanitizedActivityJSON = sanitizeActivityFirestoreWritePayload(activity.toJSON());
                const activityJSON: FirestoreActivityJSON = {
                    ...sanitizedActivityJSON,
                    userID,
                    eventID: event.getID() as string,
                    ...(event.startDate ? { eventStartDate: event.startDate } : {}),
                };


                const activityPath = ['users', userID, 'activities', <string>activity.getID()];
                writePromises.push(this.writeDocWithContext(activityPath, activityJSON));
            }
            this.logger.info(`Prepared ${activities.length} activity writes in ${Date.now() - startActivities}ms`);

            // Write Event
            // Mandatory shared write policy: all event payloads are sanitized via helper.
            const eventJSON = sanitizeEventFirestoreWritePayload(
                event.toJSON()
            ) as FirestoreEventJSON;

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
                this.logger.info(`Starting upload of ${filesToUpload.length} files...`);
                const startUpload = Date.now();
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

                    const subStart = Date.now();
                    this.logger.info(`Uploading file ${i + 1}/${filesToUpload.length} to`, filePath);
                    await this.storageAdapter.uploadFile(filePath, file.data);
                    this.logger.info(`File ${i + 1} uploaded in ${Date.now() - subStart}ms`);

                    uploadedFilesMetadata.push({
                        path: filePath,
                        bucket: this.storageAdapter.getBucketName?.() || this.bucketName,
                        startDate: file.startDate,
                        originalFilename: file.originalFilename // Save if present
                    });
                }
                this.logger.info(`All uploads complete in ${Date.now() - startUpload}ms. Adding metadata to eventJSON`);

                // Dual-field strategy: Write both originalFiles (canonical) and originalFile (legacy)
                // See method JSDoc for full explanation of this pattern
                if (uploadedFilesMetadata.length > 0) {
                    this.logger.info('Assigning metadata to eventJSON:', uploadedFilesMetadata.length);
                    // Canonical: Always an array, even for single files
                    eventJSON.originalFiles = uploadedFilesMetadata;
                    // Legacy: Always points to first file for backwards compatibility
                    eventJSON.originalFile = uploadedFilesMetadata[0];
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

            const eventPath = ['users', userID, 'events', <string>event.getID()];
            writePromises.push(this.writeDocWithContext(eventPath, eventJSON));

            this.logger.info(`Starting Promise.all for ${writePromises.length} writes...`);
            const startWrites = Date.now();
            await Promise.all(writePromises);
            this.logger.info(`Promise.all complete in ${Date.now() - startWrites}ms`);
            this.logger.info(`Total writeAllEventData execution time: ${Date.now() - startTotal}ms`);
        } catch (e) {
            const error = e as Error;
            this.logger.error(error);
            throw new Error('Could not write event data: ' + error.message);
        }
    }

    private async writeDocWithContext(path: string[], data: unknown): Promise<void> {
        try {
            await this.adapter.setDoc(path, data);
        } catch (e) {
            const error = e as Error;
            const documentPath = path.join('/');
            const undefinedPaths = collectUndefinedPaths(data);
            if (undefinedPaths.length > 0) {
                this.logger.error('Firestore write payload contains undefined values', {
                    documentPath,
                    undefinedFieldPaths: undefinedPaths,
                });
            }
            this.logger.error('Firestore write failed for document', {
                documentPath,
                errorMessage: error?.message || `${error}`,
            });

            const undefinedSuffix = undefinedPaths.length > 0
                ? ` Undefined field paths: ${undefinedPaths.join(', ')}.`
                : '';
            throw new Error(`Firestore write failed for ${documentPath}: ${error.message}.${undefinedSuffix}`);
        }
    }
}
