'use strict';

import * as logger from 'firebase-functions/logger';
import { config } from '../config';
import * as admin from 'firebase-admin';
import * as requestPromise from '../request-helper';
import { executeWithTokenRetry } from './retry-helper';
import { isProUser, PRO_REQUIRED_MESSAGE } from '../utils';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from './constants';



/**
 * Uploads an activity to Suunto app
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../src/shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';

/**
 * Uploads an activity to Suunto app
 */
export const importActivityToSuuntoApp = onCall({
  region: FUNCTIONS_MANIFEST.importActivityToSuuntoApp.region,
  cors: ALLOWED_CORS_ORIGINS,
  timeoutSeconds: 300,
  maxInstances: 10,
}, async (request) => {
  logger.info('START importActivityToSuuntoApp v_POLLING_FIX_1765906212');

  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  enforceAppCheck(request);

  const userID = request.auth.uid;

  if (!(await isProUser(userID))) {
    logger.warn(`Blocking activity upload for non-pro user ${userID}`);
    throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }

  const base64File = request.data.file;

  if (!base64File) {
    logger.error('No file provided');
    throw new HttpsError('invalid-argument', 'File content missing');
  }

  const fileBuffer = Buffer.from(base64File, 'base64');
  const size = fileBuffer.length;
  logger.info(`Received upload request. size=${size} bytes`);

  if (size === 0) {
    logger.error('File content is empty');
    throw new HttpsError('invalid-argument', 'File content is empty');
  }

  const tokenQuerySnapshots = await admin.firestore().collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME).doc(userID).collection('tokens').get();
  logger.info(`Found ${tokenQuerySnapshots.size} tokens for user ${userID}`);

  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {
    try {
      const result = await executeWithTokenRetry(
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
              },
              json: true,
              body: {
                // description: "#qs",
                // comment: "",
                notifyUser: true,
              },
              url: 'https://cloudapi.suunto.com/v2/upload/',
            });
            // Result is already parsed because json: true
          } catch (e: any) {
            // Start logging and rethrowing for retry-helper to catch matching 401s
            logger.error(`Could not init activity upload for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`, e);
            throw e;
          }

          if (!result || !result.url || !result.id) {
            logger.error(`Invalid init response from Suunto for user ${userID}`, result);
            throw new HttpsError('internal', 'Invalid response from Suunto initialization.');
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
              body: fileBuffer,
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
                json: true,
                url: `https://cloudapi.suunto.com/v2/upload/${uploadId}`,
              });

              // Response is already parsed
              const statusJson = statusResponse;

              if (!statusJson || !statusJson.status) {
                logger.warn(`Missing status in response for user ${userID}, id ${uploadId}:`, statusJson);
                // We don't throw immediately, we let it retry unless it's critical, but here status is undefined so we might want to wait or fail.
                // Let's assume 'NEW' if missing to keep retrying, or error. safer to error or warn.
                // If status is undefined, the loop condition (status === 'NEW'...) might break or continue depending on logic.
                // status will be undefined. undefined !== 'PROCESSED'. 
                // status === undefined.
              }

              status = statusJson?.status;
              logger.info(`Upload status (attempt ${attempts}/${maxAttempts}) for user ${userID}, id ${uploadId}: ${status}`, statusJson);

              if (status === 'PROCESSED') {
                logger.info(`Successfully processed activity for user ${userID}. WorkoutKey: ${statusJson.workoutKey}`);
                return { status: 'success', message: 'Activity uploaded to Suunto', workoutKey: statusJson.workoutKey };
              } else if (status === 'ERROR') {
                if (statusJson.message === 'Already exists') {
                  logger.info(`Activity already exists in Suunto for user ${userID}.`);
                  return { status: 'info', code: 'ALREADY_EXISTS', message: 'Activity already exists in Suunto' };
                }
                throw new HttpsError('internal', `Suunto processing failed: ${statusJson.message}`);
              }
            } catch (e: unknown) {
              const errorMessage = e instanceof Error ? e.message : String(e);
              logger.error(`Could not check upload status for ${uploadId} for user ${userID} (attempt ${attempts})`, errorMessage);
              throw e;
            }
          }

          if (status !== 'PROCESSED') {
            throw new HttpsError('deadline-exceeded', `Upload timed out or failed with status ${status}`);
          }
          // Shouldn't reach here as PROCESSED is handled in the loop
          return { status: 'success' };
        },
        `Upload activity for user ${userID}`
      );
      // Return the result from the callback (including ALREADY_EXISTS)
      if (result) {
        if (result.status === 'success') {
          try {
            const SERVICE_NAME = (await import('./constants')).SERVICE_NAME;
            const userServiceMetaDocumentSnapshot = admin.firestore().collection('users').doc(userID).collection('meta').doc(SERVICE_NAME);
            await userServiceMetaDocumentSnapshot.set({
              uploadedActivitiesCount: admin.firestore.FieldValue.increment(1),
            }, { merge: true });
          } catch (e: unknown) {
            logger.error('Could not update uploadedActivities count', e);
          }
        }
        return result;
      }
    } catch (e: unknown) {
      // Final catch after retries failed
      logger.error(`Failed to handle activity upload for token ${tokenQueryDocumentSnapshot.id}`, e);
      // We throw a standardized error if everything fails, or we could handle partial failures if we looped multiple tokens (but here we just iterate).
      // Since standard HttpsError is required for onCall:
      throw new HttpsError('internal', (e as Error).message);
    }
  }
  return { status: 'success' };
});
