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
import { addHistoryToQueue, isAllowedToDoHistoryImport } from '../history';

/**
 * Add to the workout queue the workouts of a user for a selected date range
 */
export const addSuuntoAppHistoryToQueue = functions.region('europe-west2').https.onRequest(async (req, res) => {
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

  // First check last history import
  if (!(await isAllowedToDoHistoryImport(userID, SERVICE_NAME))) {
    logger.error(`User ${userID} tried todo history import while not allowed`);
    res.status(403);
    res.send('History import is not allowed');
    return;
  }

  await addHistoryToQueue(userID, SERVICE_NAME, startDate, endDate);

  // Respond
  res.status(200);
  res.send({ result: 'History items added to queue' });
});
