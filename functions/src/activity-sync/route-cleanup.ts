import { ServiceNames } from '@sports-alliance/sports-lib';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ACTIVITY_SYNC_ROUTES, ActivitySyncRouteId } from '../../../shared/activity-sync-routes';
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

function getPendingDisconnectRestoreKey(serviceName: ServiceNames): string {
  return `${serviceName}`;
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
      const serviceRestoreKey = getPendingDisconnectRestoreKey(disconnectedServiceName);
      const existingServiceRestoreSettings = asRecord(existingRestoreSettings[serviceRestoreKey]);
      const routeRestoreUpdates: Partial<Record<ActivitySyncRouteId, true>> = {};

      for (const routeId of affectedRouteIds) {
        const routeSetting = asRecord(existingRouteSettings[routeId]);
        if (routeSetting.enabled === true || existingServiceRestoreSettings[routeId] === true) {
          routeRestoreUpdates[routeId] = true;
        }
      }

      serviceSyncSettings.pendingDisconnectRouteRestore = {
        [serviceRestoreKey]: routeRestoreUpdates,
      };
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
    const serviceRestoreKey = getPendingDisconnectRestoreKey(serviceName);
    const serviceRestoreSettings = asRecord(restoreSettings[serviceRestoreKey]);
    const routeUpdates: Partial<Record<ActivitySyncRouteId, { enabled: boolean }>> = {};

    for (const routeId of affectedRouteIds) {
      if (serviceRestoreSettings[routeId] === true) {
        routeUpdates[routeId] = { enabled: true };
      }
    }

    if (Object.keys(routeUpdates).length === 0 && Object.keys(serviceRestoreSettings).length === 0) {
      return;
    }

    const nextServiceSyncSettings: Record<string, unknown> = {
      pendingDisconnectRouteRestore: {
        [serviceRestoreKey]: admin.firestore.FieldValue.delete(),
      },
    };
    if (Object.keys(routeUpdates).length > 0) {
      nextServiceSyncSettings.activitySyncRoutes = routeUpdates;
    }

    transaction.set(settingsRef, {
      serviceSyncSettings: nextServiceSyncSettings,
    }, { merge: true });
  });
}
