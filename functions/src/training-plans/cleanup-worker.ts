import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import {
    TRAINING_SCHEDULE_DELETION_TOMBSTONES_COLLECTION_ID,
    SCHEDULED_WORKOUTS_COLLECTION_ID,
} from '../../../shared/training-plans';
import { TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID } from '../../../shared/training-workout-completion';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import {
    TRAINING_CLEANUP_JOBS_COLLECTION_ID,
    finishTrainingCleanupJob,
    trainingCleanupJobRef,
    type TrainingCleanupJobV1,
} from './cleanup-job-contract';
import { cleanupDeletedPlanData, parseStoredDeleteResponse } from './delete-training-plan';
import { trainingScheduleDeletionTombstoneDocumentId } from './persistence';

const SCAN_PAGE_SIZE = 25;
const MAX_SCAN = 100;
const LEASE_MS = 5 * 60 * 1000;
const MAX_RETRY_MS = 60 * 60 * 1000;

function ownerFromJobPath(path: string): string | null {
    const segments = path.split('/');
    return segments.length === 6 && segments[0] === 'users'
        && segments[2] === 'trainingPlanState' && segments[3] === 'current'
        && segments[4] === TRAINING_CLEANUP_JOBS_COLLECTION_ID
        ? segments[1] : null;
}

function parseJob(value: unknown): TrainingCleanupJobV1 {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid training cleanup job.');
    const job = value as Partial<TrainingCleanupJobV1>;
    if (job.schemaVersion !== 1 || (job.kind !== 'workout' && job.kind !== 'plan')
        || typeof job.entityId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(job.entityId)
        || typeof job.mutationId !== 'string'
        || !Number.isSafeInteger(job.createdAtMs) || !Number.isSafeInteger(job.nextAttemptAtMs)
        || !Number.isSafeInteger(job.attempts) || (job.attempts ?? -1) < 0) {
        throw new Error('Invalid training cleanup job.');
    }
    if (job.kind === 'plan') {
        const response = parseStoredDeleteResponse(job.response);
        if (response.removedPlanId !== job.entityId || response.mutationId !== job.mutationId) {
            throw new Error('Training plan cleanup response mismatch.');
        }
    } else if (job.response !== undefined) {
        throw new Error('Unexpected workout cleanup response.');
    }
    return job as TrainingCleanupJobV1;
}

export async function processTrainingCleanupJob(
    db: admin.firestore.Firestore,
    ref: admin.firestore.DocumentReference,
    nowMs: number,
): Promise<boolean> {
    const uid = ownerFromJobPath(ref.path);
    if (!uid) throw new Error('Training cleanup job is outside an owner scope.');
    const claimed = await db.runTransaction(async transaction => {
        if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)).shouldSkip) return null;
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return null;
        const job = parseJob(snapshot.data());
        if (job.nextAttemptAtMs > nowMs || ref.path !== trainingCleanupJobRef(db, uid, job.kind, job.entityId).path) return null;
        const tombstoneRef = db.collection('users').doc(uid).collection('trainingPlanState').doc('current')
            .collection(TRAINING_SCHEDULE_DELETION_TOMBSTONES_COLLECTION_ID)
            .doc(trainingScheduleDeletionTombstoneDocumentId(job.kind, job.entityId));
        const tombstone = await transaction.get(tombstoneRef);
        if (!tombstone.exists || tombstone.data()?.mutationId !== job.mutationId) {
            throw new Error('Training cleanup tombstone mismatch.');
        }
        const attempt = job.attempts + 1;
        transaction.update(ref, { attempts: attempt, nextAttemptAtMs: nowMs + LEASE_MS });
        return { job, attempt };
    });
    if (!claimed) return false;

    try {
        if (claimed.job.kind === 'plan') {
            await cleanupDeletedPlanData(db, uid, parseStoredDeleteResponse(claimed.job.response), nowMs);
        } else {
            await db.recursiveDelete(db.collection('users').doc(uid)
                .collection(TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID).doc(claimed.job.entityId));
            await db.recursiveDelete(db.collection('users').doc(uid)
                .collection(SCHEDULED_WORKOUTS_COLLECTION_ID).doc(claimed.job.entityId));
        }
        await finishTrainingCleanupJob(db, uid, claimed.job.kind, claimed.job.entityId, claimed.job.mutationId, nowMs);
        return true;
    } catch (error) {
        const retryMs = Math.min(MAX_RETRY_MS, 60_000 * 2 ** Math.min(claimed.attempt, 6));
        await db.runTransaction(async transaction => {
            if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)).shouldSkip) return;
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) return;
            const current = parseJob(snapshot.data());
            if (current.mutationId === claimed.job.mutationId && current.attempts === claimed.attempt) {
                transaction.update(ref, { nextAttemptAtMs: nowMs + retryMs });
            }
        });
        throw error;
    }
}

export async function reconcileTrainingCleanupJobs(
    db: admin.firestore.Firestore,
    nowMs = Date.now(),
): Promise<{ scanned: number; completed: number; failed: number }> {
    const due = db.collectionGroup(TRAINING_CLEANUP_JOBS_COLLECTION_ID)
        .where('nextAttemptAtMs', '<=', nowMs).orderBy('nextAttemptAtMs');
    let cursor: admin.firestore.QueryDocumentSnapshot | null = null;
    let scanned = 0;
    let completed = 0;
    let failed = 0;
    while (scanned < MAX_SCAN) {
        const page = await (cursor ? due.startAfter(cursor) : due)
            .limit(Math.min(SCAN_PAGE_SIZE, MAX_SCAN - scanned)).get();
        if (page.empty) break;
        for (const snapshot of page.docs) {
            scanned += 1;
            try {
                if (await processTrainingCleanupJob(db, snapshot.ref, nowMs)) completed += 1;
            } catch {
                failed += 1;
                logger.warn('[TrainingCleanup]', { event: 'cleanup_retry_failed' });
            }
        }
        cursor = page.docs[page.docs.length - 1];
        if (page.size < SCAN_PAGE_SIZE) break;
    }
    return { scanned, completed, failed };
}

export const reconcileTrainingPlanCleanup = onSchedule({
    schedule: 'every 5 minutes',
    timeZone: 'UTC',
    region: FUNCTIONS_MANIFEST.reconcileTrainingPlanCleanup.region,
    memory: '512MiB',
    timeoutSeconds: 300,
}, async () => {
    const result = await reconcileTrainingCleanupJobs(admin.firestore());
    if (result.scanned > 0) logger.info('[TrainingCleanup]', result);
});
