import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import type { ActivityHealthRangeResult } from '../../../shared/activity-health';
import { enforceAppCheck } from '../utils';
import {
    ActivityHealthQueryValidationError,
    readActivityHealthRange,
} from './activity-query';

export const queryActivityHealthRange = onCall({
    region: FUNCTIONS_MANIFEST.queryActivityHealthRange.region,
    cors: true,
    timeoutSeconds: 30,
    memory: '256MiB',
    maxInstances: 100,
}, async (request): Promise<ActivityHealthRangeResult> => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    enforceAppCheck(request);

    try {
        return await readActivityHealthRange(request.auth.uid, request.data);
    } catch (error) {
        if (error instanceof ActivityHealthQueryValidationError) {
            throw new HttpsError('invalid-argument', error.message);
        }
        logger.error('[ActivityHealthQuery] Bounded workout Health query failed.', {
            errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        throw new HttpsError('internal', 'Unable to query workout Health data.');
    }
});
