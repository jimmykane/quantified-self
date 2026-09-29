import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import {
    TRAINING_SCHEDULE_DELETION_TOMBSTONES_COLLECTION_ID,
    SCHEDULED_WORKOUTS_COLLECTION_ID,
    TRAINING_PLAN_SCHEMA_VERSION,
    DELETED_WORKOUT_RECOVERY_MS,
    isDeletedWorkoutRecoverable,
    parseScheduledWorkoutV1,
    parseTrainingPlanStateV1,
    parseTrainingPlanV1,
} from '../../../shared/training-plans';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import {
    TRAINING_CLEANUP_JOBS_COLLECTION_ID,
    finishTrainingCleanupJob,
    trainingCleanupJobRef,
    type TrainingCleanupJobV1,
} from './cleanup-job-contract';
import { cleanupDeletedPlanData, parseStoredDeleteResponse } from './delete-training-plan';
import { trainingScheduleDeletionTombstoneDocumentId } from './persistence';
import { mutateTrainingScheduleForUser } from './persistence';
import { TrainingScheduleMutationError } from './mutation';
import { cleanupPermanentlyDeletedWorkoutData } from './cleanup-workout';

const SCAN_PAGE_SIZE = 25;
const MAX_SCAN = 100;
// Stay beyond the scheduled Function's 300-second timeout so a timed-out
// invocation cannot overlap the next claim at the lease boundary.
const LEASE_MS = 7 * 60 * 1000;
const MAX_RETRY_MS = 60 * 60 * 1000;
const EXPIRED_SCAN_SIZE = 30;
const MAX_EXPIRED_SCAN = 100;
const MAX_EXPIRED_DELETIONS = 10;

function expiredWorkoutOwner(path: string): string | null {
    const parts = path.split('/');
    return parts.length === 4 && parts[0] === 'users' && parts[2] === SCHEDULED_WORKOUTS_COLLECTION_ID
        ? parts[1] : null;
}

/** A missing, restored, re-deleted or concurrently edited root is never purged from a stale scan. */
export async function reconcileExpiredDeletedWorkouts(
    db: admin.firestore.Firestore,
    nowMs = Date.now(),
): Promise<{ scanned: number; deleted: number; deferred: number; failed: number }> {
    const due = db.collectionGroup(SCHEDULED_WORKOUTS_COLLECTION_ID)
        .where('lifecycle', '==', 'deleted')
        .where('deletedAtMs', '<=', nowMs - DELETED_WORKOUT_RECOVERY_MS)
        .orderBy('deletedAtMs');
    let cursor: admin.firestore.QueryDocumentSnapshot | null = null;
    let scanned = 0;
    let deleted = 0;
    let deferred = 0;
    let failed = 0;
    while (scanned < MAX_EXPIRED_SCAN && deleted < MAX_EXPIRED_DELETIONS) {
        const pageSize = Math.min(EXPIRED_SCAN_SIZE, MAX_EXPIRED_SCAN - scanned);
        const page = await (cursor ? due.startAfter(cursor) : due).limit(pageSize).get();
        if (page.empty) break;
        for (const snapshot of page.docs) {
            if (deleted >= MAX_EXPIRED_DELETIONS) break;
            scanned += 1;
            const uid = expiredWorkoutOwner(snapshot.ref.path);
            if (!uid) { deferred += 1; continue; }
            try {
                const workout = parseScheduledWorkoutV1(snapshot.data());
                if (workout.id !== snapshot.id || isDeletedWorkoutRecoverable(workout, nowMs)) {
                    deferred += 1; continue;
                }
                const user = db.collection('users').doc(uid);
                const [stateDoc, planDoc, pastCleanupDoc] = await Promise.all([
                    user.collection('trainingPlanState').doc('current').get(),
                    workout.planId ? user.collection('trainingPlans').doc(workout.planId).get() : Promise.resolve(null),
                    user.collection('trainingDeliveryState').doc('current').collection('pastCleanup')
                        .doc(`workout_${workout.id}`).get(),
                ]);
                if (!stateDoc.exists || (workout.planId && !planDoc?.exists)) {
                    deferred += 1; continue;
                }
                const state = parseTrainingPlanStateV1(stateDoc.data());
                const plan = planDoc ? parseTrainingPlanV1(planDoc.data()) : null;
                const marker = pastCleanupDoc.data();
                const removePastProviderCopies = marker?.schemaVersion === 1 && marker.scope === 'workout'
                    && marker.scopeId === workout.id && marker.enabled === true
                    && marker.deletedAtMs === workout.deletedAtMs;
                const mutationId = `expiry_${createHash('sha256')
                    .update(JSON.stringify([uid, workout.id, workout.deletedAtMs])).digest('hex').slice(0, 48)}`;
                await mutateTrainingScheduleForUser(uid, {
                    mutationId,
                    expectedRevisions: [
                        { scope: 'state', id: 'current', revision: state.revision },
                        { scope: 'workout', id: workout.id, revision: workout.revision },
                        ...(plan ? [{ scope: 'plan' as const, id: plan.id, revision: plan.revision }] : []),
                    ],
                    operation: { kind: 'permanently-delete-workout', workoutId: workout.id,
                        confirmPermanentDeletion: true, removePastProviderCopies },
                }, {
                    db, nowMs,
                    transactionPrecondition: async transaction => {
                        const latest = await transaction.get(snapshot.ref);
                        if (!latest.exists) throw new TrainingScheduleMutationError('revision-conflict', 'Workout changed during expiry.');
                        const current = parseScheduledWorkoutV1(latest.data());
                        if (current.id !== workout.id || current.deletedAtMs !== workout.deletedAtMs
                            || isDeletedWorkoutRecoverable(current, nowMs)) {
                            throw new TrainingScheduleMutationError('revision-conflict', 'Workout changed during expiry.');
                        }
                    },
                });
                deleted += 1;
            } catch (error) {
                if (error instanceof TrainingScheduleMutationError
                    && ['revision-conflict', 'not-found', 'failed-precondition'].includes(error.code)) deferred += 1;
                else failed += 1;
            }
        }
        cursor = page.docs[page.docs.length - 1];
        if (page.size < pageSize) break;
    }
    return { scanned, deleted, deferred, failed };
}

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
        const entityIdHash = trainingScheduleDeletionTombstoneDocumentId(job.kind, job.entityId);
        const tombstoneRef = db.collection('users').doc(uid).collection('trainingPlanState').doc('current')
            .collection(TRAINING_SCHEDULE_DELETION_TOMBSTONES_COLLECTION_ID)
            .doc(entityIdHash);
        const tombstone = await transaction.get(tombstoneRef);
        const tombstoneData = tombstone.data();
        if (!tombstone.exists || tombstoneData?.schemaVersion !== TRAINING_PLAN_SCHEMA_VERSION
            || tombstoneData?.entityKind !== job.kind || tombstoneData?.entityIdHash !== entityIdHash
            || tombstoneData?.mutationId !== job.mutationId) {
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
            await cleanupPermanentlyDeletedWorkoutData(db, uid, claimed.job.entityId);
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

async function deferUnclaimedTrainingCleanupJob(
    db: admin.firestore.Firestore,
    ref: admin.firestore.DocumentReference,
    nowMs: number,
): Promise<void> {
    const uid = ownerFromJobPath(ref.path);
    if (!uid) return;
    await db.runTransaction(async transaction => {
        if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)).shouldSkip) return;
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return;
        const nextAttemptAtMs = snapshot.data()?.nextAttemptAtMs;
        // A claimed job already received a lease or backoff in its own path.
        // Only malformed/unclaimable due records need this head-of-line guard.
        if (typeof nextAttemptAtMs !== 'number' || nextAttemptAtMs > nowMs) return;
        transaction.update(ref, { nextAttemptAtMs: nowMs + MAX_RETRY_MS });
    });
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
                try {
                    await deferUnclaimedTrainingCleanupJob(db, snapshot.ref, nowMs);
                } catch {
                    // Keep the original job for operator investigation; one
                    // failed deferral must not abort the rest of this scan.
                }
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
    // A deployment alone must not authorize a production purge. Enable only
    // after the scoped #772 rollout and index deployment have separate approval.
    if (process.env.TRAINING_DELETED_WORKOUT_EXPIRY_ENABLED === 'true') {
        const expired = await reconcileExpiredDeletedWorkouts(admin.firestore());
        if (expired.scanned > 0) logger.info('[TrainingWorkoutExpiry]', expired);
    }
});
