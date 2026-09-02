import * as admin from 'firebase-admin';
import { TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID } from '../../../shared/training-plans';
import { TrainingScheduleMutationError } from './mutation';

export async function assertNoTrainingPlanDeletionInProgress(
    transaction: admin.firestore.Transaction,
    stateRef: admin.firestore.DocumentReference,
): Promise<void> {
    const snapshot = await transaction.get(stateRef.collection(TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID));
    if (snapshot.docs.length > 0) {
        throw new TrainingScheduleMutationError(
            'failed-precondition',
            'A training plan deletion is in progress. Retry this change after deletion finishes.',
        );
    }
}
