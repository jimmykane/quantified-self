//
import * as functions from 'firebase-functions/v1';
import * as tokens from '../tokens';
import { SERVICE_NAME } from './constants';

export const refreshSuuntoAppRefreshTokens = functions.region('europe-west2').runWith({ timeoutSeconds: 180 }).pubsub.schedule('every 2 hours').onRun(async () => {
  // Suunto app refresh tokens should be refreshed every 180days we target at half days before 90 days
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  await tokens.refreshStaleTokens(SERVICE_NAME, ninetyDaysAgo);
}
);
