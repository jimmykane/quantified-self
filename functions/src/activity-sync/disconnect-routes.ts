import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { HEALTH_PROVIDERS, HEALTH_SYNC_STATUSES, HealthProvider } from '../../../shared/health';
import { SERVICE_CONNECTION_STATES } from '../../../shared/service-connection';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME } from '../wahoo/constants';
import { disableActivitySyncRoutesForDisconnectedService } from './route-cleanup';
import { updateHealthSyncState } from '../health/writer';
import { getServiceTokenRootDocumentRef } from '../service-token-store';
import {
  supersedePendingCOROSHealthLifecycleProjectionForTokenRootDelete,
  supersedePendingHealthLifecycleProjectionForTokenRootDelete,
} from '../service-connection-meta';

const REGION = 'europe-west2';

export { disableActivitySyncRoutesForDisconnectedService } from './route-cleanup';

function deletedEventTimeMs(value: unknown): number {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : Date.now();
}

async function updateHealthStateAfterTokenRootDelete(
  userID: string,
  serviceName: ServiceNames,
  healthProvider: HealthProvider,
  transitionAtMs: number,
): Promise<boolean> {
  if (serviceName === ServiceNames.COROSAPI) {
    await supersedePendingCOROSHealthLifecycleProjectionForTokenRootDelete(userID);
  } else {
    await supersedePendingHealthLifecycleProjectionForTokenRootDelete(userID, serviceName);
  }
  const db = admin.firestore();
  const serviceMetaRef = db.collection('users').doc(userID).collection('meta').doc(serviceName);
  return updateHealthSyncState(userID, healthProvider, {
    status: HEALTH_SYNC_STATUSES.Disconnected,
    lastErrorCode: null,
  }, transitionAtMs, {
    requiredMissingDocumentRef: getServiceTokenRootDocumentRef(userID, serviceName),
    authoritativeLifecycleTransition: true,
    updateWhenDocumentFieldEquals: {
      documentRef: serviceMetaRef,
      field: 'connectionState',
      expectedValue: SERVICE_CONNECTION_STATES.ReconnectRequired,
      updateValue: {
        status: HEALTH_SYNC_STATUSES.ReconnectRequired,
        lastErrorCode: 'provider_auth_reconnect_required',
      },
    },
  });
}

export async function handleServiceTokenRootDisconnected(
  userID: string | undefined,
  serviceName: ServiceNames,
  transitionAtMs = Date.now(),
): Promise<void> {
  if (!userID) {
    logger.warn('[ActivitySyncRouteCleanup] Missing user id in token-root disconnect trigger.', { serviceName });
    return;
  }

  const healthProvider = serviceName === ServiceNames.COROSAPI
    ? HEALTH_PROVIDERS.COROSAPI
    : serviceName === ServiceNames.SuuntoApp
      ? HEALTH_PROVIDERS.SuuntoApp
      : null;

  await Promise.all([
    disableActivitySyncRoutesForDisconnectedService(userID, serviceName, {
      requireServiceTokenRootMissing: true,
    }),
    healthProvider
      ? updateHealthStateAfterTokenRootDelete(userID, serviceName, healthProvider, transitionAtMs)
      : serviceName === ServiceNames.SuuntoApp
        ? supersedePendingHealthLifecycleProjectionForTokenRootDelete(userID, serviceName)
        : Promise.resolve(true),
  ]);
}

export const disableActivitySyncRoutesOnGarminTokenRootDelete = onDocumentDeleted({
  document: `${GARMIN_API_TOKENS_COLLECTION_NAME}/{uid}`,
  region: REGION,
}, async (event) => {
  await handleServiceTokenRootDisconnected(
    event.params.uid,
    ServiceNames.GarminAPI,
    deletedEventTimeMs(event.time),
  );
});

export const disableActivitySyncRoutesOnSuuntoTokenRootDelete = onDocumentDeleted({
  document: `${SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME}/{uid}`,
  region: REGION,
  retry: true,
}, async (event) => {
  await handleServiceTokenRootDisconnected(
    event.params.uid,
    ServiceNames.SuuntoApp,
    deletedEventTimeMs(event.time),
  );
});

export const disableActivitySyncRoutesOnCOROSTokenRootDelete = onDocumentDeleted({
  document: `${COROSAPI_ACCESS_TOKENS_COLLECTION_NAME}/{uid}`,
  region: REGION,
  retry: true,
}, async (event) => {
  await handleServiceTokenRootDisconnected(
    event.params.uid,
    ServiceNames.COROSAPI,
    deletedEventTimeMs(event.time),
  );
});

export const disableActivitySyncRoutesOnWahooTokenRootDelete = onDocumentDeleted({
  document: `${WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME}/{uid}`,
  region: REGION,
}, async (event) => {
  await handleServiceTokenRootDisconnected(
    event.params.uid,
    ServiceNames.WahooAPI,
    deletedEventTimeMs(event.time),
  );
});
