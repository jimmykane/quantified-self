import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { WorkoutStructureValidationError } from '../../../shared/planned-workout';
import {
    TrainingPlanContractError,
    type MutateTrainingScheduleResponseV1,
} from '../../../shared/training-plans';
import { parseTrainingScheduleSaveRequestV1 } from '../../../shared/training-workout-delivery-save';
import { TrainingDeliveryContractError } from '../../../shared/training-provider-delivery';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
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
    memory: '512MiB',
    secrets: FUNCTION_SECRET_BINDINGS.mutateTrainingSchedule,
    timeoutSeconds: 300,
}, async (request): Promise<MutateTrainingScheduleResponseV1> => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    enforceAppCheck(request);

    try {
        const { request: parsed, deliveryAfterCreate, requireUncompletedWorkout } = parseTrainingScheduleSaveRequestV1(request.data);
        if (parsed.operation.kind === 'bulk-create-workouts') {
            throw new HttpsError('invalid-argument', 'Use the workout library placement action.');
        }
        if (deliveryAfterCreate) {
            const { createWorkoutWithDeliveryForUser } = await import('./create-workout-with-delivery');
            const { productionDeliveryRuntime } = await import('./delivery/runtime');
            return await createWorkoutWithDeliveryForUser(request.auth.uid, parsed, deliveryAfterCreate, productionDeliveryRuntime());
        }
        return await mutateTrainingScheduleForUser(request.auth.uid, parsed, ...(requireUncompletedWorkout ? [{ requireUncompletedWorkout }] : []));
    } catch (error) {
        if (error instanceof TrainingPlanContractError || error instanceof TrainingDeliveryContractError || error instanceof WorkoutStructureValidationError) {
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
