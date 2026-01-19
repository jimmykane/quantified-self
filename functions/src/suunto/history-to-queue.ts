'use strict';

import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import { isProUser, PRO_REQUIRED_MESSAGE } from '../utils';
import { SERVICE_NAME } from './constants';
import { addHistoryToQueue, isAllowedToDoHistoryImport } from '../history';
import { FUNCTIONS_MANIFEST } from '../../../src/shared/functions-manifest';


interface HistoryToQueueRequest {
  startDate: string;
  endDate: string;
}

interface HistoryToQueueResponse {
  result: string;
}

/**
 * Add to the workout queue the workouts of a user for a selected date range
 */
export const addSuuntoAppHistoryToQueue = functions
  .runWith({ memory: '256MB' })
  .region(FUNCTIONS_MANIFEST.addSuuntoAppHistoryToQueue.region)
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

    // First check last history import
    if (!(await isAllowedToDoHistoryImport(userID, SERVICE_NAME))) {
      logger.error(`User ${userID} tried todo history import while not allowed`);
      throw new functions.https.HttpsError('permission-denied', 'History import is not allowed');
    }

    try {
      await addHistoryToQueue(userID, SERVICE_NAME, startDate, endDate);
    } catch (e: any) {
      logger.error(e);
      throw new functions.https.HttpsError('internal', e.message);
    }

    return { result: 'History items added to queue' };
  });
