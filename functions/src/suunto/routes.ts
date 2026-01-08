'use strict';

import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import * as requestPromise from '../request-helper';
import { executeWithTokenRetry } from './retry-helper';
import { getUserIDFromFirebaseToken, isCorsAllowed, setAccessControlHeadersOnResponse, isProUser, PRO_REQUIRED_MESSAGE } from '../utils';
import * as zlib from 'zlib';
import { SERVICE_NAME } from './constants';
import { config } from '../config';


/**
 * Uploads a route to the Suunto app
 */
export const importRouteToSuuntoApp = functions.region('europe-west2').https.onRequest(async (req, res) => {
  // Directly set the CORS header
  if (!isCorsAllowed(req) || (req.method !== 'OPTIONS' && req.method !== 'POST')) {
    logger.error('Not allowed');
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
    logger.warn(`Blocking route upload for non-pro user ${userID}`);
    res.status(403).send(PRO_REQUIRED_MESSAGE);
    return;
  }

  let compressedData: Buffer;

  if (Buffer.isBuffer(req.rawBody)) {
    compressedData = req.rawBody;
  } else if (req.body && req.body.body) {
    compressedData = Buffer.from(req.body.body, 'base64');
  } else {
    logger.error('No compressed body found (checked rawBody and body.body)');
    res.status(400).send('No compressed body found');
    return;
  }

  const tokenQuerySnapshots = await admin.firestore().collection('suuntoAppAccessTokens').doc(userID).collection('tokens').get();
  logger.info(`Found ${tokenQuerySnapshots.size} tokens for user ${userID}`);

  let successCount = 0;
  let authFailures = 0;

  if (tokenQuerySnapshots.empty) {
    res.status(401).send('No connected Suunto account found');
    return;
  }

  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {
    let result: any;
    try {
      result = await executeWithTokenRetry(
        tokenQueryDocumentSnapshot,
        async (accessToken) => {
          const postResult = await requestPromise.post({
            headers: {
              'Authorization': accessToken,
              'Content-Type': 'application/gpx+xml',
              'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
              // json: true,
            },
            body: zlib.gunzipSync(compressedData).toString(),
            url: 'https://cloudapi.suunto.com/v2/route/import',
          });
          return postResult;
        },
        `Upload route for user ${userID}`
      );

      logger.info('Suunto API raw response:', result);
      if (typeof result === 'string') {
        try {
          result = JSON.parse(result);
        } catch (e) {
          logger.warn('Suunto API response is not JSON:', result);
        }
      }
    } catch (e: unknown) {
      const error = e as Error;
      // Logging handled in helper mostly, but we log high level failure
      logger.error(`Could not upload route for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`, error);
      // We count auth failures if "Unauthorized" / 401 bubbles up (meaning retry failed)
      if ((error as any).statusCode === 401) {
        authFailures++;
      }
      continue;
    }

    if (result.error) {
      logger.error(`Could upload route for token ${tokenQueryDocumentSnapshot.id} for user ${userID} due to service error`, result.error);
      continue;
    }
    try {
      const userServiceMetaDocumentSnapshot = await admin.firestore().collection('users').doc(userID).collection('meta').doc(SERVICE_NAME).get();
      const data = userServiceMetaDocumentSnapshot.data();
      let uploadedRoutesCount = 0;
      if (data) {
        uploadedRoutesCount = data.uploadedRoutesCount || uploadedRoutesCount;
      }
      await userServiceMetaDocumentSnapshot.ref.update({
        uploadedRoutesCount: uploadedRoutesCount + 1,
      });
      successCount++;
    } catch (e: unknown) {
      logger.error('Could not update uploadedRoutes count');
    }
  }

  if (successCount > 0) {
    res.status(200).send();
  } else if (authFailures > 0) {
    res.status(401).send('Authentication failed. Please re-connect your Suunto account.');
  } else {
    res.status(500).send('Upload failed due to service errors.');
  }
});
