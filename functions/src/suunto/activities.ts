'use strict';

import * as logger from 'firebase-functions/logger';
import { config } from '../config';
import * as admin from 'firebase-admin';
import * as requestPromise from '../request-helper';
import { executeWithTokenRetry } from './retry-helper';
import { hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from './constants';



/**
 * Uploads an activity to Suunto app
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../src/shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';

const SUUNTO_TRANSIENT_STATUS_CODES = new Set([500, 502, 503, 504]);
const SUUNTO_MAX_TRANSIENT_RETRIES = 2;
const SUUNTO_TRANSIENT_BACKOFF_MS = 1000;

function getStatusCode(error: unknown): number | undefined {
  return typeof (error as any)?.statusCode === 'number' ? (error as any).statusCode : undefined;
}

function isRetryableSuuntoTransientError(error: unknown): boolean {
  const statusCode = getStatusCode(error);
  return statusCode !== undefined && SUUNTO_TRANSIENT_STATUS_CODES.has(statusCode);
}

function isSuuntoUpstreamFailure(statusCode: number | undefined): boolean {
  return statusCode !== undefined && statusCode >= 500 && statusCode < 600;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withSuuntoTransientRetry<T>(
  operationName: string,
  operation: () => Promise<T>
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= SUUNTO_MAX_TRANSIENT_RETRIES) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;
      attempt++;

      if (!isRetryableSuuntoTransientError(error) || attempt > SUUNTO_MAX_TRANSIENT_RETRIES) {
        throw error;
      }

      const statusCode = getStatusCode(error);
      logger.warn(`${operationName} failed with transient status ${statusCode}. Retrying attempt ${attempt}/${SUUNTO_MAX_TRANSIENT_RETRIES}.`);
      await sleep(SUUNTO_TRANSIENT_BACKOFF_MS * attempt);
    }
  }

  throw lastError;
}

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

  if (!(await hasProAccess(userID))) {
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
            result = await withSuuntoTransientRetry(
              `Init activity upload for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`,
              async () => requestPromise.post({
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
              })
            );
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
            result = await withSuuntoTransientRetry(
              `Upload activity blob for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`,
              async () => requestPromise.put({
                headers: result.headers || {},
                json: false,
                url,
                body: fileBuffer,
              })
            );
            logger.info(`PUT response for user ${userID}: ${JSON.stringify(result)}`);
          } catch (e: any) {
            logger.error(`Could not upload activity for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`, e);
            throw e;
          }

          // Check the upload status with polling
          let status = 'NEW';
          let attempts = 0;
          const maxAttempts = 10; // 20 seconds total wait

          while (attempts < maxAttempts) {
            attempts++;
            // Wait 2 seconds before checking
            await new Promise(resolve => setTimeout(resolve, 2000));

            try {
              const statusResponse = await withSuuntoTransientRetry(
                `Check upload status for ${uploadId} for user ${userID}`,
                async () => requestPromise.get({
                  headers: {
                    'Authorization': accessToken,
                    'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
                  },
                  json: true,
                  url: `https://cloudapi.suunto.com/v2/upload/${uploadId}`,
                })
              );

              // Response is already parsed
              const statusJson = statusResponse;

              if (!statusJson || !statusJson.status) {
                logger.warn(`Missing status in response for user ${userID}, id ${uploadId}:`, statusJson);
                // Continue polling if status is missing
                continue;
              }

              // Check for "Already exists" before logging generic status to avoid "ERROR" noise
              if (statusJson.status === 'ERROR' && statusJson.message === 'Already exists') {
                logger.info(`Activity already exists in Suunto for user ${userID}.`);
                return { status: 'info', code: 'ALREADY_EXISTS', message: 'Activity already exists in Suunto' };
              }

              status = statusJson.status;
              logger.info(`Upload status (attempt ${attempts}/${maxAttempts}) for user ${userID}, id ${uploadId}: ${status}`, statusJson);

              if (status === 'PROCESSED') {
                logger.info(`Successfully processed activity for user ${userID}. WorkoutKey: ${statusJson.workoutKey}`);
                return { status: 'success', message: 'Activity uploaded to Suunto', workoutKey: statusJson.workoutKey };
              } else if (status === 'ERROR') {
                // The "Already exists" case is handled above
                throw new HttpsError('internal', `Suunto processing failed: ${statusJson.message}`);
              } else if (status === 'NEW' || status === 'ACCEPTED') {
                // Continue polling
                continue;
              } else {
                logger.warn(`Unknown status ${status} for user ${userID}, id ${uploadId}`);
                // Continue polling on unknown status? Or fail? Best to continue for now.
                continue;
              }
            } catch (e: unknown) {
              if (isRetryableSuuntoTransientError(e) && attempts < maxAttempts) {
                logger.warn(`Transient upload status error for ${uploadId} for user ${userID} (attempt ${attempts}/${maxAttempts}). Continuing polling.`, {
                  statusCode: getStatusCode(e),
                });
                continue;
              }

              const errorMessage = e instanceof Error ? e.message : String(e);
              logger.error(`Could not check upload status for ${uploadId} for user ${userID} (attempt ${attempts})`, errorMessage);
              throw e;
            }
          }

          throw new HttpsError('deadline-exceeded', `Upload timed out or failed with status ${status}`);
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
      const isHttpsError = e instanceof HttpsError;
      const code = isHttpsError ? e.code : 'internal';
      const statusCode = typeof (e as any)?.statusCode === 'number' ? (e as any).statusCode : undefined;
      const message = e instanceof Error ? e.message : String(e);

      logger.error('Failed to handle activity upload for token', {
        tokenId: tokenQueryDocumentSnapshot.id,
        userID,
        isHttpsError,
        code,
        statusCode,
        message,
      });

      if (isHttpsError) {
        throw e;
      }

      if (statusCode === 401) {
        throw new HttpsError('unauthenticated', 'Authentication failed. Please re-connect your Suunto account.');
      }

      if (isSuuntoUpstreamFailure(statusCode)) {
        throw new HttpsError('unavailable', 'Suunto activity upload is temporarily unavailable. Please retry.');
      }

      throw new HttpsError('internal', message);
    }
  }
  return { status: 'success' };
});
