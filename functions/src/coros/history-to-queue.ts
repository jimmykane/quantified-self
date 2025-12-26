'use strict';

import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import {
  getUserIDFromFirebaseToken,
  isCorsAllowed,
  setAccessControlHeadersOnResponse,
} from '../utils';
import { SERVICE_NAME } from './constants';
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


  const startDate = new Date(req.body.startDate);
  const endDate = new Date(req.body.endDate);

  if (!startDate || isNaN(startDate.getTime()) || !endDate || isNaN(endDate.getTime())) {
    res.status(500).send('No start and/or end date');
    return;
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
