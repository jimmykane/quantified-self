import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { WorkoutStructureValidationError } from '../../../shared/planned-workout';
import {
    TrainingPlanContractError,
    parseMutateTrainingScheduleRequestV1,
    type MutateTrainingScheduleResponseV1,
} from '../../../shared/training-plans';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { enforceAppCheck } from '../utils';
import { TrainingScheduleMutationError } from './mutation';
import { mutateTrainingScheduleForUser } from './persistence';

function mapMutationError(error: TrainingScheduleMutationError): HttpsError {
    switch (error.code) {
        case 'not-found':
            return new HttpsError('not-found', error.message);
        case 'already-exists':
            return new HttpsError('already-exists', error.message);
        case 'revision-conflict':
            return new HttpsError('aborted', error.message);
        case 'limit-exceeded':
            return new HttpsError('resource-exhausted', error.message);
        case 'range-extension-required':
        case 'failed-precondition':
            return new HttpsError('failed-precondition', error.message);
    }
}

export const mutateTrainingSchedule = onCall({
    region: FUNCTIONS_MANIFEST.mutateTrainingSchedule.region,
}, async (request): Promise<MutateTrainingScheduleResponseV1> => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    enforceAppCheck(request);

    try {
        const parsed = parseMutateTrainingScheduleRequestV1(request.data);
        return await mutateTrainingScheduleForUser(request.auth.uid, parsed);
    } catch (error) {
        if (error instanceof TrainingPlanContractError || error instanceof WorkoutStructureValidationError) {
            throw new HttpsError('invalid-argument', error.message);
        }
        if (error instanceof TrainingScheduleMutationError) {
            throw mapMutationError(error);
        }
        if (error instanceof HttpsError) throw error;
        logger.error('[TrainingPlans] Schedule mutation failed.', {
            errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        throw new HttpsError('internal', 'Unable to update the training schedule.');
    }
});
