'use strict';

import * as admin from 'firebase-admin';
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

const MAX_ACTIVITY_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_BASE64_ACTIVITY_UPLOAD_LENGTH = Math.ceil(MAX_ACTIVITY_UPLOAD_BYTES / 3) * 4 + 4;
const WAHOO_UPLOAD_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

interface WahooWorkoutFileUploadPayload {
  token?: unknown;
  status?: unknown;
  workout_id?: unknown;
  workout_summary_id?: unknown;
}

export interface WahooActivityUploadResult {
  status: 'success' | 'duplicate' | 'pending';
  code?: 'ALREADY_EXISTS';
  message: string;
  uploadId?: string;
  workoutKey?: string;
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

function getStatus(payload: WahooWorkoutFileUploadPayload): string {
  return `${payload.status || ''}`.trim().toLowerCase();
}

function toWahooActivityUploadResult(payload: WahooWorkoutFileUploadPayload): WahooActivityUploadResult {
  const status = getStatus(payload);
  const uploadId = normalizeIdentifier(payload.token);
  const workoutKey = normalizeIdentifier(payload.workout_id || payload.workout_summary_id);

  if (status === 'complete' || status === 'completed') {
    return {
      status: 'success',
      message: 'Activity uploaded to Wahoo.',
      uploadId,
      workoutKey,
    };
  }

  if (status === 'duplicate') {
    return {
      status: 'duplicate',
      code: 'ALREADY_EXISTS',
      message: 'Activity already exists in Wahoo.',
      uploadId,
      workoutKey,
    };
  }

  if (status === 'error' || status === 'failed') {
    throw new HttpsError('internal', 'Wahoo could not process this activity.');
  }

  if (!uploadId) {
    throw new HttpsError('internal', 'Wahoo did not return an upload identifier.');
  }

  return {
    status: 'pending',
    message: 'Wahoo is processing the activity.',
    uploadId,
    workoutKey,
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

function toWahooHttpsError(error: unknown): never {
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
  if (error.statusCode >= 500) {
    throw new HttpsError('unavailable', 'Wahoo is temporarily unavailable. Please retry.');
  }
  throw new HttpsError('internal', 'Wahoo rejected the activity upload.');
}

async function withWahooWorkoutWriteToken<T>(
  userID: string,
  operation: (accessToken: string) => Promise<T>,
): Promise<T> {
  await assertWahooActivityUploadUserActive(userID, 'before_token_lookup');
  if (await isServiceDisconnectPendingForUser(userID, SERVICE_NAME)) {
    throw new HttpsError('failed-precondition', 'Wahoo disconnect is pending.');
  }

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
    await assertWahooActivityUploadUserActive(userID, 'before_provider_request');
    return operation(token.accessToken);
  };

  try {
    return await execute(false);
  } catch (error) {
    if (error instanceof WahooAPIRequestError && error.statusCode === 401) {
      try {
        return await execute(true);
      } catch (retryError) {
        return toWahooHttpsError(retryError);
      }
    }
    return toWahooHttpsError(error);
  }
}

export async function uploadActivityFileToWahoo(
  userID: string,
  fileBuffer: Buffer,
  options: { filename?: unknown; timeZone?: unknown } = {},
): Promise<WahooActivityUploadResult> {
  if (fileBuffer.length === 0) {
    throw new HttpsError('invalid-argument', 'File content is empty.');
  }
  if (fileBuffer.length > MAX_ACTIVITY_UPLOAD_BYTES) {
    throw new HttpsError('invalid-argument', 'Cannot upload activity because the size is greater than 20MB.');
  }

  return withWahooWorkoutWriteToken(userID, async (accessToken) => {
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
    return toWahooActivityUploadResult(data || {});
  });
}

export async function getWahooActivityUploadStatus(
  userID: string,
  uploadId: unknown,
): Promise<WahooActivityUploadResult> {
  const token = `${uploadId || ''}`.trim();
  if (!WAHOO_UPLOAD_TOKEN_PATTERN.test(token)) {
    throw new HttpsError('invalid-argument', 'Invalid Wahoo upload identifier.');
  }

  return withWahooWorkoutWriteToken(userID, async (accessToken) => {
    const { data } = await requestWahooAPI<WahooWorkoutFileUploadPayload>(
      accessToken,
      `/v1/workout_file_uploads/${encodeURIComponent(token)}`,
    );
    return toWahooActivityUploadResult({ ...(data || {}), token: data?.token || token });
  });
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
  enforceAppCheck(request as any);
  if (!request.auth) throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  if (!(await hasProAccess(request.auth.uid))) {
    throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }
  return request.auth.uid;
}

export const importActivityToWahooAPI = onCall({
  region: FUNCTIONS_MANIFEST.importActivityToWahooAPI.region,
  cors: ALLOWED_CORS_ORIGINS,
  timeoutSeconds: 120,
  maxInstances: 10,
}, async (request) => {
  const userID = await requireWahooActivityUploadAccess(request);
  const fileBuffer = toUploadBuffer(request.data?.file);
  return uploadActivityFileToWahoo(userID, fileBuffer, {
    filename: request.data?.filename,
    timeZone: request.data?.timeZone,
  });
});

export const getWahooAPIWorkoutFileUploadStatus = onCall({
  region: FUNCTIONS_MANIFEST.getWahooAPIWorkoutFileUploadStatus.region,
  cors: ALLOWED_CORS_ORIGINS,
  timeoutSeconds: 60,
  maxInstances: 10,
}, async (request) => {
  const userID = await requireWahooActivityUploadAccess(request);
  return getWahooActivityUploadStatus(userID, request.data?.uploadId);
});
