import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { WorkoutStructureValidationError } from '../../../shared/planned-workout';
import { StrengthWorkoutValidationError } from '../../../shared/strength-workout';
import { TrainingPlanContractError } from '../../../shared/training-plans';
import {
    WorkoutLibraryContractError,
    parseMutateWorkoutLibraryRequestV1,
    parsePlaceWorkoutLibraryRequestV1,
} from '../../../shared/workout-library';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { enforceAppCheck } from '../utils';
import { TrainingScheduleMutationError } from './mutation';
import { mutateWorkoutLibraryForUser, placeWorkoutLibraryForUser } from './workout-library';

function mapError(error: unknown): never {
    if (error instanceof WorkoutLibraryContractError || error instanceof WorkoutStructureValidationError
        || error instanceof StrengthWorkoutValidationError || error instanceof TrainingPlanContractError) {
        throw new HttpsError('invalid-argument', error.message);
    }
    if (error instanceof TrainingScheduleMutationError) {
        const codes = { 'not-found': 'not-found', 'already-exists': 'already-exists',
            'revision-conflict': 'aborted', 'limit-exceeded': 'resource-exhausted',
            'range-extension-required': 'failed-precondition', 'failed-precondition': 'failed-precondition' } as const;
        throw new HttpsError(codes[error.code], error.message);
    }
    if (error instanceof HttpsError) throw error;
    logger.error('[WorkoutLibrary] Mutation failed.', { errorName: error instanceof Error ? error.name : 'UnknownError' });
    throw new HttpsError('internal', 'Unable to update the workout library.');
}

export const mutateWorkoutLibrary = onCall({
    region: FUNCTIONS_MANIFEST.mutateWorkoutLibrary.region,
    memory: '512MiB',
    timeoutSeconds: 120,
}, async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to use the workout library.');
    enforceAppCheck(request);
    try {
        return await mutateWorkoutLibraryForUser(request.auth.uid, parseMutateWorkoutLibraryRequestV1(request.data));
    } catch (error) { return mapError(error); }
});

export const placeWorkoutLibrary = onCall({
    region: FUNCTIONS_MANIFEST.placeWorkoutLibrary.region,
    memory: '512MiB',
    timeoutSeconds: 300,
}, async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to use the workout library.');
    enforceAppCheck(request);
    try {
        return await placeWorkoutLibraryForUser(request.auth.uid, parsePlaceWorkoutLibraryRequestV1(request.data));
    } catch (error) { return mapError(error); }
});
