'use strict';

import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as requestPromise from '../request-helper';
import { hasProAccess, PRO_REQUIRED_MESSAGE, ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME, PRODUCTION_URL, SERVICE_NAME, STAGING_URL, USE_STAGING } from './constants';
import { getTokenData } from '../tokens';
import { COROSAPIAuth2ServiceTokenInterface, ServiceNames } from '@sports-alliance/sports-lib';
import { getCOROSUserId } from './auth/api';

const COROS_UPLOAD_SUCCESS_CODE = '0000';
const COROS_UPLOAD_DUPLICATE_CODE = '5082';
const COROS_AUTH_ERROR_CODES = new Set(['5006', '5010', '30009']);
const COROS_INVALID_ARGUMENT_CODES = new Set(['1008', '1031', '5096']);
const MAX_ACTIVITY_UPLOAD_BYTES = 20 * 1024 * 1024;

function getCOROSBaseUrl(): string {
  return USE_STAGING ? STAGING_URL : PRODUCTION_URL;
}

export interface COROSActivityUploadResult {
  status: 'success' | 'info';
  code?: string;
  message: string;
  labelId?: string;
}

interface COROSUploadResponse {
  result?: string;
  message?: string;
  data?: Array<{
    labelId?: string | number;
  }>;
}

function buildCOROSActivityMultipartBody(openId: string, fileBuffer: Buffer): { body: Buffer; contentType: string } {
  const boundary = `----qsCorosBoundary${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const parts: Buffer[] = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="openId"\r\n\r\n${openId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="fileType"\r\n\r\n4\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="sportFile"; filename="activity.fit"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function parseCOROSUploadResponse(rawResponse: unknown): COROSUploadResponse {
  if (typeof rawResponse === 'string') {
    try {
      return JSON.parse(rawResponse) as COROSUploadResponse;
    } catch {
      throw new HttpsError('internal', 'Invalid response from COROS upload API.');
    }
  }

  if (rawResponse && typeof rawResponse === 'object') {
    return rawResponse as COROSUploadResponse;
  }

  throw new HttpsError('internal', 'Invalid response from COROS upload API.');
}

function getUploadLabelId(response: COROSUploadResponse): string | undefined {
  const labelId = response.data?.[0]?.labelId;
  if (labelId === undefined || labelId === null) {
    return undefined;
  }

  return `${labelId}`;
}

async function executeWithCOROSTokenRetry<T>(
  tokenDoc: admin.firestore.QueryDocumentSnapshot,
  operation: (serviceToken: COROSAPIAuth2ServiceTokenInterface) => Promise<T>,
  contextDescription: string,
): Promise<T> {
  let serviceToken: COROSAPIAuth2ServiceTokenInterface;

  try {
    serviceToken = (await getTokenData(tokenDoc, ServiceNames.COROSAPI, false)) as COROSAPIAuth2ServiceTokenInterface;
  } catch (error) {
    logger.warn(`Initial token fetch failed for ${contextDescription} (Token ID: ${tokenDoc.id})`, error as Error);
    throw error;
  }

  try {
    return await operation(serviceToken);
  } catch (error: any) {
    const statusCode = error?.statusCode;
    if (statusCode === 401) {
      logger.warn(`Unauthorized (${statusCode}) during ${contextDescription} for token ${tokenDoc.id}. Attempting force refresh and retry...`);
      const refreshedToken = (await getTokenData(tokenDoc, ServiceNames.COROSAPI, true)) as COROSAPIAuth2ServiceTokenInterface;
      return operation(refreshedToken);
    }

    throw error;
  }
}

function mapCOROSUploadError(resultCode: string, message: string): HttpsError {
  if (COROS_AUTH_ERROR_CODES.has(resultCode)) {
    return new HttpsError('unauthenticated', message || 'Authentication failed. Please reconnect your COROS account.');
  }

  if (COROS_INVALID_ARGUMENT_CODES.has(resultCode)) {
    return new HttpsError('invalid-argument', message || 'Invalid COROS activity upload payload.');
  }

  return new HttpsError('internal', message || `COROS upload failed with code ${resultCode}.`);
}

function getCOROSErrorMessage(error: unknown): string | undefined {
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

async function resolveOpenId(serviceToken: COROSAPIAuth2ServiceTokenInterface, corosBaseUrl: string): Promise<string> {
  if (serviceToken.openId && `${serviceToken.openId}`.trim().length > 0) {
    return `${serviceToken.openId}`.trim();
  }

  try {
    const userId = await getCOROSUserId(serviceToken.accessToken, corosBaseUrl);
    if (!userId || !`${userId}`.trim()) {
      throw new HttpsError('unauthenticated', 'Missing COROS openId for upload. Please reconnect your COROS account.');
    }

    return `${userId}`.trim();
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('unauthenticated', 'Missing COROS openId for upload. Please reconnect your COROS account.');
  }
}

export async function uploadActivityFileToCOROS(userID: string, fileBuffer: Buffer): Promise<COROSActivityUploadResult> {
  const tokenQuerySnapshots = await admin.firestore().collection(COROSAPI_ACCESS_TOKENS_COLLECTION_NAME).doc(userID).collection('tokens').get();
  logger.info(`Found ${tokenQuerySnapshots.size} COROS token(s) for user ${userID}`);
  const corosBaseUrl = getCOROSBaseUrl();

  if (tokenQuerySnapshots.empty) {
    throw new HttpsError('unauthenticated', 'No connected COROS account found.');
  }

  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {
    try {
      const result = await executeWithCOROSTokenRetry(
        tokenQueryDocumentSnapshot,
        async (serviceToken) => {
          const openId = await resolveOpenId(serviceToken, corosBaseUrl);
          const { body, contentType } = buildCOROSActivityMultipartBody(openId, fileBuffer);

          const rawResponse = await requestPromise.post({
            url: `${corosBaseUrl}/coros/file/synchronous`,
            headers: {
              token: serviceToken.accessToken,
              'Content-Type': contentType,
            },
            json: false,
            body,
          });

          const response = parseCOROSUploadResponse(rawResponse);
          const resultCode = `${response.result || ''}`.trim();
          const message = `${response.message || ''}`.trim();

          if (resultCode === COROS_UPLOAD_SUCCESS_CODE) {
            return {
              status: 'success',
              message: message || 'Activity uploaded to COROS',
              labelId: getUploadLabelId(response),
            } satisfies COROSActivityUploadResult;
          }

          if (resultCode === COROS_UPLOAD_DUPLICATE_CODE) {
            return {
              status: 'info',
              code: 'ALREADY_EXISTS',
              message: message || 'Activity already exists in COROS',
            } satisfies COROSActivityUploadResult;
          }

          throw mapCOROSUploadError(resultCode, message);
        },
        `Upload activity to COROS for user ${userID}`,
      );

      if (result.status === 'success') {
        try {
          const userServiceMetaDocument = admin.firestore().collection('users').doc(userID).collection('meta').doc(SERVICE_NAME);
          await userServiceMetaDocument.set({
            uploadedActivitiesCount: FieldValue.increment(1),
          }, { merge: true });
        } catch (error) {
          logger.error('Could not update COROS uploadedActivitiesCount', error as Error);
        }
      }

      return result;
    } catch (error: unknown) {
      if (error instanceof HttpsError) {
        throw error;
      }

      const statusCode = (error as any)?.statusCode;
      if (statusCode === 401) {
        throw new HttpsError('unauthenticated', 'Authentication failed. Please reconnect your COROS account.');
      }

      const providerMessage = getCOROSErrorMessage(error);
      const fallbackMessage = error instanceof Error ? error.message : `${error}`;
      throw new HttpsError('internal', providerMessage || fallbackMessage || 'COROS upload failed.');
    }
  }

  throw new HttpsError('internal', 'COROS upload failed for all connected tokens.');
}

export const importActivityToCOROSAPI = onCall({
  region: FUNCTIONS_MANIFEST.importActivityToCOROSAPI.region,
  cors: ALLOWED_CORS_ORIGINS,
  timeoutSeconds: 300,
  maxInstances: 10,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  enforceAppCheck(request);

  const userID = request.auth.uid;

  if (!(await hasProAccess(userID))) {
    logger.warn(`Blocking COROS activity upload for non-pro user ${userID}`);
    throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }

  const base64File = request.data.file;
  if (!base64File) {
    throw new HttpsError('invalid-argument', 'File content missing');
  }

  const fileBuffer = Buffer.from(base64File, 'base64');
  if (fileBuffer.length === 0) {
    throw new HttpsError('invalid-argument', 'File content is empty');
  }

  if (fileBuffer.length > MAX_ACTIVITY_UPLOAD_BYTES) {
    throw new HttpsError('invalid-argument', 'Cannot upload activity because the size is greater than 20MB');
  }

  return uploadActivityFileToCOROS(userID, fileBuffer);
});
