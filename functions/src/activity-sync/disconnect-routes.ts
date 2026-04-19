import { ServiceNames } from '@sports-alliance/sports-lib';
import * as admin from 'firebase-admin';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { ACTIVITY_SYNC_ROUTES, ActivitySyncRouteId } from '../../../shared/activity-sync-routes';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';

const REGION = 'europe-west2';

function normalizeServiceName(value: unknown): string {
  return `${value || ''}`.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

export async function disableActivitySyncRoutesForDisconnectedService(userID: string, disconnectedServiceName: ServiceNames): Promise<void> {
  const normalizedDisconnectedServiceName = normalizeServiceName(disconnectedServiceName);
  const affectedRouteIds = Object.values(ACTIVITY_SYNC_ROUTES)
    .filter((route) => (
      normalizeServiceName(route.sourceServiceName) === normalizedDisconnectedServiceName ||
      normalizeServiceName(route.destinationServiceName) === normalizedDisconnectedServiceName
    ))
    .map((route) => route.id);

  if (affectedRouteIds.length === 0) {
    return;
  }

  const userDocRef = admin.firestore().collection('users').doc(userID);
  const userSnapshot = await userDocRef.get();
  if (userSnapshot.exists === false) {
    return;
  }

  const routeUpdates: Partial<Record<ActivitySyncRouteId, { enabled: boolean }>> = {};
  for (const routeId of affectedRouteIds) {
    routeUpdates[routeId] = { enabled: false };
  }

  await userDocRef.collection('config').doc('settings').set({
    serviceSyncSettings: {
      activitySyncRoutes: routeUpdates,
    },
  }, { merge: true });
}

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
