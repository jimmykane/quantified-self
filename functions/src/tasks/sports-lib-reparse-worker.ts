import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    SPORTS_LIB_REPARSE_JOBS_COLLECTION,
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
    SportsLibReparseJob,
    hasPaidOrGraceAccess,
    reparseEventFromOriginalFiles,
    resolveTargetSportsLibVersion,
    writeReparseStatus,
} from '../reparse/sports-lib-reparse.service';
import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';

interface SportsLibReparseTaskPayload {
    jobId: string;
}

const ACCESS_DENIED_ERROR = 'USER_NO_PAID_ACCESS';

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
    memory: '1GiB',
    timeoutSeconds: 540,
    region: 'europe-west2',
}, async (request) => {
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
        const hasAccess = await hasPaidOrGraceAccess(job.uid);
        if (!hasAccess) {
            throw new Error(ACCESS_DENIED_ERROR);
        }

        const reparseResult = await reparseEventFromOriginalFiles(job.uid, job.eventId, {
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
    } catch (error) {
        const errorMessage = getErrorMessage(error);
        await writeReparseStatus(job.uid, job.eventId, {
            status: 'failed',
            reason: errorMessage === ACCESS_DENIED_ERROR ? ACCESS_DENIED_ERROR : 'REPARSE_FAILED',
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

        throw error;
    }
});
