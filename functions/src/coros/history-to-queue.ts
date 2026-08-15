'use strict';

import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import { SERVICE_NAME } from './constants';
import { COROS_HISTORY_IMPORT_LIMIT_MONTHS } from '../../../shared/history-import.constants';
import { HistoryImportResult, addHistoryToQueue, getNextAllowedHistoryImportDate } from '../history';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import { getActiveCOROSTokenSnapshot } from './account';
import { isServiceUnavailableForSyncForUser } from '../service-connection-meta';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';
import {
  addUTCCalendarDays,
  chunkCOROSInclusiveDateRange,
  parseCOROSCalendarDate,
  subtractUTCMonthsClamped,
} from './date-range';

interface HistoryToQueueRequest {
  startDate: string;
  endDate: string;
}

interface HistoryToQueueResponse {
  result: string;
  stats?: HistoryImportResult;
}

function toHistoryCallableError(error: unknown): functions.https.HttpsError {
  const code = `${(error as { code?: unknown } | null)?.code || ''}`.replace(/^functions\//, '');
  if (code === 'unauthenticated') {
    return new functions.https.HttpsError('unauthenticated', 'Reconnect COROS before importing history.');
  }
  if (code === 'failed-precondition') {
    return new functions.https.HttpsError('failed-precondition', 'COROS history import cannot continue for this account.');
  }
  if (code === 'unavailable' || code === 'resource-exhausted') {
    return new functions.https.HttpsError('unavailable', 'COROS history is temporarily unavailable. Please retry.');
  }
  return new functions.https.HttpsError('internal', 'Could not import COROS history. Please retry.');
}

async function assertCOROSHistoryAllowed(userID: string, phase: string): Promise<void> {
  try {
    const deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
    if (deletionGuard.shouldSkip) {
      throw new functions.https.HttpsError('failed-precondition', 'Account is being deleted or no longer exists.');
    }
    if (await isServiceUnavailableForSyncForUser(userID, SERVICE_NAME)) {
      throw new functions.https.HttpsError('failed-precondition', 'Reconnect COROS before importing history.');
    }
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    logger.warn('[COROSHistoryImport] Could not verify account lifecycle state.', {
      userID,
      phase,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    throw new functions.https.HttpsError('unavailable', 'Could not verify account state. Please retry.');
  }
}

/**
 * Add to the workout queue the workouts of a user for a selected date range
 */
export const addCOROSAPIHistoryToQueue = functions
  .runWith({
    memory: '256MB',
    timeoutSeconds: 300,
    secrets: FUNCTION_SECRET_BINDINGS.addCOROSAPIHistoryToQueue,
  })
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
    if (!(await hasProAccess(userID))) {
      logger.warn(`Blocking history import for non-pro user ${userID}`);
      throw new functions.https.HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
    }

    let startDate = parseCOROSCalendarDate(data?.startDate);
    const endDate = parseCOROSCalendarDate(data?.endDate);

    if (!startDate || !endDate) {
      throw new functions.https.HttpsError('invalid-argument', 'No start and/or end date');
    }

    if (startDate > endDate) {
      throw new functions.https.HttpsError('invalid-argument', 'Start date is after the end date');
    }

    // COROS V2 API Restriction: No data older than 3 months
    const todayUTC = parseCOROSCalendarDate(Date.now())!;
    // The client submits a local calendar date without an offset. Permit one
    // day beyond UTC for users whose local calendar has already rolled over,
    // while keeping the number of provider windows strictly bounded.
    const latestAllowedEndDate = addUTCCalendarDays(todayUTC, 1);
    if (endDate > latestAllowedEndDate) {
      throw new functions.https.HttpsError('invalid-argument', 'End date is too far in the future.');
    }
    const threeMonthsAgo = subtractUTCMonthsClamped(todayUTC, COROS_HISTORY_IMPORT_LIMIT_MONTHS);

    if (endDate < threeMonthsAgo) {
      logger.warn(`User ${userID} requested COROS history older than ${COROS_HISTORY_IMPORT_LIMIT_MONTHS} months (end date ${endDate}). Rejected.`);
      throw new functions.https.HttpsError(
        'invalid-argument',
        `COROS API limits history to the last ${COROS_HISTORY_IMPORT_LIMIT_MONTHS} months.`
      );
    }

    if (startDate < threeMonthsAgo) {
      logger.info(`Clamping COROS history start date from ${startDate} to ${threeMonthsAgo} for user ${userID}`);
      startDate = threeMonthsAgo;
    }

    // First check last history import
    const nextAllowedDate = await getNextAllowedHistoryImportDate(userID, SERVICE_NAME);
    if (nextAllowedDate && nextAllowedDate > new Date()) {
      logger.error(`User ${userID} tried todo history import for ${SERVICE_NAME} while not allowed. (Requested: ${startDate.toISOString()} - ${endDate.toISOString()}, Available on: ${nextAllowedDate.toISOString()})`);
      throw new functions.https.HttpsError('permission-denied', `History import is not allowed until ${nextAllowedDate.toISOString()}`);
    }

    const dateWindows = chunkCOROSInclusiveDateRange(startDate, endDate);

    const totalStats: HistoryImportResult = {
      successCount: 0,
      failureCount: 0,
      processedBatches: 0,
      failedBatches: 0,
    };
    await assertCOROSHistoryAllowed(userID, 'before_account_lookup');
    let expectedProviderUserId: string;
    try {
      expectedProviderUserId = (await getActiveCOROSTokenSnapshot(userID)).id;
    } catch (error) {
      logger.warn('[COROSHistoryImport] Could not resolve the active account.', {
        userID,
        errorName: error instanceof Error ? error.name : typeof error,
        code: (error as { code?: unknown } | null)?.code,
      });
      throw toHistoryCallableError(error);
    }

    for (let i = 0; i < dateWindows.length; i++) {
      const { startDate: batchStartDate, endDate: batchEndDate } = dateWindows[i];

      try {
        await assertCOROSHistoryAllowed(userID, 'before_provider_request');
        const stats = await addHistoryToQueue(userID, SERVICE_NAME, batchStartDate, batchEndDate, {
          expectedProviderUserId,
          cumulativeMetadata: {
            startDate,
            endDate: batchEndDate,
            processedActivitiesCountOffset: totalStats.successCount,
          },
        });

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
        logger.error('[COROSHistoryImport] Failed to queue a history window.', {
          userID,
          providerUserId: expectedProviderUserId,
          batchIndex: i,
          errorName: e instanceof Error ? e.name : typeof e,
          code: e?.code,
          statusCode: Number.isFinite(Number(e?.statusCode)) ? Number(e.statusCode) : undefined,
        });
        throw toHistoryCallableError(e);
      }
    }

    return { result: 'History items added to queue', stats: totalStats };
  });
