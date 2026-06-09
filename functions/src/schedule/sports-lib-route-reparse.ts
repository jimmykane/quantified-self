import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import {
    SPORTS_LIB_ROUTE_REPARSE_CHECKPOINT_PATH,
    SPORTS_LIB_ROUTE_REPARSE_JOBS_COLLECTION,
    SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS,
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
    SPORTS_LIB_REPARSE_STATUS_DOC_ID,
    RouteReparseStatusWrite,
    SportsLibRouteReparseCheckpoint,
    SportsLibRouteReparseJob,
    buildSportsLibRouteReparseJobId,
    extractPrimaryRouteSourceFile,
    isRouteReparsePersistenceSkippedForUserDeletionError,
    isSportsLibRouteReparseTerminalFailureMessage,
    parseUidAndRouteIdFromRoutePath,
    resolveRouteReparseTargetSportsLibVersion,
    resolveRouteReparseTargetSportsLibVersionCode,
    shouldRouteBeReparsed,
    writeRouteReparseStatus,
} from '../reparse/sports-lib-route-reparse.service';
import { sportsLibVersionToCode } from '../reparse/sports-lib-reparse.service';
import { enqueueSportsLibRouteReparseTask } from '../shared/cloud-tasks';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import { getUserDeletionGuardState, UserDeletionGuardReadError } from '../shared/user-deletion-guard';

const ROUTE_REPARSE_TARGET_ENQUEUE_RPS = 12;
const ROUTE_REPARSE_ENQUEUE_SPREAD_MIN_SECONDS = 5;
const ROUTE_REPARSE_ENQUEUE_SPREAD_MAX_SECONDS = 5 * 60;

type EnqueuePacingMode = 'global' | 'override';

function getCurrentSettings(): {
    enabled: boolean;
    scanLimit: number;
    enqueueLimit: number;
    uidAllowlist: Set<string> | null;
} {
    const constantUIDAllowlist = SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS.uidAllowlist
        && SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS.uidAllowlist.length > 0
        ? new Set(SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS.uidAllowlist)
        : null;
    return {
        enabled: SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS.enabled,
        scanLimit: SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS.scanLimit,
        enqueueLimit: SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS.enqueueLimit,
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

function clampNumber(value: number, minValue: number, maxValue: number): number {
    return Math.max(minValue, Math.min(maxValue, value));
}

function resolveEnqueueSpreadSeconds(enqueueLimit: number): number {
    if (enqueueLimit <= 1) {
        return 1;
    }
    const idealSpreadSeconds = Math.ceil(enqueueLimit / ROUTE_REPARSE_TARGET_ENQUEUE_RPS);

    return clampNumber(
        idealSpreadSeconds,
        ROUTE_REPARSE_ENQUEUE_SPREAD_MIN_SECONDS,
        ROUTE_REPARSE_ENQUEUE_SPREAD_MAX_SECONDS,
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

function getProcessingVersionCode(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return value;
}

function getRoutePathFromProcessingMetadataDocPath(path: string): string | null {
    const processingMetadataSuffix = '/metaData/processing';
    if (!path.endsWith(processingMetadataSuffix)) {
        return null;
    }

    const routePath = path.slice(0, -processingMetadataSuffix.length);
    return parseUidAndRouteIdFromRoutePath(routePath) ? routePath : null;
}

async function shouldSkipForUserDeletion(
    db: admin.firestore.Firestore,
    uid: string,
    routeId: string,
    phase: string,
): Promise<boolean> {
    try {
        const deletionGuard = await getUserDeletionGuardState(db, uid);
        if (!deletionGuard.shouldSkip) {
            return false;
        }

        logger.info('[sports-lib-route-reparse] Skipping candidate because user is missing or deletion is in progress.', {
            uid,
            routeId,
            phase,
            userExists: deletionGuard.userExists,
            deletionInProgress: deletionGuard.deletionInProgress,
        });
        return true;
    } catch (error) {
        throw new UserDeletionGuardReadError(uid, `sports_lib_route_reparse_scheduler:${phase}`, error);
    }
}

async function writeRouteReparseStatusUnlessUserDeleted(
    uid: string,
    routeId: string,
    payload: RouteReparseStatusWrite,
    phase: string,
): Promise<boolean> {
    try {
        await writeRouteReparseStatus(uid, routeId, payload);
        return true;
    } catch (error) {
        if (isRouteReparsePersistenceSkippedForUserDeletionError(error)) {
            logger.info('[sports-lib-route-reparse] Skipping status write because user is missing or deletion is in progress.', {
                uid,
                routeId,
                phase,
            });
            return false;
        }
        throw error;
    }
}

async function deleteRouteReparseJobForUserDeletion(
    db: admin.firestore.Firestore,
    jobRef: admin.firestore.DocumentReference,
    jobId: string,
    uid: string,
    routeId: string,
    phase: string,
): Promise<void> {
    await db.recursiveDelete(jobRef);
    logger.info('[sports-lib-route-reparse] Deleted pending job because user is missing or deletion is in progress.', {
        jobId,
        uid,
        routeId,
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
    return isSportsLibRouteReparseTerminalFailureMessage(toSafeString(statusDocData.lastError));
}

function isTerminalFailedRouteReparseJob(jobData: Record<string, unknown> | undefined): boolean {
    if (!jobData || jobData.status !== 'failed') {
        return false;
    }
    if (jobData.terminalFailure === true) {
        return true;
    }
    return isSportsLibRouteReparseTerminalFailureMessage(toSafeString(jobData.lastError));
}

async function processRouteDocument(
    db: admin.firestore.Firestore,
    routeRef: admin.firestore.DocumentReference,
    routeData: Record<string, unknown>,
    options: {
        targetSportsLibVersion: string;
        enqueueLimit: number;
        enqueueSpreadSeconds: number;
        enqueueAttemptSequence: number;
        enqueuedCount: number;
        skipCandidateCheck?: boolean;
    },
): Promise<{ enqueuedCount: number; enqueueAttemptSequence: number }> {
    const parsed = parseUidAndRouteIdFromRoutePath(routeRef.path);
    if (!parsed) {
        return {
            enqueuedCount: options.enqueuedCount,
            enqueueAttemptSequence: options.enqueueAttemptSequence,
        };
    }
    const { uid, routeId } = parsed;
    const targetSportsLibVersion = options.targetSportsLibVersion;

    if (!options.skipCandidateCheck) {
        const needsReparse = await shouldRouteBeReparsed(routeRef, targetSportsLibVersion);
        if (!needsReparse) {
            return {
                enqueuedCount: options.enqueuedCount,
                enqueueAttemptSequence: options.enqueueAttemptSequence,
            };
        }
    }

    const statusSnapshot = await routeRef.collection('metaData').doc(SPORTS_LIB_REPARSE_STATUS_DOC_ID).get();
    const reparseStatusData = statusSnapshot.data() as Record<string, unknown> | undefined;
    if (shouldSkipBecauseNoOriginalFilesForTarget(reparseStatusData, targetSportsLibVersion)) {
        return {
            enqueuedCount: options.enqueuedCount,
            enqueueAttemptSequence: options.enqueueAttemptSequence,
        };
    }
    if (shouldSkipBecauseTerminalFailureForTarget(reparseStatusData, targetSportsLibVersion)) {
        logger.info('[sports-lib-route-reparse] Skipping terminal failed route reparse status.', {
            uid,
            routeId,
            lastError: toSafeString(reparseStatusData?.lastError),
        });
        return {
            enqueuedCount: options.enqueuedCount,
            enqueueAttemptSequence: options.enqueueAttemptSequence,
        };
    }

    const sourceFile = extractPrimaryRouteSourceFile(routeData);
    if (!sourceFile) {
        if (await shouldSkipForUserDeletion(db, uid, routeId, 'before_no_source_status_write')) {
            return {
                enqueuedCount: options.enqueuedCount,
                enqueueAttemptSequence: options.enqueueAttemptSequence,
            };
        }

        await writeRouteReparseStatusUnlessUserDeleted(uid, routeId, {
            status: 'skipped',
            reason: SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
            targetSportsLibVersion,
            checkedAt: admin.firestore.FieldValue.serverTimestamp(),
            terminalFailure: admin.firestore.FieldValue.delete(),
            terminalFailureAt: admin.firestore.FieldValue.delete(),
        }, 'no_source_files');
        return {
            enqueuedCount: options.enqueuedCount,
            enqueueAttemptSequence: options.enqueueAttemptSequence,
        };
    }

    const jobId = buildSportsLibRouteReparseJobId(uid, routeId, targetSportsLibVersion);
    const jobRef = db.collection(SPORTS_LIB_ROUTE_REPARSE_JOBS_COLLECTION).doc(jobId);
    const existingJob = await jobRef.get();
    const existingJobData = existingJob.data() as Record<string, unknown> | undefined;
    const existingStatus = toSafeString(existingJobData?.status);

    if (existingJob.exists && (existingStatus === 'pending' || existingStatus === 'processing' || existingStatus === 'completed')) {
        return {
            enqueuedCount: options.enqueuedCount,
            enqueueAttemptSequence: options.enqueueAttemptSequence,
        };
    }
    if (existingJob.exists && isTerminalFailedRouteReparseJob(existingJobData)) {
        logger.info('[sports-lib-route-reparse] Skipping terminal failed route reparse job.', {
            jobId,
            uid,
            routeId,
            lastError: toSafeString(existingJobData?.lastError),
        });
        return {
            enqueuedCount: options.enqueuedCount,
            enqueueAttemptSequence: options.enqueueAttemptSequence,
        };
    }

    const basePayload: SportsLibRouteReparseJob = {
        uid,
        routeId,
        routePath: routeRef.path,
        targetSportsLibVersion,
        status: 'pending',
        attemptCount: typeof existingJobData?.attemptCount === 'number' ? existingJobData.attemptCount : 0,
        createdAt: existingJob.exists ? existingJobData?.createdAt : admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        enqueuedAt: admin.firestore.FieldValue.serverTimestamp(),
        expireAt: getExpireAtTimestamp(TTL_CONFIG.SPORTS_LIB_REPARSE_JOBS_IN_DAYS),
    };

    if (await shouldSkipForUserDeletion(db, uid, routeId, 'before_job_write')) {
        return {
            enqueuedCount: options.enqueuedCount,
            enqueueAttemptSequence: options.enqueueAttemptSequence,
        };
    }

    await jobRef.set({
        ...basePayload,
        lastError: admin.firestore.FieldValue.delete(),
        terminalFailure: admin.firestore.FieldValue.delete(),
        terminalFailureAt: admin.firestore.FieldValue.delete(),
        processedAt: admin.firestore.FieldValue.delete(),
    }, { merge: true });

    try {
        if (await shouldSkipForUserDeletion(db, uid, routeId, 'before_task_enqueue')) {
            await deleteRouteReparseJobForUserDeletion(db, jobRef, jobId, uid, routeId, 'before_task_enqueue');
            return {
                enqueuedCount: options.enqueuedCount,
                enqueueAttemptSequence: options.enqueueAttemptSequence,
            };
        }

        const enqueueDelaySeconds = calculateEnqueueDelaySeconds(
            options.enqueueAttemptSequence,
            options.enqueueLimit,
            options.enqueueSpreadSeconds,
        );
        const nextEnqueueAttemptSequence = options.enqueueAttemptSequence + 1;
        const taskCreated = enqueueDelaySeconds > 1
            ? await enqueueSportsLibRouteReparseTask(jobId, enqueueDelaySeconds)
            : await enqueueSportsLibRouteReparseTask(jobId);

        if (taskCreated) {
            return {
                enqueuedCount: options.enqueuedCount + 1,
                enqueueAttemptSequence: nextEnqueueAttemptSequence,
            };
        }

        const errorMessage = `Cloud Task was not created because a task name already exists for job ${jobId}.`;
        if (await shouldSkipForUserDeletion(db, uid, routeId, 'before_task_not_created_write')) {
            await deleteRouteReparseJobForUserDeletion(db, jobRef, jobId, uid, routeId, 'before_task_not_created_write');
            return {
                enqueuedCount: options.enqueuedCount,
                enqueueAttemptSequence: nextEnqueueAttemptSequence,
            };
        }
        await jobRef.set({
            status: 'failed',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastError: errorMessage,
            enqueuedAt: admin.firestore.FieldValue.delete(),
        }, { merge: true });
        logger.warn('[sports-lib-route-reparse] Marked job failed because task creation returned false.', {
            jobId,
            uid,
            routeId,
            error: errorMessage,
        });
        return {
            enqueuedCount: options.enqueuedCount,
            enqueueAttemptSequence: nextEnqueueAttemptSequence,
        };
    } catch (error) {
        const errorMessage = toErrorMessage(error);
        if (await shouldSkipForUserDeletion(db, uid, routeId, 'before_enqueue_failure_write')) {
            await deleteRouteReparseJobForUserDeletion(db, jobRef, jobId, uid, routeId, 'before_enqueue_failure_write');
            return {
                enqueuedCount: options.enqueuedCount,
                enqueueAttemptSequence: options.enqueueAttemptSequence,
            };
        }
        await jobRef.set({
            status: 'failed',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastError: errorMessage,
            enqueuedAt: admin.firestore.FieldValue.delete(),
        }, { merge: true });
        throw error;
    }
}

export const scheduleSportsLibRouteReparseScan = onSchedule({
    region: FUNCTIONS_MANIFEST.scheduleSportsLibRouteReparseScan.region,
    schedule: 'every 10 minutes',
    memory: '512MiB',
    timeoutSeconds: 300,
}, async () => {
    const settings = getCurrentSettings();
    if (!settings.enabled) {
        logger.info('[sports-lib-route-reparse] Scheduler disabled (SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS.enabled=false).');
        return;
    }

    const db = admin.firestore();
    const targetSportsLibVersion = resolveRouteReparseTargetSportsLibVersion();
    const targetSportsLibVersionCode = resolveRouteReparseTargetSportsLibVersionCode();
    const checkpointRef = db.doc(SPORTS_LIB_ROUTE_REPARSE_CHECKPOINT_PATH);
    const checkpointSnapshot = await checkpointRef.get();
    const checkpointData = checkpointSnapshot.data() as SportsLibRouteReparseCheckpoint | undefined;
    const cursorProcessingDocPath = checkpointData?.cursorProcessingDocPath || null;
    const cursorProcessingVersionCode = getProcessingVersionCode(checkpointData?.cursorProcessingVersionCode);
    const enqueueSpreadSeconds = resolveEnqueueSpreadSeconds(settings.enqueueLimit);
    const enqueuePacingMode: EnqueuePacingMode = settings.uidAllowlist && settings.uidAllowlist.size > 0
        ? 'override'
        : 'global';

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
    let lastProcessingDocPath: string | null = null;
    let lastProcessingVersionCode: number | null = null;

    if (settings.uidAllowlist && settings.uidAllowlist.size > 0) {
        const overrideUIDs = Array.from(settings.uidAllowlist);
        const previousCursorByUID = checkpointData?.overrideCursorByUid || {};
        const nextCursorByUID: Record<string, string | null> = {};

        for (const uid of overrideUIDs) {
            const remainingScan = settings.scanLimit - scannedCount;
            const previousCursor = previousCursorByUID[uid] || null;

            if (enqueuedCount >= settings.enqueueLimit || remainingScan <= 0) {
                nextCursorByUID[uid] = previousCursor;
                continue;
            }

            let userQuery = db.collection(`users/${uid}/routes`)
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
            for (const routeDoc of userSnapshot.docs) {
                if (enqueuedCount >= settings.enqueueLimit) {
                    break;
                }
                scannedCount++;
                lastProcessedDocId = routeDoc.id;
                const result = await processRouteDocument(db, routeDoc.ref, routeDoc.data() as Record<string, unknown>, {
                    targetSportsLibVersion,
                    enqueueLimit: settings.enqueueLimit,
                    enqueueSpreadSeconds,
                    enqueueAttemptSequence,
                    enqueuedCount,
                });
                enqueuedCount = result.enqueuedCount;
                enqueueAttemptSequence = result.enqueueAttemptSequence;
            }

            if (enqueuedCount >= settings.enqueueLimit) {
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

        logger.info('[sports-lib-route-reparse] Override scan complete', {
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
        logger.info('[sports-lib-route-reparse] No processing metadata candidates found for scan.');
        return;
    }

    for (const processingDoc of processingSnapshot.docs) {
        if (enqueuedCount >= settings.enqueueLimit) {
            break;
        }

        scannedCount++;
        const processingData = processingDoc.data() as Record<string, unknown>;
        const processingVersion = `${processingData.sportsLibVersion ?? ''}`;
        const processingVersionCode = getProcessingVersionCode(processingData.sportsLibVersionCode);

        // Move the cursor on the sortable tuple even when a malformed metadata
        // doc is skipped, so a bad page cannot block future scans.
        if (processingVersionCode !== null) {
            lastProcessingDocPath = processingDoc.ref.path;
            lastProcessingVersionCode = processingVersionCode;
        }

        const routePath = getRoutePathFromProcessingMetadataDocPath(processingDoc.ref.path);
        if (!routePath) {
            logger.warn('[sports-lib-route-reparse] Skipping non-route processing metadata doc from candidate query.', {
                processingDocPath: processingDoc.ref.path,
            });
            continue;
        }

        if (!processingVersion || processingVersionCode === null) {
            logger.warn('[sports-lib-route-reparse] Invalid processing metadata; skipping doc.', {
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
            logger.warn('[sports-lib-route-reparse] Invalid processing metadata; skipping doc.', {
                processingDocPath: processingDoc.ref.path,
                sportsLibVersion: processingVersion,
                sportsLibVersionCode: processingVersionCode,
                error: toErrorMessage(error),
            });
            continue;
        }
        if (computedVersionCode !== processingVersionCode) {
            logger.warn('[sports-lib-route-reparse] Mismatched processing metadata version/code; skipping doc.', {
                processingDocPath: processingDoc.ref.path,
                sportsLibVersion: processingVersion,
                sportsLibVersionCode: processingVersionCode,
                computedVersionCode,
            });
            continue;
        }

        if (processingVersionCode >= targetSportsLibVersionCode) {
            continue;
        }

        const routeRef = db.doc(routePath);
        const routeSnapshot = await routeRef.get();
        if (!routeSnapshot.exists) {
            logger.warn('[sports-lib-route-reparse] Skipping stale processing metadata because parent route is missing.', {
                processingDocPath: processingDoc.ref.path,
                routePath,
            });
            continue;
        }

        const result = await processRouteDocument(db, routeRef, routeSnapshot.data() as Record<string, unknown>, {
            targetSportsLibVersion,
            enqueueLimit: settings.enqueueLimit,
            enqueueSpreadSeconds,
            enqueueAttemptSequence,
            enqueuedCount,
            skipCandidateCheck: true,
        });
        enqueuedCount = result.enqueuedCount;
        enqueueAttemptSequence = result.enqueueAttemptSequence;
    }

    const completedPass = processingSnapshot.size < settings.scanLimit && enqueuedCount < settings.enqueueLimit;
    const canPersistCursor = !completedPass && lastProcessingDocPath && lastProcessingVersionCode !== null;
    await checkpointRef.set({
        cursorProcessingDocPath: canPersistCursor ? lastProcessingDocPath : null,
        cursorProcessingVersionCode: canPersistCursor ? lastProcessingVersionCode : null,
        lastScanAt: admin.firestore.FieldValue.serverTimestamp(),
        lastScanCount: scannedCount,
        lastEnqueuedCount: enqueuedCount,
        targetSportsLibVersion,
        ...(completedPass ? { lastPassCompletedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
    }, { merge: true });

    logger.info('[sports-lib-route-reparse] Scan complete', {
        scannedCount,
        enqueuedCount,
        enqueuePacingMode,
        enqueueSpreadSeconds,
        cursorProcessingDocPath: canPersistCursor ? lastProcessingDocPath : null,
        cursorProcessingVersionCode: canPersistCursor ? lastProcessingVersionCode : null,
    });
});
