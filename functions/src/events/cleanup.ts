import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

interface EventSourceFileForCleanup {
    path: string;
    bucket: string;
    generation?: string;
}

type EventCleanupDecision = 'continue' | 'event_exists' | 'guard_failed';

async function getEventCleanupDecision(userId: string, eventId: string, phase: string): Promise<EventCleanupDecision> {
    try {
        const currentEventSnapshot = await admin.firestore().doc(`users/${userId}/events/${eventId}`).get();
        if (currentEventSnapshot.exists) {
            logger.warn('[Cleanup] stale_delete_trigger_skipped: event exists again, skipping destructive cleanup.', {
                userId,
                eventId,
                phase,
            });
            return 'event_exists';
        }
        return 'continue';
    } catch (error) {
        logger.error('[Cleanup] stale_delete_guard_failed: could not verify event absence, skipping destructive cleanup.', {
            userId,
            eventId,
            phase,
            error,
        });
        return 'guard_failed';
    }
}

interface GuardedCleanupResult {
    skipped: boolean;
    deletedCount: number;
}

async function deleteLinkedActivitiesIfEventStillMissing(userId: string, eventId: string): Promise<GuardedCleanupResult> {
    const db = admin.firestore();
    const eventRef = db.doc(`users/${userId}/events/${eventId}`);
    const activitiesQuery = db.collection(`users/${userId}/activities`).where('eventID', '==', eventId);

    const result = await db.runTransaction(async (transaction): Promise<GuardedCleanupResult> => {
        const currentEventSnapshot = await transaction.get(eventRef);
        if (currentEventSnapshot.exists) {
            return { skipped: true, deletedCount: 0 };
        }

        const activitySnapshot = await transaction.get(activitiesQuery);
        if (activitySnapshot.empty) {
            return { skipped: false, deletedCount: 0 };
        }

        activitySnapshot.docs.forEach((doc) => {
            // Flat activity documents do not own cleanup-managed subcollections.
            transaction.delete(doc.ref);
        });

        return { skipped: false, deletedCount: activitySnapshot.size };
    });

    if (result.skipped) {
        logger.warn('[Cleanup] stale_delete_trigger_skipped: event exists again, skipping destructive cleanup.', {
            userId,
            eventId,
            phase: 'activity_transaction',
        });
    } else if (result.deletedCount === 0) {
        logger.info(`[Cleanup] No flat activities found for event ${eventId}`);
    } else {
        logger.info(`[Cleanup] Successfully deleted ${result.deletedCount} linked activities for event ${eventId}`);
    }

    return result;
}

async function deleteMetadataIfEventStillMissing(userId: string, eventId: string): Promise<GuardedCleanupResult> {
    const db = admin.firestore();
    const eventRef = db.doc(`users/${userId}/events/${eventId}`);
    const metadataRef = db.collection(`users/${userId}/events/${eventId}/metaData`);

    const result = await db.runTransaction(async (transaction): Promise<GuardedCleanupResult> => {
        const currentEventSnapshot = await transaction.get(eventRef);
        if (currentEventSnapshot.exists) {
            return { skipped: true, deletedCount: 0 };
        }

        const metadataSnapshot = await transaction.get(metadataRef);
        if (metadataSnapshot.empty) {
            return { skipped: false, deletedCount: 0 };
        }

        metadataSnapshot.docs.forEach((doc) => {
            // Event metadata docs are leaf provider/status docs; this transaction prevents stale delete triggers
            // from deleting metadata that belongs to a recreated deterministic event ID.
            transaction.delete(doc.ref);
        });

        return { skipped: false, deletedCount: metadataSnapshot.size };
    });

    if (result.skipped) {
        logger.warn('[Cleanup] stale_delete_trigger_skipped: event exists again, skipping destructive cleanup.', {
            userId,
            eventId,
            phase: 'metadata_transaction',
        });
    } else if (result.deletedCount === 0) {
        logger.info(`[Cleanup] No metaData documents found for event ${eventId}`);
    } else {
        logger.info(`[Cleanup] Successfully deleted ${result.deletedCount} metaData documents for event ${eventId}`);
    }

    return result;
}

function normalizeNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeStorageGeneration(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return `${value}`;
    }
    return null;
}

function normalizeTimestampMillis(value: unknown): number | null {
    if (value instanceof Date) {
        const millis = value.getTime();
        return Number.isFinite(millis) ? millis : null;
    }

    if (typeof value === 'string' || typeof value === 'number') {
        const millis = new Date(value).getTime();
        return Number.isFinite(millis) ? millis : null;
    }

    const valueRecord = asRecord(value);
    const toMillis = valueRecord?.toMillis;
    if (typeof toMillis === 'function') {
        const millis = toMillis.call(value);
        return typeof millis === 'number' && Number.isFinite(millis) ? millis : null;
    }

    const toDate = valueRecord?.toDate;
    if (typeof toDate === 'function') {
        return normalizeTimestampMillis(toDate.call(value));
    }

    return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function resolveSourceFilesForCleanup(
    eventData: unknown,
    userId: string,
    eventId: string,
    defaultBucketName: string,
): EventSourceFileForCleanup[] {
    const eventRecord = asRecord(eventData);
    if (!eventRecord) {
        return [];
    }

    const candidates: unknown[] = [];
    if (Array.isArray(eventRecord.originalFiles)) {
        candidates.push(...eventRecord.originalFiles);
    }
    if (eventRecord.originalFile) {
        candidates.push(eventRecord.originalFile);
    }

    const prefix = `users/${userId}/events/${eventId}/`;
    const sourceFileByPath = new Map<string, EventSourceFileForCleanup>();

    candidates.forEach((candidate) => {
        const sourceFile = asRecord(candidate);
        const path = normalizeNonEmptyString(sourceFile?.path);
        if (!sourceFile || !path || !path.startsWith(prefix)) {
            logger.warn('[Cleanup] Skipping source file cleanup for invalid event source metadata.', {
                userId,
                eventId,
                path,
            });
            return;
        }

        const bucket = normalizeNonEmptyString(sourceFile.bucket) || defaultBucketName;
        if (bucket !== defaultBucketName) {
            logger.warn('[Cleanup] Skipping source file cleanup outside the default bucket.', {
                userId,
                eventId,
                path,
                bucket,
                defaultBucketName,
            });
            return;
        }

        const generation = normalizeStorageGeneration(sourceFile.generation) ?? undefined;
        const key = `${bucket}/${path}`;
        const existingSourceFile = sourceFileByPath.get(key);
        if (!existingSourceFile || (!existingSourceFile.generation && generation)) {
            sourceFileByPath.set(key, { path, bucket, ...(generation ? { generation } : {}) });
        }
    });

    return Array.from(sourceFileByPath.values());
}

function isStoragePreconditionFailure(error: unknown): boolean {
    const errorRecord = asRecord(error);
    const code = errorRecord?.code;
    const statusCode = errorRecord?.statusCode;
    return code === 412 || code === '412' || statusCode === 412 || statusCode === '412';
}

function isStorageNotFound(error: unknown): boolean {
    const errorRecord = asRecord(error);
    const code = errorRecord?.code;
    const statusCode = errorRecord?.statusCode;
    return code === 404 || code === '404' || statusCode === 404 || statusCode === '404';
}

async function resolveCurrentStorageGenerationForLegacySourceFile(params: {
    file: { getMetadata(): Promise<[Record<string, unknown>, ...unknown[]]> };
    userId: string;
    eventId: string;
    sourceFile: EventSourceFileForCleanup;
    deletedEventBoundaryMillis: number | null;
}): Promise<string | null> {
    const { file, userId, eventId, sourceFile, deletedEventBoundaryMillis } = params;

    if (deletedEventBoundaryMillis === null) {
        logger.warn('[Cleanup] Skipping legacy source file cleanup without a deleted event timestamp.', {
            userId,
            eventId,
            path: sourceFile.path,
            bucket: sourceFile.bucket,
        });
        return null;
    }

    let metadata: Record<string, unknown>;
    try {
        [metadata] = await file.getMetadata();
    } catch (error) {
        if (isStorageNotFound(error)) {
            logger.info(`[Cleanup] Legacy source file ${sourceFile.path} was already missing.`);
            return null;
        }
        throw error;
    }

    const timeCreatedMillis = normalizeTimestampMillis(metadata.timeCreated);
    if (timeCreatedMillis === null) {
        logger.warn('[Cleanup] Skipping legacy source file cleanup because current storage metadata has no creation time.', {
            userId,
            eventId,
            path: sourceFile.path,
            bucket: sourceFile.bucket,
        });
        return null;
    }

    // Legacy event docs do not record Storage generation. Only trust live-resolved generation
    // when the current object clearly predates the delete event; newer objects may be from a recreated event.
    if (timeCreatedMillis >= deletedEventBoundaryMillis) {
        logger.warn('[Cleanup] Skipping legacy source file cleanup because the current object was created at or after the deleted event boundary.', {
            userId,
            eventId,
            path: sourceFile.path,
            bucket: sourceFile.bucket,
            timeCreated: metadata.timeCreated,
        });
        return null;
    }

    const generation = normalizeStorageGeneration(metadata.generation);
    if (!generation) {
        logger.warn('[Cleanup] Skipping legacy source file cleanup because current storage metadata has no generation.', {
            userId,
            eventId,
            path: sourceFile.path,
            bucket: sourceFile.bucket,
        });
        return null;
    }

    return generation;
}

async function deleteSourceFilesForDeletedEventSnapshot(
    userId: string,
    eventId: string,
    eventData: unknown,
    deletedEventBoundaryMillis: number | null,
): Promise<void> {
    const defaultBucket = admin.storage().bucket();
    const defaultBucketName = defaultBucket.name;
    const sourceFiles = resolveSourceFilesForCleanup(eventData, userId, eventId, defaultBucketName);

    if (sourceFiles.length === 0) {
        logger.info(`[Cleanup] No event source files found for event ${eventId}`);
        return;
    }

    const failures: unknown[] = [];
    let deletedCount = 0;
    for (const sourceFile of sourceFiles) {
        let attemptedGeneration = sourceFile.generation;
        try {
            const file = defaultBucket.file(sourceFile.path);
            const resolvedGeneration = attemptedGeneration
                ?? await resolveCurrentStorageGenerationForLegacySourceFile({
                    file,
                    userId,
                    eventId,
                    sourceFile,
                    deletedEventBoundaryMillis,
                });
            attemptedGeneration = resolvedGeneration ?? undefined;

            if (!attemptedGeneration) {
                continue;
            }

            if (!sourceFile.generation) {
                const cleanupDecision = await getEventCleanupDecision(userId, eventId, 'before_legacy_storage_delete');
                if (cleanupDecision === 'event_exists') {
                    continue;
                }
                if (cleanupDecision === 'guard_failed') {
                    throw new Error(`Could not verify event absence before deleting legacy source file ${sourceFile.path}.`);
                }
            }

            logger.info(`[Cleanup] Deleting source file generation ${attemptedGeneration} at ${sourceFile.path}`);
            await file.delete({
                ignoreNotFound: true,
                ifGenerationMatch: attemptedGeneration,
            });
            deletedCount++;
        } catch (error) {
            if (isStoragePreconditionFailure(error)) {
                logger.warn('[Cleanup] Source file generation no longer matches; skipping stale file delete.', {
                    userId,
                    eventId,
                    path: sourceFile.path,
                    bucket: sourceFile.bucket,
                    generation: attemptedGeneration,
                    error,
                });
                continue;
            }
            failures.push(error);
            logger.error(`[Cleanup] Failed to delete source file ${sourceFile.path} for event ${eventId}`, error);
        }
    }

    if (failures.length > 0) {
        throw new Error(`Failed to delete ${failures.length} source file(s) for event ${eventId}.`);
    }

    logger.info(`[Cleanup] Successfully deleted ${deletedCount} source file(s) for event ${eventId}`);
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
    const cleanupFailures: string[] = [];

    // Delete linked activities (Flat structure)
    try {
        const activityCleanup = await deleteLinkedActivitiesIfEventStillMissing(userId, eventId);
        if (activityCleanup.skipped) {
            return;
        }
    } catch (error) {
        logger.error(`[Cleanup] Failed to delete linked activities for event ${eventId}`, error);
        cleanupFailures.push('activities');
    }

    // Delete linked metaData (Subcollection)
    try {
        const metadataCleanup = await deleteMetadataIfEventStillMissing(userId, eventId);
        if (metadataCleanup.skipped) {
            return;
        }
    } catch (error) {
        logger.error(`[Cleanup] Failed to delete metaData for event ${eventId}`, error);
        cleanupFailures.push('metadata');
    }

    try {
        const cleanupDecision = await getEventCleanupDecision(userId, eventId, 'before_storage_cleanup');
        if (cleanupDecision === 'event_exists') {
            return;
        }
        if (cleanupDecision === 'guard_failed') {
            cleanupFailures.push('storage_guard');
        } else {
            const deletedEventBoundaryMillis = normalizeTimestampMillis((event as { time?: unknown }).time)
                ?? normalizeTimestampMillis(snap.updateTime);
            await deleteSourceFilesForDeletedEventSnapshot(
                userId,
                eventId,
                snap.data(),
                deletedEventBoundaryMillis,
            );
        }
    } catch (error) {
        logger.error(`[Cleanup] Failed to delete source files for event ${eventId}`, error);
        cleanupFailures.push('source_files');
    }

    if (cleanupFailures.length > 0) {
        throw new Error(`Event cleanup failed for ${eventId}: ${cleanupFailures.join(', ')}.`);
    }
});
