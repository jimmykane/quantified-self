'use strict';

import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import { config } from '../config';
import * as admin from 'firebase-admin';
import * as requestPromise from '../request-helper';
import { getTokenData } from '../tokens';
import { getUserIDFromFirebaseToken, isCorsAllowed, setAccessControlHeadersOnResponse } from '../utils';
import { SERVICE_NAME } from './constants';


/**
 * Uploads an activity to Suunto app
 */
export const importActivityToSuuntoApp = functions.region('europe-west2').https.onRequest(async (req, res) => {
  logger.info('START importActivityToSuuntoApp v_POLLING_FIX_1765906212');
  // Directly set the CORS header
  if (!isCorsAllowed(req) || (req.method !== 'OPTIONS' && req.method !== 'POST')) {
    logger.error(`Not allowed. Origin: ${req.get('origin')}, Method: ${req.method}`);
    res.status(403);
    res.send('Unauthorized');
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

  if (!req.body) {
    logger.error('No file provided\'');
    res.status(500);
    res.send();
    return;
  }

  // Debugging file content
  const isBuffer = Buffer.isBuffer(req.rawBody);
  const size = isBuffer ? req.rawBody.length : 0;
  logger.info(`Received upload request. rawBody isBuffer=${isBuffer}, size=${size} bytes`);

  if (!isBuffer || size === 0) {
    logger.error('File content is empty or not a buffer');
    res.status(400).send('File content missing or invalid');
    return;
  }

  const tokenQuerySnapshots = await admin.firestore().collection('suuntoAppAccessTokens').doc(userID).collection('tokens').get();
  logger.info(`Found ${tokenQuerySnapshots.size} tokens for user ${userID}`);

  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {
    let serviceToken;
    try {
      serviceToken = await getTokenData(tokenQueryDocumentSnapshot, SERVICE_NAME, false);
    } catch (e: any) {
      logger.error(`Refreshing token failed skipping this token with id ${tokenQueryDocumentSnapshot.id}`);
      res.status(500);
      res.send(e.name);
      return;
    }

    // Initialize the upload
    let result: any;
    try {
      result = await requestPromise.post({
        headers: {
          'Authorization': serviceToken.accessToken,
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
          'json': true,
        },
        body: JSON.stringify({
          // description: "#qs",
          // comment: "",
          notifyUser: true,
        }),
        url: 'https://cloudapi.suunto.com/v2/upload/',
      });
      result = JSON.parse(result);
    } catch (e: any) {
      logger.error(`Could not init activity upload for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`, e);
      res.status(500);
      res.send(e.name);
      return;
    }

    const url = result.url;
    const uploadId = result.id;
    logger.info(`Init response for user ${userID}: url=${url}, id=${uploadId}, headers=${JSON.stringify(result.headers)}`);

    try {
      // Perform the binary upload to the Azure Blob Storage URL provided by Suunto
      // We must use the headers provided by the init-upload response to match the signed URL signature
      result = await requestPromise.put({
        headers: result.headers || {},
        json: false,
        url,
        body: req.rawBody,
      });
      logger.info(`PUT response for user ${userID}: ${JSON.stringify(result)}`);
    } catch (e: any) {
      logger.error(`Could not upload activity for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`, e);
      res.status(500);
      res.send(e.message);
      return;
    }

    // Check the upload status
    // Check the upload status with polling
    let status = 'NEW';
    let attempts = 0;
    const maxAttempts = 10; // 20 seconds total wait

    while ((status === 'NEW' || status === 'ACCEPTED') && attempts < maxAttempts) {
      attempts++;
      // Wait 2 seconds before checking (skip wait on first attempt if you prefer, but usually good to wait after upload)
      await new Promise(resolve => setTimeout(resolve, 2000));

      try {
        const statusResponse = await requestPromise.get({
          headers: {
            'Authorization': serviceToken.accessToken,
            'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
          },
          url: `https://cloudapi.suunto.com/v2/upload/${uploadId}`,
        });

        const statusJson = JSON.parse(statusResponse);
        status = statusJson.status;
        logger.info(`Upload status (attempt ${attempts}/${maxAttempts}) for user ${userID}, id ${uploadId}: ${status}`, statusJson);

        if (status === 'PROCESSED') {
          logger.info(`Successfully processed activity for user ${userID}. WorkoutKey: ${statusJson.workoutKey}`);
          break;
        } else if (status === 'ERROR') {
          logger.error(`Suunto processing failed for user ${userID}: ${statusJson.message}`);
          // We might want to throw here or just log and exit
        }
      } catch (e: any) {
        logger.error(`Could not check upload status for ${uploadId} for user ${userID} (attempt ${attempts})`, e);
      }
    }

    if (result && result.error) {
      logger.error(`Could not upload activity for token ${tokenQueryDocumentSnapshot.id} for user ${userID} due to service error`, result.error);
      res.status(500);
      res.send(result.error);
      return;
    }
  }
  res.status(200);
  res.send();
});
