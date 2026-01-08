'use strict';

import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import { config } from '../config';
import * as admin from 'firebase-admin';
import * as requestPromise from '../request-helper';
import { executeWithTokenRetry } from './retry-helper';
import { getUserIDFromFirebaseToken, isCorsAllowed, setAccessControlHeadersOnResponse, isProUser, PRO_REQUIRED_MESSAGE } from '../utils';
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

  if (!(await isProUser(userID))) {
    logger.warn(`Blocking activity upload for non-pro user ${userID}`);
    res.status(403).send(PRO_REQUIRED_MESSAGE);
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
    try {
      await executeWithTokenRetry(
        tokenQueryDocumentSnapshot,
        async (accessToken) => {
          // Initialize the upload
          let result: any;
          try {
            result = await requestPromise.post({
              headers: {
                'Authorization': accessToken,
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
            // Start logging and rethrowing for retry-helper to catch matching 401s
            logger.error(`Could not init activity upload for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`, e);
            throw e;
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
            throw e;
          }

          // Check the upload status with polling
          let status = 'NEW';
          let attempts = 0;
          const maxAttempts = 10; // 20 seconds total wait

          while ((status === 'NEW' || status === 'ACCEPTED') && attempts < maxAttempts) {
            attempts++;
            // Wait 2 seconds before checking
            await new Promise(resolve => setTimeout(resolve, 2000));

            try {
              const statusResponse = await requestPromise.get({
                headers: {
                  'Authorization': accessToken,
                  'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
                },
                url: `https://cloudapi.suunto.com/v2/upload/${uploadId}`,
              });

              const statusJson = JSON.parse(statusResponse);
              status = statusJson.status;
              logger.info(`Upload status (attempt ${attempts}/${maxAttempts}) for user ${userID}, id ${uploadId}: ${status}`, statusJson);

              if (status === 'PROCESSED') {
                logger.info(`Successfully processed activity for user ${userID}. WorkoutKey: ${statusJson.workoutKey}`);
                return; // Success
              } else if (status === 'ERROR') {
                throw new Error(`Suunto processing failed: ${statusJson.message}`);
              }
            } catch (e: any) {
              logger.error(`Could not check upload status for ${uploadId} for user ${userID} (attempt ${attempts})`, e);
              // If it's a 401 during polling, throwing allows retry-helper to refresh and restart the WHOLE process.
              // If it's unrelated, we might want to continue polling?
              // But requestPromise throws on error status.
              // If we throw here, the while loop exits and retry-helper catches it.
              throw e;
            }
          }

          if (status !== 'PROCESSED') {
            throw new Error(`Upload timed out or failed with status ${status}`);
          }
        },
        `Upload activity for user ${userID}`
      );
    } catch (e: unknown) {
      // Final catch after retries failed
      logger.error(`Failed to handle activity upload for token ${tokenQueryDocumentSnapshot.id}`, e);
      // Continue to next token, but maybe return 500 if all fail? 
      // Original code returned 500 immediately on error. 
      // We should probably accumulate errors or return 500 if ALL fail.
      // Original code: `return` immediately on error.
      // Let's stick to original behavior: if one token fails completely, return 500.
      // Wait, original: loop continues if `getTokenData` fails. But if `requestPromise` fails, it does `res.status(500); return;`.
      // So it stops on first API failure.
      res.status(500);
      res.send((e as Error).message);
      return;
    }
  }
  res.status(200);
  res.send();
});
