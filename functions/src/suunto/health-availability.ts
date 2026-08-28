import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { SuuntoHealthSyncAvailabilityResponse } from '../../../shared/sleep-backfill';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';
import { isSuuntoHealthSyncEnabled } from './health-flags';

export const getSuuntoHealthSyncAvailability = onCall({
  region: FUNCTIONS_MANIFEST.getSuuntoHealthSyncAvailability.region,
  cors: ALLOWED_CORS_ORIGINS,
  timeoutSeconds: 15,
  memory: '256MiB',
  maxInstances: 100,
}, async (request): Promise<SuuntoHealthSyncAvailabilityResponse> => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }
  enforceAppCheck(request);

  return {
    available: isSuuntoHealthSyncEnabled(),
  };
});
