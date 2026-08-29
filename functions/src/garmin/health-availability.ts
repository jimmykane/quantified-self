import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { GarminHealthSyncAvailabilityResponse } from '../../../shared/sleep-backfill';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';
import { isGarminHealthSyncEnabled, isGarminHealthSyncUserAllowed } from './health-rollout';

export const getGarminHealthSyncAvailability = onCall({
  region: FUNCTIONS_MANIFEST.getGarminHealthSyncAvailability.region,
  cors: ALLOWED_CORS_ORIGINS,
}, async (request): Promise<GarminHealthSyncAvailabilityResponse> => {
  enforceAppCheck(request);
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }
  return {
    available: isGarminHealthSyncEnabled()
      && isGarminHealthSyncUserAllowed(request.auth.uid),
  };
});
