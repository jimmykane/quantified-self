import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { TrainingPlanContractError } from '../../../shared/training-plans';
import { enforceAppCheck } from '../utils';
import { TrainingScheduleMutationError } from './mutation';
import {
    parseRestoreTrainingScheduleRevisionRequest,
    restoreTrainingScheduleRevisionForUser,
} from './restore';

function mapRestoreError(error: TrainingScheduleMutationError): HttpsError {
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

export const restoreTrainingScheduleRevision = onCall({
    region: FUNCTIONS_MANIFEST.restoreTrainingScheduleRevision.region,
}, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    enforceAppCheck(request);
    try {
        return await restoreTrainingScheduleRevisionForUser(
            request.auth.uid,
            parseRestoreTrainingScheduleRevisionRequest(request.data),
        );
    } catch (error) {
        if (error instanceof TrainingPlanContractError) {
            throw new HttpsError('invalid-argument', error.message);
        }
        if (error instanceof TrainingScheduleMutationError) throw mapRestoreError(error);
        if (error instanceof HttpsError) throw error;
        logger.error('[TrainingPlans] Revision restore failed.', {
            errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        throw new HttpsError('internal', 'Unable to restore this training schedule revision.');
    }
});
