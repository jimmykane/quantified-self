import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { refreshTokens } from '../tokens';
import { SERVICE_NAME } from './constants';

export const refreshCOROSAPIRefreshTokens = functions.region('europe-west2').runWith({ timeoutSeconds: 180 }).pubsub.schedule('every 2 hours').onRun(async (context) => {
  // COROS API refresh tokens should be refreshed every 30 days we target at half days before 20 days
  const tokenQuery = admin.firestore().collectionGroup('tokens').where('serviceName', '==', SERVICE_NAME).where('dateRefreshed', '<=', (new Date()).getTime() - (20 * 24 * 60 * 60 * 1000)).limit(50)
    .get();

  const missingDateRefreshedQuery = admin.firestore()
    .collectionGroup('tokens')
    .where('serviceName', '==', SERVICE_NAME)
    .where('dateRefreshed', '==', null) // Catch tokens without a refresh date
    .limit(50)
    .get();

  const [tokenQuerySnapshots, missingDateRefreshedSnapshots] = await Promise.all([
    tokenQuery,
    missingDateRefreshedQuery,
  ]);

  await refreshTokens(tokenQuerySnapshots, SERVICE_NAME);
  await refreshTokens(missingDateRefreshedSnapshots, SERVICE_NAME);
});
