import { ServiceNames } from '@sports-alliance/sports-lib';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { disableActivitySyncRoutesForDisconnectedService } from './route-cleanup';

const REGION = 'europe-west2';

export { disableActivitySyncRoutesForDisconnectedService } from './route-cleanup';

export async function handleServiceTokenRootDisconnected(userID: string | undefined, serviceName: ServiceNames): Promise<void> {
  if (!userID) {
    logger.warn('[ActivitySyncRouteCleanup] Missing user id in token-root disconnect trigger.', { serviceName });
    return;
  }

  await disableActivitySyncRoutesForDisconnectedService(userID, serviceName);
}

export const disableActivitySyncRoutesOnGarminTokenRootDelete = onDocumentDeleted({
  document: `${GARMIN_API_TOKENS_COLLECTION_NAME}/{uid}`,
  region: REGION,
}, async (event) => {
  await handleServiceTokenRootDisconnected(event.params.uid, ServiceNames.GarminAPI);
});

export const disableActivitySyncRoutesOnSuuntoTokenRootDelete = onDocumentDeleted({
  document: `${SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME}/{uid}`,
  region: REGION,
}, async (event) => {
  await handleServiceTokenRootDisconnected(event.params.uid, ServiceNames.SuuntoApp);
});

export const disableActivitySyncRoutesOnCOROSTokenRootDelete = onDocumentDeleted({
  document: `${COROSAPI_ACCESS_TOKENS_COLLECTION_NAME}/{uid}`,
  region: REGION,
}, async (event) => {
  await handleServiceTokenRootDisconnected(event.params.uid, ServiceNames.COROSAPI);
});
