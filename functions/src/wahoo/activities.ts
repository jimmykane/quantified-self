'use strict';

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { ServiceNames, WahooAPIAuth2ServiceTokenInterface } from '@sports-alliance/sports-lib';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { isServiceDisconnectPendingForUser } from '../service-disconnect-pending';
import {
  getUserDeletionGuardState,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import { getTokenData } from '../tokens';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import {
  SERVICE_NAME,
  WAHOO_API_WORKOUTS_WRITE_SCOPE,
} from './constants';
import { WahooAPIRequestError, WahooAPITransportError, requestWahooAPI } from './auth/api';
import {
  getWahooErrorLogDetails,
  getWahooProviderErrorMessage,
  isWahooDuplicateError,
  isWahooDuplicateMessage,
} from './error-details';
import { MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES, MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES_LABEL } from '../shared/activity-processing-config';
import {
  isProviderOperationError,
  isTerminalServiceAuthError,
  ProviderOperationError,
} from '../shared/provider-operation-error';
import { ProviderPendingDisconnectError } from '../shared/provider-pending-disconnect-error';
import {
  assertWahooConnectionAvailable,
  isWahooRefreshContentionError,
  isWahooReconnectRequiredError,
  isWahooRefreshBackoffError,
} from './refresh-recovery';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import {
  ActivitySyncOutboundFingerprintSkippedForDeletedUserError,
  completeActivitySyncOutboundFingerprintProviderRequest,
  recordActivitySyncOutboundFingerprint,
  markActivitySyncOutboundFingerprintProviderRequestStarted,
  rollbackActivitySyncOutboundFingerprint,
  type ActivitySyncOutboundFingerprintRecord,
} from '../activity-sync/outbound-fingerprint';
import {
  assertWahooActiveAccountGuardCurrent,
  captureWahooActiveAccountGuard,
  getActiveWahooTokenSnapshot,
  normalizeWahooUserID,
} from './account';
import {
  getWahooWorkoutTypeById,
  WahooWorkoutType,
} from '../../../shared/wahoo-activity-types';

const MAX_BASE64_ACTIVITY_UPLOAD_LENGTH = Math.ceil(MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES / 3) * 4 + 4;
const WAHOO_UPLOAD_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const WAHOO_WORKOUT_ID_PATTERN = /^\d{1,20}$/;

interface WahooWorkoutFileUploadPayload {
  token?: unknown;
  status?: unknown;
  workout_id?: unknown;
  workout_summary_id?: unknown;
  error?: unknown;
}

export interface WahooActivityUploadResult {
  status: 'success' | 'duplicate' | 'pending';
  code?: 'ALREADY_EXISTS';
  message: string;
  uploadId?: string;
  workoutKey?: string;
  expectedWorkoutTypeId?: number;
}

export interface WahooActivityUploadOptions {
  filename?: unknown;
  timeZone?: unknown;
  expectedWorkoutTypeId?: number | null;
  /** Runs after account validation and immediately before the provider request. */
  beforeProviderRequest?: () => Promise<void>;
  /** Rolls back preparation only when no provider request was issued. */
  onProviderRequestAborted?: () => Promise<void>;
  /** Promote pre-request state; account ownership is revalidated before I/O. */
  onProviderRequestStarting?: () => Promise<void>;
  /** Finalizes pre-request state after Wahoo has been attempted. */
  onProviderRequestFinished?: () => Promise<void>;
}

export class WahooActivityUploadSkippedForDeletedUserError extends Error {
  public readonly name = 'WahooActivityUploadSkippedForDeletedUserError';

  constructor(
    public readonly userID: string,
    public readonly phase: string,
  ) {
    super(`Skipping Wahoo activity upload for user ${userID} during ${phase} because the user is missing or deletion is in progress.`);
  }
}

export class WahooWorkoutWriteScopeRequiredError extends HttpsError {
  public override readonly name = 'WahooWorkoutWriteScopeRequiredError';

  constructor() {
    super('failed-precondition', 'Reconnect Wahoo and allow workout access before sending activities.');
  }
}

function hasWahooWorkoutsWriteScope(scope: unknown): boolean {
  return `${scope || ''}`
    .split(/\s+/)
    .some((value) => value.trim() === WAHOO_API_WORKOUTS_WRITE_SCOPE);
}

function normalizeIdentifier(value: unknown): string | undefined {
  const normalized = `${value || ''}`.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeWahooUploadToken(value: unknown): string | undefined {
  const token = normalizeIdentifier(value);
  return token && WAHOO_UPLOAD_TOKEN_PATTERN.test(token) ? token : undefined;
}

function normalizeWahooWorkoutId(value: unknown): string | undefined {
  const workoutId = normalizeIdentifier(value);
  return workoutId && WAHOO_WORKOUT_ID_PATTERN.test(workoutId) ? workoutId : undefined;
}

function resolveExpectedWahooWorkoutType(value: unknown): WahooWorkoutType | null {
  if (value === undefined || value === null) {
    return null;
  }
  const workoutType = getWahooWorkoutTypeById(value);
  if (!workoutType) {
    throw new HttpsError('invalid-argument', 'Invalid expected Wahoo workout type.');
  }
  return workoutType;
}

function getStatus(payload: WahooWorkoutFileUploadPayload): string {
  return `${payload.status || ''}`.trim().toLowerCase();
}

function toDuplicateWahooActivityUploadResult(
  payload: WahooWorkoutFileUploadPayload,
  expectedWorkoutType?: WahooWorkoutType | null,
): WahooActivityUploadResult {
  return {
    status: 'duplicate',
    code: 'ALREADY_EXISTS',
    message: 'Activity already exists in Wahoo.',
    uploadId: normalizeWahooUploadToken(payload.token),
    workoutKey: normalizeIdentifier(payload.workout_id || payload.workout_summary_id),
    ...(expectedWorkoutType ? { expectedWorkoutTypeId: expectedWorkoutType.id } : {}),
  };
}

function toWahooActivityUploadResult(
  payload: WahooWorkoutFileUploadPayload,
  operation: 'upload' | 'status',
  expectedWorkoutType?: WahooWorkoutType | null,
): WahooActivityUploadResult {
  const status = getStatus(payload);
  const uploadId = normalizeWahooUploadToken(payload.token);
  const workoutKey = normalizeIdentifier(payload.workout_id || payload.workout_summary_id);

  if (status === 'complete' || status === 'completed') {
    if (!uploadId) {
      throw Object.assign(
        new HttpsError(
          'failed-precondition',
          'Wahoo completed the activity upload without returning the identifier required to reconcile it safely.',
        ),
        { dlqContext: 'WAHOO_ACTIVITY_UPLOAD_INVALID_RESPONSE' },
      );
    }
    return {
      status: 'success',
      message: 'Activity uploaded to Wahoo.',
      uploadId,
      workoutKey,
      ...(expectedWorkoutType ? { expectedWorkoutTypeId: expectedWorkoutType.id } : {}),
    };
  }

  const providerMessage = getWahooProviderErrorMessage(payload.error);
  if (status === 'duplicate' || (status === 'error' && isWahooDuplicateMessage(providerMessage))) {
    logger.info('Wahoo reported a duplicate activity upload', {
      operation,
      status,
      ...(providerMessage ? { providerMessage } : {}),
    });
    return toDuplicateWahooActivityUploadResult(payload, expectedWorkoutType);
  }

  if (status === 'error' || status === 'failed') {
    logger.warn('Wahoo could not process an activity upload', {
      operation,
      status,
      ...(providerMessage ? { providerMessage } : {}),
    });
    const message = providerMessage
      ? `Wahoo could not process this activity: ${providerMessage}`
      : 'Wahoo could not process this activity.';
    throw new HttpsError('failed-precondition', message, {
      retryMode: 'restart',
      providerOperation: `activity_upload_${operation}`,
    });
  }

  if (!uploadId) {
    throw Object.assign(
      new HttpsError(
        'failed-precondition',
        'Wahoo did not return the upload identifier required to reconcile this activity safely.',
      ),
      { dlqContext: 'WAHOO_ACTIVITY_UPLOAD_INVALID_RESPONSE' },
    );
  }

  return {
    status: 'pending',
    message: 'Wahoo is processing the activity.',
    uploadId,
    workoutKey,
    ...(expectedWorkoutType ? { expectedWorkoutTypeId: expectedWorkoutType.id } : {}),
  };
}

function normalizeFilename(value: unknown): string | undefined {
  const filename = `${value || ''}`.trim().replace(/[\\/]/g, '_').slice(0, 200);
  return filename.length > 0 ? filename : undefined;
}

function normalizeTimeZone(value: unknown): string | undefined {
  const timeZone = `${value || ''}`.trim().slice(0, 100);
  if (!timeZone) return undefined;
  try {
    Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

async function assertWahooActivityUploadUserActive(userID: string, phase: string): Promise<void> {
  let deletionGuard;
  try {
    deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
  } catch (error) {
    throw new UserDeletionGuardReadError(userID, `wahoo_activity_upload:${phase}`, error);
  }

  if (!deletionGuard.shouldSkip) return;
  throw new WahooActivityUploadSkippedForDeletedUserError(userID, phase);
}

async function assertWahooActivityUploadProviderActionAllowed(userID: string, phase: string): Promise<void> {
  await assertWahooActivityUploadUserActive(userID, phase);
  if (await isServiceDisconnectPendingForUser(userID, SERVICE_NAME)) {
    throw new ProviderPendingDisconnectError(userID, ServiceNames.WahooAPI, phase);
  }
  await assertWahooConnectionAvailable(userID);
}

function toWahooHttpsError(error: unknown): never {
  if (isWahooReconnectRequiredError(error) || isTerminalServiceAuthError(error)) {
    throw Object.assign(
      new HttpsError('unauthenticated', 'Reconnect Wahoo before sending activities.'),
      { name: 'WahooReconnectRequiredError' },
    );
  }
  if (isWahooRefreshBackoffError(error)) {
    throw new HttpsError('unavailable', 'Wahoo token refresh is temporarily paused. Please retry later.', {
      retryAt: error.retryAt,
    });
  }
  if (isWahooRefreshContentionError(error)) {
    throw new HttpsError('unavailable', 'Wahoo credentials are being refreshed. Please retry shortly.');
  }
  if (error instanceof WahooAPITransportError) {
    throw new HttpsError('unavailable', 'Wahoo is temporarily unavailable. Please retry.');
  }
  if (!(error instanceof WahooAPIRequestError)) throw error;
  if (error.statusCode === 401) {
    throw new HttpsError('unauthenticated', 'Reconnect Wahoo before sending activities.');
  }
  if (error.statusCode === 403) {
    throw new HttpsError('permission-denied', 'Reconnect Wahoo and allow workout access before sending activities.');
  }
  if (error.statusCode === 429) {
    throw new HttpsError('resource-exhausted', 'Wahoo is rate-limiting uploads. Please retry shortly.', {
      retryAfterSeconds: error.resetAfterSeconds,
    });
  }
  if (error.statusCode === 408 || error.statusCode >= 500) {
    throw new HttpsError('unavailable', 'Wahoo is temporarily unavailable. Please retry.');
  }
  const providerMessage = getWahooProviderErrorMessage(error);
  throw new HttpsError(
    'failed-precondition',
    providerMessage ? `Wahoo rejected the activity upload: ${providerMessage}` : 'Wahoo rejected the activity upload.',
  );
}

function getAmbiguousWahooActivityUploadError(error: unknown): ProviderOperationError | null {
  const statusCode = error instanceof WahooAPIRequestError ? error.statusCode : undefined;
  if (
    !(error instanceof WahooAPITransportError)
    && statusCode !== 408
    && !(statusCode !== undefined && statusCode >= 500)
  ) {
    return null;
  }

  return new ProviderOperationError({
    serviceName: ServiceNames.WahooAPI,
    operation: 'activity_upload_init',
    disposition: 'permanent',
    retryMode: 'none',
    code: 'failed-precondition',
    message: 'Wahoo did not confirm whether the activity upload was accepted. Check Wahoo before trying again.',
    statusCode,
    dlqContext: 'WAHOO_ACTIVITY_UPLOAD_AMBIGUOUS',
  });
}

async function withWahooWorkoutWriteToken<T>(
  userID: string,
  operation: (accessToken: string) => Promise<T>,
  hooks: Pick<
    WahooActivityUploadOptions,
    'beforeProviderRequest'
    | 'onProviderRequestAborted'
    | 'onProviderRequestStarting'
    | 'onProviderRequestFinished'
  > = {},
): Promise<T> {
  await assertWahooActivityUploadProviderActionAllowed(userID, 'before_token_lookup');

  const initialTokenSnapshot = await getActiveWahooTokenSnapshot(userID);
  const providerUserId = initialTokenSnapshot.id;

  const execute = async (forceRefresh: boolean): Promise<T> => {
    const currentTokenSnapshot = await getActiveWahooTokenSnapshot(userID, providerUserId);
    const token = await getTokenData(
      currentTokenSnapshot,
      ServiceNames.WahooAPI,
      forceRefresh,
    ) as WahooAPIAuth2ServiceTokenInterface;
    if (normalizeWahooUserID(token.wahooUserID) !== providerUserId) {
      throw new HttpsError('unauthenticated', 'Reconnect Wahoo before sending activities.');
    }
    if (!hasWahooWorkoutsWriteScope(token.scope)) {
      throw new WahooWorkoutWriteScopeRequiredError();
    }
    await assertWahooActivityUploadProviderActionAllowed(userID, 'before_provider_request');
    const accountGuard = await captureWahooActiveAccountGuard(
      userID,
      providerUserId,
      token.accessToken,
    );
    let providerPreparationCompleted = false;
    let providerRequestStarted = false;
    try {
      if (hooks.beforeProviderRequest) {
        await hooks.beforeProviderRequest();
        providerPreparationCompleted = true;
        await assertWahooActivityUploadProviderActionAllowed(userID, 'after_pre_request_write');
      }
      await assertWahooActiveAccountGuardCurrent(userID, accountGuard);
      if (hooks.onProviderRequestStarting) {
        await hooks.onProviderRequestStarting();
        // Fingerprint promotion is an awaited Firestore transaction. A
        // disconnect, credential rotation, or account switch can win while it
        // is in flight, so prove ownership again immediately before the
        // irreversible provider request.
        await assertWahooActiveAccountGuardCurrent(userID, accountGuard);
      }
      providerRequestStarted = true;
      try {
        return await operation(token.accessToken);
      } finally {
        if (hooks.onProviderRequestFinished) {
          try {
            await hooks.onProviderRequestFinished();
          } catch (completionError) {
            logger.error('Could not finalize a Wahoo outbound fingerprint after the provider request started.', {
              error: getWahooErrorLogDetails(completionError),
            });
          }
        }
      }
    } catch (error) {
      if (providerPreparationCompleted && !providerRequestStarted && hooks.onProviderRequestAborted) {
        try {
          await hooks.onProviderRequestAborted();
        } catch (rollbackError) {
          logger.error('Could not roll back an unused Wahoo outbound fingerprint.', {
            error: getWahooErrorLogDetails(rollbackError),
          });
        }
      }
      throw error;
    }
  };

  try {
    return await execute(false);
  } catch (error) {
    if (error instanceof WahooAPIRequestError && error.statusCode === 401) {
      return execute(true);
    }
    throw error;
  }
}

class WahooActivityTypeCorrectionError extends ProviderOperationError {
  constructor(
    options: ConstructorParameters<typeof ProviderOperationError>[0],
    readonly expectedWorkoutTypeId: number,
  ) {
    super(options);
  }
}

class WahooActivityTypeCorrectionPendingDisconnectError extends ProviderPendingDisconnectError {
  constructor(
    pendingDisconnectError: ProviderPendingDisconnectError,
    readonly providerOperationId: string,
    readonly expectedWorkoutTypeId: number,
  ) {
    super(
      pendingDisconnectError.userID,
      pendingDisconnectError.serviceName,
      pendingDisconnectError.phase,
    );
  }
}

function toWahooActivityTypeCorrectionError(
  error: unknown,
  uploadId: string,
  expectedWorkoutTypeId: number,
): never {
  if (error instanceof ProviderPendingDisconnectError) {
    throw new WahooActivityTypeCorrectionPendingDisconnectError(
      error,
      uploadId,
      expectedWorkoutTypeId,
    );
  }
  if (isTerminalServiceAuthError(error)) {
    throw new WahooActivityTypeCorrectionError({
      serviceName: ServiceNames.WahooAPI,
      operation: 'activity_upload_status',
      disposition: 'auth_required',
      retryMode: 'none',
      code: 'unauthenticated',
      message: 'Reconnect Wahoo before updating this accepted activity.',
      statusCode: error.statusCode || undefined,
      providerOperationId: uploadId,
      dlqContext: 'WAHOO_ACTIVITY_TYPE_CORRECTION_AUTH_RECONCILIATION_REQUIRED',
    }, expectedWorkoutTypeId);
  }
  const statusCode = error instanceof WahooAPIRequestError ? error.statusCode : undefined;
  const retryable = error instanceof WahooAPITransportError
    || statusCode === 408
    || statusCode === 429
    || (statusCode !== undefined && statusCode >= 500);
  if (retryable) {
    throw new WahooActivityTypeCorrectionError({
      serviceName: ServiceNames.WahooAPI,
      operation: 'activity_upload_status',
      disposition: 'retryable',
      retryMode: 'resume',
      code: statusCode === 429 ? 'resource-exhausted' : 'unavailable',
      message: statusCode === 429
        ? 'Wahoo is rate-limiting workout updates. Please retry shortly.'
        : 'Wahoo is temporarily unable to update the workout type. Please retry.',
      statusCode,
      retryAfterSeconds: error instanceof WahooAPIRequestError ? error.resetAfterSeconds || undefined : undefined,
      providerOperationId: uploadId,
      dlqContext: 'WAHOO_ACTIVITY_TYPE_CORRECTION_RETRY_EXHAUSTED',
    }, expectedWorkoutTypeId);
  }
  if (statusCode === 401 || statusCode === 403) {
    throw new WahooActivityTypeCorrectionError({
      serviceName: ServiceNames.WahooAPI,
      operation: 'activity_upload_status',
      disposition: statusCode === 401 ? 'auth_required' : 'permission_required',
      retryMode: 'none',
      code: statusCode === 401 ? 'unauthenticated' : 'permission-denied',
      message: statusCode === 401
        ? 'Reconnect Wahoo before updating this accepted activity.'
        : 'Reconnect Wahoo and allow workout access before updating this accepted activity.',
      statusCode,
      providerOperationId: uploadId,
      dlqContext: statusCode === 401
        ? 'WAHOO_ACTIVITY_TYPE_CORRECTION_AUTH_RECONCILIATION_REQUIRED'
        : 'WAHOO_ACTIVITY_TYPE_CORRECTION_PERMISSION_RECONCILIATION_REQUIRED',
    }, expectedWorkoutTypeId);
  }
  if (error instanceof WahooAPIRequestError) {
    const providerMessage = getWahooProviderErrorMessage(error);
    throw new WahooActivityTypeCorrectionError({
      serviceName: ServiceNames.WahooAPI,
      operation: 'activity_upload_status',
      disposition: 'permanent',
      retryMode: 'none',
      code: 'failed-precondition',
      message: providerMessage
        ? `Wahoo rejected the workout type update: ${providerMessage}`
        : 'Wahoo rejected the workout type update.',
      statusCode,
      providerOperationId: uploadId,
      dlqContext: 'WAHOO_ACTIVITY_TYPE_CORRECTION_REJECTED',
    }, expectedWorkoutTypeId);
  }
  throw error;
}

async function correctCompletedWahooActivityType(params: {
  userID: string;
  uploadId?: string;
  workoutId: unknown;
  expectedWorkoutType: WahooWorkoutType | null;
}): Promise<void> {
  const expectedWorkoutType = params.expectedWorkoutType;
  if (!expectedWorkoutType) {
    return;
  }
  const workoutId = normalizeWahooWorkoutId(params.workoutId);
  if (!workoutId) {
    throw new WahooActivityTypeCorrectionError({
      serviceName: ServiceNames.WahooAPI,
      operation: 'activity_upload_status',
      disposition: 'permanent',
      retryMode: 'none',
      code: 'failed-precondition',
      message: 'Wahoo completed the activity upload without returning the workout identifier required to correct its type.',
      providerOperationId: params.uploadId,
      dlqContext: 'WAHOO_ACTIVITY_TYPE_CORRECTION_MISSING_WORKOUT_ID',
    }, expectedWorkoutType.id);
  }

  try {
    await withWahooWorkoutWriteToken(params.userID, async (accessToken) => {
      const form = new URLSearchParams();
      form.set('workout[workout_type_id]', `${expectedWorkoutType.id}`);
      await requestWahooAPI(
        accessToken,
        `/v1/workouts/${encodeURIComponent(workoutId)}`,
        { method: 'PUT', form },
      );
    });
    logger.info('Corrected Wahoo workout activity type after FIT processing.', {
      uploadId: params.uploadId,
      workoutId,
      workoutTypeId: expectedWorkoutType.id,
      workoutTypeName: expectedWorkoutType.name,
    });
  } catch (error) {
    logWahooActivityUploadRequestError(error, 'status');
    if (!params.uploadId) {
      throw new ProviderOperationError({
        serviceName: ServiceNames.WahooAPI,
        operation: 'activity_upload_status',
        disposition: 'permanent',
        retryMode: 'none',
        code: 'failed-precondition',
        message: `Wahoo accepted duplicate workout ${workoutId}, but did not return the upload identifier required to resume its type correction safely.`,
        dlqContext: 'WAHOO_ACTIVITY_TYPE_CORRECTION_DUPLICATE_NO_RESUME_ID',
      });
    }
    return toWahooActivityTypeCorrectionError(error, params.uploadId, expectedWorkoutType.id);
  }
}

function logWahooActivityUploadRequestError(error: unknown, operation: 'upload' | 'status'): void {
  if (!(error instanceof WahooAPIRequestError)) return;
  const logDetails = getWahooErrorLogDetails(error);
  if (isWahooDuplicateError(error)) {
    logger.info('Wahoo identified the activity upload as a duplicate', { operation, ...logDetails });
    return;
  }
  logger.warn('Wahoo activity upload request failed', { operation, ...logDetails });
}

export async function uploadActivityFileToWahoo(
  userID: string,
  fileBuffer: Buffer,
  options: WahooActivityUploadOptions = {},
): Promise<WahooActivityUploadResult> {
  if (fileBuffer.length === 0) {
    throw new HttpsError('invalid-argument', 'File content is empty.');
  }
  if (fileBuffer.length > MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES) {
    throw new HttpsError('invalid-argument', `Cannot upload activity because the size is greater than ${MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES_LABEL}.`);
  }

  const configuredExpectedWorkoutType = resolveExpectedWahooWorkoutType(options.expectedWorkoutTypeId);
  let acceptedUpload: {
    result: WahooActivityUploadResult;
    workoutId?: unknown;
    expectedWorkoutType: WahooWorkoutType | null;
  };
  try {
    acceptedUpload = await withWahooWorkoutWriteToken(userID, async (accessToken) => {
      const expectedWorkoutType = configuredExpectedWorkoutType;
      const form = new URLSearchParams();
      form.set('workout_file_upload[file]', `data:application/vnd.fit;base64,${fileBuffer.toString('base64')}`);
      const filename = normalizeFilename(options.filename);
      const timeZone = normalizeTimeZone(options.timeZone);
      if (filename) form.set('workout_file_upload[filename]', filename);
      if (timeZone) form.set('workout_file_upload[time_zone]', timeZone);
      const { data } = await requestWahooAPI<WahooWorkoutFileUploadPayload>(
        accessToken,
        '/v1/workout_file_uploads',
        { method: 'POST', form },
      );
      return {
        result: toWahooActivityUploadResult(data || {}, 'upload', expectedWorkoutType),
        workoutId: data?.workout_id,
        expectedWorkoutType,
      };
    }, options);
  } catch (error) {
    logWahooActivityUploadRequestError(error, 'upload');
    if (isWahooDuplicateError(error)) {
      return toDuplicateWahooActivityUploadResult({});
    }
    const ambiguousUploadError = getAmbiguousWahooActivityUploadError(error);
    if (ambiguousUploadError) {
      throw ambiguousUploadError;
    }
    return toWahooHttpsError(error);
  }

  if (
    acceptedUpload.result.status === 'success'
    || (
      acceptedUpload.result.status === 'duplicate'
      && normalizeWahooWorkoutId(acceptedUpload.workoutId)
    )
  ) {
    await correctCompletedWahooActivityType({
      userID,
      uploadId: acceptedUpload.result.uploadId,
      workoutId: acceptedUpload.workoutId,
      expectedWorkoutType: acceptedUpload.expectedWorkoutType,
    });
  }
  return acceptedUpload.result;
}

export async function getWahooActivityUploadStatus(
  userID: string,
  uploadId: unknown,
  expectedWorkoutTypeId?: number | null,
): Promise<WahooActivityUploadResult> {
  const token = normalizeWahooUploadToken(uploadId);
  if (!token) {
    throw new HttpsError('invalid-argument', 'Invalid Wahoo upload identifier.');
  }
  const expectedWorkoutType = resolveExpectedWahooWorkoutType(expectedWorkoutTypeId);

  let acceptedUpload: { result: WahooActivityUploadResult; workoutId?: unknown };
  try {
    acceptedUpload = await withWahooWorkoutWriteToken(userID, async (accessToken) => {
      const { data } = await requestWahooAPI<WahooWorkoutFileUploadPayload>(
        accessToken,
        `/v1/workout_file_uploads/${encodeURIComponent(token)}`,
      );
      return {
        result: toWahooActivityUploadResult(
          { ...(data || {}), token: data?.token || token },
          'status',
          expectedWorkoutType,
        ),
        workoutId: data?.workout_id,
      };
    });
  } catch (error) {
    logWahooActivityUploadRequestError(error, 'status');
    return toWahooHttpsError(error);
  }

  if (
    acceptedUpload.result.status === 'success'
    || (
      acceptedUpload.result.status === 'duplicate'
      && normalizeWahooWorkoutId(acceptedUpload.workoutId)
    )
  ) {
    await correctCompletedWahooActivityType({
      userID,
      uploadId: token,
      workoutId: acceptedUpload.workoutId,
      expectedWorkoutType,
    });
  }
  return acceptedUpload.result;
}

function toUploadBuffer(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpsError('invalid-argument', 'File content missing.');
  }
  if (value.length > MAX_BASE64_ACTIVITY_UPLOAD_LENGTH
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new HttpsError('invalid-argument', 'File content is not valid base64.');
  }
  const fileBuffer = Buffer.from(value, 'base64');
  if (fileBuffer.length === 0) {
    throw new HttpsError('invalid-argument', 'File content is empty.');
  }
  return fileBuffer;
}

async function requireWahooActivityUploadAccess(request: { auth?: { uid: string } | null }): Promise<string> {
  enforceAppCheck(request as unknown as Parameters<typeof enforceAppCheck>[0]);
  if (!request.auth) throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  if (!(await hasProAccess(request.auth.uid))) {
    throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }
  return request.auth.uid;
}

function throwWahooActivityCallableError(error: unknown): never {
  if (error instanceof UserDeletionGuardReadError) {
    throw new HttpsError('unavailable', 'Could not verify account state. Please retry.');
  }
  if (
    error instanceof ActivitySyncOutboundFingerprintSkippedForDeletedUserError
    || error instanceof WahooActivityUploadSkippedForDeletedUserError
  ) {
    throw new HttpsError('failed-precondition', 'Account is being deleted or no longer exists.');
  }
  if (!isProviderOperationError(error)) {
    throw error;
  }
  if (error.disposition === 'auth_required') {
    throw new HttpsError('unauthenticated', error.message);
  }
  if (error.disposition === 'permission_required') {
    throw new HttpsError('permission-denied', error.message);
  }
  if (error.disposition === 'retryable') {
    throw new HttpsError(
      error.code === 'resource-exhausted' ? 'resource-exhausted' : 'unavailable',
      error.message,
      {
        retryMode: error.retryMode,
        resumeUploadId: error.providerOperationId,
        ...(error.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      },
    );
  }
  throw new HttpsError('failed-precondition', error.message);
}

export const importActivityToWahooAPI = onCall({
  region: FUNCTIONS_MANIFEST.importActivityToWahooAPI.region,
  secrets: FUNCTION_SECRET_BINDINGS.importActivityToWahooAPI,
  cors: ALLOWED_CORS_ORIGINS,
  timeoutSeconds: 120,
  maxInstances: 10,
}, async (request) => {
  const userID = await requireWahooActivityUploadAccess(request);
  const fileBuffer = toUploadBuffer(request.data?.file);
  let outboundFingerprint: ActivitySyncOutboundFingerprintRecord | null = null;
  try {
    return await uploadActivityFileToWahoo(userID, fileBuffer, {
      filename: request.data?.filename,
      timeZone: request.data?.timeZone,
      beforeProviderRequest: async () => {
        outboundFingerprint = await recordActivitySyncOutboundFingerprint({
          userID,
          destinationServiceName: ServiceNames.WahooAPI,
          fileBuffer,
          provisional: true,
        });
      },
      onProviderRequestStarting: async () => {
        if (!outboundFingerprint) {
          throw new Error('Missing provisional Wahoo outbound fingerprint.');
        }
        await markActivitySyncOutboundFingerprintProviderRequestStarted({
          userID,
          destinationServiceName: ServiceNames.WahooAPI,
          record: outboundFingerprint,
        });
      },
      onProviderRequestFinished: async () => {
        if (!outboundFingerprint) return;
        await completeActivitySyncOutboundFingerprintProviderRequest({
          userID,
          destinationServiceName: ServiceNames.WahooAPI,
          record: outboundFingerprint,
        });
      },
      onProviderRequestAborted: async () => {
        if (!outboundFingerprint) return;
        await rollbackActivitySyncOutboundFingerprint({
          userID,
          destinationServiceName: ServiceNames.WahooAPI,
          record: outboundFingerprint,
        });
        outboundFingerprint = null;
      },
    });
  } catch (error) {
    return throwWahooActivityCallableError(error);
  }
});

export const getWahooAPIWorkoutFileUploadStatus = onCall({
  region: FUNCTIONS_MANIFEST.getWahooAPIWorkoutFileUploadStatus.region,
  secrets: FUNCTION_SECRET_BINDINGS.getWahooAPIWorkoutFileUploadStatus,
  cors: ALLOWED_CORS_ORIGINS,
  timeoutSeconds: 60,
  maxInstances: 10,
}, async (request) => {
  const userID = await requireWahooActivityUploadAccess(request);
  try {
    const uploadId = normalizeWahooUploadToken(request.data?.uploadId);
    if (!uploadId) {
      throw new HttpsError('invalid-argument', 'Invalid Wahoo upload identifier.');
    }
    return await getWahooActivityUploadStatus(userID, uploadId);
  } catch (error) {
    return throwWahooActivityCallableError(error);
  }
});
