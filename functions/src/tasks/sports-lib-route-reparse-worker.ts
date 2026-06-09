import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import {
    ROUTE_PROCESSING_TASK_RUNTIME_OPTIONS,
} from '../shared/route-processing-config';
import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';
import {
    SPORTS_LIB_ROUTE_REPARSE_JOBS_COLLECTION,
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
    RouteReparseStatusWrite,
    SportsLibRouteReparseJob,
    assertRouteReparseRuntimeVersionMatchesTarget,
    isRouteReparsePersistenceSkippedForUserDeletionError,
    isSportsLibRouteReparseTerminalFailureMessage,
    resolveRouteReparseTargetSportsLibVersion,
    writeRouteReparseStatus,
} from '../reparse/sports-lib-route-reparse.service';
import { reprocessRouteFromOriginalFile } from '../routes/reprocess-route';
import { getUserDeletionGuardState, UserDeletionGuardReadError } from '../shared/user-deletion-guard';

interface SportsLibRouteReparseTaskPayload {
    jobId: string;
}

class SportsLibRouteReparseSkippedForUserDeletionError extends Error {
    readonly name = 'SportsLibRouteReparseSkippedForUserDeletionError';

    constructor(
        readonly jobId: string,
        readonly uid: string,
        readonly phase: string,
    ) {
        super(`Skipping sports-lib route reparse job ${jobId} for deleted/deleting user ${uid} during ${phase}.`);
    }
}

function getJobRef(jobId: string): admin.firestore.DocumentReference {
    return admin.firestore().collection(SPORTS_LIB_ROUTE_REPARSE_JOBS_COLLECTION).doc(jobId);
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return `${error}`;
}

function getJobLastError(job: SportsLibRouteReparseJob): string {
    return `${job.lastError || ''}`;
}

function isUserDeletionGuardReadError(error: unknown): error is UserDeletionGuardReadError {
    return error instanceof UserDeletionGuardReadError
        || (error instanceof Error && error.name === 'UserDeletionGuardReadError');
}

async function markJobFailed(
    jobRef: admin.firestore.DocumentReference,
    errorMessage: string,
    options?: { terminalFailure?: boolean },
): Promise<void> {
    const isTerminalFailure = options?.terminalFailure === true;
    await jobRef.set({
        status: 'failed',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastError: errorMessage,
        terminalFailure: isTerminalFailure ? true : admin.firestore.FieldValue.delete(),
        terminalFailureAt: isTerminalFailure
            ? admin.firestore.FieldValue.serverTimestamp()
            : admin.firestore.FieldValue.delete(),
    }, { merge: true });
}

async function deleteJobForUserDeletion(
    jobRef: admin.firestore.DocumentReference,
    jobId: string,
    job: SportsLibRouteReparseJob,
    phase: string,
): Promise<void> {
    await admin.firestore().recursiveDelete(jobRef);
    logger.info('[sports-lib-route-reparse-worker] Deleted reparse job because user is missing or deletion is in progress.', {
        jobId,
        uid: job.uid,
        routeId: job.routeId,
        phase,
    });
}

async function writeWorkerRouteReparseStatus(
    job: SportsLibRouteReparseJob,
    jobId: string,
    payload: RouteReparseStatusWrite,
): Promise<boolean> {
    try {
        await writeRouteReparseStatus(job.uid, job.routeId, payload);
        return true;
    } catch (error) {
        if (isRouteReparsePersistenceSkippedForUserDeletionError(error)) {
            logger.info('[sports-lib-route-reparse-worker] Skipping status write because user is missing or deletion is in progress.', {
                jobId,
                uid: job.uid,
                routeId: job.routeId,
            });
            return false;
        }
        throw error;
    }
}

async function assertUserDeletionAllowed(job: SportsLibRouteReparseJob, jobId: string, phase: string): Promise<void> {
    try {
        const deletionGuard = await getUserDeletionGuardState(admin.firestore(), job.uid);
        if (!deletionGuard.shouldSkip) {
            return;
        }

        logger.info('[sports-lib-route-reparse-worker] Skipping job because user is missing or deletion is in progress.', {
            jobId,
            uid: job.uid,
            routeId: job.routeId,
            phase,
            userExists: deletionGuard.userExists,
            deletionInProgress: deletionGuard.deletionInProgress,
        });
        throw new SportsLibRouteReparseSkippedForUserDeletionError(jobId, job.uid, phase);
    } catch (error) {
        if (error instanceof SportsLibRouteReparseSkippedForUserDeletionError) {
            throw error;
        }
        throw new UserDeletionGuardReadError(job.uid, 'sports_lib_route_reparse_worker', error);
    }
}

async function shouldSkipForUserDeletion(job: SportsLibRouteReparseJob, jobId: string, phase: string): Promise<boolean> {
    try {
        await assertUserDeletionAllowed(job, jobId, phase);
        return false;
    } catch (error) {
        if (error instanceof SportsLibRouteReparseSkippedForUserDeletionError) {
            return true;
        }
        throw error;
    }
}

async function processSportsLibRouteReparseTaskRequest(
    request: { data: SportsLibRouteReparseTaskPayload },
): Promise<void> {
    const startedAtMs = Date.now();
    const payload = request.data as SportsLibRouteReparseTaskPayload;
    const jobId = payload?.jobId;

    if (!jobId) {
        throw new Error('Missing jobId in sports-lib route reparse task payload.');
    }

    const jobRef = getJobRef(jobId);
    const snapshot = await jobRef.get();
    if (!snapshot.exists) {
        logger.warn(`[sports-lib-route-reparse-worker] Job ${jobId} not found. Skipping.`);
        return;
    }

    const job = snapshot.data() as SportsLibRouteReparseJob;
    const deleteForUserDeletion = (phase: string) => deleteJobForUserDeletion(jobRef, jobId, job, phase);
    if (job.status === 'completed') {
        logger.info(`[sports-lib-route-reparse-worker] Job ${jobId} already completed. Skipping.`);
        return;
    }
    if (job.status === 'failed'
        && (job.terminalFailure === true || isSportsLibRouteReparseTerminalFailureMessage(getJobLastError(job)))) {
        logger.info('[sports-lib-route-reparse-worker] Job already has a terminal failure. Skipping.', {
            jobId,
            uid: job.uid,
            routeId: job.routeId,
            lastError: getJobLastError(job),
        });
        return;
    }

    try {
        if (await shouldSkipForUserDeletion(job, jobId, 'start')) {
            await deleteForUserDeletion('start');
            return;
        }
    } catch (error) {
        if (isUserDeletionGuardReadError(error)) {
            await markJobFailed(jobRef, getErrorMessage(error));
        }
        throw error;
    }

    const targetSportsLibVersion = job.targetSportsLibVersion || resolveRouteReparseTargetSportsLibVersion();
    const nextAttemptCount = (job.attemptCount || 0) + 1;
    await jobRef.set({
        status: 'processing',
        attemptCount: nextAttemptCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        terminalFailure: admin.firestore.FieldValue.delete(),
        terminalFailureAt: admin.firestore.FieldValue.delete(),
    }, { merge: true });

    try {
        assertRouteReparseRuntimeVersionMatchesTarget(targetSportsLibVersion);
        const reparseResult = await reprocessRouteFromOriginalFile(job.uid, job.routeId);

        if (await shouldSkipForUserDeletion(job, jobId, 'before_status_write')) {
            await deleteForUserDeletion('before_status_write');
            return;
        }

        if (reparseResult.status === 'skipped' && reparseResult.reason === SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES) {
            const statusWritten = await writeWorkerRouteReparseStatus(job, jobId, {
                status: 'skipped',
                reason: SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
                targetSportsLibVersion,
                checkedAt: admin.firestore.FieldValue.serverTimestamp(),
                terminalFailure: admin.firestore.FieldValue.delete(),
                terminalFailureAt: admin.firestore.FieldValue.delete(),
            });
            if (!statusWritten) {
                await deleteForUserDeletion('status_write_skipped');
                return;
            }

            await jobRef.set({
                status: 'skipped',
                processedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastError: admin.firestore.FieldValue.delete(),
                terminalFailure: admin.firestore.FieldValue.delete(),
                terminalFailureAt: admin.firestore.FieldValue.delete(),
            }, { merge: true });
        } else {
            const statusWritten = await writeWorkerRouteReparseStatus(job, jobId, {
                status: 'completed',
                targetSportsLibVersion,
                checkedAt: admin.firestore.FieldValue.serverTimestamp(),
                processedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastError: '',
                terminalFailure: admin.firestore.FieldValue.delete(),
                terminalFailureAt: admin.firestore.FieldValue.delete(),
            });
            if (!statusWritten) {
                await deleteForUserDeletion('status_write_skipped');
                return;
            }

            await jobRef.set({
                status: 'completed',
                processedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastError: admin.firestore.FieldValue.delete(),
                terminalFailure: admin.firestore.FieldValue.delete(),
                terminalFailureAt: admin.firestore.FieldValue.delete(),
            }, { merge: true });
        }

        logger.info('[sports-lib-route-reparse-worker] Job completed.', {
            jobId,
            uid: job.uid,
            routeId: job.routeId,
            durationMs: Date.now() - startedAtMs,
            resultStatus: reparseResult.status,
            resultReason: reparseResult.reason || null,
            sourceFilesCount: reparseResult.sourceFilesCount,
            routeCount: reparseResult.routeCount,
            waypointCount: reparseResult.waypointCount,
            pointCount: reparseResult.pointCount,
        });
    } catch (error) {
        if (error instanceof SportsLibRouteReparseSkippedForUserDeletionError) {
            await deleteForUserDeletion(error.phase);
            return;
        }
        if (isUserDeletionGuardReadError(error)) {
            await markJobFailed(jobRef, getErrorMessage(error));
            throw error;
        }
        try {
            if (await shouldSkipForUserDeletion(job, jobId, 'before_failure_status_write')) {
                await deleteForUserDeletion('before_failure_status_write');
                return;
            }
        } catch (guardError) {
            if (isUserDeletionGuardReadError(guardError)) {
                await markJobFailed(jobRef, getErrorMessage(guardError));
            }
            throw guardError;
        }

        const errorMessage = getErrorMessage(error);
        const terminalFailure = isSportsLibRouteReparseTerminalFailureMessage(errorMessage);
        try {
            const statusWritten = await writeWorkerRouteReparseStatus(job, jobId, {
                status: 'failed',
                reason: 'REPARSE_FAILED',
                targetSportsLibVersion,
                checkedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastError: errorMessage,
                terminalFailure: terminalFailure ? true : admin.firestore.FieldValue.delete(),
                terminalFailureAt: terminalFailure
                    ? admin.firestore.FieldValue.serverTimestamp()
                    : admin.firestore.FieldValue.delete(),
            });
            if (!statusWritten) {
                await deleteForUserDeletion('failure_status_write_skipped');
                return;
            }
        } catch (statusWriteError) {
            if (isUserDeletionGuardReadError(statusWriteError)) {
                await markJobFailed(jobRef, getErrorMessage(statusWriteError));
            }
            throw statusWriteError;
        }

        await markJobFailed(jobRef, errorMessage, { terminalFailure });

        logger.error('[sports-lib-route-reparse-worker] Job failed.', {
            jobId,
            uid: job.uid,
            routeId: job.routeId,
            durationMs: Date.now() - startedAtMs,
            error: errorMessage,
        });

        if (terminalFailure) {
            logger.warn('[sports-lib-route-reparse-worker] Suppressing retry for terminal job failure.', {
                jobId,
                uid: job.uid,
                routeId: job.routeId,
                error: errorMessage,
            });
            return;
        }

        throw error;
    }
}

export const processSportsLibRouteReparseTask = onTaskDispatched({
    retryConfig: CLOUD_TASK_RETRY_CONFIG,
    ...ROUTE_PROCESSING_TASK_RUNTIME_OPTIONS,
    region: FUNCTIONS_MANIFEST.processSportsLibRouteReparseTask.region,
}, async (request) => processSportsLibRouteReparseTaskRequest(request));
