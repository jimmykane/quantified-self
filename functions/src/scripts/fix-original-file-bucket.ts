import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { parseUIDAllowlist } from '../reparse/sports-lib-reparse.service';

const DEFAULT_WRONG_BUCKET = 'quantified-self-io.appspot.com';
const DEFAULT_TARGET_BUCKET = 'quantified-self-io';
const DEFAULT_SCAN_LIMIT = 1000;

interface ScriptOptions {
    execute: boolean;
    uid?: string;
    uids?: string[];
    limit: number;
    startAfter?: string;
    wrongBucket: string;
    targetBucket: string;
    verifyTargetObjectExists: boolean;
}

export interface BucketFixSummary {
    dryRun: boolean;
    scanned: number;
    affected: number;
    eligibleForUpdate: number;
    updated: number;
    skippedMissingTargetObject: number;
    failed: number;
    wrongBucket: string;
    targetBucket: string;
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

function parseIntArg(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

export function parseFixBucketScriptOptions(argv: string[]): ScriptOptions {
    const execute = argv.includes('--execute');
    const uid = readArgValue(argv, '--uid');
    const uidAllowlist = parseUIDAllowlist(readArgValue(argv, '--uids'));
    const limit = parseIntArg(readArgValue(argv, '--limit'), DEFAULT_SCAN_LIMIT);
    const startAfter = readArgValue(argv, '--start-after');
    const wrongBucket = readArgValue(argv, '--wrong-bucket') || DEFAULT_WRONG_BUCKET;
    const targetBucket = readArgValue(argv, '--target-bucket') || DEFAULT_TARGET_BUCKET;
    const verifyTargetObjectExists = !argv.includes('--skip-target-check');

    return {
        execute,
        uid,
        uids: uid ? undefined : (uidAllowlist ? Array.from(uidAllowlist) : undefined),
        limit,
        startAfter,
        wrongBucket,
        targetBucket,
        verifyTargetObjectExists,
    };
}

function collectWrongBucketPaths(
    eventData: Record<string, unknown>,
    wrongBucket: string,
): string[] {
    const wrongPaths = new Set<string>();
    const eventAny = eventData as any;

    const originalFile = eventAny.originalFile;
    if (originalFile?.bucket === wrongBucket && typeof originalFile?.path === 'string' && originalFile.path) {
        wrongPaths.add(originalFile.path);
    }

    const originalFiles = Array.isArray(eventAny.originalFiles) ? eventAny.originalFiles : [];
    for (const sourceFile of originalFiles) {
        if (sourceFile?.bucket === wrongBucket && typeof sourceFile?.path === 'string' && sourceFile.path) {
            wrongPaths.add(sourceFile.path);
        }
    }

    return Array.from(wrongPaths);
}

function buildBucketRewritePayload(
    eventData: Record<string, unknown>,
    wrongBucket: string,
    targetBucket: string,
): { changed: boolean; payload: Record<string, unknown> } {
    const eventAny = eventData as any;
    let changed = false;
    const payload: Record<string, unknown> = {};

    if (eventAny.originalFile && typeof eventAny.originalFile === 'object') {
        if (eventAny.originalFile.bucket === wrongBucket) {
            payload.originalFile = {
                ...eventAny.originalFile,
                bucket: targetBucket,
            };
            changed = true;
        }
    }

    if (Array.isArray(eventAny.originalFiles)) {
        const rewrittenOriginalFiles = eventAny.originalFiles.map((sourceFile: Record<string, unknown>) => {
            if (!sourceFile || typeof sourceFile !== 'object') {
                return sourceFile;
            }
            if (sourceFile.bucket !== wrongBucket) {
                return sourceFile;
            }
            changed = true;
            return {
                ...sourceFile,
                bucket: targetBucket,
            };
        });

        if (changed) {
            payload.originalFiles = rewrittenOriginalFiles;
        }
    }

    return { changed, payload };
}

async function getEventsToInspect(options: ScriptOptions): Promise<admin.firestore.QueryDocumentSnapshot[]> {
    const db = admin.firestore();
    if (options.uid) {
        let userQuery = db.collection(`users/${options.uid}/events`)
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(options.limit);
        if (options.startAfter) {
            userQuery = userQuery.startAfter(options.startAfter);
        }
        const snapshot = await userQuery.get();
        return snapshot.docs;
    }

    if (options.uids && options.uids.length > 0) {
        if (options.startAfter) {
            logger.warn('[fix-original-file-bucket] Ignoring --start-after in multi-UID mode.');
        }

        const docs: admin.firestore.QueryDocumentSnapshot[] = [];
        let remainingLimit = options.limit;

        for (const uid of options.uids) {
            if (remainingLimit <= 0) {
                break;
            }

            const snapshot = await db.collection(`users/${uid}/events`)
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(remainingLimit)
                .get();

            docs.push(...snapshot.docs);
            remainingLimit -= snapshot.docs.length;
        }
        return docs;
    }

    let groupQuery = db.collectionGroup('events')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(options.limit);
    if (options.startAfter) {
        groupQuery = groupQuery.startAfter(db.doc(options.startAfter));
    }
    const snapshot = await groupQuery.get();
    return snapshot.docs;
}

async function objectExistsInBucket(
    bucketName: string,
    path: string,
    cache: Map<string, Promise<boolean>>,
): Promise<boolean> {
    const cacheKey = `${bucketName}:${path}`;
    let existsPromise = cache.get(cacheKey);
    if (!existsPromise) {
        existsPromise = admin.storage().bucket(bucketName).file(path).exists()
            .then(([exists]) => exists)
            .catch((error) => {
                logger.error('[fix-original-file-bucket] Could not verify object existence', {
                    bucketName,
                    path,
                    errorMessage: (error as Error)?.message || `${error}`,
                });
                return false;
            });
        cache.set(cacheKey, existsPromise);
    }
    return existsPromise;
}

export async function runFixOriginalFileBucketScript(argv: string[]): Promise<BucketFixSummary> {
    const options = parseFixBucketScriptOptions(argv);
    const summary: BucketFixSummary = {
        dryRun: !options.execute,
        scanned: 0,
        affected: 0,
        eligibleForUpdate: 0,
        updated: 0,
        skippedMissingTargetObject: 0,
        failed: 0,
        wrongBucket: options.wrongBucket,
        targetBucket: options.targetBucket,
    };

    if (!admin.apps.length) {
        admin.initializeApp();
    }

    const eventDocs = await getEventsToInspect(options);
    const existenceCache = new Map<string, Promise<boolean>>();

    for (const eventDoc of eventDocs) {
        summary.scanned++;
        const eventData = eventDoc.data() as Record<string, unknown>;
        const wrongBucketPaths = collectWrongBucketPaths(eventData, options.wrongBucket);
        if (wrongBucketPaths.length === 0) {
            continue;
        }

        summary.affected++;

        if (options.verifyTargetObjectExists) {
            const existenceChecks = await Promise.all(
                wrongBucketPaths.map(path => objectExistsInBucket(options.targetBucket, path, existenceCache)),
            );
            const missingTargetObjects = wrongBucketPaths.filter((_, index) => !existenceChecks[index]);
            if (missingTargetObjects.length > 0) {
                summary.skippedMissingTargetObject++;
                logger.warn('[fix-original-file-bucket] Skipping event because target-bucket object is missing', {
                    eventPath: eventDoc.ref.path,
                    missingTargetObjects,
                    targetBucket: options.targetBucket,
                });
                continue;
            }
        }

        const rewrite = buildBucketRewritePayload(eventData, options.wrongBucket, options.targetBucket);
        if (!rewrite.changed) {
            continue;
        }

        summary.eligibleForUpdate++;

        if (!options.execute) {
            continue;
        }

        try {
            await eventDoc.ref.set(rewrite.payload, { merge: true });
            summary.updated++;
        } catch (error) {
            summary.failed++;
            logger.error('[fix-original-file-bucket] Failed to update event metadata', {
                eventPath: eventDoc.ref.path,
                errorMessage: (error as Error)?.message || `${error}`,
            });
        }
    }

    logger.info('[fix-original-file-bucket] Summary', summary);
    return summary;
}

async function main(): Promise<void> {
    const summary = await runFixOriginalFileBucketScript(process.argv.slice(2));
    if (!summary.dryRun && summary.failed > 0) {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch((error) => {
        logger.error('[fix-original-file-bucket] Fatal error', error);
        process.exitCode = 1;
    });
}
