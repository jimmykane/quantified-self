//
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { refreshTokens } from '../tokens';
import { SERVICE_NAME } from './constants';

export const refreshSuuntoAppRefreshTokens = functions.region('europe-west2').runWith({ timeoutSeconds: 180 }).pubsub.schedule('every 2 hours').onRun(async (context) => {
  // Suunto app refresh tokens should be refreshed every 180days we target at half days before 90 days
  const querySnapshot = await admin.firestore().collectionGroup('tokens').where('dateRefreshed', '<=', (new Date()).getTime() - (90 * 24 * 60 * 60 * 1000)).limit(50).get();
  await refreshTokens(querySnapshot, SERVICE_NAME);
});
