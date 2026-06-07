import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';

const REGION = 'europe-west2';

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
