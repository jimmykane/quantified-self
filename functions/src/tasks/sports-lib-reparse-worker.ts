import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    SPORTS_LIB_REPARSE_JOBS_COLLECTION,
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
    SportsLibReparseJob,
    reparseEventFromOriginalFiles,
    resolveTargetSportsLibVersion,
    writeReparseStatus,
} from '../reparse/sports-lib-reparse.service';
import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';

interface SportsLibReparseTaskPayload {
    jobId: string;
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

export const processSportsLibReparseTask = onTaskDispatched({
    retryConfig: CLOUD_TASK_RETRY_CONFIG,
    cpu: 2,
    concurrency: 1,
    memory: '1GiB',
    timeoutSeconds: 540,
    region: FUNCTIONS_MANIFEST.processSportsLibReparseTask.region,
}, async (request) => {
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

    const targetSportsLibVersion = job.targetSportsLibVersion || resolveTargetSportsLibVersion();
    const nextAttemptCount = (job.attemptCount || 0) + 1;
    await jobRef.set({
        status: 'processing',
        attemptCount: nextAttemptCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    try {
        const reparseResult = await reparseEventFromOriginalFiles(job.uid, job.eventId, {
            mode: 'reimport',
            targetSportsLibVersion,
        });

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
            durationMs: Date.now() - startedAtMs,
            resultStatus: reparseResult.status,
            resultReason: reparseResult.reason || null,
            sourceFilesCount: reparseResult.sourceFilesCount,
            parsedActivitiesCount: reparseResult.parsedActivitiesCount,
            staleActivitiesDeleted: reparseResult.staleActivitiesDeleted,
        });
    } catch (error) {
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
            durationMs: Date.now() - startedAtMs,
            error: errorMessage,
        });

        throw error;
    }
});
