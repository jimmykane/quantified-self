'use strict';

import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import * as requestPromise from '../request-helper';
import { executeWithTokenRetry } from './retry-helper';
import { isProUser, PRO_REQUIRED_MESSAGE } from '../utils';
import * as zlib from 'zlib';
import { SERVICE_NAME, SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from './constants';
import { config } from '../config';


/**
 * Uploads a route to the Suunto app
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../src/shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS } from '../utils';

/**
 * Uploads a route to the Suunto app
 */
export const importRouteToSuuntoApp = onCall({
  region: FUNCTIONS_MANIFEST.importRouteToSuuntoApp.region,
  cors: ALLOWED_CORS_ORIGINS,
  timeoutSeconds: 300,
  maxInstances: 10,
}, async (request) => {

  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  if (!request.app) {
    throw new HttpsError('failed-precondition', 'The function must be called from an App Check verified app.');
  }

  const userID = request.auth.uid;

  if (!(await isProUser(userID))) {
    logger.warn(`Blocking route upload for non-pro user ${userID}`);
    throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }

  const base64File = request.data.file;

  if (!base64File) {
    logger.error('No file provided');
    throw new HttpsError('invalid-argument', 'File content missing');
  }

  const compressedData = Buffer.from(base64File, 'base64');

  const tokenQuerySnapshots = await admin.firestore().collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME).doc(userID).collection('tokens').get();
  logger.info(`Found ${tokenQuerySnapshots.size} tokens for user ${userID}`);

  let successCount = 0;
  let authFailures = 0;

  if (tokenQuerySnapshots.empty) {
    throw new HttpsError('unauthenticated', 'No connected Suunto account found');
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
    return { status: 'success' };
  } else if (authFailures > 0) {
    throw new HttpsError('unauthenticated', 'Authentication failed. Please re-connect your Suunto account.');
  } else {
    throw new HttpsError('internal', 'Upload failed due to service errors.');
  }
});
