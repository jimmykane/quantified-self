import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    SPORTS_LIB_REPARSE_HEAVY_REASONS,
    SPORTS_LIB_REPARSE_JOBS_COLLECTION,
    SPORTS_LIB_REPARSE_PROCESSING_TIERS,
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
    SportsLibReparseJob,
    getSportsLibReparseEventDurationMs,
    isSportsLibReparseDurationHeavy,
    reparseEventFromOriginalFiles,
    resolveTargetSportsLibVersion,
    writeReparseStatus,
} from '../reparse/sports-lib-reparse.service';
import { CLOUD_TASK_RETRY_CONFIG, REPARSE_HEAVY_TASK_RETRY_CONFIG } from '../shared/queue-config';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import {
    REPARSE_PROCESSING_HEAVY_TASK_RATE_LIMITS,
    REPARSE_PROCESSING_HEAVY_TASK_RUNTIME_OPTIONS,
    REPARSE_PROCESSING_TASK_RUNTIME_OPTIONS,
} from '../shared/activity-processing-config';
import { enqueueSportsLibReparseHeavyTask } from '../shared/cloud-tasks';
import { getUserDeletionGuardState, UserDeletionGuardReadError } from '../shared/user-deletion-guard';

interface SportsLibReparseTaskPayload {
    jobId: string;
}

const TERMINAL_REPARSE_ERROR_PATTERNS = [
    /^\[sports-lib-reparse\] Reparse target sports-lib version ".*" does not match runtime sports-lib version ".*"$/,
    /^Event .* was not found for user .*$/,
] as const;

type SportsLibReparseWorkerTier = 'normal' | 'heavy';

class SportsLibReparseSkippedForUserDeletionError extends Error {
    readonly name = 'SportsLibReparseSkippedForUserDeletionError';

    constructor(
        readonly jobId: string,
        readonly uid: string,
        readonly phase: string,
    ) {
        super(`Skipping sports-lib reparse job ${jobId} for deleted/deleting user ${uid} during ${phase}.`);
    }
}

function getJobRef(jobId: string): admin.firestore.DocumentReference {
    return admin.firestore().collection(SPORTS_LIB_REPARSE_JOBS_COLLECTION).doc(jobId);
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return `${error}`;
}

function isTerminalReparseFailure(errorMessage: string): boolean {
    return TERMINAL_REPARSE_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage));
}

async function resolveJobEventDurationMs(job: SportsLibReparseJob): Promise<number | null> {
    if (typeof job.eventDurationMs === 'number' && Number.isFinite(job.eventDurationMs)) {
        return job.eventDurationMs;
    }

    const eventPath = job.eventPath || `users/${job.uid}/events/${job.eventId}`;
    const eventSnapshot = await admin.firestore().doc(eventPath).get();
    if (!eventSnapshot.exists) {
        return null;
    }

    return getSportsLibReparseEventDurationMs(eventSnapshot.data() as Record<string, unknown>);
}

async function assertUserDeletionAllowed(job: SportsLibReparseJob, jobId: string, phase: string): Promise<void> {
    try {
        const deletionGuard = await getUserDeletionGuardState(admin.firestore(), job.uid);
        if (!deletionGuard.shouldSkip) {
            return;
        }

        logger.info('[sports-lib-reparse-worker] Skipping job because user is missing or deletion is in progress.', {
            jobId,
            uid: job.uid,
            eventId: job.eventId,
            phase,
            userExists: deletionGuard.userExists,
            deletionInProgress: deletionGuard.deletionInProgress,
        });
        throw new SportsLibReparseSkippedForUserDeletionError(jobId, job.uid, phase);
    } catch (error) {
        if (error instanceof SportsLibReparseSkippedForUserDeletionError) {
            throw error;
        }
        throw new UserDeletionGuardReadError(job.uid, 'sports_lib_reparse_worker', error);
    }
}

async function shouldSkipForUserDeletion(job: SportsLibReparseJob, jobId: string, phase: string): Promise<boolean> {
    try {
        await assertUserDeletionAllowed(job, jobId, phase);
        return false;
    } catch (error) {
        if (error instanceof SportsLibReparseSkippedForUserDeletionError) {
            return true;
        }
        throw error;
    }
}

async function requeueHeavyFromNormalWorker(
    jobRef: admin.firestore.DocumentReference,
    jobId: string,
    job: SportsLibReparseJob,
    eventDurationMs: number,
): Promise<void> {
    await jobRef.set({
        status: 'pending',
        processingTier: SPORTS_LIB_REPARSE_PROCESSING_TIERS.Heavy,
        heavyReason: SPORTS_LIB_REPARSE_HEAVY_REASONS.Duration,
        eventDurationMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        enqueuedAt: admin.firestore.FieldValue.serverTimestamp(),
        processedAt: admin.firestore.FieldValue.delete(),
        lastError: admin.firestore.FieldValue.delete(),
    }, { merge: true });

    try {
        await enqueueSportsLibReparseHeavyTask(jobId);
    } catch (error) {
        const errorMessage = getErrorMessage(error);
        await jobRef.set({
            status: 'failed',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastError: errorMessage,
            enqueuedAt: admin.firestore.FieldValue.delete(),
        }, { merge: true });
        throw error;
    }

    logger.info('[sports-lib-reparse-worker] Requeued long-duration job to heavy worker.', {
        jobId,
        uid: job.uid,
        eventId: job.eventId,
        eventDurationMs,
    });
}

async function processSportsLibReparseTaskRequest(
    request: { data: SportsLibReparseTaskPayload },
    workerTier: SportsLibReparseWorkerTier,
): Promise<void> {
    const startedAtMs = Date.now();
    const payload = request.data as SportsLibReparseTaskPayload;
    const jobId = payload?.jobId;

    if (!jobId) {
        throw new Error('Missing jobId in sports-lib reparse task payload.');
    }

    const jobRef = getJobRef(jobId);
    const snapshot = await jobRef.get();
    if (!snapshot.exists) {
        logger.warn(`[sports-lib-reparse-worker] Job ${jobId} not found. Skipping.`);
        return;
    }

    const job = snapshot.data() as SportsLibReparseJob;
    if (job.status === 'completed') {
        logger.info(`[sports-lib-reparse-worker] Job ${jobId} already completed. Skipping.`);
        return;
    }

    if (await shouldSkipForUserDeletion(job, jobId, 'start')) {
        return;
    }

    if (workerTier === 'normal') {
        if (job.processingTier === SPORTS_LIB_REPARSE_PROCESSING_TIERS.Heavy) {
            logger.info('[sports-lib-reparse-worker] Normal worker skipping job already marked for heavy processing.', {
                jobId,
                uid: job.uid,
                eventId: job.eventId,
                heavyReason: job.heavyReason || null,
            });
            return;
        }

        const eventDurationMs = await resolveJobEventDurationMs(job);
        if (isSportsLibReparseDurationHeavy(eventDurationMs)) {
            await requeueHeavyFromNormalWorker(jobRef, jobId, job, eventDurationMs as number);
            return;
        }
    }

    const targetSportsLibVersion = job.targetSportsLibVersion || resolveTargetSportsLibVersion();
    const nextAttemptCount = (job.attemptCount || 0) + 1;
    await jobRef.set({
        status: 'processing',
        processingTier: workerTier === 'heavy'
            ? SPORTS_LIB_REPARSE_PROCESSING_TIERS.Heavy
            : (job.processingTier || SPORTS_LIB_REPARSE_PROCESSING_TIERS.Normal),
        attemptCount: nextAttemptCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    try {
        const reparseResult = await reparseEventFromOriginalFiles(job.uid, job.eventId, {
            mode: 'reimport',
            targetSportsLibVersion,
            beforePersist: () => assertUserDeletionAllowed(job, jobId, 'before_persist'),
        });

        if (await shouldSkipForUserDeletion(job, jobId, 'before_status_write')) {
            return;
        }

        if (reparseResult.status === 'skipped' && reparseResult.reason === SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES) {
            await writeReparseStatus(job.uid, job.eventId, {
                status: 'skipped',
                reason: SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
                targetSportsLibVersion,
                checkedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        } else {
            await writeReparseStatus(job.uid, job.eventId, {
                status: 'completed',
                targetSportsLibVersion,
                checkedAt: admin.firestore.FieldValue.serverTimestamp(),
                processedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastError: '',
            });
        }

        await jobRef.set({
            status: 'completed',
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastError: admin.firestore.FieldValue.delete(),
        }, { merge: true });

        logger.info('[sports-lib-reparse-worker] Job completed.', {
            jobId,
            uid: job.uid,
            eventId: job.eventId,
            processingTier: workerTier,
            durationMs: Date.now() - startedAtMs,
            resultStatus: reparseResult.status,
            resultReason: reparseResult.reason || null,
            sourceFilesCount: reparseResult.sourceFilesCount,
            parsedActivitiesCount: reparseResult.parsedActivitiesCount,
            staleActivitiesDeleted: reparseResult.staleActivitiesDeleted,
        });
    } catch (error) {
        if (error instanceof SportsLibReparseSkippedForUserDeletionError) {
            return;
        }
        if (error instanceof UserDeletionGuardReadError) {
            throw error;
        }
        if (await shouldSkipForUserDeletion(job, jobId, 'before_failure_status_write')) {
            return;
        }

        const errorMessage = getErrorMessage(error);
        await writeReparseStatus(job.uid, job.eventId, {
            status: 'failed',
            reason: 'REPARSE_FAILED',
            targetSportsLibVersion,
            checkedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastError: errorMessage,
        });

        await jobRef.set({
            status: 'failed',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastError: errorMessage,
        }, { merge: true });

        logger.error('[sports-lib-reparse-worker] Job failed.', {
            jobId,
            uid: job.uid,
            eventId: job.eventId,
            processingTier: workerTier,
            durationMs: Date.now() - startedAtMs,
            error: errorMessage,
        });

        if (isTerminalReparseFailure(errorMessage)) {
            logger.warn('[sports-lib-reparse-worker] Suppressing retry for terminal job failure.', {
                jobId,
                uid: job.uid,
                eventId: job.eventId,
                error: errorMessage,
            });
            return;
        }

        throw error;
    }
}

export const processSportsLibReparseTask = onTaskDispatched({
    retryConfig: CLOUD_TASK_RETRY_CONFIG,
    ...REPARSE_PROCESSING_TASK_RUNTIME_OPTIONS,
    region: FUNCTIONS_MANIFEST.processSportsLibReparseTask.region,
}, async (request) => processSportsLibReparseTaskRequest(request, 'normal'));

export const processSportsLibReparseHeavyTask = onTaskDispatched({
    retryConfig: REPARSE_HEAVY_TASK_RETRY_CONFIG,
    rateLimits: REPARSE_PROCESSING_HEAVY_TASK_RATE_LIMITS,
    ...REPARSE_PROCESSING_HEAVY_TASK_RUNTIME_OPTIONS,
    region: FUNCTIONS_MANIFEST.processSportsLibReparseHeavyTask.region,
}, async (request) => processSportsLibReparseTaskRequest(request, 'heavy'));
