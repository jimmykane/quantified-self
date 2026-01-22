'use strict';

import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import { isProUser, PRO_REQUIRED_MESSAGE } from '../utils';
import { SERVICE_NAME } from './constants';
import { COROS_HISTORY_IMPORT_LIMIT_MONTHS } from '../shared/history-import.constants';
import { HistoryImportResult, addHistoryToQueue, isAllowedToDoHistoryImport } from '../history';
import { FUNCTIONS_MANIFEST } from '../../../src/shared/functions-manifest';

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
export const addCOROSAPIHistoryToQueue = functions
  .runWith({ memory: '256MB' })
  .region(FUNCTIONS_MANIFEST.addCOROSAPIHistoryToQueue.region)
  .https.onCall(async (data: HistoryToQueueRequest, context): Promise<HistoryToQueueResponse> => {
    // App Check verification
    if (!context.app) {
      throw new functions.https.HttpsError('failed-precondition', 'App Check verification failed.');
    }

    // Auth verification
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const userID = context.auth.uid;

    // Enforce Pro Access
    if (!(await isProUser(userID))) {
      logger.warn(`Blocking history import for non-pro user ${userID}`);
      throw new functions.https.HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
    }

    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);

    if (!startDate || isNaN(startDate.getTime()) || !endDate || isNaN(endDate.getTime())) {
      throw new functions.https.HttpsError('invalid-argument', 'No start and/or end date');
    }

    if (startDate > endDate) {
      throw new functions.https.HttpsError('invalid-argument', 'Start date is after the end date');
    }

    // COROS V2 API Restriction: No data older than 3 months
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - COROS_HISTORY_IMPORT_LIMIT_MONTHS);
    threeMonthsAgo.setHours(0, 0, 0, 0);

    if (endDate < threeMonthsAgo) {
      logger.warn(`User ${userID} requested COROS history older than ${COROS_HISTORY_IMPORT_LIMIT_MONTHS} months (end date ${endDate}). Rejected.`);
      throw new functions.https.HttpsError(
        'invalid-argument',
        `COROS API limits history to the last ${COROS_HISTORY_IMPORT_LIMIT_MONTHS} months.`
      );
    }

    if (startDate < threeMonthsAgo) {
      logger.info(`Clamping COROS history start date from ${startDate} to ${threeMonthsAgo} for user ${userID}`);
      startDate.setTime(threeMonthsAgo.getTime());
    }

    // First check last history import
    if (!(await isAllowedToDoHistoryImport(userID, SERVICE_NAME))) {
      logger.error(`User ${userID} tried todo history import while not allowed`);
      throw new functions.https.HttpsError('permission-denied', 'History import is not allowed');
    }

    // We need to break down the requests to multiple of 30 days max. 2592000000ms
    const maxDeltaInMS = 2592000000;
    const batchCount = Math.ceil((+endDate - +startDate) / maxDeltaInMS);

    const totalStats: HistoryImportResult = {
      successCount: 0,
      failureCount: 0,
      processedBatches: 0,
      failedBatches: 0,
    };

    for (let i = 0; i < batchCount; i++) {
      const batchStartDate = new Date(startDate.getTime() + (i * maxDeltaInMS));
      const batchEndDate = batchStartDate.getTime() + (maxDeltaInMS) >= endDate.getTime() ?
        endDate :
        new Date(batchStartDate.getTime() + maxDeltaInMS);

      try {
        const stats = await addHistoryToQueue(userID, SERVICE_NAME, batchStartDate, batchEndDate);

        totalStats.successCount += stats.successCount;
        totalStats.failureCount += stats.failureCount;
        totalStats.processedBatches += stats.processedBatches;
        totalStats.failedBatches += stats.failedBatches;

        if (stats.successCount === 0 && stats.failureCount > 0) {
          throw new Error(`Failed to import all ${stats.failureCount} items in batch.`);
        }

        if (stats.failureCount > 0) {
          logger.warn(`Partial import success in batch: ${stats.successCount} imported, ${stats.failureCount} failed.`);
        }
      } catch (e: any) {
        logger.error(e);
        throw new functions.https.HttpsError('internal', e.message);
      }
    }

    return { result: 'History items added to queue', stats: totalStats };
  });
