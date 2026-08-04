'use strict';

import * as logger from 'firebase-functions/logger';
import { config } from '../config';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as requestPromise from '../request-helper';
import { executeWithTokenRetry } from './retry-helper';
import {
  getUserDeletionGuardState,
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import { hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import { SERVICE_NAME, SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from './constants';
import { toSuuntoAuthorizationHeader } from './authorization-header';



/**
 * Uploads an activity to Suunto app
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';
import { MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES, MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES_LABEL } from '../shared/activity-processing-config';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  extractRefreshFailureDetails,
  isTerminalRefreshFailureForService,
} from '../service-auth-lifecycle';
import {
  isProviderOperationError,
  isTransientProviderTransportError,
  ProviderOperation,
  ProviderOperationError,
  ProviderRetryMode,
} from '../shared/provider-operation-error';

const SUUNTO_ALWAYS_TRANSIENT_STATUS_CODES = new Set([408, 502, 503, 504]);
const SUUNTO_MAX_TRANSIENT_RETRIES = 2;
const SUUNTO_TRANSIENT_BACKOFF_MS = 1000;
const SUUNTO_STATUS_POLL_DELAY_MS = 2000;
const SUUNTO_MAX_STATUS_REQUEST_ATTEMPTS = 10;
const SUUNTO_DIRECT_UPLOAD_COUNT_IDEMPOTENCY_WINDOW = 100;
const SUUNTO_EXPLICIT_CONTENT_REJECTION_PATTERNS = [
  /\bunsupported\s+(?:activity|file|fit|payload|workout)\b/i,
  /\b(?:activity|file|fit|payload|workout)\s+(?:is\s+)?unsupported\b/i,
  /\b(?:invalid|malformed|corrupt(?:ed)?)\s+(?:activity|file|fit|payload|workout)\b/i,
  /\b(?:activity|file|fit|payload|workout)\s+(?:is\s+)?(?:invalid|malformed|corrupt(?:ed)?)\b/i,
];

function getStatusCode(error: unknown): number | undefined {
  const directStatusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof directStatusCode === 'number') {
    return directStatusCode;
  }

  const responseStatusCode = (error as { response?: { statusCode?: unknown } } | null)?.response?.statusCode;
  return typeof responseStatusCode === 'number' ? responseStatusCode : undefined;
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

  const message = getSuuntoErrorMessage(error);
  if (!message) {
    return false;
  }

  return isExplicitSuuntoContentRejectionMessage(message);
}

function isExplicitSuuntoContentRejectionMessage(message: string): boolean {
  return SUUNTO_EXPLICIT_CONTENT_REJECTION_PATTERNS.some((pattern) => pattern.test(message));
}

function isRetryableSuuntoTransientError(error: unknown, retryOnInternalServerError = false): boolean {
  const statusCode = getStatusCode(error);
  if (statusCode === undefined) {
    return isTransientProviderTransportError(error);
  }

  if (SUUNTO_ALWAYS_TRANSIENT_STATUS_CODES.has(statusCode)) {
    return true;
  }

  return statusCode === 500 && retryOnInternalServerError && !isLikelyPermanentSuunto500(error);
}

export class SuuntoActivityUploadSkippedForDeletedUserError extends Error {
  public readonly name = 'SuuntoActivityUploadSkippedForDeletedUserError';
  public readonly code = 'user_deleted_or_deleting';

  constructor(
    public readonly userID: string,
    public readonly phase: string,
  ) {
    super(`Skipping Suunto activity upload for user ${userID} during ${phase} because the user is missing or deletion is in progress.`);
  }
}

async function assertSuuntoActivityUploadUserActive(userID: string, phase: string): Promise<void> {
  let deletionGuard;
  try {
    deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
  } catch (error) {
    throw new UserDeletionGuardReadError(userID, `suunto_activity_upload:${phase}`, error);
  }

  if (!deletionGuard.shouldSkip) {
    return;
  }

  logger.warn(`Skipping Suunto activity upload for user ${userID} during ${phase} because the user is missing or deletion is in progress.`);
  throw new SuuntoActivityUploadSkippedForDeletedUserError(userID, phase);
}

interface SuuntoActivityUploadCountContext {
  uploadId: string;
  queueItemRef?: admin.firestore.DocumentReference;
}

async function incrementUploadedActivitiesCountIfUserActive(
  userID: string,
  countContext?: SuuntoActivityUploadCountContext,
): Promise<boolean> {
  const db = admin.firestore();
  const userServiceMetaDocumentSnapshot = db.collection('users').doc(userID).collection('meta').doc(SERVICE_NAME);

  return db.runTransaction(async (transaction) => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, 'suunto_activity_upload_meta', error);
    }

    if (deletionGuard.shouldSkip) {
      logger.warn(`Skipping Suunto uploadedActivitiesCount update because user ${userID} is missing or deletion is in progress.`);
      return false;
    }

    const serviceMetaUpdate: Record<string, unknown> = {
      uploadedActivitiesCount: FieldValue.increment(1),
    };
    if (countContext?.queueItemRef) {
      const queueItemSnapshot = await transaction.get(countContext.queueItemRef);
      if (!queueItemSnapshot.exists) {
        logger.warn('Skipping Suunto uploadedActivitiesCount update because the activity-sync queue item no longer exists.', {
          userID,
          uploadId: countContext.uploadId,
        });
        return false;
      }

      const queueItemData = queueItemSnapshot.data() as {
        destinationUploadCountedID?: unknown;
      } | undefined;
      const countedUploadId = `${queueItemData?.destinationUploadCountedID || ''}`.trim();
      if (countedUploadId === countContext.uploadId) {
        return false;
      }
      if (countedUploadId) {
        logger.error('Skipping Suunto uploadedActivitiesCount update because the queue item already counted a different upload.', {
          userID,
          uploadId: countContext.uploadId,
          countedUploadId,
        });
        return false;
      }

      transaction.update(countContext.queueItemRef, {
        destinationUploadCountedID: countContext.uploadId,
        destinationUploadCountedAt: Date.now(),
      });
    } else if (countContext) {
      const serviceMetaSnapshot = await transaction.get(userServiceMetaDocumentSnapshot);
      const serviceMetaData = serviceMetaSnapshot.data() as {
        recentDirectActivityUploadCountedIDs?: unknown;
      } | undefined;
      const recentUploadIds = Array.isArray(serviceMetaData?.recentDirectActivityUploadCountedIDs)
        ? serviceMetaData.recentDirectActivityUploadCountedIDs
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
        : [];
      if (recentUploadIds.includes(countContext.uploadId)) {
        return false;
      }
      serviceMetaUpdate.recentDirectActivityUploadCountedIDs = [
        ...recentUploadIds.filter(uploadId => uploadId !== countContext.uploadId),
        countContext.uploadId,
      ].slice(-SUUNTO_DIRECT_UPLOAD_COUNT_IDEMPOTENCY_WINDOW);
    }

    transaction.set(userServiceMetaDocumentSnapshot, serviceMetaUpdate, { merge: true });
    return true;
  });
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
  status: 'success' | 'info' | 'pending';
  code?: string;
  message: string;
  workoutKey?: string;
  uploadId?: string;
  providerUserId?: string;
}

export interface SuuntoActivityUploadInitializationState {
  uploadId: string;
  providerUserId: string;
}

export interface SuuntoActivityUploadOptions {
  /**
   * Persists the provider identifiers before the FIT blob is sent. Returning
   * false means the caller's guarded state was removed and the upload must stop.
   */
  persistUploadStateBeforeBlob?: (state: SuuntoActivityUploadInitializationState) => Promise<boolean>;
}

export class SuuntoActivityUploadStatePersistenceSkippedError extends Error {
  public readonly name = 'SuuntoActivityUploadStatePersistenceSkippedError';
  public readonly code = 'user_deleted_or_deleting';

  constructor(
    public readonly userID: string,
    public readonly uploadId: string,
  ) {
    super(`Skipping Suunto activity blob upload ${uploadId} because its guarded queue state was removed.`);
  }
}

export class SuuntoActivityUploadStatePersistenceError extends Error {
  public readonly name = 'SuuntoActivityUploadStatePersistenceError';
  public readonly code?: unknown;
  public readonly status?: unknown;
  public readonly statusCode?: unknown;

  constructor(public readonly originalError: unknown) {
    super('Could not persist Suunto activity upload state before sending the activity blob.');
    const errorLike = originalError as {
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
    } | null;
    this.code = errorLike?.code;
    this.status = errorLike?.status;
    this.statusCode = errorLike?.statusCode;
  }
}

interface SuuntoProviderErrorContext {
  operation: ProviderOperation;
  retryMode: ProviderRetryMode;
  providerUserId?: string;
  uploadId?: string;
}

function shouldPreserveServiceLifecycleError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === 'TerminalServiceAuthError'
    || error.name === 'TokenRefreshSkippedForDeletedUserError'
    || error.name === 'TokenUseSkippedForPendingDisconnectError'
    || error.name === 'UserDeletionGuardReadError'
    || error.name === 'SuuntoActivityUploadSkippedForDeletedUserError'
    || error.name === 'SuuntoActivityUploadStatePersistenceSkippedError'
    || error.name === 'SuuntoActivityUploadStatePersistenceError'
  );
}

function toSuuntoProviderOperationError(
  error: unknown,
  context: SuuntoProviderErrorContext,
): ProviderOperationError {
  if (isProviderOperationError(error)) {
    return error;
  }

  const statusCode = getStatusCode(error);
  const refreshFailure = extractRefreshFailureDetails(error);
  const isTemporarilyRetryableAuthFailure = refreshFailure.isTerminalAuthFailure
    && !isTerminalRefreshFailureForService(ServiceNames.SuuntoApp, refreshFailure);
  const providerMessage = getSuuntoErrorMessage(error);
  const message = providerMessage || (error instanceof Error ? error.message : `${error || 'Suunto operation failed.'}`);
  const common = {
    serviceName: ServiceNames.SuuntoApp,
    operation: context.operation,
    providerUserId: context.providerUserId,
    providerOperationId: context.uploadId,
    statusCode,
  } as const;

  if (statusCode === 401) {
    return new ProviderOperationError({
      ...common,
      disposition: 'auth_required',
      retryMode: 'none',
      code: 'unauthenticated',
      message: 'Authentication failed. Please re-connect your Suunto account.',
      dlqContext: 'SUUNTO_AUTH_REQUIRED',
    });
  }

  if (statusCode === 403) {
    return new ProviderOperationError({
      ...common,
      disposition: 'permission_required',
      retryMode: 'none',
      code: 'permission-denied',
      message: 'Suunto rejected this operation because the connection lacks permission.',
      dlqContext: 'SUUNTO_PERMISSION_REQUIRED',
    });
  }

  if (
    isTemporarilyRetryableAuthFailure
    || statusCode === 408
    || statusCode === 429
    || (statusCode !== undefined && statusCode >= 500 && !isLikelyPermanentSuunto500(error))
    || (statusCode === undefined && isTransientProviderTransportError(error))
  ) {
    return new ProviderOperationError({
      ...common,
      disposition: 'retryable',
      retryMode: context.retryMode,
      code: statusCode === 429 ? 'resource-exhausted' : 'unavailable',
      message: 'Suunto activity upload is temporarily unavailable. Please retry.',
      dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
    });
  }

  const httpsCode = error instanceof HttpsError ? error.code : undefined;
  if (httpsCode === 'unauthenticated') {
    return new ProviderOperationError({
      ...common,
      disposition: 'auth_required',
      retryMode: 'none',
      code: 'unauthenticated',
      message,
      dlqContext: 'SUUNTO_AUTH_REQUIRED',
    });
  }
  if (httpsCode === 'permission-denied') {
    return new ProviderOperationError({
      ...common,
      disposition: 'permission_required',
      retryMode: 'none',
      code: 'permission-denied',
      message,
      dlqContext: 'SUUNTO_PERMISSION_REQUIRED',
    });
  }
  if (httpsCode === 'unavailable' || httpsCode === 'deadline-exceeded' || httpsCode === 'resource-exhausted') {
    return new ProviderOperationError({
      ...common,
      disposition: 'retryable',
      retryMode: context.retryMode,
      code: httpsCode,
      message,
      dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
    });
  }

  return new ProviderOperationError({
    ...common,
    disposition: 'permanent',
    retryMode: 'none',
    code: 'failed-precondition',
    message,
    dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_REJECTED',
  });
}

function toSuuntoProcessingStatusError(
  providerMessage: string,
  providerUserId: string,
  uploadId: string,
): ProviderOperationError {
  const message = `Suunto processing failed: ${providerMessage || 'Unknown provider error'}`;
  const permanent = isExplicitSuuntoContentRejectionMessage(providerMessage);
  return new ProviderOperationError({
    serviceName: ServiceNames.SuuntoApp,
    operation: 'activity_upload_status',
    disposition: permanent ? 'permanent' : 'retryable',
    retryMode: permanent ? 'none' : 'restart',
    code: permanent ? 'failed-precondition' : 'unavailable',
    message,
    providerCode: 'ERROR',
    providerUserId,
    providerOperationId: uploadId,
    dlqContext: permanent
      ? 'SUUNTO_ACTIVITY_UPLOAD_REJECTED'
      : 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
  });
}

async function pollSuuntoActivityUploadStatus(
  userID: string,
  providerUserId: string,
  uploadId: string,
  accessToken: string,
): Promise<SuuntoActivityUploadResult> {
  let status = 'NEW';
  let statusRequestAttempts = 0;

  while (statusRequestAttempts < SUUNTO_MAX_STATUS_REQUEST_ATTEMPTS) {
    await sleep(SUUNTO_STATUS_POLL_DELAY_MS);
    await assertSuuntoActivityUploadUserActive(userID, 'before_status_poll');

    try {
      const remainingStatusRequestAttempts = SUUNTO_MAX_STATUS_REQUEST_ATTEMPTS - statusRequestAttempts;
      const maxStatusRequestRetries = Math.min(
        SUUNTO_MAX_TRANSIENT_RETRIES,
        Math.max(0, remainingStatusRequestAttempts - 1)
      );
      const statusJson = await withSuuntoTransientRetry(
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

      if (!statusJson || !statusJson.status) {
        logger.warn('Suunto activity status response omitted status.', {
          userID,
          providerUserId,
          uploadId,
          statusRequestAttempts,
        });
        continue;
      }

      status = `${statusJson.status}`.trim().toUpperCase();
      const providerMessage = typeof statusJson.message === 'string' ? statusJson.message.trim() : '';

      if (status === 'ERROR' && providerMessage.toLowerCase() === 'already exists') {
        logger.info('Activity already exists in Suunto.', { userID, providerUserId, uploadId });
        return {
          status: 'info',
          code: 'ALREADY_EXISTS',
          message: 'Activity already exists in Suunto',
          uploadId,
          providerUserId,
        };
      }

      logger.info('Suunto activity upload status received.', {
        userID,
        providerUserId,
        uploadId,
        status,
        statusRequestAttempts,
        maxStatusRequestAttempts: SUUNTO_MAX_STATUS_REQUEST_ATTEMPTS,
      });

      if (status === 'PROCESSED') {
        return {
          status: 'success',
          message: 'Activity uploaded to Suunto',
          workoutKey: typeof statusJson.workoutKey === 'string' ? statusJson.workoutKey : undefined,
          uploadId,
          providerUserId,
        };
      }
      if (status === 'ERROR') {
        throw toSuuntoProcessingStatusError(providerMessage, providerUserId, uploadId);
      }
    } catch (error: unknown) {
      if (isProviderOperationError(error) || shouldPreserveServiceLifecycleError(error)) {
        throw error;
      }
      if (isRetryableSuuntoTransientError(error, true) && statusRequestAttempts < SUUNTO_MAX_STATUS_REQUEST_ATTEMPTS) {
        logger.warn('Transient Suunto activity status request failed; continuing current upload.', {
          userID,
          providerUserId,
          uploadId,
          statusCode: getStatusCode(error),
          statusRequestAttempts,
          maxStatusRequestAttempts: SUUNTO_MAX_STATUS_REQUEST_ATTEMPTS,
        });
        continue;
      }
      throw toSuuntoProviderOperationError(error, {
        operation: 'activity_upload_status',
        retryMode: 'resume',
        providerUserId,
        uploadId,
      });
    }
  }

  return {
    status: 'pending',
    code: 'PROCESSING',
    message: `Suunto is still processing the activity with status ${status}.`,
    uploadId,
    providerUserId,
  };
}

async function countSuccessfulSuuntoActivityUpload(userID: string, result: SuuntoActivityUploadResult): Promise<void> {
  if (result.status !== 'success' || !result.uploadId) {
    return;
  }
  try {
    await incrementUploadedActivitiesCountIfUserActive(userID, { uploadId: result.uploadId });
  } catch (error: unknown) {
    logger.error('Could not update uploadedActivities count', error);
  }
}

export async function recordSuccessfulSuuntoActivityUploadForQueueItem(
  userID: string,
  queueItemRef: admin.firestore.DocumentReference,
  uploadId: string,
): Promise<void> {
  try {
    await incrementUploadedActivitiesCountIfUserActive(userID, {
      queueItemRef,
      uploadId,
    });
  } catch (error: unknown) {
    logger.error('Could not idempotently update uploadedActivities count for activity-sync queue item', error);
  }
}

function logSuuntoActivityProviderFailure(userID: string, error: ProviderOperationError): void {
  const details = {
    userID,
    serviceName: error.serviceName,
    operation: error.operation,
    disposition: error.disposition,
    retryMode: error.retryMode,
    code: error.code,
    statusCode: error.statusCode,
    providerUserId: error.providerUserId,
    providerOperationId: error.providerOperationId,
    message: error.message,
    dlqContext: error.dlqContext,
  };
  if (error.disposition === 'retryable') {
    logger.warn('[SuuntoActivityUpload] Provider operation will be retried.', details);
  } else {
    logger.error('[SuuntoActivityUpload] Provider operation failed permanently.', details);
  }
}

export async function getSuuntoActivityUploadStatus(
  userID: string,
  uploadId: string,
  providerUserId: string,
): Promise<SuuntoActivityUploadResult> {
  await assertSuuntoActivityUploadUserActive(userID, 'before_token_lookup');
  const tokenSnapshot = await admin.firestore()
    .collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME)
    .doc(userID)
    .collection('tokens')
    .doc(providerUserId)
    .get();

  if (!tokenSnapshot.exists) {
    throw new HttpsError('unauthenticated', 'No connected Suunto account found.');
  }

  try {
    const result = await executeWithTokenRetry(
      tokenSnapshot,
      async (accessToken) => pollSuuntoActivityUploadStatus(
        userID,
        providerUserId,
        uploadId,
        accessToken,
      ),
      `Check activity upload ${uploadId} for user ${userID}`,
    );
    return result;
  } catch (error: unknown) {
    if (shouldPreserveServiceLifecycleError(error) || error instanceof HttpsError) {
      throw error;
    }
    const normalizedError = toSuuntoProviderOperationError(error, {
      operation: 'activity_upload_status',
      retryMode: 'resume',
      providerUserId,
      uploadId,
    });
    logSuuntoActivityProviderFailure(userID, normalizedError);
    throw normalizedError;
  }
}

export async function uploadActivityFileToSuunto(
  userID: string,
  fileBuffer: Buffer,
  options: SuuntoActivityUploadOptions = {},
): Promise<SuuntoActivityUploadResult> {
  await assertSuuntoActivityUploadUserActive(userID, 'before_token_lookup');

  const tokenQuerySnapshots = await admin.firestore().collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME).doc(userID).collection('tokens').get();
  logger.info(`Found ${tokenQuerySnapshots.size} tokens for user ${userID}`);

  if (tokenQuerySnapshots.empty) {
    throw new HttpsError('unauthenticated', 'No connected Suunto account found.');
  }

  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {
    const providerUserId = tokenQueryDocumentSnapshot.id;
    try {
      const initializedUpload = await executeWithTokenRetry(
        tokenQueryDocumentSnapshot,
        async (accessToken) => {
          await assertSuuntoActivityUploadUserActive(userID, 'before_init_upload');
          try {
            return await withSuuntoTransientRetry(
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
          } catch (error: unknown) {
            throw toSuuntoProviderOperationError(error, {
              operation: 'activity_upload_init',
              retryMode: 'restart',
              providerUserId,
            });
          }
        },
        `Initialize activity upload for user ${userID}`
      );

      if (!initializedUpload || !initializedUpload.url || !initializedUpload.id) {
        throw new ProviderOperationError({
          serviceName: ServiceNames.SuuntoApp,
          operation: 'activity_upload_init',
          disposition: 'permanent',
          retryMode: 'none',
          code: 'failed-precondition',
          message: 'Invalid response from Suunto initialization.',
          providerUserId,
          dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_INVALID_RESPONSE',
        });
      }

      const url = `${initializedUpload.url}`;
      const uploadId = `${initializedUpload.id}`;
      const blobHeaders = { ...(initializedUpload.headers || {}) };
      logger.info('Suunto activity upload initialized.', {
        userID,
        providerUserId,
        uploadId,
      });

      if (options.persistUploadStateBeforeBlob) {
        let persisted: boolean;
        try {
          persisted = await options.persistUploadStateBeforeBlob({
            uploadId,
            providerUserId,
          });
        } catch (error: unknown) {
          throw new SuuntoActivityUploadStatePersistenceError(error);
        }
        if (!persisted) {
          throw new SuuntoActivityUploadStatePersistenceSkippedError(userID, uploadId);
        }
      }

      await assertSuuntoActivityUploadUserActive(userID, 'before_blob_upload');
      try {
        await withSuuntoTransientRetry(
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
        logger.info('Suunto activity blob upload completed.', {
          userID,
          providerUserId,
          uploadId,
        });
      } catch (error: unknown) {
        throw toSuuntoProviderOperationError(error, {
          operation: 'activity_upload_blob',
          // Once Suunto issues an upload ID, an HTTP/transport failure does
          // not prove that the blob PUT was rejected. Resume by polling the
          // existing job instead of creating a second provider upload.
          retryMode: 'resume',
          providerUserId,
          uploadId,
        });
      }

      // Token refresh may repeat status polling, but must never repeat upload
      // initialization or blob delivery after Suunto has issued an upload ID.
      return executeWithTokenRetry(
        tokenQueryDocumentSnapshot,
        accessToken => pollSuuntoActivityUploadStatus(userID, providerUserId, uploadId, accessToken),
        `Check activity upload ${uploadId} for user ${userID}`,
      );
    } catch (error: unknown) {
      if (shouldPreserveServiceLifecycleError(error)) {
        throw error;
      }
      const normalizedError = toSuuntoProviderOperationError(error, {
        operation: 'activity_upload_init',
        retryMode: 'restart',
        providerUserId,
      });
      logSuuntoActivityProviderFailure(userID, normalizedError);
      throw normalizedError;
    }
  }

  return {
    status: 'success',
    message: 'Activity upload completed',
  };
}

function toSuuntoActivityCallableError(error: ProviderOperationError): HttpsError {
  const details = {
    retryMode: error.retryMode,
    ...(error.retryMode === 'resume' && error.providerOperationId && error.providerUserId
      ? {
        resumeUploadId: error.providerOperationId,
        resumeProviderUserId: error.providerUserId,
      }
      : {}),
  };
  switch (error.disposition) {
    case 'retryable':
      return new HttpsError('unavailable', 'Suunto activity upload is temporarily unavailable. Please retry.', details);
    case 'auth_required':
      return new HttpsError('unauthenticated', 'Authentication failed. Please re-connect your Suunto account.', details);
    case 'permission_required':
      return new HttpsError('permission-denied', 'Suunto rejected this operation because the connection lacks permission.', details);
    case 'permanent':
    default:
      return new HttpsError('internal', error.message, details);
  }
}

function getSuuntoActivityCallableResumeState(data: unknown): SuuntoActivityUploadInitializationState | null {
  const requestData = data as {
    resumeUploadId?: unknown;
    resumeProviderUserId?: unknown;
  } | null;
  const rawUploadId = requestData?.resumeUploadId;
  const rawProviderUserId = requestData?.resumeProviderUserId;
  if (rawUploadId !== undefined && rawUploadId !== null && typeof rawUploadId !== 'string') {
    throw new HttpsError('invalid-argument', 'Suunto resume identifiers must be strings.');
  }
  if (rawProviderUserId !== undefined && rawProviderUserId !== null && typeof rawProviderUserId !== 'string') {
    throw new HttpsError('invalid-argument', 'Suunto resume identifiers must be strings.');
  }
  const uploadId = `${rawUploadId || ''}`.trim();
  const providerUserId = `${rawProviderUserId || ''}`.trim();
  if (!uploadId && !providerUserId) {
    return null;
  }
  if (
    !uploadId
    || !providerUserId
    || uploadId.length > 200
    || providerUserId.length > 200
    || uploadId.includes('/')
    || providerUserId.includes('/')
  ) {
    throw new HttpsError('invalid-argument', 'Both Suunto resume identifiers are required.');
  }
  return { uploadId, providerUserId };
}

function toPendingSuuntoActivityUploadError(result: SuuntoActivityUploadResult): ProviderOperationError {
  return new ProviderOperationError({
    serviceName: ServiceNames.SuuntoApp,
    operation: 'activity_upload_status',
    disposition: 'retryable',
    retryMode: 'resume',
    code: 'deadline-exceeded',
    message: result.message || 'Suunto is still processing the activity.',
    providerOperationId: result.uploadId,
    providerUserId: result.providerUserId,
    dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
  });
}

function toSuuntoActivityCallableResult(
  result: SuuntoActivityUploadResult,
): Omit<SuuntoActivityUploadResult, 'providerUserId'> {
  return {
    status: result.status,
    message: result.message,
    ...(result.code !== undefined ? { code: result.code } : {}),
    ...(result.workoutKey !== undefined ? { workoutKey: result.workoutKey } : {}),
    ...(result.uploadId !== undefined ? { uploadId: result.uploadId } : {}),
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

  if (size > MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES) {
    throw new HttpsError('invalid-argument', `Cannot upload activity because the size is greater than ${MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES_LABEL}`);
  }

  try {
    const resumeState = getSuuntoActivityCallableResumeState(request.data);
    const result = resumeState
      ? await getSuuntoActivityUploadStatus(userID, resumeState.uploadId, resumeState.providerUserId)
      : await uploadActivityFileToSuunto(userID, fileBuffer);
    if (result.status === 'pending') {
      throw toPendingSuuntoActivityUploadError(result);
    }
    await countSuccessfulSuuntoActivityUpload(userID, result);
    return toSuuntoActivityCallableResult(result);
  } catch (error: unknown) {
    if (isProviderOperationError(error)) {
      throw toSuuntoActivityCallableError(error);
    }
    throw error;
  }
});
