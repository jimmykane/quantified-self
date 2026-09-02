import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { TrainingPlanContractError } from '../../../shared/training-plans';
import { enforceAppCheck } from '../utils';
import { TrainingScheduleMutationError } from './mutation';
import {
    getTrainingScheduleHistoryForUser,
    parsePreviewTrainingScheduleRestoreRequest,
    parseTrainingScheduleHistoryRequest,
    previewTrainingScheduleRestoreForUser,
} from './history';

function mapKnownError(error: unknown): HttpsError | null {
    if (error instanceof TrainingPlanContractError) return new HttpsError('invalid-argument', error.message);
    if (error instanceof TrainingScheduleMutationError) {
        return new HttpsError(error.code === 'not-found' ? 'not-found' : 'failed-precondition', error.message);
    }
    return null;
}

export const getTrainingScheduleHistory = onCall({
    region: FUNCTIONS_MANIFEST.getTrainingScheduleHistory.region,
}, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    enforceAppCheck(request);
    try {
        return await getTrainingScheduleHistoryForUser(
            request.auth.uid,
            parseTrainingScheduleHistoryRequest(request.data),
        );
    } catch (error) {
        const known = mapKnownError(error);
        if (known) throw known;
        logger.error('[TrainingPlans] History query failed.', {
            errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        throw new HttpsError('internal', 'Unable to load training schedule history.');
    }
});

export const previewTrainingScheduleRestore = onCall({
    region: FUNCTIONS_MANIFEST.previewTrainingScheduleRestore.region,
}, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    enforceAppCheck(request);
    try {
        return await previewTrainingScheduleRestoreForUser(
            request.auth.uid,
            parsePreviewTrainingScheduleRestoreRequest(request.data),
        );
    } catch (error) {
        const known = mapKnownError(error);
        if (known) throw known;
        logger.error('[TrainingPlans] Restore preview failed.', {
            errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        throw new HttpsError('internal', 'Unable to preview this training schedule revision.');
    }
});
