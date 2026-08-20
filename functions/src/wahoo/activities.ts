'use strict';

import { createHmac, timingSafeEqual } from 'node:crypto';
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
  WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME,
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
import { FUNCTION_SECRET_BINDINGS, SECRET_PARAMS } from '../secrets';
import {
  ActivitySyncOutboundFingerprintSkippedForDeletedUserError,
  recordActivitySyncOutboundFingerprint,
} from '../activity-sync/outbound-fingerprint';
import {
  getWahooWorkoutTypeById,
  resolveWahooWorkoutType,
  WahooWorkoutType,
} from '../../../shared/wahoo-activity-types';

const MAX_BASE64_ACTIVITY_UPLOAD_LENGTH = Math.ceil(MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES / 3) * 4 + 4;
const WAHOO_UPLOAD_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const WAHOO_WORKOUT_ID_PATTERN = /^\d{1,20}$/;
const WAHOO_ACTIVITY_UPLOAD_RESUME_TOKEN_VERSION = 'v1';
const WAHOO_ACTIVITY_UPLOAD_RESUME_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const WAHOO_ACTIVITY_UPLOAD_RESUME_TOKEN_PATTERN = /^v1\.([A-Za-z0-9_-]{1,1000})\.([A-Za-z0-9_-]{43})$/;

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
  /** Present only for direct browser uploads that need a server-verified status poll. */
  resumeToken?: string;
}

export interface WahooActivityUploadPreparation {
  expectedWorkoutTypeId?: number;
}

export interface WahooActivityUploadOptions {
  filename?: unknown;
  timeZone?: unknown;
  expectedWorkoutTypeId?: number | null;
  /** Runs after account validation and immediately before the provider request. */
  beforeProviderRequest?: () => Promise<WahooActivityUploadPreparation | void>;
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

interface WahooActivityUploadResumePayload {
  version: 1;
  userID: string;
  uploadId: string;
  expectedWorkoutTypeId: number | null;
  issuedAt: number;
  expiresAt: number;
}

function getWahooActivityUploadResumeSigningKey(): string {
  const signingKey = SECRET_PARAMS.WAHOOAPI_ACTIVITY_UPLOAD_RESUME_SIGNING_KEY.value().trim();
  if (signingKey.length < 32) {
    throw new HttpsError(
      'unavailable',
      'Wahoo activity uploads are temporarily unavailable. Please retry shortly.',
    );
  }
  return signingKey;
}

function createWahooActivityUploadResumeToken(params: {
  userID: string;
  uploadId: string;
  expectedWorkoutType: WahooWorkoutType | null;
}): string {
  const uploadId = normalizeWahooUploadToken(params.uploadId);
  if (!uploadId) {
    throw new Error('Cannot create a Wahoo upload continuation without a valid upload identifier.');
  }
  const issuedAt = Date.now();
  const payload: WahooActivityUploadResumePayload = {
    version: 1,
    userID: params.userID,
    uploadId,
    expectedWorkoutTypeId: params.expectedWorkoutType?.id ?? null,
    issuedAt,
    expiresAt: issuedAt + WAHOO_ACTIVITY_UPLOAD_RESUME_TOKEN_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', getWahooActivityUploadResumeSigningKey())
    .update(`${WAHOO_ACTIVITY_UPLOAD_RESUME_TOKEN_VERSION}.${encodedPayload}`)
    .digest('base64url');
  return `${WAHOO_ACTIVITY_UPLOAD_RESUME_TOKEN_VERSION}.${encodedPayload}.${signature}`;
}

function invalidWahooActivityUploadResumeToken(): never {
  throw new HttpsError(
    'failed-precondition',
    'This Wahoo activity upload continuation is invalid or expired. Start the upload again.',
    { retryMode: 'restart' },
  );
}

function verifyWahooActivityUploadResumeToken(
  value: unknown,
  userID: string,
  uploadId: string,
): WahooWorkoutType | null {
  if (typeof value !== 'string') {
    return invalidWahooActivityUploadResumeToken();
  }
  const match = WAHOO_ACTIVITY_UPLOAD_RESUME_TOKEN_PATTERN.exec(value);
  if (!match) {
    return invalidWahooActivityUploadResumeToken();
  }

  const expectedSignature = createHmac('sha256', getWahooActivityUploadResumeSigningKey())
    .update(`${WAHOO_ACTIVITY_UPLOAD_RESUME_TOKEN_VERSION}.${match[1]}`)
    .digest('base64url');
  const receivedSignature = Buffer.from(match[2], 'utf8');
  const expectedSignatureBytes = Buffer.from(expectedSignature, 'utf8');
  if (
    receivedSignature.length !== expectedSignatureBytes.length
    || !timingSafeEqual(receivedSignature, expectedSignatureBytes)
  ) {
    return invalidWahooActivityUploadResumeToken();
  }

  let payload: WahooActivityUploadResumePayload;
  try {
    payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')) as WahooActivityUploadResumePayload;
  } catch {
    return invalidWahooActivityUploadResumeToken();
  }
  const now = Date.now();
  const normalizedUploadId = normalizeWahooUploadToken(uploadId);
  if (
    payload?.version !== 1
    || payload.userID !== userID
    || payload.uploadId !== normalizedUploadId
    || !Number.isSafeInteger(payload.issuedAt)
    || !Number.isSafeInteger(payload.expiresAt)
    || payload.expiresAt - payload.issuedAt !== WAHOO_ACTIVITY_UPLOAD_RESUME_TOKEN_TTL_MS
    || payload.issuedAt > now + 60_000
    || payload.expiresAt <= now
  ) {
    return invalidWahooActivityUploadResumeToken();
  }
  if (payload.expectedWorkoutTypeId === null) {
    return null;
  }
  return getWahooWorkoutTypeById(payload.expectedWorkoutTypeId) || invalidWahooActivityUploadResumeToken();
}

function toDirectWahooActivityUploadResult(
  userID: string,
  uploadResult: WahooActivityUploadResult,
): WahooActivityUploadResult {
  const { expectedWorkoutTypeId, ...directResult } = uploadResult;
  if (uploadResult.status !== 'pending' || !uploadResult.uploadId) {
    return directResult;
  }
  return {
    ...directResult,
    resumeToken: createWahooActivityUploadResumeToken({
      userID,
      uploadId: uploadResult.uploadId,
      expectedWorkoutType: resolveExpectedWahooWorkoutType(expectedWorkoutTypeId),
    }),
  };
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
}

function toWahooHttpsError(error: unknown): never {
  if (isTerminalServiceAuthError(error)) {
    throw new HttpsError('unauthenticated', 'Reconnect Wahoo before sending activities.');
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

async function withWahooWorkoutWriteToken<T, TPreparation = void>(
  userID: string,
  operation: (accessToken: string, preparation: TPreparation | undefined) => Promise<T>,
  beforeProviderRequest?: () => Promise<TPreparation | void>,
): Promise<T> {
  await assertWahooActivityUploadProviderActionAllowed(userID, 'before_token_lookup');

  const initialTokenSnapshots = await admin.firestore()
    .collection(WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME)
    .doc(userID)
    .collection('tokens')
    .limit(1)
    .get();
  const initialTokenSnapshot = initialTokenSnapshots.docs[0];
  if (!initialTokenSnapshot) {
    throw new HttpsError('unauthenticated', 'Connect Wahoo before sending activities.');
  }

  const execute = async (forceRefresh: boolean): Promise<T> => {
    const currentTokenSnapshot = await initialTokenSnapshot.ref.get();
    if (!currentTokenSnapshot.exists) {
      throw new HttpsError('unauthenticated', 'Connect Wahoo before sending activities.');
    }
    const token = await getTokenData(
      currentTokenSnapshot,
      ServiceNames.WahooAPI,
      forceRefresh,
    ) as WahooAPIAuth2ServiceTokenInterface;
    if (!hasWahooWorkoutsWriteScope(token.scope)) {
      throw new WahooWorkoutWriteScopeRequiredError();
    }
    await assertWahooActivityUploadProviderActionAllowed(userID, 'before_provider_request');
    let preparation: TPreparation | undefined;
    if (beforeProviderRequest) {
      preparation = (await beforeProviderRequest()) || undefined;
      await assertWahooActivityUploadProviderActionAllowed(userID, 'after_pre_request_write');
    }
    return operation(token.accessToken, preparation);
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
  uploadId: string;
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
    acceptedUpload = await withWahooWorkoutWriteToken(userID, async (accessToken, preparation) => {
      const expectedWorkoutType = resolveExpectedWahooWorkoutType(
        preparation?.expectedWorkoutTypeId ?? configuredExpectedWorkoutType?.id,
      );
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
    }, options.beforeProviderRequest);
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
      uploadId: acceptedUpload.result.uploadId as string,
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

function toWahooActivityTypeCorrectionResumeDetails(
  error: WahooActivityTypeCorrectionError | WahooActivityTypeCorrectionPendingDisconnectError,
  userID: string,
): {
  retryMode: 'resume';
  resumeUploadId: string;
  resumeToken: string;
} {
  const uploadId = normalizeWahooUploadToken(error.providerOperationId);
  if (!uploadId) {
    throw new HttpsError(
      'failed-precondition',
      'Wahoo accepted the activity upload, but its continuation cannot be recovered safely. Contact support before retrying.',
    );
  }
  return {
    retryMode: 'resume',
    resumeUploadId: uploadId,
    resumeToken: createWahooActivityUploadResumeToken({
      userID,
      uploadId,
      expectedWorkoutType: getWahooWorkoutTypeById(error.expectedWorkoutTypeId),
    }),
  };
}

function throwWahooActivityCallableError(error: unknown, userID: string): never {
  if (error instanceof UserDeletionGuardReadError) {
    throw new HttpsError('unavailable', 'Could not verify account state. Please retry.');
  }
  if (
    error instanceof ActivitySyncOutboundFingerprintSkippedForDeletedUserError
    || error instanceof WahooActivityUploadSkippedForDeletedUserError
  ) {
    throw new HttpsError('failed-precondition', 'Account is being deleted or no longer exists.');
  }
  if (error instanceof WahooActivityTypeCorrectionPendingDisconnectError) {
    throw new HttpsError(
      'failed-precondition',
      error.message,
      toWahooActivityTypeCorrectionResumeDetails(error, userID),
    );
  }
  if (!isProviderOperationError(error)) {
    throw error;
  }
  const correctionResumeDetails = error instanceof WahooActivityTypeCorrectionError
    ? toWahooActivityTypeCorrectionResumeDetails(error, userID)
    : undefined;
  if (error.disposition === 'auth_required') {
    throw new HttpsError('unauthenticated', error.message, correctionResumeDetails);
  }
  if (error.disposition === 'permission_required') {
    throw new HttpsError('permission-denied', error.message, correctionResumeDetails);
  }
  if (error.disposition === 'retryable') {
    throw new HttpsError(
      error.code === 'resource-exhausted' ? 'resource-exhausted' : 'unavailable',
      error.message,
      {
        retryMode: error.retryMode,
        resumeUploadId: error.providerOperationId,
        ...(correctionResumeDetails || {}),
        ...(error.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      },
    );
  }
  throw new HttpsError('failed-precondition', error.message, correctionResumeDetails);
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
  try {
    // Verify the endpoint-bound key before posting a non-idempotent FIT upload.
    getWahooActivityUploadResumeSigningKey();
    const uploadResult = await uploadActivityFileToWahoo(userID, fileBuffer, {
      filename: request.data?.filename,
      timeZone: request.data?.timeZone,
      beforeProviderRequest: async () => {
        const fingerprint = await recordActivitySyncOutboundFingerprint({
          userID,
          destinationServiceName: ServiceNames.WahooAPI,
          fileBuffer,
        });
        const expectedWorkoutType = resolveWahooWorkoutType(fingerprint.activityTypes);
        if (!expectedWorkoutType && fingerprint.activityTypes.length > 0) {
          logger.info('Keeping Wahoo inferred workout type for an unmapped manual FIT activity.', {
            canonicalActivityTypes: fingerprint.activityTypes,
          });
        }
        return expectedWorkoutType
          ? { expectedWorkoutTypeId: expectedWorkoutType.id }
          : undefined;
      },
    });
    return toDirectWahooActivityUploadResult(userID, uploadResult);
  } catch (error) {
    return throwWahooActivityCallableError(error, userID);
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
    const expectedWorkoutType = verifyWahooActivityUploadResumeToken(
      request.data?.resumeToken,
      userID,
      uploadId,
    );
    const uploadResult = await getWahooActivityUploadStatus(
      userID,
      uploadId,
      expectedWorkoutType?.id,
    );
    return toDirectWahooActivityUploadResult(userID, uploadResult);
  } catch (error) {
    return throwWahooActivityCallableError(error, userID);
  }
});
