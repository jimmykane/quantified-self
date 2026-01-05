'use strict';

import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import * as requestPromise from '../request-helper';
import { getTokenData } from '../tokens';
import { isCorsAllowed, setAccessControlHeadersOnResponse } from '../utils';
import { SERVICE_NAME } from './constants';
import { config } from '../config';

/**
 * Downloads the original file
 */
export const getSuuntoFITFile = functions.region('europe-west2').https.onRequest(async (req, res) => {
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

  if (!req.headers.authorization) {
    logger.error('No authorization\'');
    res.status(403);
    res.send();
    return;
  }

  if (!req.body.workoutID || !req.body.userName) {
    logger.error('No \'workoutID\' or \'userName\' provided');
    res.status(500);
    res.send();
    return;
  }

  let decodedIdToken;
  try {
    decodedIdToken = await admin.auth().verifyIdToken(req.headers.authorization);
  } catch (e: any) {
    logger.error(e);
    logger.error('Could not verify user token aborting operation');
    res.status(500);
    res.send();
    return;
  }

  if (!decodedIdToken) {
    logger.error('Could not verify and decode token');
    res.status(500);
    res.send();
    return;
  }

  const tokenQuerySnapshots = await admin.firestore().collection('suuntoAppAccessTokens').doc(decodedIdToken.uid).collection('tokens').get();
  logger.info(`Found ${tokenQuerySnapshots.size} tokens for user ${decodedIdToken.uid}`);

  let serviceTokenToUse;
  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {
    let serviceToken;
    try {
      serviceToken = await getTokenData(tokenQueryDocumentSnapshot, SERVICE_NAME, false);
    } catch (e: any) {
      logger.error(`Refreshing token failed skipping this token with id ${tokenQueryDocumentSnapshot.id}`);
      res.status(500);
      res.send();
      return;
    }
    // Only download for the specific user
    if (serviceToken.userName === req.body.userName) {
      serviceTokenToUse = serviceToken;
    }
  }

  if (!serviceTokenToUse) {
    logger.info('No service token for this userName and workoutID found');
    res.status(404);
    res.send();
    return;
  }

  let result;
  try {
    logger.info('Starting timer: GetFIT');
    result = await requestPromise.get({
      headers: {
        'Authorization': serviceTokenToUse.accessToken,
        'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
      },
      encoding: null,
      // gzip: true,
      url: `https://cloudapi.suunto.com/v3/workouts/${req.body.workoutID}/fit`,
    });
    logger.info('Ending timer: GetFIT');
    logger.info(`Downloaded FIT file for ${req.body.workoutID} and token user ${serviceTokenToUse.userName}`);
  } catch (e: any) {
    if (e.statusCode === 403) {
      logger.error(new Error(`Could not get workout for ${req.body.workoutID} and token user ${serviceTokenToUse.userName} due to 403`));
    }
    if (e.statusCode === 500) {
      logger.error(new Error(`Could not get workout for ${req.body.workoutID} and token user ${serviceTokenToUse.userName} due to 403`));
    }
    logger.error(new Error(`Could not get workout for ${req.body.workoutID} and token user ${serviceTokenToUse.userName}.`));
    res.status(e.statusCode);
    res.send();
    return;
  }

  logger.info('Sending response');
  res.status(200);
  res.send(result);
});
