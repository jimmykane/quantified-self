import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS,
    parseUidAndEventIdFromEventPath,
} from '../reparse/sports-lib-reparse.service';
import { EVENT_PROCESSING_ENTITY } from '../shared/processing-metadata.interface';
import { getUserDeletionGuardStateInTransaction, UserDeletionGuardReadError } from '../shared/user-deletion-guard';

const PROGRESS_LOG_EVERY = 25;
const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 50;
const BACKFILL_RESUME_CHECKPOINT_PATH = 'temp_collection/temp_doc_eventProcessingEntityBackfill';

interface BackfillEventProcessingEntityOptions {
    execute: boolean;
    uid?: string;
    limit: number;
    startAfter?: string;
    concurrency: number;
    resume: boolean;
}

export interface BackfillEventProcessingEntitySummary {
    dryRun: boolean;
    scanned: number;
    patched: number;
    unchanged: number;
    skippedMissing: number;
    skippedInvalid: number;
    skippedEventMissing: number;
    skippedUserDeletion: number;
    failed: number;
}

export function shouldFailBackfillEventProcessingEntityRun(
    summary: Pick<BackfillEventProcessingEntitySummary, 'dryRun' | 'failed'>,
): boolean {
    return !summary.dryRun && summary.failed > 0;
}

type EventProcessingEntityBackfillOutcome =
    | 'patched'
    | 'unchanged'
    | 'skipped_missing_processing'
    | 'skipped_invalid_entity'
    | 'skipped_event_missing'
    | 'skipped_user_deletion';

interface BackfillEventProcessingEntityResumeCheckpoint {
    scopeKey?: string;
    lastEventPath?: string;
    updatedAt?: unknown;
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

export function parseBackfillEventProcessingEntityOptions(argv: string[]): BackfillEventProcessingEntityOptions {
    if (hasArg(argv, '--uids')) {
        throw new Error('backfill-event-processing-entity does not support --uids. Run globally or use --uid for a single-user scoped batch.');
    }

    const execute = argv.includes('--execute');
    const uid = readArgValue(argv, '--uid');

    return {
        execute,
        uid,
        limit: parseIntArg(readArgValue(argv, '--limit'), SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.scanLimit),
        startAfter: readArgValue(argv, '--start-after'),
        concurrency: parseConcurrencyArg(readArgValue(argv, '--concurrency')),
        resume: argv.includes('--resume'),
    };
}

function resolveScopedStartAfterValue(startAfter: string | undefined, options: BackfillEventProcessingEntityOptions): string | undefined {
    if (!startAfter || !options.uid) {
        return startAfter;
    }
    const parsed = parseUidAndEventIdFromEventPath(startAfter);
    if (parsed && parsed.uid === options.uid) {
        return parsed.eventId;
    }
    return startAfter;
}

async function getEventsToInspect(options: BackfillEventProcessingEntityOptions): Promise<admin.firestore.QueryDocumentSnapshot[]> {
    const db = admin.firestore();
    if (options.uid) {
        let userQuery = db.collection(`users/${options.uid}/events`)
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(options.limit);
        const scopedStartAfter = resolveScopedStartAfterValue(options.startAfter, options);
        if (scopedStartAfter) {
            userQuery = userQuery.startAfter(scopedStartAfter);
        }
        const snapshot = await userQuery.get();
        return snapshot.docs;
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

function shouldLogProgress(scanned: number, total: number): boolean {
    if (total <= 0) {
        return false;
    }
    return scanned === 1 || scanned === total || scanned % PROGRESS_LOG_EVERY === 0;
}

export async function runBackfillEventProcessingEntity(argv: string[]): Promise<BackfillEventProcessingEntitySummary> {
    const options = parseBackfillEventProcessingEntityOptions(argv);
    const summary: BackfillEventProcessingEntitySummary = {
        dryRun: !options.execute,
        scanned: 0,
        patched: 0,
        unchanged: 0,
        skippedMissing: 0,
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
    const scopeKey = options.uid ? `uid:${options.uid}` : 'global';

    let effectiveStartAfter = options.startAfter;
    if (!effectiveStartAfter && options.resume) {
        const checkpointSnapshot = await checkpointRef.get();
        const checkpointData = checkpointSnapshot.data() as BackfillEventProcessingEntityResumeCheckpoint | undefined;
        if (checkpointData?.scopeKey === scopeKey && typeof checkpointData.lastEventPath === 'string' && checkpointData.lastEventPath.length > 0) {
            effectiveStartAfter = checkpointData.lastEventPath;
            logger.info('[event-processing-entity-backfill] Resuming from checkpoint.', {
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
    logger.info('[event-processing-entity-backfill] Starting backfill run.', {
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
            summary.skippedInvalid++;
            logger.warn('[event-processing-entity-backfill] Could not parse UID/eventID from event path.', {
                eventPath: eventDoc.ref.path,
            });
            return;
        }

        const { uid, eventId } = parsed;
        const eventPath = eventDoc.ref.path;
        const processingRef = eventDoc.ref.collection('metaData').doc('processing');
        const processingDocPath = processingRef.path;

        try {
            let existingEntity: unknown;
            let outcome: EventProcessingEntityBackfillOutcome;

            if (options.execute) {
                const db = admin.firestore();
                outcome = await db.runTransaction(async (transaction) => {
                    const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid);
                    if (deletionGuard.shouldSkip) {
                        logger.info('[event-processing-entity-backfill] Skipping event because user is missing or deletion is in progress.', {
                            uid,
                            eventId,
                            eventPath,
                            processingDocPath,
                            userExists: deletionGuard.userExists,
                            deletionInProgress: deletionGuard.deletionInProgress,
                        });
                        return 'skipped_user_deletion';
                    }

                    const latestEventSnapshot = await transaction.get(eventDoc.ref);
                    if (!latestEventSnapshot.exists) {
                        logger.warn('[event-processing-entity-backfill] Skipping event because event document no longer exists.', {
                            uid,
                            eventId,
                            eventPath,
                            processingDocPath,
                        });
                        return 'skipped_event_missing';
                    }

                    const processingSnapshot = await transaction.get(processingRef);
                    if (!processingSnapshot.exists) {
                        logger.warn('[event-processing-entity-backfill] Skipping event without processing metadata.', {
                            uid,
                            eventId,
                            eventPath,
                            processingDocPath,
                        });
                        return 'skipped_missing_processing';
                    }

                    const processingData = processingSnapshot.data() as Record<string, unknown>;
                    existingEntity = processingData.processingEntity;
                    if (existingEntity === EVENT_PROCESSING_ENTITY) {
                        return 'unchanged';
                    }
                    if (typeof existingEntity === 'string' && existingEntity.length > 0) {
                        logger.warn('[event-processing-entity-backfill] Skipping event processing metadata with unexpected entity.', {
                            uid,
                            eventId,
                            eventPath,
                            processingDocPath,
                            processingEntity: existingEntity,
                        });
                        return 'skipped_invalid_entity';
                    }

                    transaction.set(processingRef, {
                        processingEntity: EVENT_PROCESSING_ENTITY,
                    }, { merge: true });
                    return 'patched';
                });
            } else {
                const processingSnapshot = await processingRef.get();
                if (!processingSnapshot.exists) {
                    logger.warn('[event-processing-entity-backfill] Skipping event without processing metadata.', {
                        uid,
                        eventId,
                        eventPath,
                        processingDocPath,
                    });
                    outcome = 'skipped_missing_processing';
                } else {
                    const processingData = processingSnapshot.data() as Record<string, unknown>;
                    existingEntity = processingData.processingEntity;
                    if (existingEntity === EVENT_PROCESSING_ENTITY) {
                        outcome = 'unchanged';
                    } else if (typeof existingEntity === 'string' && existingEntity.length > 0) {
                        logger.warn('[event-processing-entity-backfill] Skipping event processing metadata with unexpected entity.', {
                            uid,
                            eventId,
                            eventPath,
                            processingDocPath,
                            processingEntity: existingEntity,
                        });
                        outcome = 'skipped_invalid_entity';
                    } else {
                        outcome = 'patched';
                    }
                }
            }

            if (outcome === 'patched') {
                summary.patched++;
                logger.info('[event-processing-entity-backfill] Patched event processing metadata entity.', {
                    uid,
                    eventId,
                    eventPath,
                    processingDocPath,
                    dryRun: !options.execute,
                });
            } else if (outcome === 'unchanged') {
                summary.unchanged++;
            } else if (outcome === 'skipped_missing_processing') {
                summary.skippedMissing++;
            } else if (outcome === 'skipped_invalid_entity') {
                summary.skippedInvalid++;
            } else if (outcome === 'skipped_event_missing') {
                summary.skippedEventMissing++;
            } else {
                summary.skippedUserDeletion++;
            }
        } catch (error) {
            summary.failed++;
            logger.error('[event-processing-entity-backfill] Failed to backfill event processing metadata entity.', {
                uid,
                eventId,
                eventPath,
                processingDocPath,
                deletionGuardReadError: error instanceof UserDeletionGuardReadError,
                error: `${error}`,
            });
        } finally {
            if (shouldLogProgress(summary.scanned, totalEvents)) {
                logger.info('[event-processing-entity-backfill] Progress', {
                    scanned: summary.scanned,
                    totalEvents,
                    percentComplete: Math.round((summary.scanned / totalEvents) * 100),
                    patched: summary.patched,
                    unchanged: summary.unchanged,
                    skippedMissing: summary.skippedMissing,
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
                logger.info('[event-processing-entity-backfill] Updated resume checkpoint.', {
                    checkpointPath: BACKFILL_RESUME_CHECKPOINT_PATH,
                    scopeKey,
                    lastEventPath,
                });
            } else {
                logger.warn('[event-processing-entity-backfill] Resume checkpoint not advanced because the batch had failures.', {
                    checkpointPath: BACKFILL_RESUME_CHECKPOINT_PATH,
                    scopeKey,
                    lastEventPath,
                    failed: summary.failed,
                });
            }
        } else {
            logger.info('[event-processing-entity-backfill] No events found; resume checkpoint unchanged.', {
                checkpointPath: BACKFILL_RESUME_CHECKPOINT_PATH,
                scopeKey,
            });
        }
    }

    logger.info('[event-processing-entity-backfill] Summary', summary);
    return summary;
}

async function main(): Promise<void> {
    const summary = await runBackfillEventProcessingEntity(process.argv.slice(2));
    if (shouldFailBackfillEventProcessingEntityRun(summary)) {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch(error => {
        logger.error('[event-processing-entity-backfill] Fatal error', error);
        process.exitCode = 1;
    });
}
