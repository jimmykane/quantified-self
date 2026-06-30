import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

interface EventSourceFileForCleanup {
    path: string;
    bucket: string;
    generation: string;
}

async function shouldSkipEventCleanup(userId: string, eventId: string, phase: string): Promise<boolean> {
    try {
        const currentEventSnapshot = await admin.firestore().doc(`users/${userId}/events/${eventId}`).get();
        if (currentEventSnapshot.exists) {
            logger.warn('[Cleanup] stale_delete_trigger_skipped: event exists again, skipping destructive cleanup.', {
                userId,
                eventId,
                phase,
            });
            return true;
        }
        return false;
    } catch (error) {
        logger.error('[Cleanup] stale_delete_guard_failed: could not verify event absence, skipping destructive cleanup.', {
            userId,
            eventId,
            phase,
            error,
        });
        return true;
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
    const sourceFiles: EventSourceFileForCleanup[] = [];
    const seen = new Set<string>();

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

        const generation = normalizeStorageGeneration(sourceFile.generation);
        if (!generation) {
            logger.warn('[Cleanup] Skipping source file cleanup without a storage generation precondition.', {
                userId,
                eventId,
                path,
                bucket,
            });
            return;
        }

        const key = `${bucket}/${path}@${generation}`;
        if (!seen.has(key)) {
            seen.add(key);
            sourceFiles.push({ path, bucket, generation });
        }
    });

    return sourceFiles;
}

function isStoragePreconditionFailure(error: unknown): boolean {
    const errorRecord = asRecord(error);
    const code = errorRecord?.code;
    const statusCode = errorRecord?.statusCode;
    return code === 412 || code === '412' || statusCode === 412 || statusCode === '412';
}

async function deleteSourceFilesForDeletedEventSnapshot(
    userId: string,
    eventId: string,
    eventData: unknown,
): Promise<void> {
    const defaultBucket = admin.storage().bucket();
    const defaultBucketName = defaultBucket.name;
    const sourceFiles = resolveSourceFilesForCleanup(eventData, userId, eventId, defaultBucketName);

    if (sourceFiles.length === 0) {
        logger.info(`[Cleanup] No generation-pinned source files found for event ${eventId}`);
        return;
    }

    const failures: unknown[] = [];
    for (const sourceFile of sourceFiles) {
        try {
            logger.info(`[Cleanup] Deleting source file generation ${sourceFile.generation} at ${sourceFile.path}`);
            await defaultBucket.file(sourceFile.path).delete({
                ignoreNotFound: true,
                ifGenerationMatch: sourceFile.generation,
            });
        } catch (error) {
            if (isStoragePreconditionFailure(error)) {
                logger.warn('[Cleanup] Source file generation no longer matches; skipping stale file delete.', {
                    userId,
                    eventId,
                    path: sourceFile.path,
                    bucket: sourceFile.bucket,
                    generation: sourceFile.generation,
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

    logger.info(`[Cleanup] Successfully deleted ${sourceFiles.length} generation-pinned source file(s) for event ${eventId}`);
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

    // Delete linked activities (Flat structure)
    try {
        const activityCleanup = await deleteLinkedActivitiesIfEventStillMissing(userId, eventId);
        if (activityCleanup.skipped) {
            return;
        }
    } catch (error) {
        logger.error(`[Cleanup] Failed to delete linked activities for event ${eventId}`, error);
        return;
    }

    // Delete linked metaData (Subcollection)
    try {
        const metadataCleanup = await deleteMetadataIfEventStillMissing(userId, eventId);
        if (metadataCleanup.skipped) {
            return;
        }
    } catch (error) {
        logger.error(`[Cleanup] Failed to delete metaData for event ${eventId}`, error);
        return;
    }

    try {
        if (await shouldSkipEventCleanup(userId, eventId, 'before_storage_cleanup')) {
            return;
        }
        await deleteSourceFilesForDeletedEventSnapshot(userId, eventId, snap.data());
    } catch (error) {
        logger.error(`[Cleanup] Failed to delete source files for event ${eventId}`, error);
    }
});
