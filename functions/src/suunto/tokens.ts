//
import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { refreshTokens } from '../tokens';
import { SERVICE_NAME } from './constants';

export const refreshSuuntoAppRefreshTokens = functions.region('europe-west2').runWith({ timeoutSeconds: 180 }).pubsub.schedule('every 2 hours').onRun(async () => {
  // Suunto app refresh tokens should be refreshed every 180days we target at half days before 90 days
  const ninetyDaysAgo = (new Date()).getTime() - (90 * 24 * 60 * 60 * 1000);

  // Query 1: Tokens that need refresh based on dateRefreshed
  const querySnapshot = await admin.firestore().collectionGroup('tokens')
    .where('serviceName', '==', SERVICE_NAME)
    .where('dateRefreshed', '<=', ninetyDaysAgo)
    .limit(50).get();

  logger.info(`Found ${querySnapshot.size} tokens with dateRefreshed <= 90 days ago`);
  await refreshTokens(querySnapshot, SERVICE_NAME);

  // Query 2: Tokens that don't have dateRefreshed (older tokens or newly created ones without it)
  // Since we can't query "not exists", we can query for ones where dateCreated is old but dateRefreshed is missing
  // or just attempt to refresh tokens that have no dateRefreshed at all.
  const querySnapshotNoDate = await admin.firestore().collectionGroup('tokens')
    .where('serviceName', '==', SERVICE_NAME)
    .where('dateRefreshed', '==', null) // Some might have it as null
    .limit(50).get();

  if (querySnapshotNoDate.size > 0) {
    logger.info(`Found ${querySnapshotNoDate.size} tokens with dateRefreshed == null`);
    await refreshTokens(querySnapshotNoDate, SERVICE_NAME);
  }
});
