import { ServiceNames } from '@sports-alliance/sports-lib';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ACTIVITY_SYNC_ROUTES, ActivitySyncRouteId } from '../../../shared/activity-sync-routes';
import {
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';

function normalizeServiceName(value: unknown): string {
  return `${value || ''}`.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

export async function disableActivitySyncRoutesForDisconnectedService(
  userID: string,
  disconnectedServiceName: ServiceNames,
): Promise<void> {
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

    transaction.set(settingsRef, {
      serviceSyncSettings: {
        activitySyncRoutes: routeUpdates,
      },
    }, { merge: true });
  });
}
