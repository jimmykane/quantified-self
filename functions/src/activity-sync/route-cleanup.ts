import { ServiceNames } from '@sports-alliance/sports-lib';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ACTIVITY_SYNC_ROUTES, ActivitySyncRouteId } from '../../../shared/activity-sync-routes';
import {
  isServiceUnavailableForSyncConnection,
  type ServiceConnectionMetaFields,
} from '../../../shared/service-connection';
import {
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';

interface ActivitySyncRouteCleanupOptions {
  trackPendingDisconnectRestore?: boolean;
}

function normalizeServiceName(value: unknown): string {
  return `${value || ''}`.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getAffectedRouteIds(serviceName: ServiceNames): ActivitySyncRouteId[] {
  const normalizedServiceName = normalizeServiceName(serviceName);
  return Object.values(ACTIVITY_SYNC_ROUTES)
    .filter((route) => (
      normalizeServiceName(route.sourceServiceName) === normalizedServiceName ||
      normalizeServiceName(route.destinationServiceName) === normalizedServiceName
    ))
    .map((route) => route.id);
}

function getUserServiceMetaRef(
  db: FirebaseFirestore.Firestore,
  userID: string,
  serviceName: ServiceNames,
): FirebaseFirestore.DocumentReference {
  return db.collection('users').doc(userID).collection('meta').doc(`${serviceName}`);
}

async function isServiceAvailableForPendingRouteRestore(
  db: FirebaseFirestore.Firestore,
  transaction: FirebaseFirestore.Transaction,
  userID: string,
  serviceName: ServiceNames,
  serviceUnavailableCache: Map<string, boolean>,
): Promise<boolean> {
  const serviceKey = `${serviceName}`;
  const cachedUnavailable = serviceUnavailableCache.get(serviceKey);
  if (cachedUnavailable !== undefined) {
    return !cachedUnavailable;
  }

  const metaSnapshot = await transaction.get(getUserServiceMetaRef(db, userID, serviceName));
  const metaData = asRecord(metaSnapshot.data()) as unknown as ServiceConnectionMetaFields;
  const unavailable = isServiceUnavailableForSyncConnection(metaData);
  serviceUnavailableCache.set(serviceKey, unavailable);
  return !unavailable;
}

async function isRouteAvailableForPendingRestore(
  db: FirebaseFirestore.Firestore,
  transaction: FirebaseFirestore.Transaction,
  userID: string,
  routeId: ActivitySyncRouteId,
  serviceUnavailableCache: Map<string, boolean>,
): Promise<boolean> {
  const route = ACTIVITY_SYNC_ROUTES[routeId];
  const [sourceAvailable, destinationAvailable] = await Promise.all([
    isServiceAvailableForPendingRouteRestore(db, transaction, userID, route.sourceServiceName, serviceUnavailableCache),
    isServiceAvailableForPendingRouteRestore(db, transaction, userID, route.destinationServiceName, serviceUnavailableCache),
  ]);

  return sourceAvailable && destinationAvailable;
}

export async function disableActivitySyncRoutesForDisconnectedService(
  userID: string,
  disconnectedServiceName: ServiceNames,
  options: ActivitySyncRouteCleanupOptions = {},
): Promise<void> {
  const affectedRouteIds = getAffectedRouteIds(disconnectedServiceName);

  if (affectedRouteIds.length === 0) {
    return;
  }

  const routeUpdates: Partial<Record<ActivitySyncRouteId, { enabled: boolean }>> = {};
  for (const routeId of affectedRouteIds) {
    routeUpdates[routeId] = { enabled: false };
  }

  const db = admin.firestore();
  const settingsRef = db.collection('users').doc(userID).collection('config').doc('settings');
  await db.runTransaction(async (transaction) => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, `activity_sync_route_cleanup:${disconnectedServiceName}`, error);
    }

    if (deletionGuard.shouldSkip) {
      logger.warn(
        `[ActivitySyncRouteCleanup] Skipping route disable for ${disconnectedServiceName} user ${userID} because the user is missing or deletion is in progress.`,
      );
      return;
    }

    const serviceSyncSettings: Record<string, unknown> = {
      activitySyncRoutes: routeUpdates,
    };

    if (options.trackPendingDisconnectRestore) {
      const settingsSnapshot = await transaction.get(settingsRef);
      const settingsData = asRecord(settingsSnapshot.data());
      const existingServiceSyncSettings = asRecord(settingsData.serviceSyncSettings);
      const existingRouteSettings = asRecord(existingServiceSyncSettings.activitySyncRoutes);
      const existingRestoreSettings = asRecord(existingServiceSyncSettings.pendingDisconnectRouteRestore);
      const serviceRestoreKey = `${disconnectedServiceName}`;
      const existingServiceRestoreSettings = asRecord(existingRestoreSettings[serviceRestoreKey]);
      const routeRestoreUpdates: Partial<Record<ActivitySyncRouteId, true>> = {};

      for (const routeId of affectedRouteIds) {
        const routeSetting = asRecord(existingRouteSettings[routeId]);
        if (
          routeSetting.enabled === true ||
          existingRestoreSettings[routeId] === true ||
          existingServiceRestoreSettings[routeId] === true
        ) {
          routeRestoreUpdates[routeId] = true;
        }
      }

      if (Object.keys(routeRestoreUpdates).length > 0) {
        serviceSyncSettings.pendingDisconnectRouteRestore = routeRestoreUpdates;
      }
    }

    transaction.set(settingsRef, {
      serviceSyncSettings,
    }, { merge: true });
  });
}

export async function restoreActivitySyncRoutesForPendingDisconnectClear(
  userID: string,
  serviceName: ServiceNames,
): Promise<void> {
  const affectedRouteIds = getAffectedRouteIds(serviceName);

  if (affectedRouteIds.length === 0) {
    return;
  }

  const db = admin.firestore();
  const settingsRef = db.collection('users').doc(userID).collection('config').doc('settings');
  await db.runTransaction(async (transaction) => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, `activity_sync_route_restore:${serviceName}`, error);
    }

    if (deletionGuard.shouldSkip) {
      logger.warn(
        `[ActivitySyncRouteCleanup] Skipping route restore for ${serviceName} user ${userID} because the user is missing or deletion is in progress.`,
      );
      return;
    }

    const settingsSnapshot = await transaction.get(settingsRef);
    const settingsData = asRecord(settingsSnapshot.data());
    const serviceSyncSettings = asRecord(settingsData.serviceSyncSettings);
    const restoreSettings = asRecord(serviceSyncSettings.pendingDisconnectRouteRestore);
    const serviceRestoreKey = `${serviceName}`;
    const serviceRestoreSettings = asRecord(restoreSettings[serviceRestoreKey]);
    const routeUpdates: Partial<Record<ActivitySyncRouteId, { enabled: boolean }>> = {};
    const restoreMarkerUpdates: Record<string, unknown> = {};
    const serviceUnavailableCache = new Map<string, boolean>();

    for (const routeId of affectedRouteIds) {
      const hasRestoreMarker = restoreSettings[routeId] === true || serviceRestoreSettings[routeId] === true;
      if (!hasRestoreMarker) {
        continue;
      }

      if (await isRouteAvailableForPendingRestore(db, transaction, userID, routeId, serviceUnavailableCache)) {
        routeUpdates[routeId] = { enabled: true };
        restoreMarkerUpdates[routeId] = admin.firestore.FieldValue.delete();
      } else if (serviceRestoreSettings[routeId] === true && restoreSettings[routeId] !== true) {
        restoreMarkerUpdates[routeId] = true;
      }
    }

    if (Object.keys(serviceRestoreSettings).length > 0) {
      restoreMarkerUpdates[serviceRestoreKey] = admin.firestore.FieldValue.delete();
    }

    if (Object.keys(routeUpdates).length === 0 && Object.keys(restoreMarkerUpdates).length === 0) {
      return;
    }

    const nextServiceSyncSettings: Record<string, unknown> = {
      pendingDisconnectRouteRestore: restoreMarkerUpdates,
    };
    if (Object.keys(routeUpdates).length > 0) {
      nextServiceSyncSettings.activitySyncRoutes = routeUpdates;
    }

    transaction.set(settingsRef, {
      serviceSyncSettings: nextServiceSyncSettings,
    }, { merge: true });
  });
}
