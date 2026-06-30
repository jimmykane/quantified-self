import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { sanitizeEventFirestoreWritePayload } from '../../../shared/firestore-write-sanitizer';

const DEFAULT_TARGET_BUCKET = 'quantified-self-io';
const DEFAULT_PREFIX = 'users/';
const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 1000;
const DEFAULT_EVENT_PAGE_SIZE = 500;

type AdminStorage = ReturnType<typeof admin.storage>;
type StorageBucket = ReturnType<AdminStorage['bucket']>;
type StorageFile = ReturnType<StorageBucket['file']>;

interface ParsedStorageLocation {
    bucket: string;
    prefix?: string;
}

export interface StorageUsersBucketMigrationOptions {
    execute: boolean;
    sourceBucket: string;
    targetBucket: string;
    prefix: string;
    pageSize: number;
    eventPageSize: number;
    maxObjects?: number;
    overwrite: boolean;
    patchFirestore: boolean;
    uid?: string;
    uids?: string[];
}

interface ListedSourceObject {
    name: string;
    file: StorageFile;
}

export interface StorageUsersBucketMigrationSummary {
    dryRun: boolean;
    sourceBucket: string;
    targetBucket: string;
    prefix: string;
    scannedObjects: number;
    usersWithSourceObjects: number;
    userIDs: string[];
    copiedObjects: number;
    skippedExistingObjects: number;
    failedObjects: number;
    firestoreUsersScanned: number;
    firestoreEventsScanned: number;
    firestoreEventsAffected: number;
    firestoreEventsEligible: number;
    firestoreEventsPatched: number;
    firestoreEventsSkippedMissingTarget: number;
    firestoreEventsFailed: number;
}

function readArgValue(argv: string[], key: string): string | undefined {
    const equalsPrefix = `${key}=`;
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token === key) {
            return argv[i + 1];
        }
        if (token.startsWith(equalsPrefix)) {
            return token.slice(equalsPrefix.length);
        }
    }
    return undefined;
}

function parseCommaList(value: string | undefined): string[] | undefined {
    if (!value) {
        return undefined;
    }
    const values = value.split(',').map(item => item.trim()).filter(Boolean);
    return values.length > 0 ? values : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number, fieldName: string): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${fieldName} must be a positive integer.`);
    }
    return parsed;
}

function parseOptionalPositiveInt(value: string | undefined, fieldName: string): number | undefined {
    if (!value) {
        return undefined;
    }
    return parsePositiveInt(value, 1, fieldName);
}

function normalizeStoragePrefix(value: string): string {
    const normalized = value.trim().replace(/^\/+/, '');
    if (!normalized) {
        return DEFAULT_PREFIX;
    }
    const withTrailingSlash = normalized.endsWith('/') ? normalized : `${normalized}/`;
    if (!withTrailingSlash.startsWith('users/')) {
        throw new Error('Storage migration prefix must be under users/.');
    }
    return withTrailingSlash;
}

function parseStorageLocation(value: string | undefined, fieldName: string): ParsedStorageLocation {
    if (!value || !value.trim()) {
        throw new Error(`${fieldName} is required.`);
    }

    const trimmed = value.trim();
    const withoutScheme = trimmed.startsWith('gs://') ? trimmed.slice('gs://'.length) : trimmed;
    const [bucket, ...pathParts] = withoutScheme.split('/');
    const normalizedBucket = bucket.trim();
    if (!normalizedBucket) {
        throw new Error(`${fieldName} is invalid.`);
    }

    const prefix = pathParts.join('/').trim();
    return {
        bucket: normalizedBucket,
        ...(prefix ? { prefix: normalizeStoragePrefix(prefix) } : {}),
    };
}

export function parseStorageUsersBucketMigrationOptions(argv: string[]): StorageUsersBucketMigrationOptions {
    const sourceLocation = parseStorageLocation(readArgValue(argv, '--source-bucket'), '--source-bucket');
    const targetLocation = parseStorageLocation(
        readArgValue(argv, '--target-bucket') || DEFAULT_TARGET_BUCKET,
        '--target-bucket',
    );
    const uid = readArgValue(argv, '--uid')?.trim() || undefined;
    const uids = uid ? undefined : parseCommaList(readArgValue(argv, '--uids'));
    const pageSize = Math.min(
        parsePositiveInt(readArgValue(argv, '--page-size'), DEFAULT_PAGE_SIZE, '--page-size'),
        MAX_PAGE_SIZE,
    );

    if (sourceLocation.bucket === targetLocation.bucket) {
        throw new Error('Source and target buckets must be different.');
    }

    return {
        execute: argv.includes('--execute'),
        sourceBucket: sourceLocation.bucket,
        targetBucket: targetLocation.bucket,
        prefix: normalizeStoragePrefix(readArgValue(argv, '--prefix') || sourceLocation.prefix || DEFAULT_PREFIX),
        pageSize,
        eventPageSize: parsePositiveInt(readArgValue(argv, '--event-page-size'), DEFAULT_EVENT_PAGE_SIZE, '--event-page-size'),
        maxObjects: parseOptionalPositiveInt(readArgValue(argv, '--max-objects'), '--max-objects'),
        overwrite: argv.includes('--overwrite'),
        patchFirestore: !argv.includes('--skip-firestore'),
        uid,
        uids,
    };
}

function extractUserIDFromStoragePath(path: string): string | null {
    const parts = path.split('/');
    if (parts.length < 2 || parts[0] !== 'users' || !parts[1]) {
        return null;
    }
    return parts[1];
}

function normalizeStoragePath(value: unknown): string {
    return typeof value === 'string' ? value.trim().replace(/^\/+/, '') : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function normalizeNextQuery(nextQuery: unknown, pageSize: number): Record<string, unknown> | null {
    if (!nextQuery || typeof nextQuery !== 'object') {
        return null;
    }
    const query = nextQuery as Record<string, unknown>;
    if (Object.keys(query).length === 0) {
        return null;
    }
    return {
        ...query,
        autoPaginate: false,
        maxResults: pageSize,
    };
}

async function listSourceUserObjects(
    sourceBucket: StorageBucket,
    options: StorageUsersBucketMigrationOptions,
    summary: StorageUsersBucketMigrationSummary,
): Promise<{ objects: ListedSourceObject[]; userIDs: Set<string> }> {
    const objects: ListedSourceObject[] = [];
    const userIDs = new Set<string>();
    let query: Record<string, unknown> | null = {
        prefix: options.prefix,
        autoPaginate: false,
        maxResults: options.pageSize,
    };

    while (query) {
        const [files, nextQuery] = await sourceBucket.getFiles(
            query as unknown as Parameters<StorageBucket['getFiles']>[0],
        ) as unknown as [
            StorageFile[],
            Record<string, unknown> | null | undefined,
            unknown?,
        ];

        for (const file of files) {
            if (options.maxObjects && summary.scannedObjects >= options.maxObjects) {
                query = null;
                break;
            }

            const name = typeof file.name === 'string' ? file.name : '';
            if (!name || name.endsWith('/')) {
                continue;
            }

            summary.scannedObjects++;
            objects.push({ name, file });

            const userID = extractUserIDFromStoragePath(name);
            if (userID) {
                userIDs.add(userID);
            }
        }

        if (!query) {
            break;
        }
        query = normalizeNextQuery(nextQuery, options.pageSize);
    }

    return { objects, userIDs };
}

async function objectExists(
    bucket: StorageBucket,
    path: string,
    cache: Map<string, Promise<boolean>>,
): Promise<boolean> {
    let existsPromise = cache.get(path);
    if (!existsPromise) {
        existsPromise = bucket.file(path).exists()
            .then(([exists]) => exists)
            .catch((error) => {
                logger.error('[storage-users-bucket-migration] Could not verify target object existence', {
                    path,
                    errorMessage: (error as Error)?.message || `${error}`,
                });
                return false;
            });
        cache.set(path, existsPromise);
    }
    return existsPromise;
}

async function migrateListedObjects(
    targetBucket: StorageBucket,
    listedObjects: ListedSourceObject[],
    options: StorageUsersBucketMigrationOptions,
    summary: StorageUsersBucketMigrationSummary,
): Promise<Set<string>> {
    const targetReadyPaths = new Set<string>();

    for (const sourceObject of listedObjects) {
        if (!options.execute) {
            targetReadyPaths.add(sourceObject.name);
            continue;
        }

        const targetFile = targetBucket.file(sourceObject.name);
        try {
            if (!options.overwrite) {
                const [targetExists] = await targetFile.exists();
                if (targetExists) {
                    summary.skippedExistingObjects++;
                    targetReadyPaths.add(sourceObject.name);
                    continue;
                }
            }

            await sourceObject.file.copy(targetFile);
            summary.copiedObjects++;
            targetReadyPaths.add(sourceObject.name);
        } catch (error) {
            summary.failedObjects++;
            logger.error('[storage-users-bucket-migration] Failed to copy source object', {
                sourceBucket: options.sourceBucket,
                targetBucket: options.targetBucket,
                path: sourceObject.name,
                errorMessage: (error as Error)?.message || `${error}`,
            });
        }
    }

    return targetReadyPaths;
}

function collectSourceBucketPaths(
    eventData: Record<string, unknown>,
    sourceBucket: string,
): { affected: boolean; paths: string[] } {
    const paths = new Set<string>();
    let affected = false;

    const collect = (sourceFile: unknown): void => {
        const sourceFileRecord = asRecord(sourceFile);
        if (!sourceFileRecord || sourceFileRecord.bucket !== sourceBucket) {
            return;
        }

        affected = true;
        const path = normalizeStoragePath(sourceFileRecord.path);
        if (path) {
            paths.add(path);
        }
    };

    collect(eventData.originalFile);

    if (Array.isArray(eventData.originalFiles)) {
        for (const sourceFile of eventData.originalFiles) {
            collect(sourceFile);
        }
    }

    return { affected, paths: Array.from(paths) };
}

function buildBucketRewritePayload(
    eventData: Record<string, unknown>,
    sourceBucket: string,
    targetBucket: string,
): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    const originalFile = asRecord(eventData.originalFile);
    if (originalFile?.bucket === sourceBucket) {
        payload.originalFile = {
            ...originalFile,
            bucket: targetBucket,
        };
    }

    if (Array.isArray(eventData.originalFiles)) {
        let changed = false;
        const originalFiles = eventData.originalFiles.map((sourceFile) => {
            const sourceFileRecord = asRecord(sourceFile);
            if (!sourceFileRecord || sourceFileRecord.bucket !== sourceBucket) {
                return sourceFile;
            }

            changed = true;
            return {
                ...sourceFileRecord,
                bucket: targetBucket,
            };
        });

        if (changed) {
            payload.originalFiles = originalFiles;
        }
    }

    return sanitizeEventFirestoreWritePayload(payload);
}

async function isTargetReadyForPath(
    path: string,
    targetBucket: StorageBucket,
    targetReadyPaths: Set<string>,
    targetExistsCache: Map<string, Promise<boolean>>,
): Promise<boolean> {
    if (targetReadyPaths.has(path)) {
        return true;
    }
    return objectExists(targetBucket, path, targetExistsCache);
}

async function patchFirestoreMetadataForUser(
    uid: string,
    targetBucket: StorageBucket,
    targetReadyPaths: Set<string>,
    options: StorageUsersBucketMigrationOptions,
    summary: StorageUsersBucketMigrationSummary,
    targetExistsCache: Map<string, Promise<boolean>>,
): Promise<void> {
    const db = admin.firestore();
    let lastDoc: admin.firestore.QueryDocumentSnapshot | undefined;

    while (true) {
        let query = db.collection(`users/${uid}/events`)
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(options.eventPageSize);
        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }

        const snapshot = await query.get();
        if (snapshot.empty) {
            break;
        }

        for (const eventDoc of snapshot.docs) {
            summary.firestoreEventsScanned++;
            const eventData = eventDoc.data() as Record<string, unknown>;
            const sourceBucketPaths = collectSourceBucketPaths(eventData, options.sourceBucket);
            if (!sourceBucketPaths.affected) {
                continue;
            }

            summary.firestoreEventsAffected++;
            const readiness = await Promise.all(
                sourceBucketPaths.paths.map(path => isTargetReadyForPath(
                    path,
                    targetBucket,
                    targetReadyPaths,
                    targetExistsCache,
                )),
            );
            if (sourceBucketPaths.paths.length === 0 || readiness.some(isReady => !isReady)) {
                summary.firestoreEventsSkippedMissingTarget++;
                logger.warn('[storage-users-bucket-migration] Skipping event metadata patch because target source object is missing', {
                    eventPath: eventDoc.ref.path,
                    sourceBucket: options.sourceBucket,
                    targetBucket: options.targetBucket,
                    paths: sourceBucketPaths.paths,
                });
                continue;
            }

            summary.firestoreEventsEligible++;
            if (!options.execute) {
                continue;
            }

            try {
                await eventDoc.ref.set(
                    buildBucketRewritePayload(eventData, options.sourceBucket, options.targetBucket),
                    { merge: true },
                );
                summary.firestoreEventsPatched++;
            } catch (error) {
                summary.firestoreEventsFailed++;
                logger.error('[storage-users-bucket-migration] Failed to patch event source metadata', {
                    eventPath: eventDoc.ref.path,
                    errorMessage: (error as Error)?.message || `${error}`,
                });
            }
        }

        lastDoc = snapshot.docs[snapshot.docs.length - 1];
    }
}

async function patchFirestoreMetadata(
    userIDsFromStorage: Set<string>,
    targetBucket: StorageBucket,
    targetReadyPaths: Set<string>,
    options: StorageUsersBucketMigrationOptions,
    summary: StorageUsersBucketMigrationSummary,
): Promise<void> {
    if (!options.patchFirestore) {
        return;
    }

    const userIDs = options.uid
        ? [options.uid]
        : options.uids && options.uids.length > 0
            ? options.uids
            : Array.from(userIDsFromStorage).sort();
    const targetExistsCache = new Map<string, Promise<boolean>>();

    for (const uid of userIDs) {
        summary.firestoreUsersScanned++;
        await patchFirestoreMetadataForUser(
            uid,
            targetBucket,
            targetReadyPaths,
            options,
            summary,
            targetExistsCache,
        );
    }
}

export async function runStorageUsersBucketMigrationScript(
    argv: string[],
): Promise<StorageUsersBucketMigrationSummary> {
    const options = parseStorageUsersBucketMigrationOptions(argv);
    const summary: StorageUsersBucketMigrationSummary = {
        dryRun: !options.execute,
        sourceBucket: options.sourceBucket,
        targetBucket: options.targetBucket,
        prefix: options.prefix,
        scannedObjects: 0,
        usersWithSourceObjects: 0,
        userIDs: [],
        copiedObjects: 0,
        skippedExistingObjects: 0,
        failedObjects: 0,
        firestoreUsersScanned: 0,
        firestoreEventsScanned: 0,
        firestoreEventsAffected: 0,
        firestoreEventsEligible: 0,
        firestoreEventsPatched: 0,
        firestoreEventsSkippedMissingTarget: 0,
        firestoreEventsFailed: 0,
    };

    if (!admin.apps.length) {
        admin.initializeApp();
    }

    const sourceBucket = admin.storage().bucket(options.sourceBucket);
    const targetBucket = admin.storage().bucket(options.targetBucket);
    const listed = await listSourceUserObjects(sourceBucket, options, summary);
    summary.userIDs = Array.from(listed.userIDs).sort();
    summary.usersWithSourceObjects = summary.userIDs.length;

    const targetReadyPaths = await migrateListedObjects(targetBucket, listed.objects, options, summary);
    await patchFirestoreMetadata(listed.userIDs, targetBucket, targetReadyPaths, options, summary);

    logger.info('[storage-users-bucket-migration] Summary', summary);
    return summary;
}

async function main(): Promise<void> {
    const summary = await runStorageUsersBucketMigrationScript(process.argv.slice(2));
    if (!summary.dryRun && (summary.failedObjects > 0 || summary.firestoreEventsFailed > 0)) {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch((error) => {
        logger.error('[storage-users-bucket-migration] Fatal error', error);
        process.exitCode = 1;
    });
}
