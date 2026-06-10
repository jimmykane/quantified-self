import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS,
    parseUIDAllowlist,
    parseUidAndEventIdFromEventPath,
    sportsLibVersionToCode,
} from '../reparse/sports-lib-reparse.service';
import { EVENT_PROCESSING_ENTITY } from '../shared/processing-metadata.interface';
import { getUserDeletionGuardStateInTransaction, UserDeletionGuardReadError } from '../shared/user-deletion-guard';

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
    skippedEventMissing: number;
    skippedUserDeletion: number;
    failed: number;
}

interface BackfillResumeCheckpoint {
    scopeKey?: string;
    lastEventPath?: string;
    updatedAt?: unknown;
}

type BackfillProcessingCodeOutcome =
    | 'created'
    | 'patched'
    | 'unchanged'
    | 'skipped_invalid'
    | 'skipped_event_missing'
    | 'skipped_user_deletion';

interface ProcessingCodeDecision {
    outcome: BackfillProcessingCodeOutcome;
    payload?: Record<string, unknown>;
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

function hasArg(argv: string[], key: string): boolean {
    const equalsPrefix = `${key}=`;
    return argv.some(token => token === key || token.startsWith(equalsPrefix));
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
    if (resume && (hasArg(argv, '--uids') || (!uid && constantUIDAllowlist && constantUIDAllowlist.size > 0))) {
        throw new Error('backfill-sports-lib-processing-code does not support --resume with multi-UID scope. Run globally, use --uid, or omit --resume.');
    }

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
        skippedEventMissing: 0,
        skippedUserDeletion: 0,
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
            const makeDecision = (
                processingSnapshot: admin.firestore.DocumentSnapshot,
            ): ProcessingCodeDecision => {
                if (!processingSnapshot.exists) {
                    return {
                        outcome: 'created',
                        payload: options.execute
                            ? {
                                processingEntity: EVENT_PROCESSING_ENTITY,
                                sportsLibVersion: MISSING_PROCESSING_VERSION,
                                sportsLibVersionCode: MISSING_PROCESSING_VERSION_CODE,
                                processedAt: admin.firestore.FieldValue.serverTimestamp(),
                            }
                            : undefined,
                    };
                }

                const processingData = processingSnapshot.data() as Record<string, unknown>;
                const rawVersion = processingData.sportsLibVersion;
                if (typeof rawVersion !== 'string') {
                    logger.warn('[sports-lib-processing-backfill] Invalid processing metadata. Missing or non-string sportsLibVersion.', {
                        eventPath,
                        processingDocPath,
                        sportsLibVersion: rawVersion,
                    });
                    return { outcome: 'skipped_invalid' };
                }

                let computedCode: number;
                try {
                    computedCode = sportsLibVersionToCode(rawVersion);
                } catch (error) {
                    logger.warn('[sports-lib-processing-backfill] Invalid processing metadata. Could not parse sportsLibVersion.', {
                        eventPath,
                        processingDocPath,
                        sportsLibVersion: rawVersion,
                        error: `${error}`,
                    });
                    return { outcome: 'skipped_invalid' };
                }

                const rawCode = processingData.sportsLibVersionCode;
                const normalizedRawCode = typeof rawCode === 'number' && Number.isFinite(rawCode) ? rawCode : null;
                const normalizedProcessingEntity = processingData.processingEntity === EVENT_PROCESSING_ENTITY
                    ? EVENT_PROCESSING_ENTITY
                    : null;
                if (normalizedRawCode === computedCode && normalizedProcessingEntity === EVENT_PROCESSING_ENTITY) {
                    logger.info('[sports-lib-processing-backfill] Processing metadata already up to date.', {
                        uid,
                        eventId,
                        eventPath,
                        processingDocPath,
                        processingEntity: normalizedProcessingEntity,
                        sportsLibVersion: rawVersion,
                        sportsLibVersionCode: normalizedRawCode,
                    });
                    return { outcome: 'unchanged' };
                }

                return {
                    outcome: 'patched',
                    payload: {
                        processingEntity: EVENT_PROCESSING_ENTITY,
                        sportsLibVersionCode: computedCode,
                    },
                };
            };

            let decision: ProcessingCodeDecision;
            if (options.execute) {
                const db = admin.firestore();
                decision = await db.runTransaction(async (transaction) => {
                    const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid);
                    if (deletionGuard.shouldSkip) {
                        logger.info('[sports-lib-processing-backfill] Skipping event because user is missing or deletion is in progress.', {
                            uid,
                            eventId,
                            eventPath,
                            processingDocPath,
                            userExists: deletionGuard.userExists,
                            deletionInProgress: deletionGuard.deletionInProgress,
                        });
                        return { outcome: 'skipped_user_deletion' };
                    }

                    const latestEventSnapshot = await transaction.get(eventDoc.ref);
                    if (!latestEventSnapshot.exists) {
                        logger.warn('[sports-lib-processing-backfill] Skipping event because event document no longer exists.', {
                            uid,
                            eventId,
                            eventPath,
                            processingDocPath,
                        });
                        return { outcome: 'skipped_event_missing' };
                    }

                    const processingSnapshot = await transaction.get(processingRef);
                    const transactionDecision = makeDecision(processingSnapshot);
                    if (transactionDecision.payload) {
                        transaction.set(processingRef, transactionDecision.payload, { merge: true });
                    }
                    return transactionDecision;
                });
            } else {
                decision = makeDecision(await processingRef.get());
            }

            if (decision.outcome === 'created') {
                summary.created++;
                logger.info('[sports-lib-processing-backfill] Created missing processing metadata.', {
                    uid,
                    eventId,
                    eventPath,
                    processingDocPath,
                    dryRun: !options.execute,
                });
                return;
            }
            if (decision.outcome === 'skipped_invalid') {
                summary.skippedInvalid++;
                return;
            }
            if (decision.outcome === 'skipped_event_missing') {
                summary.skippedEventMissing++;
                return;
            }
            if (decision.outcome === 'skipped_user_deletion') {
                summary.skippedUserDeletion++;
                return;
            }
            if (decision.outcome === 'unchanged') {
                summary.unchanged++;
                return;
            }

            summary.patched++;
            logger.info('[sports-lib-processing-backfill] Patched processing metadata.', {
                uid,
                eventId,
                eventPath,
                processingDocPath,
                dryRun: !options.execute,
            });
        } catch (error) {
            summary.failed++;
            logger.error('[sports-lib-processing-backfill] Failed to backfill processing metadata for event.', {
                uid,
                eventId,
                eventPath,
                processingDocPath,
                deletionGuardReadError: error instanceof UserDeletionGuardReadError,
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
                    skippedEventMissing: summary.skippedEventMissing,
                    skippedUserDeletion: summary.skippedUserDeletion,
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

    if (options.resume && options.execute) {
        if (eventDocs.length > 0) {
            const lastEventPath = eventDocs[eventDocs.length - 1].ref.path;
            if (summary.failed === 0) {
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
            } else {
                logger.warn('[sports-lib-processing-backfill] Resume checkpoint not advanced because the batch had failures.', {
                    checkpointPath: BACKFILL_RESUME_CHECKPOINT_PATH,
                    scopeKey,
                    lastEventPath,
                    failed: summary.failed,
                });
            }
        } else {
            logger.info('[sports-lib-processing-backfill] No events found; resume checkpoint unchanged.', {
                checkpointPath: BACKFILL_RESUME_CHECKPOINT_PATH,
                scopeKey,
            });
        }
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
