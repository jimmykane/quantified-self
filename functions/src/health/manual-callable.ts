import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import type {
    DeleteManualHealthMeasurementResponse,
    SaveManualHealthMeasurementResponse,
} from '../../../shared/manual-health';
import { enforceAppCheck } from '../utils';
import {
    deleteManualHealthMeasurement,
    ManualHealthMeasurementNotFoundError,
    ManualHealthRevisionConflictError,
    ManualHealthValidationError,
    ManualHealthWriteBlockedError,
    saveManualHealthMeasurement,
} from './manual-measurements';

function mapManualHealthError(error: unknown): never {
    if (error instanceof ManualHealthValidationError) {
        throw new HttpsError('invalid-argument', error.message);
    }
    if (error instanceof ManualHealthMeasurementNotFoundError) {
        throw new HttpsError('not-found', 'The manual Health measurement was not found.');
    }
    if (error instanceof ManualHealthRevisionConflictError) {
        throw new HttpsError('aborted', 'The measurement changed. Refresh Health and try again.');
    }
    if (error instanceof ManualHealthWriteBlockedError) {
        throw new HttpsError('failed-precondition', 'Health measurements cannot be changed while the account is unavailable.');
    }
    logger.error('[ManualHealth] Owner-scoped mutation failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new HttpsError('internal', 'Unable to change the manual Health measurement.');
}

const callableOptions = {
    region: FUNCTIONS_MANIFEST.saveManualHealthMeasurement.region,
    cors: true,
    timeoutSeconds: 30,
    memory: '256MiB' as const,
    maxInstances: 100,
};

export const saveManualHealthMeasurementCallable = onCall(callableOptions, async (
    request,
): Promise<SaveManualHealthMeasurementResponse> => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    enforceAppCheck(request);
    try {
        return await saveManualHealthMeasurement(request.auth.uid, request.data);
    } catch (error) {
        return mapManualHealthError(error);
    }
});

export const deleteManualHealthMeasurementCallable = onCall({
    ...callableOptions,
    region: FUNCTIONS_MANIFEST.deleteManualHealthMeasurement.region,
}, async (request): Promise<DeleteManualHealthMeasurementResponse> => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    enforceAppCheck(request);
    try {
        return await deleteManualHealthMeasurement(request.auth.uid, request.data);
    } catch (error) {
        return mapManualHealthError(error);
    }
});
