'use strict';

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { isProUser, PRO_REQUIRED_MESSAGE, enforceAppCheck } from '../utils';
import { SERVICE_NAME } from './constants';
import { HistoryImportResult, addHistoryToQueue, isAllowedToDoHistoryImport } from '../history';
import { FUNCTIONS_MANIFEST } from '../../../src/shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS } from '../utils';

interface HistoryToQueueRequest {
  startDate: string;
  endDate: string;
}

interface HistoryToQueueResponse {
  result: string;
  stats?: HistoryImportResult;
}

/**
 * Add to the workout queue the workouts of a user for a selected date range
 */
export const addSuuntoAppHistoryToQueue = onCall({
  region: FUNCTIONS_MANIFEST.addSuuntoAppHistoryToQueue.region,
  cors: ALLOWED_CORS_ORIGINS,
  memory: '256MiB',
  maxInstances: 10
}, async (request): Promise<HistoryToQueueResponse> => {
  // App Check verification
  enforceAppCheck(request);

  // Auth verification
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const userID = request.auth.uid;

  // Enforce Pro Access
  if (!(await isProUser(userID))) {
    logger.warn(`Blocking history import for non-pro user ${userID}`);
    throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }

  const { startDate: startDateStr, endDate: endDateStr } = request.data as HistoryToQueueRequest;
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  if (!startDate || isNaN(startDate.getTime()) || !endDate || isNaN(endDate.getTime())) {
    throw new HttpsError('invalid-argument', 'No start and/or end date');
  }

  if (startDate > endDate) {
    throw new HttpsError('invalid-argument', 'Start date is after the end date');
  }

  // First check last history import
  if (!(await isAllowedToDoHistoryImport(userID, SERVICE_NAME))) {
    logger.error(`User ${userID} tried todo history import while not allowed`);
    throw new HttpsError('permission-denied', 'History import is not allowed');
  }

  let stats: HistoryImportResult;
  try {
    stats = await addHistoryToQueue(userID, SERVICE_NAME, startDate, endDate);

    if (stats.successCount === 0 && stats.failureCount > 0) {
      throw new Error(`Failed to import all ${stats.failureCount} items.`);
    }

    if (stats.failureCount > 0) {
      logger.warn(`Partial import success: ${stats.successCount} imported, ${stats.failureCount} failed.`);
    }
  } catch (e: any) {
    logger.error(e);
    throw new HttpsError('internal', e.message);
  }

  return { result: 'History items added to queue', stats };
});
