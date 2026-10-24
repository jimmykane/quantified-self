'use strict';

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { hasProAccess, PRO_REQUIRED_MESSAGE, enforceAppCheck } from '../utils';
import { SERVICE_NAME } from './constants';
import { HistoryImportResult, addHistoryToQueue, getNextAllowedHistoryImportDate } from '../history';
import { HistoryImportAdmissionError, HistoryLifecycleChangedError } from '../connection-history/execution';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS } from '../utils';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import type { ConnectionHistoryStatusProjection } from '../../../shared/connection-history';

interface HistoryToQueueRequest {
  startDate: string;
  endDate: string;
  background?: boolean;
}

interface HistoryToQueueResponse {
  result: string;
  stats?: HistoryImportResult;
  historyImport?: ConnectionHistoryStatusProjection;
}

/**
 * Add to the workout queue the workouts of a user for a selected date range
 */
export const addSuuntoAppHistoryToQueue = onCall({
  region: FUNCTIONS_MANIFEST.addSuuntoAppHistoryToQueue.region,
  secrets: FUNCTION_SECRET_BINDINGS.addSuuntoAppHistoryToQueue,
  cors: ALLOWED_CORS_ORIGINS,
  memory: '512MiB',
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
  if (!(await hasProAccess(userID))) {
    logger.warn(`Blocking history import for non-pro user ${userID}`);
    throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }

  const { startDate: startDateStr, endDate: endDateStr, background } = (request.data ?? {}) as HistoryToQueueRequest;
  if (background !== undefined && typeof background !== 'boolean') throw new HttpsError('invalid-argument', 'background must be a boolean.');
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  if (!startDate || isNaN(startDate.getTime()) || !endDate || isNaN(endDate.getTime())) {
    throw new HttpsError('invalid-argument', 'No start and/or end date');
  }

  if (startDate > endDate) {
    throw new HttpsError('invalid-argument', 'Start date is after the end date');
  }

  if (background === true) {
    const { startManualActivityHistory } = await import('../connection-history/manual-activity');
    const historyImport = await startManualActivityHistory(userID, SERVICE_NAME, startDate, endDate);
    if (historyImport) return { result: 'History import accepted', historyImport };
  }

  // First check last history import
  const nextAllowedDate = await getNextAllowedHistoryImportDate(userID, SERVICE_NAME);
  if (nextAllowedDate && nextAllowedDate > new Date()) {
    logger.error(`User ${userID} tried todo history import for ${SERVICE_NAME} while not allowed. (Requested: ${startDate.toISOString()} - ${endDate.toISOString()}, Available on: ${nextAllowedDate.toISOString()})`);
    throw new HttpsError('permission-denied', `History import is not allowed until ${nextAllowedDate.toISOString()}`);
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
    if (e instanceof HistoryImportAdmissionError) {
      logger.info('[SuuntoHistoryImport] History admission was blocked.', { code: e.code });
      throw e;
    }
    if (e instanceof HistoryLifecycleChangedError) {
      logger.info('[SuuntoHistoryImport] History import is no longer active.');
      throw new HttpsError('failed-precondition', 'History import is no longer active. Please retry.');
    }
    if (e instanceof HttpsError && e.code === 'already-exists') {
      logger.info('[SuuntoHistoryImport] History import is already running.');
      throw e;
    }
    logger.error(e);
    throw new HttpsError('internal', e.message);
  }

  return { result: 'History items added to queue', stats };
});
