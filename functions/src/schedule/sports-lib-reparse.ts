import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    SPORTS_LIB_REPARSE_CHECKPOINT_PATH,
    SPORTS_LIB_REPARSE_JOBS_COLLECTION,
    SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS,
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
    SPORTS_LIB_REPARSE_STATUS_DOC_ID,
    ReparseStatusWrite,
    SportsLibReparseCheckpoint,
    SportsLibReparseJob,
    buildSportsLibReparseJobId,
    extractSourceFiles,
    isReparsePersistenceSkippedForUserDeletionError,
    isSportsLibReparseTerminalFailureMessage,
    parseUidAndEventIdFromEventPath,
    resolveSportsLibReparseRoutingDecision,
    resolveTargetSportsLibVersion,
    resolveTargetSportsLibVersionCode,
    sportsLibVersionToCode,
    shouldEventBeReparsed,
    writeReparseStatus,
} from '../reparse/sports-lib-reparse.service';
import { enqueueSportsLibReparseHeavyTask, enqueueSportsLibReparseTask } from '../shared/cloud-tasks';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { getUserDeletionGuardState, UserDeletionGuardReadError } from '../shared/user-deletion-guard';
import { EVENT_PROCESSING_ENTITY } from '../shared/processing-metadata.interface';

const SPORTS_LIB_REPARSE_SCAN_CONCURRENCY = 25;
const SPORTS_LIB_REPARSE_TARGET_ENQUEUE_RPS = 12;
const SPORTS_LIB_REPARSE_ENQUEUE_SPREAD_MIN_SECONDS = 5;
const SPORTS_LIB_REPARSE_ENQUEUE_SPREAD_MAX_SECONDS = 5 * 60;

type EnqueuePacingMode = 'global' | 'override';

type ProcessingTaskResult = {
    trackedPromise: Promise<ProcessingTaskResult>;
} & (
    | { ok: true }
    | { ok: false; error: unknown }
);

type EnqueueSlotLease = {
    release: () => void;
};

function getCurrentSettings(): {
    enabled: boolean;
    scanLimit: number;
    enqueueLimit: number;
    uidAllowlist: Set<string> | null;
} {
    const constantUIDAllowlist = SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.uidAllowlist
        && SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.uidAllowlist.length > 0
        ? new Set(SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.uidAllowlist)
        : null;
    return {
        enabled: SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.enabled,
        scanLimit: SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.scanLimit,
        enqueueLimit: SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.enqueueLimit,
        uidAllowlist: constantUIDAllowlist,
    };
}

function toSafeString(value: unknown): string {
    if (value === undefined || value === null) {
        return '';
    }
    return `${value}`;
}

function toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return `${error}`;
}

async function shouldSkipForUserDeletion(
    db: admin.firestore.Firestore,
    uid: string,
    eventId: string,
    phase: string,
): Promise<boolean> {
    try {
        const deletionGuard = await getUserDeletionGuardState(db, uid);
        if (!deletionGuard.shouldSkip) {
            return false;
        }

        logger.info('[sports-lib-reparse] Skipping candidate because user is missing or deletion is in progress.', {
            uid,
            eventId,
            phase,
            userExists: deletionGuard.userExists,
            deletionInProgress: deletionGuard.deletionInProgress,
        });
        return true;
    } catch (error) {
        throw new UserDeletionGuardReadError(uid, `sports_lib_reparse_scheduler:${phase}`, error);
    }
}

async function writeReparseStatusUnlessUserDeleted(
    uid: string,
    eventId: string,
    payload: ReparseStatusWrite,
    phase: string,
): Promise<boolean> {
    try {
        await writeReparseStatus(uid, eventId, payload);
        return true;
    } catch (error) {
        if (isReparsePersistenceSkippedForUserDeletionError(error)) {
            logger.info('[sports-lib-reparse] Skipping status write because user is missing or deletion is in progress.', {
                uid,
                eventId,
                phase,
            });
            return false;
        }
        throw error;
    }
}

async function deleteReparseJobForUserDeletion(
    db: admin.firestore.Firestore,
    jobRef: admin.firestore.DocumentReference,
    jobId: string,
    uid: string,
    eventId: string,
    phase: string,
): Promise<void> {
    await db.recursiveDelete(jobRef);
    logger.info('[sports-lib-reparse] Deleted pending job because user is missing or deletion is in progress.', {
        jobId,
        uid,
        eventId,
        phase,
    });
}

function shouldSkipBecauseNoOriginalFilesForTarget(
    statusDocData: Record<string, unknown> | undefined,
    targetSportsLibVersion: string,
): boolean {
    if (!statusDocData) {
        return false;
    }
    return statusDocData.status === 'skipped'
        && statusDocData.reason === SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES
        && statusDocData.targetSportsLibVersion === targetSportsLibVersion;
}

function shouldSkipBecauseTerminalFailureForTarget(
    statusDocData: Record<string, unknown> | undefined,
    targetSportsLibVersion: string,
): boolean {
    if (!statusDocData
        || statusDocData.status !== 'failed'
        || statusDocData.targetSportsLibVersion !== targetSportsLibVersion) {
        return false;
    }
    if (statusDocData.terminalFailure === true) {
        return true;
    }
    return isSportsLibReparseTerminalFailureMessage(toSafeString(statusDocData.lastError));
}

function isTerminalFailedReparseJob(jobData: Record<string, unknown> | undefined): boolean {
    if (!jobData || jobData.status !== 'failed') {
        return false;
    }
    if (jobData.terminalFailure === true) {
        return true;
    }
    return isSportsLibReparseTerminalFailureMessage(toSafeString(jobData.lastError));
}

function getProcessingVersionCode(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return value;
}

function isEventProcessingMetadataDocPath(path: string): boolean {
    const processingMetadataSuffix = '/metaData/processing';
    if (!path.endsWith(processingMetadataSuffix)) {
        return false;
    }

    const eventPath = path.slice(0, -processingMetadataSuffix.length);
    return parseUidAndEventIdFromEventPath(eventPath) !== null;
}

function clampNumber(value: number, minValue: number, maxValue: number): number {
    return Math.max(minValue, Math.min(maxValue, value));
}

function resolveEnqueueSpreadSeconds(
    enqueueLimit: number,
): number {
    if (enqueueLimit <= 1) {
        return 1;
    }
    const idealSpreadSeconds = Math.ceil(enqueueLimit / SPORTS_LIB_REPARSE_TARGET_ENQUEUE_RPS);

    return clampNumber(
        idealSpreadSeconds,
        SPORTS_LIB_REPARSE_ENQUEUE_SPREAD_MIN_SECONDS,
        SPORTS_LIB_REPARSE_ENQUEUE_SPREAD_MAX_SECONDS,
    );
}

function calculateEnqueueDelaySeconds(
    enqueueSequence: number,
    enqueueLimit: number,
    enqueueSpreadSeconds: number,
): number {
    if (enqueueSequence <= 0 || enqueueLimit <= 1) {
        return 1;
    }
    const denominator = Math.max(enqueueLimit - 1, 1);
    const scaled = Math.floor((enqueueSequence * enqueueSpreadSeconds) / denominator);
    return clampNumber(scaled, 1, enqueueSpreadSeconds);
}

export const scheduleSportsLibReparseScan = onSchedule({
    region: FUNCTIONS_MANIFEST.scheduleSportsLibReparseScan.region,
    schedule: 'every 10 minutes',
    memory: '512MiB',
    timeoutSeconds: 300,
}, async () => {
    const settings = getCurrentSettings();
    if (!settings.enabled) {
        logger.info('[sports-lib-reparse] Scheduler disabled (SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.enabled=false).');
        return;
    }

    const db = admin.firestore();
    const targetSportsLibVersion = resolveTargetSportsLibVersion();
    const targetSportsLibVersionCode = resolveTargetSportsLibVersionCode();
    const checkpointRef = db.doc(SPORTS_LIB_REPARSE_CHECKPOINT_PATH);
    const checkpointSnapshot = await checkpointRef.get();
    const checkpointData = checkpointSnapshot.data() as SportsLibReparseCheckpoint | undefined;
    const cursorProcessingDocPath = checkpointData?.cursorProcessingDocPath || null;
    const cursorProcessingVersionCode = getProcessingVersionCode(checkpointData?.cursorProcessingVersionCode);

    await checkpointRef.set({
        lastPassStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastScanAt: admin.firestore.FieldValue.serverTimestamp(),
        lastScanCount: 0,
        lastEnqueuedCount: 0,
        targetSportsLibVersion,
    }, { merge: true });

    let scannedCount = 0;
    let enqueuedCount = 0;
    let enqueueAttemptSequence = 0;
    let enqueueReservationCount = 0;
    let lastProcessingDocPath: string | null = null;
    let lastProcessingVersionCode: number | null = null;
    const enqueuePacingMode: EnqueuePacingMode = settings.uidAllowlist && settings.uidAllowlist.size > 0
        ? 'override'
        : 'global';
    const enqueueSpreadSeconds = resolveEnqueueSpreadSeconds(settings.enqueueLimit);
    const hasReachedEnqueueLimit = (): boolean => enqueuedCount >= settings.enqueueLimit;
    const hasAvailableEnqueueSlot = (): boolean => (enqueuedCount + enqueueReservationCount) < settings.enqueueLimit;
    const tryAcquireEnqueueSlotLease = (): EnqueueSlotLease | null => {
        if (!hasAvailableEnqueueSlot()) {
            return null;
        }
        enqueueReservationCount++;
        let released = false;
        return {
            release: (): void => {
                if (released) {
                    return;
                }
                released = true;
                enqueueReservationCount--;
            },
        };
    };

    const processEventData = async (
        eventRef: admin.firestore.DocumentReference,
        eventData: Record<string, unknown>,
        options?: { skipCandidateCheck?: boolean; reservationLease?: EnqueueSlotLease | null },
    ): Promise<void> => {
        const parsed = parseUidAndEventIdFromEventPath(eventRef.path);
        let reservationLease = options?.reservationLease ?? null;
        if (!parsed) {
            reservationLease?.release();
            return;
        }
        const { uid, eventId } = parsed;

        if (!reservationLease) {
            reservationLease = tryAcquireEnqueueSlotLease();
        }
        if (!reservationLease) {
            return;
        }

        try {
            if (!options?.skipCandidateCheck) {
                try {
                    const needsReparse = await shouldEventBeReparsed(eventRef, targetSportsLibVersion);
                    if (!needsReparse) {
                        return;
                    }
                } catch (error) {
                    logger.warn('[sports-lib-reparse] Invalid processing metadata; skipping event candidate.', {
                        eventPath: eventRef.path,
                        error: toErrorMessage(error),
                    });
                    return;
                }
            }

            const statusSnapshot = await eventRef.collection('metaData').doc(SPORTS_LIB_REPARSE_STATUS_DOC_ID).get();
            const reparseStatusData = statusSnapshot.data() as Record<string, unknown> | undefined;
            if (shouldSkipBecauseNoOriginalFilesForTarget(reparseStatusData, targetSportsLibVersion)) {
                return;
            }
            if (shouldSkipBecauseTerminalFailureForTarget(reparseStatusData, targetSportsLibVersion)) {
                logger.info('[sports-lib-reparse] Skipping terminal failed reparse status.', {
                    uid,
                    eventId,
                    lastError: toSafeString(reparseStatusData?.lastError),
                });
                return;
            }

            const sourceFiles = extractSourceFiles(eventData);
            if (sourceFiles.length === 0) {
                if (await shouldSkipForUserDeletion(db, uid, eventId, 'before_no_source_status_write')) {
                    return;
                }

                await writeReparseStatusUnlessUserDeleted(uid, eventId, {
                    status: 'skipped',
                    reason: SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
                    targetSportsLibVersion,
                    checkedAt: admin.firestore.FieldValue.serverTimestamp(),
                    terminalFailure: admin.firestore.FieldValue.delete(),
                    terminalFailureAt: admin.firestore.FieldValue.delete(),
                }, 'no_source_files');
                return;
            }

            const jobId = buildSportsLibReparseJobId(uid, eventId, targetSportsLibVersion);
            const jobRef = db.collection(SPORTS_LIB_REPARSE_JOBS_COLLECTION).doc(jobId);
            const existingJob = await jobRef.get();
            const existingJobData = existingJob.data() as Record<string, unknown> | undefined;
            const existingStatus = toSafeString(existingJobData?.status);

            if (existingJob.exists && (
                existingStatus === 'pending'
                || existingStatus === 'processing'
                || existingStatus === 'completed'
                || existingStatus === 'superseded'
            )) {
                return;
            }
            if (existingJob.exists && isTerminalFailedReparseJob(existingJobData)) {
                logger.info('[sports-lib-reparse] Skipping terminal failed reparse job.', {
                    jobId,
                    uid,
                    eventId,
                    lastError: toSafeString(existingJobData?.lastError),
                });
                return;
            }

            const routingDecision = resolveSportsLibReparseRoutingDecision(eventData);

            const basePayload: SportsLibReparseJob = {
                uid,
                eventId,
                eventPath: eventRef.path,
                targetSportsLibVersion,
                status: 'pending',
                processingTier: routingDecision.processingTier,
                ...(routingDecision.heavyReason ? { heavyReason: routingDecision.heavyReason } : {}),
                ...(routingDecision.eventDurationMs !== null ? { eventDurationMs: routingDecision.eventDurationMs } : {}),
                attemptCount: typeof existingJobData?.attemptCount === 'number' ? existingJobData.attemptCount : 0,
                createdAt: existingJob.exists ? existingJobData?.createdAt : admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                enqueuedAt: admin.firestore.FieldValue.serverTimestamp(),
                expireAt: getExpireAtTimestamp(TTL_CONFIG.SPORTS_LIB_REPARSE_JOBS_IN_DAYS),
            };

            if (await shouldSkipForUserDeletion(db, uid, eventId, 'before_job_write')) {
                return;
            }

            await jobRef.set({
                ...basePayload,
                ...(routingDecision.heavyReason ? {} : { heavyReason: admin.firestore.FieldValue.delete() }),
                ...(routingDecision.eventDurationMs !== null ? {} : { eventDurationMs: admin.firestore.FieldValue.delete() }),
                lastError: admin.firestore.FieldValue.delete(),
                terminalFailure: admin.firestore.FieldValue.delete(),
                terminalFailureAt: admin.firestore.FieldValue.delete(),
                processedAt: admin.firestore.FieldValue.delete(),
            }, { merge: true });

            try {
                if (await shouldSkipForUserDeletion(db, uid, eventId, 'before_task_enqueue')) {
                    await deleteReparseJobForUserDeletion(db, jobRef, jobId, uid, eventId, 'before_task_enqueue');
                    return;
                }

                const enqueueDelaySeconds = calculateEnqueueDelaySeconds(
                    enqueueAttemptSequence,
                    settings.enqueueLimit,
                    enqueueSpreadSeconds,
                );
                enqueueAttemptSequence++;
                const enqueueTask = routingDecision.processingTier === 'heavy'
                    ? enqueueSportsLibReparseHeavyTask
                    : enqueueSportsLibReparseTask;
                const taskCreated = enqueueDelaySeconds > 1
                    ? await enqueueTask(jobId, enqueueDelaySeconds)
                    : await enqueueTask(jobId);
                if (taskCreated) {
                    enqueuedCount++;
                } else {
                    const errorMessage = `Cloud Task was not created because a task name already exists for job ${jobId}.`;
                    if (await shouldSkipForUserDeletion(db, uid, eventId, 'before_task_not_created_write')) {
                        await deleteReparseJobForUserDeletion(db, jobRef, jobId, uid, eventId, 'before_task_not_created_write');
                        return;
                    }
                    await jobRef.set({
                        status: 'failed',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        lastError: errorMessage,
                        enqueuedAt: admin.firestore.FieldValue.delete(),
                    }, { merge: true });
                    logger.warn('[sports-lib-reparse] Marked job failed because task creation returned false.', {
                        jobId,
                        uid,
                        eventId,
                        processingTier: routingDecision.processingTier,
                        error: errorMessage,
                    });
                }
            } catch (error) {
                const errorMessage = toErrorMessage(error);
                if (await shouldSkipForUserDeletion(db, uid, eventId, 'before_enqueue_failure_write')) {
                    await deleteReparseJobForUserDeletion(db, jobRef, jobId, uid, eventId, 'before_enqueue_failure_write');
                    return;
                }
                await jobRef.set({
                    status: 'failed',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    lastError: errorMessage,
                    enqueuedAt: admin.firestore.FieldValue.delete(),
                }, { merge: true });
                throw error;
            }
        } finally {
            reservationLease.release();
        }
    };

    if (settings.uidAllowlist && settings.uidAllowlist.size > 0) {
        const overrideUIDs = Array.from(settings.uidAllowlist);
        const previousCursorByUID = checkpointData?.overrideCursorByUid || {};
        const nextCursorByUID: Record<string, string | null> = {};

        for (const uid of overrideUIDs) {
            const remainingScan = settings.scanLimit - scannedCount;
            const previousCursor = previousCursorByUID[uid] || null;

            if (hasReachedEnqueueLimit()) {
                nextCursorByUID[uid] = previousCursor;
                continue;
            }

            if (remainingScan <= 0) {
                nextCursorByUID[uid] = previousCursor;
                continue;
            }

            let userQuery = db.collection(`users/${uid}/events`)
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(remainingScan);

            if (previousCursor) {
                userQuery = userQuery.startAfter(previousCursor);
            }

            const userSnapshot = await userQuery.get();
            if (userSnapshot.empty) {
                nextCursorByUID[uid] = null;
                continue;
            }

            let lastProcessedDocId: string | null = null;
            for (const eventDoc of userSnapshot.docs) {
                if (hasReachedEnqueueLimit()) {
                    break;
                }
                scannedCount++;
                lastProcessedDocId = eventDoc.id;
                await processEventData(eventDoc.ref, eventDoc.data() as Record<string, unknown>);
            }

            if (hasReachedEnqueueLimit()) {
                nextCursorByUID[uid] = lastProcessedDocId || previousCursor;
            } else if (userSnapshot.size < remainingScan) {
                nextCursorByUID[uid] = null;
            } else {
                nextCursorByUID[uid] = lastProcessedDocId;
            }
        }

        const completedAllUIDPasses = Object.values(nextCursorByUID).every(cursor => !cursor);
        await checkpointRef.set({
            overrideCursorByUid: nextCursorByUID,
            lastScanAt: admin.firestore.FieldValue.serverTimestamp(),
            lastScanCount: scannedCount,
            lastEnqueuedCount: enqueuedCount,
            targetSportsLibVersion,
            ...(completedAllUIDPasses ? { lastPassCompletedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
        }, { merge: true });

        logger.info('[sports-lib-reparse] Override scan complete', {
            scannedCount,
            enqueuedCount,
            overrideUIDsCount: overrideUIDs.length,
            enqueuePacingMode,
            enqueueSpreadSeconds,
            nextCursorByUID,
        });
        return;
    }

    let query = db.collectionGroup('metaData')
        .where('processingEntity', '==', EVENT_PROCESSING_ENTITY)
        .where('sportsLibVersionCode', '<', targetSportsLibVersionCode)
        .orderBy('sportsLibVersionCode', 'asc')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(settings.scanLimit);

    if (cursorProcessingDocPath && cursorProcessingVersionCode !== null) {
        query = query.startAfter(cursorProcessingVersionCode, db.doc(cursorProcessingDocPath));
    }

    const processingSnapshot = await query.get();
    if (processingSnapshot.empty) {
        await checkpointRef.set({
            cursorProcessingDocPath: null,
            cursorProcessingVersionCode: null,
            lastScanAt: admin.firestore.FieldValue.serverTimestamp(),
            lastPassCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastScanCount: 0,
            lastEnqueuedCount: 0,
            targetSportsLibVersion,
        }, { merge: true });
        logger.info('[sports-lib-reparse] No processing metadata candidates found for scan.');
        return;
    }

    let stoppedByEnqueueLimit = false;
    const inFlightProcessing = new Set<Promise<ProcessingTaskResult>>();
    for (const processingDoc of processingSnapshot.docs) {
        while (inFlightProcessing.size >= SPORTS_LIB_REPARSE_SCAN_CONCURRENCY || !hasAvailableEnqueueSlot()) {
            if (inFlightProcessing.size === 0) {
                stoppedByEnqueueLimit = hasReachedEnqueueLimit();
                break;
            }
            const settledTask = await Promise.race(inFlightProcessing);
            inFlightProcessing.delete(settledTask.trackedPromise);
            if (!settledTask.ok) {
                throw settledTask.error;
            }
        }
        if (stoppedByEnqueueLimit) {
            break;
        }
        scannedCount++;
        const processingData = processingDoc.data() as Record<string, unknown>;
        const processingVersion = `${processingData.sportsLibVersion ?? ''}`;
        const processingVersionCode = getProcessingVersionCode(processingData.sportsLibVersionCode);

        // Persist cursor progression based on the sortable query tuple to avoid rescanning
        // full malformed pages (e.g. missing/invalid sportsLibVersion payload).
        if (processingVersionCode !== null) {
            lastProcessingDocPath = processingDoc.ref.path;
            lastProcessingVersionCode = processingVersionCode;
        }

        if (!isEventProcessingMetadataDocPath(processingDoc.ref.path)) {
            logger.warn('[sports-lib-reparse] Skipping metadata doc outside event processing path.', {
                processingDocPath: processingDoc.ref.path,
            });
            continue;
        }

        if (!processingVersion || processingVersionCode === null) {
            logger.warn('[sports-lib-reparse] Invalid processing metadata; skipping doc.', {
                processingDocPath: processingDoc.ref.path,
                sportsLibVersion: processingData.sportsLibVersion,
                sportsLibVersionCode: processingData.sportsLibVersionCode,
            });
            continue;
        }

        let computedVersionCode: number;
        try {
            computedVersionCode = sportsLibVersionToCode(processingVersion);
        } catch (error) {
            logger.warn('[sports-lib-reparse] Invalid processing metadata; skipping doc.', {
                processingDocPath: processingDoc.ref.path,
                sportsLibVersion: processingVersion,
                sportsLibVersionCode: processingVersionCode,
                error: toErrorMessage(error),
            });
            continue;
        }
        if (computedVersionCode !== processingVersionCode) {
            logger.warn('[sports-lib-reparse] Mismatched processing metadata version/code; skipping doc.', {
                processingDocPath: processingDoc.ref.path,
                sportsLibVersion: processingVersion,
                sportsLibVersionCode: processingVersionCode,
                computedVersionCode,
            });
            continue;
        }

        const eventRef = processingDoc.ref.parent.parent;
        if (!eventRef) {
            logger.warn('[sports-lib-reparse] Could not resolve parent event from processing metadata path.', {
                processingDocPath: processingDoc.ref.path,
            });
            continue;
        }

        if (processingVersionCode >= targetSportsLibVersionCode) {
            continue;
        }

        const reservationLease = tryAcquireEnqueueSlotLease();
        if (!reservationLease) {
            stoppedByEnqueueLimit = hasReachedEnqueueLimit();
            if (stoppedByEnqueueLimit) {
                break;
            }
            continue;
        }

        const processPromise = (async (): Promise<void> => {
            let activeReservationLease: EnqueueSlotLease | null = reservationLease;
            try {
                const eventSnapshot = await eventRef.get();
                if (!eventSnapshot.exists) {
                    logger.warn('[sports-lib-reparse] Skipping stale processing metadata because parent event is missing.', {
                        processingDocPath: processingDoc.ref.path,
                        eventPath: eventRef.path,
                    });
                    return;
                }
                const inheritedReservationLease = activeReservationLease;
                activeReservationLease = null;
                await processEventData(eventRef, eventSnapshot.data() as Record<string, unknown>, {
                    skipCandidateCheck: true,
                    reservationLease: inheritedReservationLease,
                });
            } finally {
                activeReservationLease?.release();
            }
        })();
        const trackedPromise = processPromise.then(
            (): ProcessingTaskResult => ({
                trackedPromise,
                ok: true,
            }),
            (error): ProcessingTaskResult => {
                logger.error('[sports-lib-reparse] Failed to process candidate from processing metadata scan.', {
                    processingDocPath: processingDoc.ref.path,
                    eventPath: eventRef.path,
                    error: toErrorMessage(error),
                });
                return {
                    trackedPromise,
                    ok: false,
                    error,
                };
            },
        );
        inFlightProcessing.add(trackedPromise);
    }

    if (inFlightProcessing.size > 0) {
        const settledTasks = await Promise.all(inFlightProcessing);
        for (const settledTask of settledTasks) {
            if (!settledTask.ok) {
                throw settledTask.error;
            }
        }
    }

    const passCompleted = !stoppedByEnqueueLimit && processingSnapshot.size < settings.scanLimit;
    const canPersistCursor = !passCompleted && lastProcessingDocPath && lastProcessingVersionCode !== null;
    await checkpointRef.set({
        cursorProcessingDocPath: canPersistCursor ? lastProcessingDocPath : null,
        cursorProcessingVersionCode: canPersistCursor ? lastProcessingVersionCode : null,
        ...(passCompleted ? { cursorEventPath: null } : {}),
        lastScanAt: admin.firestore.FieldValue.serverTimestamp(),
        lastScanCount: scannedCount,
        lastEnqueuedCount: enqueuedCount,
        targetSportsLibVersion,
        ...(passCompleted ? { lastPassCompletedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
    }, { merge: true });

    logger.info('[sports-lib-reparse] Scan complete', {
        scannedCount,
        enqueuedCount,
        enqueuePacingMode,
        enqueueSpreadSeconds,
        nextCursorProcessingDocPath: passCompleted ? null : lastProcessingDocPath,
        nextCursorProcessingVersionCode: passCompleted ? null : lastProcessingVersionCode,
    });
});
