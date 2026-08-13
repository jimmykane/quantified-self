'use strict';

import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { COROSAPIAuth2ServiceTokenInterface, ServiceNames } from '@sports-alliance/sports-lib';

import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import * as requestPromise from '../request-helper';
import { recordSuccessfulActivityUpload } from '../activity-sync/upload-count';
import { isServiceDisconnectPendingForUser } from '../service-disconnect-pending';
import { MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES, MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES_LABEL } from '../shared/activity-processing-config';
import {
  isProviderOperationError,
  isTerminalServiceAuthError,
  isTransientProviderTransportError,
  ProviderOperation,
  ProviderOperationError,
} from '../shared/provider-operation-error';
import { ProviderPendingDisconnectError } from '../shared/provider-pending-disconnect-error';
import { getUserDeletionGuardState, UserDeletionGuardReadError } from '../shared/user-deletion-guard';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import { getTokenData } from '../tokens';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import { getActiveCOROSTokenSnapshot } from './account';
import { PRODUCTION_URL, SERVICE_NAME, STAGING_URL, USE_STAGING } from './constants';
import {
  ActivitySyncOutboundFingerprintSkippedForDeletedUserError,
  recordActivitySyncOutboundFingerprint,
} from '../activity-sync/outbound-fingerprint';

const COROS_SUCCESS_CODE = '0000';
const COROS_DUPLICATE_CODE = '5082';
const COROS_UPLOAD_ID_PATTERN = /^\d{1,20}$/;
const MAX_BASE64_ACTIVITY_UPLOAD_LENGTH = Math.ceil(MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES / 3) * 4 + 4;

export interface COROSActivityUploadResult {
  status: 'success' | 'duplicate' | 'pending';
  code?: 'ALREADY_EXISTS';
  message: string;
  uploadId?: string;
  providerUserId?: string;
}

interface COROSUploadResponseData {
  uploadId?: unknown;
  status?: unknown;
}

interface COROSUploadResponse {
  result?: unknown;
  message?: unknown;
  data?: COROSUploadResponseData | COROSUploadResponseData[];
}

export interface COROSActivityUploadCountOptions {
  queueItemRef?: admin.firestore.DocumentReference;
}

export interface COROSActivityUploadOptions {
  beforeProviderRequest?: () => Promise<void>;
}

export class COROSActivityUploadSkippedForDeletedUserError extends Error {
  readonly name = 'COROSActivityUploadSkippedForDeletedUserError';
  readonly code = 'user_deleted_or_deleting';

  constructor(public readonly userID: string, public readonly phase: string) {
    super(`Skipping COROS activity upload for user ${userID} during ${phase} because the user is missing or being deleted.`);
  }
}

function getCOROSBaseUrl(): string {
  return USE_STAGING ? STAGING_URL : PRODUCTION_URL;
}

function normalizeIdentifier(value: unknown): string | undefined {
  const normalized = `${value ?? ''}`.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeUploadId(value: unknown): string | undefined {
  const normalized = normalizeIdentifier(value);
  return normalized && COROS_UPLOAD_ID_PATTERN.test(normalized) ? normalized : undefined;
}

function protectCOROSInt64Identifiers(raw: string): string {
  return raw.replace(/("(?:uploadId|labelId)"\s*:\s*)(-?\d{16,20})(?=\s*[,}\]])/g, '$1"$2"');
}

function parseCOROSResponse(rawResponse: unknown): COROSUploadResponse {
  if (typeof rawResponse === 'string') {
    try {
      return JSON.parse(protectCOROSInt64Identifiers(rawResponse)) as COROSUploadResponse;
    } catch {
      throw new ProviderOperationError({
        serviceName: ServiceNames.COROSAPI,
        operation: 'activity_upload_status',
        disposition: 'permanent',
        code: 'invalid-provider-response',
        message: 'COROS returned an invalid activity upload response.',
        dlqContext: 'COROS_ACTIVITY_UPLOAD_INVALID_RESPONSE',
      });
    }
  }
  if (rawResponse && typeof rawResponse === 'object') {
    return rawResponse as COROSUploadResponse;
  }
  throw new ProviderOperationError({
    serviceName: ServiceNames.COROSAPI,
    operation: 'activity_upload_status',
    disposition: 'permanent',
    code: 'invalid-provider-response',
    message: 'COROS returned an invalid activity upload response.',
    dlqContext: 'COROS_ACTIVITY_UPLOAD_INVALID_RESPONSE',
  });
}

function responseData(response: COROSUploadResponse): COROSUploadResponseData {
  return Array.isArray(response.data) ? response.data[0] || {} : response.data || {};
}

function buildCOROSActivityMultipartBody(openId: string, fileBuffer: Buffer): { body: Buffer; contentType: string } {
  const boundary = `----qsCorosBoundary${crypto.randomUUID().replace(/-/g, '')}`;
  const parts: Buffer[] = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="openId"\r\n\r\n${openId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="fileType"\r\n\r\n4\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="sportFile"; filename="activity.fit"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function assertCOROSActivityUploadAllowed(userID: string, phase: string): Promise<void> {
  let deletionGuard;
  try {
    deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
  } catch (error) {
    throw new UserDeletionGuardReadError(userID, `coros_activity_upload:${phase}`, error);
  }
  if (deletionGuard.shouldSkip) {
    throw new COROSActivityUploadSkippedForDeletedUserError(userID, phase);
  }
  if (await isServiceDisconnectPendingForUser(userID, SERVICE_NAME)) {
    throw new ProviderPendingDisconnectError(userID, ServiceNames.COROSAPI, phase);
  }
}

function providerMessageForCode(code: string): string {
  switch (code) {
    case '1008': return `COROS rejected the activity because it exceeds the provider's size limit.`;
    case '1031': return 'COROS rejected the activity upload parameters.';
    case '5096': return 'COROS does not support this activity file.';
    case '5098': return 'COROS could not process this activity file.';
    case '30009': return 'COROS has not enabled this upload permission for the connected application.';
    case '5006':
    case '5010': return 'Reconnect COROS before sending activities.';
    default: return 'COROS rejected the activity upload.';
  }
}

function toCOROSResultError(
  operation: ProviderOperation,
  response: COROSUploadResponse,
  providerUserId: string,
  providerOperationId?: string,
): ProviderOperationError {
  const providerCode = `${response.result || ''}`.trim() || 'unknown';
  const common = { serviceName: ServiceNames.COROSAPI, operation, providerCode, providerUserId, providerOperationId };
  if (providerCode === '30009') {
    return new ProviderOperationError({
      ...common,
      disposition: 'permission_required',
      code: 'permission-denied',
      message: providerMessageForCode(providerCode),
      dlqContext: 'COROS_ACTIVITY_UPLOAD_PERMISSION_REQUIRED',
    });
  }
  if (providerCode === '5006' || providerCode === '5010') {
    return new ProviderOperationError({
      ...common,
      disposition: 'auth_required',
      code: 'unauthenticated',
      message: providerMessageForCode(providerCode),
      dlqContext: 'COROS_ACTIVITY_UPLOAD_AUTH_REQUIRED',
    });
  }
  return new ProviderOperationError({
    ...common,
    disposition: 'permanent',
    code: providerCode === '1008' || providerCode === '1031' || providerCode === '5096'
      ? 'invalid-argument'
      : 'failed-precondition',
    message: providerMessageForCode(providerCode),
    dlqContext: 'COROS_ACTIVITY_UPLOAD_REJECTED',
  });
}

function statusCodeFromError(error: unknown): number | undefined {
  const value = Number((error as { statusCode?: unknown } | null)?.statusCode);
  return Number.isFinite(value) ? value : undefined;
}

function toCOROSRequestError(
  operation: 'activity_upload_init' | 'activity_upload_status',
  error: unknown,
  providerUserId: string,
  providerOperationId?: string,
): ProviderOperationError {
  if (isProviderOperationError(error)) return error;
  const statusCode = statusCodeFromError(error);
  const retryMode = operation === 'activity_upload_status' ? 'resume' : 'restart';
  const common = { serviceName: ServiceNames.COROSAPI, operation, providerUserId, providerOperationId, statusCode };
  const callableCode = `${(error as { code?: unknown } | null)?.code || ''}`.replace(/^functions\//, '');
  if (isTerminalServiceAuthError(error) || statusCode === 401 || callableCode === 'unauthenticated') {
    return new ProviderOperationError({
      ...common,
      disposition: 'auth_required',
      code: 'unauthenticated',
      message: 'Reconnect COROS before sending activities.',
      dlqContext: 'COROS_ACTIVITY_UPLOAD_AUTH_REQUIRED',
    });
  }
  if (statusCode === 403 || callableCode === 'permission-denied') {
    return new ProviderOperationError({
      ...common,
      disposition: 'permission_required',
      code: 'permission-denied',
      message: 'COROS has not enabled this upload permission for the connected application.',
      dlqContext: 'COROS_ACTIVITY_UPLOAD_PERMISSION_REQUIRED',
    });
  }
  if (callableCode === 'invalid-argument' || callableCode === 'failed-precondition') {
    return new ProviderOperationError({
      ...common,
      disposition: 'permanent',
      code: callableCode,
      message: error instanceof Error ? error.message : 'COROS activity upload cannot continue.',
      dlqContext: 'COROS_ACTIVITY_UPLOAD_REJECTED',
    });
  }
  if (statusCode === 429 || statusCode === 408 || (statusCode !== undefined && statusCode >= 500)
    || isTransientProviderTransportError(error)) {
    return new ProviderOperationError({
      ...common,
      disposition: 'retryable',
      retryMode,
      code: statusCode === 429 ? 'resource-exhausted' : 'unavailable',
      message: statusCode === 429
        ? 'COROS is rate-limiting uploads. Please retry shortly.'
        : 'COROS activity uploads are temporarily unavailable. Please retry.',
      dlqContext: 'COROS_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
    });
  }
  return new ProviderOperationError({
    ...common,
    disposition: 'permanent',
    code: 'failed-precondition',
    message: 'COROS rejected the activity upload.',
    dlqContext: 'COROS_ACTIVITY_UPLOAD_REJECTED',
  });
}

async function withActiveCOROSToken<T>(
  userID: string,
  operation: (token: COROSAPIAuth2ServiceTokenInterface, providerUserId: string) => Promise<T>,
): Promise<T> {
  await assertCOROSActivityUploadAllowed(userID, 'before_token_lookup');
  const selectedSnapshot = await getActiveCOROSTokenSnapshot(userID);
  const providerUserId = selectedSnapshot.id;

  const execute = async (forceRefresh: boolean): Promise<T> => {
    const currentSnapshot = await selectedSnapshot.ref.get();
    if (!currentSnapshot.exists) {
      throw new HttpsError('unauthenticated', 'Reconnect COROS before sending activities.');
    }
    const token = await getTokenData(currentSnapshot, ServiceNames.COROSAPI, forceRefresh) as COROSAPIAuth2ServiceTokenInterface;
    await assertCOROSActivityUploadAllowed(userID, 'before_provider_request');
    return operation(token, providerUserId);
  };

  try {
    return await execute(false);
  } catch (error) {
    const statusCode = statusCodeFromError(error);
    if (statusCode === 401 || (isProviderOperationError(error) && error.providerCode === '5006')) {
      return execute(true);
    }
    throw error;
  }
}

function getOpenId(token: COROSAPIAuth2ServiceTokenInterface, providerUserId: string): string {
  const openId = `${token.openId || providerUserId}`.trim();
  if (!openId || openId !== providerUserId) {
    throw new ProviderOperationError({
      serviceName: ServiceNames.COROSAPI,
      operation: 'activity_upload_init',
      disposition: 'auth_required',
      code: 'unauthenticated',
      message: 'Reconnect COROS before sending activities.',
      providerUserId,
      dlqContext: 'COROS_ACTIVITY_UPLOAD_AUTH_REQUIRED',
    });
  }
  return openId;
}

export async function uploadActivityFileToCOROS(
  userID: string,
  fileBuffer: Buffer,
  options: COROSActivityUploadOptions = {},
): Promise<COROSActivityUploadResult> {
  if (fileBuffer.length === 0) throw new HttpsError('invalid-argument', 'File content is empty.');
  if (fileBuffer.length > MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES) {
    throw new HttpsError('invalid-argument', `Cannot upload activity because the size is greater than ${MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES_LABEL}.`);
  }

  let providerUserId = '';
  try {
    return await withActiveCOROSToken<COROSActivityUploadResult>(userID, async (token, selectedProviderUserId) => {
      providerUserId = selectedProviderUserId;
      const openId = getOpenId(token, selectedProviderUserId);
      await options.beforeProviderRequest?.();
      const { body, contentType } = buildCOROSActivityMultipartBody(openId, fileBuffer);
      const rawResponse = await requestPromise.post({
        url: `${getCOROSBaseUrl()}/coros/file/upload`,
        headers: { token: token.accessToken, 'Content-Type': contentType },
        json: false,
        body,
      });
      const response = parseCOROSResponse(rawResponse);
      const resultCode = `${response.result || ''}`.trim();
      if (resultCode === COROS_DUPLICATE_CODE) {
        return { status: 'duplicate', code: 'ALREADY_EXISTS', message: 'Activity already exists in COROS.', providerUserId };
      }
      if (resultCode !== COROS_SUCCESS_CODE) {
        throw toCOROSResultError('activity_upload_init', response, providerUserId);
      }
      const uploadId = normalizeUploadId(responseData(response).uploadId);
      if (!uploadId) {
        throw new ProviderOperationError({
          serviceName: ServiceNames.COROSAPI,
          operation: 'activity_upload_init',
          disposition: 'permanent',
          code: 'invalid-provider-response',
          message: 'COROS accepted the activity without returning the identifier required to reconcile it safely.',
          providerUserId,
          dlqContext: 'COROS_ACTIVITY_UPLOAD_INVALID_RESPONSE',
        });
      }
      return { status: 'pending', message: 'COROS is processing the activity.', uploadId, providerUserId };
    });
  } catch (error) {
    throw toCOROSRequestError('activity_upload_init', error, providerUserId);
  }
}

export async function getCOROSActivityUploadStatus(
  userID: string,
  uploadIdValue: unknown,
  providerUserIdValue: unknown,
  countOptions: COROSActivityUploadCountOptions = {},
): Promise<COROSActivityUploadResult> {
  const uploadId = normalizeUploadId(uploadIdValue);
  const expectedProviderUserId = normalizeIdentifier(providerUserIdValue);
  if (!uploadId || !expectedProviderUserId) {
    throw new HttpsError('invalid-argument', 'Invalid COROS upload resume identifiers.');
  }

  try {
    const result = await withActiveCOROSToken<COROSActivityUploadResult>(userID, async (token, providerUserId) => {
      if (providerUserId !== expectedProviderUserId) {
        throw new ProviderOperationError({
          serviceName: ServiceNames.COROSAPI,
          operation: 'activity_upload_status',
          disposition: 'auth_required',
          code: 'unauthenticated',
          message: 'The COROS account for this upload is no longer connected.',
          providerUserId: expectedProviderUserId,
          providerOperationId: uploadId,
          dlqContext: 'COROS_ACTIVITY_UPLOAD_AUTH_REQUIRED',
        });
      }
      const openId = getOpenId(token, providerUserId);
      const rawResponse = await requestPromise.get({
        url: `${getCOROSBaseUrl()}/coros/file/upload/get?openId=${encodeURIComponent(openId)}&uploadId=${encodeURIComponent(uploadId)}`,
        headers: { token: token.accessToken },
        json: false,
      });
      const response = parseCOROSResponse(rawResponse);
      const resultCode = `${response.result || ''}`.trim();
      if (resultCode === COROS_DUPLICATE_CODE) {
        return { status: 'duplicate', code: 'ALREADY_EXISTS', message: 'Activity already exists in COROS.', uploadId, providerUserId };
      }
      if (resultCode !== COROS_SUCCESS_CODE) {
        throw toCOROSResultError('activity_upload_status', response, providerUserId, uploadId);
      }
      const data = responseData(response);
      const responseUploadId = normalizeUploadId(data.uploadId);
      if (responseUploadId !== uploadId) {
        throw new ProviderOperationError({
          serviceName: ServiceNames.COROSAPI,
          operation: 'activity_upload_status',
          disposition: 'permanent',
          code: 'invalid-provider-response',
          message: 'COROS returned an activity upload status for a different operation.',
          providerUserId,
          providerOperationId: uploadId,
          dlqContext: 'COROS_ACTIVITY_UPLOAD_INVALID_RESPONSE',
        });
      }
      const status = Number(data.status);
      if (status === 1) {
        return { status: 'pending', message: 'COROS is processing the activity.', uploadId, providerUserId };
      }
      if (status === 2) {
        return { status: 'success', message: 'Activity uploaded to COROS.', uploadId, providerUserId };
      }
      throw new ProviderOperationError({
        serviceName: ServiceNames.COROSAPI,
        operation: 'activity_upload_status',
        disposition: 'permanent',
        code: 'failed-precondition',
        message: status === -1 ? 'COROS could not process this activity file.' : 'COROS returned an unknown activity upload status.',
        providerUserId,
        providerOperationId: uploadId,
        dlqContext: 'COROS_ACTIVITY_UPLOAD_FAILED',
      });
    });

    if (result.status === 'success') {
      await recordSuccessfulActivityUpload({
        userID,
        serviceName: ServiceNames.COROSAPI,
        uploadId,
        queueItemRef: countOptions.queueItemRef,
      });
    }
    return result;
  } catch (error) {
    throw toCOROSRequestError('activity_upload_status', error, expectedProviderUserId, uploadId);
  }
}

function decodeActivityUpload(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpsError('invalid-argument', 'File content missing.');
  }
  if (value.length > MAX_BASE64_ACTIVITY_UPLOAD_LENGTH || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new HttpsError('invalid-argument', 'File content is not valid base64.');
  }
  const fileBuffer = Buffer.from(value, 'base64');
  if (fileBuffer.length === 0) throw new HttpsError('invalid-argument', 'File content is empty.');
  if (fileBuffer.length > MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES) {
    throw new HttpsError('invalid-argument', `Cannot upload activity because the size is greater than ${MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES_LABEL}.`);
  }
  return fileBuffer;
}

async function requireCOROSActivityUploadAccess(request: { auth?: { uid: string } | null }): Promise<string> {
  enforceAppCheck(request as Parameters<typeof enforceAppCheck>[0]);
  if (!request.auth) throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  if (!(await hasProAccess(request.auth.uid))) throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  return request.auth.uid;
}

function toCallableError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof UserDeletionGuardReadError) {
    throw new HttpsError('unavailable', 'Could not verify account state. Please retry.');
  }
  if (error instanceof ActivitySyncOutboundFingerprintSkippedForDeletedUserError) {
    throw new HttpsError('failed-precondition', 'Account is being deleted or no longer exists.');
  }
  if (!isProviderOperationError(error)) {
    logger.warn('[COROSActivityUpload] Unexpected upload failure', { errorName: error instanceof Error ? error.name : typeof error });
    throw new HttpsError('unavailable', 'COROS activity uploads are temporarily unavailable. Please retry.');
  }
  const details = {
    retryMode: error.retryMode,
    ...(error.providerOperationId ? { resumeUploadId: error.providerOperationId } : {}),
    ...(error.providerUserId ? { resumeProviderUserId: error.providerUserId } : {}),
  };
  if (error.disposition === 'auth_required') throw new HttpsError('unauthenticated', error.message, details);
  if (error.disposition === 'permission_required') throw new HttpsError('permission-denied', error.message, details);
  if (error.disposition === 'retryable') {
    throw new HttpsError(error.code === 'resource-exhausted' ? 'resource-exhausted' : 'unavailable', error.message, details);
  }
  throw new HttpsError(error.code === 'invalid-argument' ? 'invalid-argument' : 'failed-precondition', error.message, details);
}

export const importActivityToCOROSAPI = onCall({
  region: FUNCTIONS_MANIFEST.importActivityToCOROSAPI.region,
  secrets: FUNCTION_SECRET_BINDINGS.importActivityToCOROSAPI,
  cors: ALLOWED_CORS_ORIGINS,
  timeoutSeconds: 120,
  maxInstances: 10,
}, async (request) => {
  const userID = await requireCOROSActivityUploadAccess(request);
  try {
    const fileBuffer = decodeActivityUpload(request.data?.file);
    return await uploadActivityFileToCOROS(userID, fileBuffer, {
      beforeProviderRequest: async () => {
        await recordActivitySyncOutboundFingerprint({
          userID,
          destinationServiceName: ServiceNames.COROSAPI,
          fileBuffer,
        });
      },
    });
  } catch (error) {
    return toCallableError(error);
  }
});

export const getCOROSAPIWorkoutFileUploadStatus = onCall({
  region: FUNCTIONS_MANIFEST.getCOROSAPIWorkoutFileUploadStatus.region,
  secrets: FUNCTION_SECRET_BINDINGS.getCOROSAPIWorkoutFileUploadStatus,
  cors: ALLOWED_CORS_ORIGINS,
  timeoutSeconds: 60,
  maxInstances: 10,
}, async (request) => {
  const userID = await requireCOROSActivityUploadAccess(request);
  try {
    return await getCOROSActivityUploadStatus(userID, request.data?.uploadId, request.data?.providerUserId);
  } catch (error) {
    return toCallableError(error);
  }
});
