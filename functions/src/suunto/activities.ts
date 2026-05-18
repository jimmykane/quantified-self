'use strict';

import * as logger from 'firebase-functions/logger';
import { config } from '../config';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as requestPromise from '../request-helper';
import { executeWithTokenRetry } from './retry-helper';
import { hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from './constants';
import { toSuuntoAuthorizationHeader } from './authorization-header';



/**
 * Uploads an activity to Suunto app
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';

const SUUNTO_ALWAYS_TRANSIENT_STATUS_CODES = new Set([502, 503, 504]);
const SUUNTO_MAX_TRANSIENT_RETRIES = 2;
const SUUNTO_TRANSIENT_BACKOFF_MS = 1000;
const MAX_ACTIVITY_UPLOAD_BYTES = 20 * 1024 * 1024;
const SUUNTO_PERMANENT_500_MESSAGE_PATTERNS = [
  'unsupported',
  'invalid',
  'malformed',
  'corrupt',
  'format',
  'payload',
  'fit file',
];

function getStatusCode(error: unknown): number | undefined {
  return typeof (error as any)?.statusCode === 'number' ? (error as any).statusCode : undefined;
}

function getSuuntoErrorMessage(error: unknown): string | undefined {
  const errorPayload = (error as any)?.error;
  if (typeof errorPayload === 'string') {
    return errorPayload;
  }

  if (typeof errorPayload?.message === 'string') {
    return errorPayload.message;
  }

  if (typeof errorPayload?.error === 'string') {
    return errorPayload.error;
  }

  if (typeof errorPayload?.error_description === 'string') {
    return errorPayload.error_description;
  }

  return undefined;
}

function isLikelyPermanentSuunto500(error: unknown): boolean {
  const statusCode = getStatusCode(error);
  if (statusCode !== 500) {
    return false;
  }

  const message = getSuuntoErrorMessage(error)?.toLowerCase();
  if (!message) {
    return false;
  }

  return SUUNTO_PERMANENT_500_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
}

function isRetryableSuuntoTransientError(error: unknown, retryOnInternalServerError = false): boolean {
  const statusCode = getStatusCode(error);
  if (statusCode === undefined) {
    return false;
  }

  if (SUUNTO_ALWAYS_TRANSIENT_STATUS_CODES.has(statusCode)) {
    return true;
  }

  return statusCode === 500 && retryOnInternalServerError && !isLikelyPermanentSuunto500(error);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withSuuntoTransientRetry<T>(
  operationName: string,
  operation: () => Promise<T>,
  maxRetries = SUUNTO_MAX_TRANSIENT_RETRIES,
  retryOnInternalServerError = false
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;
      attempt++;

      if (!isRetryableSuuntoTransientError(error, retryOnInternalServerError) || attempt > maxRetries) {
        throw error;
      }

      const statusCode = getStatusCode(error);
      logger.warn(`${operationName} failed with transient status ${statusCode}. Retrying attempt ${attempt}/${maxRetries}.`);
      await sleep(SUUNTO_TRANSIENT_BACKOFF_MS * attempt);
    }
  }

  throw lastError;
}

export interface SuuntoActivityUploadResult {
  status: 'success' | 'info';
  code?: string;
  message: string;
  workoutKey?: string;
  uploadId?: string;
}

export async function uploadActivityFileToSuunto(userID: string, fileBuffer: Buffer): Promise<SuuntoActivityUploadResult> {
  const tokenQuerySnapshots = await admin.firestore().collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME).doc(userID).collection('tokens').get();
  logger.info(`Found ${tokenQuerySnapshots.size} tokens for user ${userID}`);

  if (tokenQuerySnapshots.empty) {
    throw new HttpsError('unauthenticated', 'No connected Suunto account found.');
  }

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
                  'Authorization': toSuuntoAuthorizationHeader(accessToken),
                  'Content-Type': 'application/json',
                  'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
                },
                json: true,
                body: {
                  notifyUser: true,
                },
                url: 'https://cloudapi.suunto.com/v2/upload',
              }),
              SUUNTO_MAX_TRANSIENT_RETRIES,
              true
            );
          } catch (e: any) {
            logger.error(`Could not init activity upload for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`, e);
            throw e;
          }

          if (!result || !result.url || !result.id) {
            logger.error(`Invalid init response from Suunto for user ${userID}`, result);
            throw new HttpsError('internal', 'Invalid response from Suunto initialization.');
          }

          const url = result.url;
          const uploadId = result.id;
          const blobHeaders = { ...(result.headers || {}) };
          logger.info(`Init response for user ${userID}: url=${url}, id=${uploadId}, headers=${JSON.stringify(result.headers)}`);

          try {
            result = await withSuuntoTransientRetry(
              `Upload activity blob for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`,
              async () => requestPromise.put({
                headers: { ...blobHeaders },
                json: false,
                url,
                body: fileBuffer,
              }),
              SUUNTO_MAX_TRANSIENT_RETRIES,
              true
            );
            logger.info(`PUT response for user ${userID}: ${JSON.stringify(result)}`);
          } catch (e: any) {
            logger.error(`Could not upload activity for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`, e);
            throw e;
          }

          let status = 'NEW';
          let statusRequestAttempts = 0;
          const maxStatusRequestAttempts = 10;

          while (statusRequestAttempts < maxStatusRequestAttempts) {
            await sleep(2000);

            try {
              const remainingStatusRequestAttempts = maxStatusRequestAttempts - statusRequestAttempts;
              const maxStatusRequestRetries = Math.min(
                SUUNTO_MAX_TRANSIENT_RETRIES,
                Math.max(0, remainingStatusRequestAttempts - 1)
              );
              const statusResponse = await withSuuntoTransientRetry(
                `Check upload status for ${uploadId} for user ${userID}`,
                async () => {
                  statusRequestAttempts++;
                  return requestPromise.get({
                    headers: {
                      'Authorization': toSuuntoAuthorizationHeader(accessToken),
                      'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
                    },
                    json: true,
                    url: `https://cloudapi.suunto.com/v2/upload/${uploadId}`,
                  });
                },
                maxStatusRequestRetries,
                true
              );

              const statusJson = statusResponse;
              if (!statusJson || !statusJson.status) {
                logger.warn(`Missing status in response for user ${userID}, id ${uploadId}:`, statusJson);
                continue;
              }

              if (statusJson.status === 'ERROR' && statusJson.message === 'Already exists') {
                logger.info(`Activity already exists in Suunto for user ${userID}.`);
                return {
                  status: 'info',
                  code: 'ALREADY_EXISTS',
                  message: 'Activity already exists in Suunto',
                  uploadId: `${uploadId}`,
                } satisfies SuuntoActivityUploadResult;
              }

              status = statusJson.status;
              logger.info(`Upload status (request ${statusRequestAttempts}/${maxStatusRequestAttempts}) for user ${userID}, id ${uploadId}: ${status}`, statusJson);

              if (status === 'PROCESSED') {
                logger.info(`Successfully processed activity for user ${userID}. WorkoutKey: ${statusJson.workoutKey}`);
                return {
                  status: 'success',
                  message: 'Activity uploaded to Suunto',
                  workoutKey: statusJson.workoutKey,
                  uploadId: `${uploadId}`,
                } satisfies SuuntoActivityUploadResult;
              } else if (status === 'ERROR') {
                throw new HttpsError('internal', `Suunto processing failed: ${statusJson.message}`);
              } else if (status === 'NEW' || status === 'ACCEPTED') {
                continue;
              } else {
                logger.warn(`Unknown status ${status} for user ${userID}, id ${uploadId}`);
                continue;
              }
            } catch (e: unknown) {
              if (isRetryableSuuntoTransientError(e, true) && statusRequestAttempts < maxStatusRequestAttempts) {
                logger.warn(`Transient upload status error for ${uploadId} for user ${userID} after ${statusRequestAttempts}/${maxStatusRequestAttempts} status requests. Continuing polling.`, {
                  statusCode: getStatusCode(e),
                  statusRequestAttempts,
                  maxStatusRequestAttempts,
                });
                continue;
              }

              const errorMessage = e instanceof Error ? e.message : String(e);
              logger.error(`Could not check upload status for ${uploadId} for user ${userID} after ${statusRequestAttempts} status requests`, errorMessage);
              throw e;
            }
          }

          throw new HttpsError('deadline-exceeded', `Upload timed out or failed with status ${status}`);
        },
        `Upload activity for user ${userID}`
      );

      if (result) {
        if (result.status === 'success') {
          try {
            const SERVICE_NAME = (await import('./constants')).SERVICE_NAME;
            const userServiceMetaDocumentSnapshot = admin.firestore().collection('users').doc(userID).collection('meta').doc(SERVICE_NAME);
            await userServiceMetaDocumentSnapshot.set({
              uploadedActivitiesCount: FieldValue.increment(1),
            }, { merge: true });
          } catch (e: unknown) {
            logger.error('Could not update uploadedActivities count', e);
          }
        }
        return result as SuuntoActivityUploadResult;
      }
    } catch (e: unknown) {
      const isHttpsError = e instanceof HttpsError;
      const code = isHttpsError ? e.code : 'internal';
      const statusCode = typeof (e as any)?.statusCode === 'number' ? (e as any).statusCode : undefined;
      const providerMessage = getSuuntoErrorMessage(e);
      const message = providerMessage || (e instanceof Error ? e.message : String(e));

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

      if (isRetryableSuuntoTransientError(e, true)) {
        throw new HttpsError('unavailable', 'Suunto activity upload is temporarily unavailable. Please retry.');
      }

      throw new HttpsError('internal', message);
    }
  }

  return {
    status: 'success',
    message: 'Activity upload completed',
  };
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

  if (size > MAX_ACTIVITY_UPLOAD_BYTES) {
    throw new HttpsError('invalid-argument', 'Cannot upload activity because the size is greater than 20MB');
  }

  return uploadActivityFileToSuunto(userID, fileBuffer);
});
