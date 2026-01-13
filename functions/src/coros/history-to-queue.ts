'use strict';

import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import {
  getUserIDFromFirebaseToken,
  isCorsAllowed,
  setAccessControlHeadersOnResponse,
  isProUser,
  PRO_REQUIRED_MESSAGE,
} from '../utils';
import { SERVICE_NAME } from './constants';
import { COROS_HISTORY_IMPORT_LIMIT_MONTHS } from '../shared/history-import.constants';
import { addHistoryToQueue, isAllowedToDoHistoryImport } from '../history';


/**
 * Add to the workout queue the workouts of a user for a selected date range
 */
export const addCOROSAPIHistoryToQueue = functions.region('europe-west2').https.onRequest(async (req, res) => {
  // Directly set the CORS header
  if (!isCorsAllowed(req) || (req.method !== 'OPTIONS' && req.method !== 'POST')) {
    logger.error('Not allowed');
    res.status(403);
    res.send();
    return;
  }

  setAccessControlHeadersOnResponse(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200);
    res.send();
    return;
  }

  const userID = await getUserIDFromFirebaseToken(req);
  if (!userID) {
    res.status(403).send('Unauthorized');
    return;
  }

  if (!(await isProUser(userID))) {
    logger.warn(`Blocking history import for non-pro user ${userID}`);
    res.status(403).send(PRO_REQUIRED_MESSAGE);
    return;
  }


  const startDate = new Date(req.body.startDate);
  const endDate = new Date(req.body.endDate);

  if (!startDate || isNaN(startDate.getTime()) || !endDate || isNaN(endDate.getTime())) {
    res.status(500).send('No start and/or end date');
    return;
  }

  // COROS V2 API Restriction: No data older than 3 months
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - COROS_HISTORY_IMPORT_LIMIT_MONTHS);
  threeMonthsAgo.setHours(0, 0, 0, 0);

  if (endDate < threeMonthsAgo) {
    logger.warn(`User ${userID} requested COROS history older than ${COROS_HISTORY_IMPORT_LIMIT_MONTHS} months (end date ${endDate}). Rejected.`);
    res.status(400).send(`COROS API limits history to the last ${COROS_HISTORY_IMPORT_LIMIT_MONTHS} months.`);
    return;
  }

  if (startDate < threeMonthsAgo) {
    logger.info(`Clamping COROS history start date from ${startDate} to ${threeMonthsAgo} for user ${userID}`);
    startDate.setTime(threeMonthsAgo.getTime());
  }

  // First check last history import
  // First check last history import
  if (!(await isAllowedToDoHistoryImport(userID, SERVICE_NAME))) {
    logger.error(`User ${userID} tried todo history import while not allowed`);
    res.status(403);
    res.send('History import is not allowed');
    return;
  }

  // We need to break down the requests to multiple of 30 days max. 2592000000ms
  const maxDeltaInMS = 2592000000;
  const batchCount = Math.ceil((+endDate - +startDate) / maxDeltaInMS);

  for (let i = 0; i < batchCount; i++) {
    const batchStartDate = new Date(startDate.getTime() + (i * maxDeltaInMS));
    const batchEndDate = batchStartDate.getTime() + (maxDeltaInMS) >= endDate.getTime() ?
      endDate :
      new Date(batchStartDate.getTime() + maxDeltaInMS);

    try {
      await addHistoryToQueue(userID, SERVICE_NAME, batchStartDate, batchEndDate);
    } catch (e: any) {
      logger.error(e);
      res.status(500).send(e.message);
      return;
    }
  }
  // Respond
  res.status(200);
  res.send({ result: 'History items added to queue' });
});
