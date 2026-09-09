import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import {
    TrainingPlanContractError,
    parseDeleteTrainingPlanRequestV1,
} from '../../../shared/training-plans';
import { enforceAppCheck } from '../utils';
import { deleteTrainingPlanForUser } from './delete-training-plan';
import { TrainingScheduleMutationError } from './mutation';

function mapDeletionError(error: TrainingScheduleMutationError): HttpsError {
    switch (error.code) {
        case 'not-found':
            return new HttpsError('not-found', error.message);
        case 'revision-conflict':
            return new HttpsError('aborted', error.message);
        case 'limit-exceeded':
            return new HttpsError('resource-exhausted', error.message);
        case 'already-exists':
            return new HttpsError('already-exists', error.message);
        case 'range-extension-required':
        case 'failed-precondition':
            return new HttpsError('failed-precondition', error.message);
    }
}

export const deleteTrainingPlan = onCall({
    region: FUNCTIONS_MANIFEST.deleteTrainingPlan.region,
    timeoutSeconds: 540,
    memory: '1GiB',
}, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    enforceAppCheck(request);
    try {
        return await deleteTrainingPlanForUser(
            request.auth.uid,
            parseDeleteTrainingPlanRequestV1(request.data),
        );
    } catch (error) {
        if (error instanceof TrainingPlanContractError) throw new HttpsError('invalid-argument', error.message);
        if (error instanceof TrainingScheduleMutationError) throw mapDeletionError(error);
        if (error instanceof HttpsError) throw error;
        logger.error('[TrainingPlans] Plan deletion failed.', {
            errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        throw new HttpsError('internal', 'Unable to delete this training plan. Retry with the same request.');
    }
});
