import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import {
    TRAINING_PLAN_SCHEMA_VERSION,
    type DeleteTrainingPlanResponseV1,
} from '../../../shared/training-plans';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';

export const TRAINING_CLEANUP_JOBS_COLLECTION_ID = 'trainingCleanupJobs';

export type TrainingCleanupJobV1 = {
    schemaVersion: typeof TRAINING_PLAN_SCHEMA_VERSION;
    kind: 'workout' | 'plan';
    entityId: string;
    mutationId: string;
    createdAtMs: number;
    nextAttemptAtMs: number;
    attempts: number;
    response?: DeleteTrainingPlanResponseV1;
};

export function trainingCleanupJobRef(
    db: admin.firestore.Firestore,
    uid: string,
    kind: TrainingCleanupJobV1['kind'],
    entityId: string,
): admin.firestore.DocumentReference {
    const hash = createHash('sha256').update(`${kind}:${entityId}`).digest('hex');
    return db.collection('users').doc(uid).collection('trainingPlanState').doc('current')
        .collection(TRAINING_CLEANUP_JOBS_COLLECTION_ID).doc(`${kind}_${hash}`);
}

export function trainingCleanupJob(
    kind: TrainingCleanupJobV1['kind'],
    entityId: string,
    mutationId: string,
    nowMs: number,
    response?: DeleteTrainingPlanResponseV1,
): TrainingCleanupJobV1 {
    return {
        schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
        kind,
        entityId,
        mutationId,
        createdAtMs: nowMs,
        nextAttemptAtMs: nowMs,
        attempts: 0,
        ...(response ? { response } : {}),
    };
}

export async function finishTrainingCleanupJob(
    db: admin.firestore.Firestore,
    uid: string,
    kind: TrainingCleanupJobV1['kind'],
    entityId: string,
    mutationId: string,
    nowMs: number,
): Promise<void> {
    const ref = trainingCleanupJobRef(db, uid, kind, entityId);
    await db.runTransaction(async transaction => {
        if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)).shouldSkip) return;
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return;
        const value = snapshot.data() as Partial<TrainingCleanupJobV1>;
        if (value.kind !== kind || value.entityId !== entityId || value.mutationId !== mutationId) {
            throw new Error('Training cleanup ownership changed.');
        }
        // Cleanup jobs are leaf documents by contract; they never own children.
        transaction.delete(ref);
    });
}
