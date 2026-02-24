import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS,
    parseUIDAllowlist,
    parseUidAndEventIdFromEventPath,
    sportsLibVersionToCode,
} from '../reparse/sports-lib-reparse.service';

const MISSING_PROCESSING_VERSION = '0.0.0';
const MISSING_PROCESSING_VERSION_CODE = 0;
const PROGRESS_LOG_EVERY = 25;
const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 50;
const BACKFILL_RESUME_CHECKPOINT_PATH = 'temp_collection/temp_doc_sportsLibProcessingBackfill';

interface BackfillOptions {
    execute: boolean;
    uid?: string;
    uids?: string[];
    limit: number;
    startAfter?: string;
    concurrency: number;
    resume: boolean;
}

export interface BackfillSummary {
    dryRun: boolean;
    scanned: number;
    created: number;
    patched: number;
    unchanged: number;
    skippedInvalid: number;
    failed: number;
}

interface BackfillResumeCheckpoint {
    scopeKey?: string;
    lastEventPath?: string;
    updatedAt?: unknown;
}

function resolveScopedStartAfterValue(startAfter: string | undefined, options: BackfillOptions): string | undefined {
    if (!startAfter || !options.uid) {
        return startAfter;
    }
    const parsed = parseUidAndEventIdFromEventPath(startAfter);
    if (parsed && parsed.uid === options.uid) {
        return parsed.eventId;
    }
    return startAfter;
}

function shouldLogProgress(scanned: number, total: number): boolean {
    if (total <= 0) {
        return false;
    }
    return scanned === 1 || scanned === total || scanned % PROGRESS_LOG_EVERY === 0;
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

function parseConcurrencyArg(value: string | undefined): number {
    const parsed = parseIntArg(value, DEFAULT_CONCURRENCY);
    return Math.min(Math.max(parsed, 1), MAX_CONCURRENCY);
}

export function parseBackfillOptions(argv: string[]): BackfillOptions {
    const execute = argv.includes('--execute');
    const uid = readArgValue(argv, '--uid');
    const cliUIDAllowlist = parseUIDAllowlist(readArgValue(argv, '--uids'));
    const constantUIDAllowlist = SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.uidAllowlist
        && SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.uidAllowlist.length > 0
        ? new Set(SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.uidAllowlist)
        : null;
    const effectiveUIDAllowlist = uid ? null : (cliUIDAllowlist || constantUIDAllowlist);
    const limit = parseIntArg(readArgValue(argv, '--limit'), SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.scanLimit);
    const startAfter = readArgValue(argv, '--start-after');
    const concurrency = parseConcurrencyArg(readArgValue(argv, '--concurrency'));
    const resume = argv.includes('--resume');

    return {
        execute,
        uid,
        uids: effectiveUIDAllowlist ? Array.from(effectiveUIDAllowlist) : undefined,
        limit,
        startAfter,
        concurrency,
        resume,
    };
}

async function getEventsToInspect(options: BackfillOptions): Promise<admin.firestore.QueryDocumentSnapshot[]> {
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
            logger.warn('[sports-lib-processing-backfill] Ignoring --start-after in multi-UID mode.');
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

export async function runBackfillSportsLibProcessingCode(argv: string[]): Promise<BackfillSummary> {
    const options = parseBackfillOptions(argv);
    const summary: BackfillSummary = {
        dryRun: !options.execute,
        scanned: 0,
        created: 0,
        patched: 0,
        unchanged: 0,
        skippedInvalid: 0,
        failed: 0,
    };

    if (!admin.apps.length) {
        admin.initializeApp();
    }

    const db = admin.firestore();
    const checkpointRef = db.doc(BACKFILL_RESUME_CHECKPOINT_PATH);
    const scopeKey = options.uid
        ? `uid:${options.uid}`
        : options.uids && options.uids.length > 0
            ? `uids:${options.uids.slice().sort().join(',')}`
            : 'global';

    let effectiveStartAfter = options.startAfter;
    if (!effectiveStartAfter && options.resume) {
        const checkpointSnapshot = await checkpointRef.get();
        const checkpointData = checkpointSnapshot.data() as BackfillResumeCheckpoint | undefined;
        if (checkpointData?.scopeKey === scopeKey && typeof checkpointData.lastEventPath === 'string' && checkpointData.lastEventPath.length > 0) {
            effectiveStartAfter = checkpointData.lastEventPath;
            logger.info('[sports-lib-processing-backfill] Resuming from checkpoint.', {
                checkpointPath: BACKFILL_RESUME_CHECKPOINT_PATH,
                scopeKey,
                startAfter: effectiveStartAfter,
            });
        }
    }

    const eventDocs = await getEventsToInspect({
        ...options,
        startAfter: resolveScopedStartAfterValue(effectiveStartAfter, options),
    });
    const totalEvents = eventDocs.length;
    logger.info('[sports-lib-processing-backfill] Starting backfill run.', {
        dryRun: !options.execute,
        totalEvents,
        progressLogEvery: PROGRESS_LOG_EVERY,
        concurrency: options.concurrency,
        resume: options.resume,
        startAfter: effectiveStartAfter,
    });
    const processEventDoc = async (eventDoc: admin.firestore.QueryDocumentSnapshot): Promise<void> => {
        summary.scanned++;
        const parsed = parseUidAndEventIdFromEventPath(eventDoc.ref.path);
        if (!parsed) {
            return;
        }
        const { uid, eventId } = parsed;
        const eventPath = eventDoc.ref.path;
        const processingRef = eventDoc.ref.collection('metaData').doc('processing');
        const processingDocPath = processingRef.path;

        try {
            const processingSnapshot = await processingRef.get();
            if (!processingSnapshot.exists) {
                summary.created++;
                if (options.execute) {
                    await processingRef.set({
                        sportsLibVersion: MISSING_PROCESSING_VERSION,
                        sportsLibVersionCode: MISSING_PROCESSING_VERSION_CODE,
                        processedAt: admin.firestore.FieldValue.serverTimestamp(),
                    }, { merge: true });
                }
                logger.info('[sports-lib-processing-backfill] Created missing processing metadata.', {
                    uid,
                    eventId,
                    eventPath,
                    processingDocPath,
                    dryRun: !options.execute,
                });
                return;
            }

            const processingData = processingSnapshot.data() as Record<string, unknown>;
            const rawVersion = processingData.sportsLibVersion;
            if (typeof rawVersion !== 'string') {
                summary.skippedInvalid++;
                logger.warn('[sports-lib-processing-backfill] Invalid processing metadata. Missing or non-string sportsLibVersion.', {
                    eventPath,
                    processingDocPath,
                    sportsLibVersion: rawVersion,
                });
                return;
            }

            let computedCode: number;
            try {
                computedCode = sportsLibVersionToCode(rawVersion);
            } catch (error) {
                summary.skippedInvalid++;
                logger.warn('[sports-lib-processing-backfill] Invalid processing metadata. Could not parse sportsLibVersion.', {
                    eventPath,
                    processingDocPath,
                    sportsLibVersion: rawVersion,
                    error: `${error}`,
                });
                return;
            }

            const rawCode = processingData.sportsLibVersionCode;
            const normalizedRawCode = typeof rawCode === 'number' && Number.isFinite(rawCode) ? rawCode : null;
            if (normalizedRawCode === computedCode) {
                summary.unchanged++;
                logger.info('[sports-lib-processing-backfill] Processing metadata already up to date.', {
                    uid,
                    eventId,
                    eventPath,
                    processingDocPath,
                    sportsLibVersion: rawVersion,
                    sportsLibVersionCode: normalizedRawCode,
                });
                return;
            }

            summary.patched++;
            if (options.execute) {
                await processingRef.set({
                    sportsLibVersionCode: computedCode,
                }, { merge: true });
            }
            logger.info('[sports-lib-processing-backfill] Patched processing metadata version code.', {
                uid,
                eventId,
                eventPath,
                processingDocPath,
                sportsLibVersion: rawVersion,
                previousSportsLibVersionCode: normalizedRawCode,
                newSportsLibVersionCode: computedCode,
                dryRun: !options.execute,
            });
        } catch (error) {
            summary.failed++;
            logger.error('[sports-lib-processing-backfill] Failed to backfill processing metadata for event.', {
                uid,
                eventId,
                eventPath,
                processingDocPath,
                error: `${error}`,
            });
        } finally {
            if (shouldLogProgress(summary.scanned, totalEvents)) {
                logger.info('[sports-lib-processing-backfill] Progress', {
                    scanned: summary.scanned,
                    total: totalEvents,
                    percentComplete: Math.round((summary.scanned / totalEvents) * 100),
                    created: summary.created,
                    patched: summary.patched,
                    unchanged: summary.unchanged,
                    skippedInvalid: summary.skippedInvalid,
                    failed: summary.failed,
                });
            }
        }
    };

    if (eventDocs.length > 0) {
        let nextIndex = 0;
        const workerCount = Math.min(options.concurrency, eventDocs.length);
        const workers = Array.from({ length: workerCount }, async () => {
            while (true) {
                const currentIndex = nextIndex++;
                if (currentIndex >= eventDocs.length) {
                    return;
                }
                await processEventDoc(eventDocs[currentIndex]);
            }
        });
        await Promise.all(workers);
    }

    if (options.resume) {
        const lastEventPath = eventDocs.length > 0 ? eventDocs[eventDocs.length - 1].ref.path : null;
        await checkpointRef.set({
            scopeKey,
            lastEventPath,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        logger.info('[sports-lib-processing-backfill] Updated resume checkpoint.', {
            checkpointPath: BACKFILL_RESUME_CHECKPOINT_PATH,
            scopeKey,
            lastEventPath,
        });
    }

    logger.info('[sports-lib-processing-backfill] Summary', summary);
    return summary;
}

async function main(): Promise<void> {
    const summary = await runBackfillSportsLibProcessingCode(process.argv.slice(2));
    if (!summary.dryRun && summary.failed > 0) {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch((error) => {
        logger.error('[sports-lib-processing-backfill] Fatal error', error);
        process.exitCode = 1;
    });
}
