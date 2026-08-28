import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { HealthRangeResult } from '../../../shared/health';
import { HealthQueryValidationError } from '../../../shared/health-query';
import { enforceAppCheck } from '../utils';
import { readHealthRange } from './query';

export const queryHealthRange = onCall({
    region: FUNCTIONS_MANIFEST.queryHealthRange.region,
    cors: true,
    timeoutSeconds: 30,
    memory: '256MiB',
    maxInstances: 100,
}, async (request): Promise<HealthRangeResult> => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    enforceAppCheck(request);

    try {
        return await readHealthRange(request.auth.uid, request.data);
    } catch (error) {
        if (error instanceof HealthQueryValidationError) {
            throw new HttpsError('invalid-argument', error.message);
        }
        logger.error('[HealthQuery] Bounded health query failed.', {
            errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        throw new HttpsError('internal', 'Unable to query health data.');
    }
});
