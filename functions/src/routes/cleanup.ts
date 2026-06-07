import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import {
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';

const REGION = 'europe-west2';

type RouteCleanupFailurePhase = 'quota' | 'metadata' | 'storage';

interface RouteCleanupFailure {
  phase: RouteCleanupFailurePhase;
  error: unknown;
}

class RouteCleanupError extends Error {
  constructor(public readonly failures: RouteCleanupFailure[]) {
    super(`Route cleanup failed: ${failures.map(failure => failure.phase).join(', ')}.`);
    this.name = 'RouteCleanupError';
  }
}

function readRouteCountCounter(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

function normalizeRouteCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function getDeleteMarkerID(userId: string, routeId: string, eventId?: string, eventTime?: string): string {
  return createHash('sha256')
    .update(eventId || `${userId}:${routeId}:${eventTime || 'unknown-delete-event'}`)
    .digest('hex');
}

async function getRouteCountForUser(userId: string): Promise<number> {
  const countSnapshot = await admin.firestore()
    .collection(`users/${userId}/routes`)
    .count()
    .get();
  return normalizeRouteCount(countSnapshot.data().count);
}

async function reconcileRouteQuotaCounterAfterDelete(
  userId: string,
  routeId: string,
  eventId?: string,
  eventTime?: string,
): Promise<{ skippedForDeletedUser: boolean }> {
  const db = admin.firestore();
  const counterRef = db.doc(`users/${userId}/metaData/routeQuota`);
  const deleteMarkerRef = db.doc(`users/${userId}/metaData/routeQuota/deletions/${getDeleteMarkerID(userId, routeId, eventId, eventTime)}`);

  return db.runTransaction(async (transaction) => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userId);
    } catch (error) {
      throw new UserDeletionGuardReadError(userId, 'route_delete_quota_reconcile', error);
    }

    if (deletionGuard.shouldSkip) {
      logger.warn('Skipping route quota reconciliation because user is missing or deletion is in progress', {
        userId,
        routeId,
        eventId,
        userExists: deletionGuard.userExists,
        deletionInProgress: deletionGuard.deletionInProgress,
      });
      return { skippedForDeletedUser: true };
    }

    const [counterSnapshot, deleteMarkerSnapshot] = await Promise.all([
      transaction.get(counterRef),
      transaction.get(deleteMarkerRef),
    ]);
    if (deleteMarkerSnapshot.exists) {
      return { skippedForDeletedUser: false };
    }

    const authoritativeRouteCount = await getRouteCountForUser(userId);
    const serverTimestamp = FieldValue.serverTimestamp();
    const currentRouteCount = counterSnapshot.exists
      ? readRouteCountCounter(counterSnapshot.data()?.routeCount)
      : null;
    const counterPayload: Record<string, unknown> = {
      routeCount: authoritativeRouteCount,
      updatedAt: serverTimestamp,
      lastDeletedRouteId: routeId,
      reconciledAfterDeleteAt: serverTimestamp,
    };

    if (!counterSnapshot.exists) {
      counterPayload.initializedAt = serverTimestamp;
    }
    if (counterSnapshot.exists && currentRouteCount === null) {
      counterPayload.repairedAt = serverTimestamp;
    }

    transaction.set(counterRef, counterPayload, { merge: true });
    transaction.set(deleteMarkerRef, {
      routeId,
      eventId: eventId || null,
      eventTime: eventTime || null,
      processedAt: serverTimestamp,
    });

    return { skippedForDeletedUser: false };
  });
}

export const cleanupRouteFiles = onDocumentDeleted({
  document: 'users/{userId}/routes/{routeId}',
  region: REGION,
  timeoutSeconds: 540,
  memory: '1GiB',
  maxInstances: 10,
  concurrency: 5,
  retry: true,
}, async (event) => {
  const { userId, routeId } = event.params;
  if (!userId || !routeId) {
    logger.warn('cleanupRouteFiles missing route delete params', { userId, routeId });
    return;
  }

  if (!event.data) {
    logger.warn('cleanupRouteFiles invoked without snapshot data', { userId, routeId });
    return;
  }

  const db = admin.firestore();
  const storagePrefix = `users/${userId}/routes/${routeId}/`;
  const eventId = typeof event.id === 'string' ? event.id : undefined;
  const eventTime = typeof event.time === 'string' ? event.time : undefined;
  const cleanupFailures: RouteCleanupFailure[] = [];
  let skipFirestoreCleanup = false;

  try {
    const reconciliationResult = await reconcileRouteQuotaCounterAfterDelete(userId, routeId, eventId, eventTime);
    skipFirestoreCleanup = reconciliationResult.skippedForDeletedUser;
    if (skipFirestoreCleanup) {
      logger.info('Route quota counter reconciliation skipped because account deletion owns Firestore cleanup', { userId, routeId, eventId });
    } else {
      logger.info('Route quota counter reconciled after delete', { userId, routeId, eventId });
    }
  } catch (error) {
    cleanupFailures.push({ phase: 'quota', error });
    logger.error('Failed to reconcile route quota counter after delete', { userId, routeId, eventId, error });
  }

  if (!skipFirestoreCleanup) {
    try {
      await db.recursiveDelete(db.collection(`users/${userId}/routes/${routeId}/metaData`));
      logger.info('Route metadata cleaned up', { userId, routeId });
    } catch (error) {
      cleanupFailures.push({ phase: 'metadata', error });
      logger.error('Failed to clean up route metadata', { userId, routeId, error });
    }
  } else {
    logger.info('Route metadata cleanup skipped because account deletion owns Firestore cleanup', { userId, routeId });
  }

  try {
    await admin.storage().bucket().deleteFiles({ prefix: storagePrefix, force: true });
    logger.info('Route original files cleaned up', { userId, routeId, storagePrefix });
  } catch (error) {
    cleanupFailures.push({ phase: 'storage', error });
    logger.error('Failed to clean up route original files', { userId, routeId, storagePrefix, error });
  }

  logger.info('Route cleanup finished', { userId, routeId, storagePrefix });

  if (cleanupFailures.length > 0) {
    throw new RouteCleanupError(cleanupFailures);
  }
});
