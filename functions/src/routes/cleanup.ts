import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';

const REGION = 'europe-west2';

function readRouteCountCounter(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

function getDeleteMarkerID(userId: string, routeId: string, eventId?: string, eventTime?: string): string {
  return createHash('sha256')
    .update(eventId || `${userId}:${routeId}:${eventTime || 'unknown-delete-event'}`)
    .digest('hex');
}

async function decrementRouteQuotaCounter(
  userId: string,
  routeId: string,
  eventId?: string,
  eventTime?: string,
): Promise<void> {
  const db = admin.firestore();
  const counterRef = db.doc(`users/${userId}/metaData/routeQuota`);
  const deleteMarkerRef = db.doc(`users/${userId}/metaData/routeQuota/deletions/${getDeleteMarkerID(userId, routeId, eventId, eventTime)}`);

  await db.runTransaction(async (transaction) => {
    const [counterSnapshot, deleteMarkerSnapshot] = await Promise.all([
      transaction.get(counterRef),
      transaction.get(deleteMarkerRef),
    ]);
    if (deleteMarkerSnapshot.exists) {
      return;
    }

    const serverTimestamp = FieldValue.serverTimestamp();
    if (counterSnapshot.exists) {
      const currentRouteCount = readRouteCountCounter(counterSnapshot.data()?.routeCount);
      if (currentRouteCount !== null) {
        transaction.set(counterRef, {
          routeCount: Math.max(0, currentRouteCount - 1),
          updatedAt: serverTimestamp,
          lastDeletedRouteId: routeId,
        }, { merge: true });
      } else {
        transaction.set(counterRef, {
          routeCountNeedsRepair: true,
          updatedAt: serverTimestamp,
          lastDeletedRouteId: routeId,
        }, { merge: true });
      }
    }

    transaction.set(deleteMarkerRef, {
      routeId,
      eventId: eventId || null,
      eventTime: eventTime || null,
      processedAt: serverTimestamp,
    });
  });
}

export const cleanupRouteFiles = onDocumentDeleted({
  document: 'users/{userId}/routes/{routeId}',
  region: REGION,
  timeoutSeconds: 540,
  memory: '1GiB',
  maxInstances: 10,
  concurrency: 5,
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

  try {
    await decrementRouteQuotaCounter(userId, routeId, eventId, eventTime);
    logger.info('Route quota counter decremented', { userId, routeId, eventId });
  } catch (error) {
    logger.error('Failed to decrement route quota counter', { userId, routeId, eventId, error });
  }

  try {
    await db.recursiveDelete(db.collection(`users/${userId}/routes/${routeId}/metaData`));
    logger.info('Route metadata cleaned up', { userId, routeId });
  } catch (error) {
    logger.error('Failed to clean up route metadata', { userId, routeId, error });
  }

  try {
    await admin.storage().bucket().deleteFiles({ prefix: storagePrefix, force: true });
    logger.info('Route original files cleaned up', { userId, routeId, storagePrefix });
  } catch (error) {
    logger.error('Failed to clean up route original files', { userId, routeId, storagePrefix, error });
  }

  logger.info('Route cleanup finished', { userId, routeId, storagePrefix });
});
