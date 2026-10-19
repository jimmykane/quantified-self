import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import * as requestPromise from '../request-helper';
import { getTokenData } from '../tokens';
import { getHealthFailureTelemetry } from '../health/error-diagnostics';
import { parseTrustedGarminCallbackURL } from '../sleep/garmin-callback-url';
import {
  GarminHealthResult,
  GarminHealthValidationError,
  mapGarminHealthSummaries,
} from './health';
import { isGarminHealthSummaryType } from './health-summary-types';
import {
  areGarminHealthWriteLifecycleGuardsContinuous,
  captureActiveGarminHealthWriteLifecycleGuards,
  doesGarminHealthTokenDataMatchGuard,
  GarminHealthAccountValidationError,
  GarminHealthWriteLifecycleGuards,
} from './health-lifecycle';

type TokenSnapshot = admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot;

export const GARMIN_HEALTH_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
export const GARMIN_HEALTH_REQUEST_TIMEOUT_MS = 30_000;

function getGarminHealthPayloadDigest(
  summaryType: string,
  healthResults: readonly GarminHealthResult[],
): string {
  const hash = createHash('sha256');
  hash.update('garmin-health-callback-v1\0');
  hash.update(summaryType);
  for (const result of healthResults) {
    hash.update('\0');
    hash.update(JSON.stringify([
      result.input.sourceRecordType,
      result.input.sourceRecordKey,
      result.input.revision.order,
      result.input.revision.token,
    ]));
  }
  return hash.digest('hex');
}

export class GarminHealthPermissionError extends Error {
  public readonly name = 'GarminHealthPermissionError';
  public readonly code = 'garmin_health_permission_missing';

  constructor(public readonly userID: string) {
    super('Garmin Health permission is unavailable for this summary family.');
  }
}

export class GarminHealthRequestError extends Error {
  public readonly name = 'GarminHealthRequestError';
  public readonly code = 'garmin_health_request_failed';

  constructor(
    public readonly statusCode: number | null = null,
    public readonly transportCode?: string,
    public readonly responseByteLimitExceeded = false,
  ) {
    super('Garmin Health callback request failed.');
  }
}

export type GarminHealthRequestStage = 'token_refresh' | 'identity_request' | 'callback_request'
  | 'callback_mapping' | 'result_assembly';

export function getGarminHealthFailureTelemetry(
  error: unknown, stage: string, elapsedMs: number,
): Record<string, string | number> {
  const base: Record<string, string | number> = {
    ...getHealthFailureTelemetry(error, stage, elapsedMs), errorCode: 'garmin_health_processing_failed',
  };
  try {
    if (!(error instanceof GarminHealthRequestError)) return base;
    const status = error.statusCode;
    const hasStatus = typeof status === 'number' && Number.isSafeInteger(status) && status >= 100 && status <= 599;
    return {
      ...base, errorName: 'GarminHealthRequestError', errorCode: 'garmin_health_request_failed',
      failureCategory: error.responseByteLimitExceeded === true ? 'response_byte_limit'
        : hasStatus ? 'provider_http_error' : base.transportCode ? 'transport_error' : 'provider_request_unknown',
      ...(hasStatus ? { providerStatusCode: status } : {}),
    };
  } catch {
    return base;
  }
}

function requestFailure(error: unknown): GarminHealthRequestError {
  const telemetry = getHealthFailureTelemetry(error, 'unknown', 0);
  return new GarminHealthRequestError(
    statusCodeFromError(error),
    typeof telemetry.transportCode === 'string' ? telemetry.transportCode : undefined,
    error instanceof requestPromise.ResponseBodyTooLargeError,
  );
}

export function assertGarminHealthPermission(tokenData: Record<string, unknown>, userID: string): void {
  const permissions = tokenData.permissions;
  if (Array.isArray(permissions)
    && !permissions.includes('HEALTH_EXPORT')) {
    throw new GarminHealthPermissionError(userID);
  }
}

function statusCodeFromError(error: unknown): number | null {
  const statusCode = Number((error as { statusCode?: unknown } | null)?.statusCode);
  return Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
    ? statusCode
    : null;
}

export async function verifyLegacyGarminProviderIdentity(
  accessToken: unknown,
  expectedProviderUserId: string,
): Promise<void> {
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new GarminHealthAccountValidationError();
  }
  let response: unknown;
  try {
    response = await requestPromise.get({
      headers: { Authorization: `Bearer ${accessToken}` },
      json: true,
      maxResponseBytes: 16 * 1024,
      timeout: GARMIN_HEALTH_REQUEST_TIMEOUT_MS,
      url: 'https://apis.garmin.com/wellness-api/rest/user/id',
    });
  } catch (error) {
    throw requestFailure(error);
  }
  const providerUserId = response && typeof response === 'object'
    ? `${(response as Record<string, unknown>).userId || ''}`.trim()
    : '';
  if (!providerUserId || providerUserId !== expectedProviderUserId) {
    throw new GarminHealthAccountValidationError();
  }
}

export function sanitizeGarminHealthErrorForTelemetry(error: unknown): Error {
  if (error instanceof GarminHealthValidationError
    || error instanceof GarminHealthPermissionError
    || error instanceof GarminHealthAccountValidationError
    || error instanceof GarminHealthRequestError) {
    return error;
  }
  return new GarminHealthRequestError(statusCodeFromError(error));
}

export async function refreshAndCaptureGarminHealthGuards(
  queueItem: SleepSyncQueueItemInterface,
  tokenSnapshot: TokenSnapshot,
  firebaseUserID: string,
  initialGuards: GarminHealthWriteLifecycleGuards,
): Promise<{
  tokenData: Record<string, unknown>;
  tokenSnapshot: TokenSnapshot;
  lifecycleGuards: GarminHealthWriteLifecycleGuards;
}> {
  const tokenData = await getTokenData(tokenSnapshot, ServiceNames.GarminAPI, false, {
    opaqueTelemetry: true,
    expectedActiveOAuthCredentialGeneration: initialGuards.rootOAuthCredentialGeneration,
  }) as unknown as Record<string, unknown>;
  const currentTokenSnapshot = await tokenSnapshot.ref.get();
  const lifecycleGuards = await captureActiveGarminHealthWriteLifecycleGuards(
    admin.firestore(),
    firebaseUserID,
    queueItem.providerUserId,
    currentTokenSnapshot,
  );
  if (!lifecycleGuards
    || !areGarminHealthWriteLifecycleGuardsContinuous(initialGuards, lifecycleGuards)
    || !doesGarminHealthTokenDataMatchGuard(tokenData, lifecycleGuards)) {
    throw new GarminHealthAccountValidationError();
  }
  return { tokenData, tokenSnapshot: currentTokenSnapshot, lifecycleGuards };
}

export async function processGarminHealthQueueItem(
  queueItem: SleepSyncQueueItemInterface,
  tokenSnapshot: TokenSnapshot,
  firebaseUserID: string,
  initialGuards: GarminHealthWriteLifecycleGuards,
  onLifecycleGuardsCaptured?: (guards: GarminHealthWriteLifecycleGuards) => void,
  onStage?: (stage: GarminHealthRequestStage) => void,
): Promise<{
  healthResults: GarminHealthResult[];
  lifecycleGuards: GarminHealthWriteLifecycleGuards;
  continuation: {
    payloadDigest: string;
    receivedAtMs: number;
    startIndex: number;
    recordsWritten: number;
    recordsUnchanged: number;
    recordsStale: number;
  };
}> {
  const stage = (value: GarminHealthRequestStage): void => {
    try { onStage?.(value); } catch { /* Diagnostics must not change provider processing. */ }
  };
  if (!isGarminHealthSummaryType(queueItem.garminSummaryType)) {
    throw new GarminHealthValidationError('Garmin Health queue item has an unsupported summary family.');
  }
  const callback = parseTrustedGarminCallbackURL(
    queueItem.callbackURL,
    queueItem.garminSummaryType,
  );
  if (!callback) {
    throw new GarminHealthValidationError('Garmin Health queue item has an invalid callback URL.');
  }

  stage('token_refresh');
  const refreshed = await refreshAndCaptureGarminHealthGuards(
    queueItem,
    tokenSnapshot,
    firebaseUserID,
    initialGuards,
  );
  onLifecycleGuardsCaptured?.(refreshed.lifecycleGuards);
  assertGarminHealthPermission(refreshed.tokenData, firebaseUserID);
  if (!refreshed.lifecycleGuards.providerIdentityPinned) {
    stage('identity_request');
    await verifyLegacyGarminProviderIdentity(
      refreshed.tokenData.accessToken,
      queueItem.providerUserId,
    );
  }

  let payload: unknown;
  try {
    stage('callback_request');
    payload = await requestPromise.get({
      headers: {
        Authorization: `Bearer ${refreshed.tokenData.accessToken}`,
      },
      json: true,
      maxResponseBytes: GARMIN_HEALTH_MAX_RESPONSE_BYTES,
      timeout: GARMIN_HEALTH_REQUEST_TIMEOUT_MS,
      url: callback.callbackURL,
    });
  } catch (error) {
    const statusCode = statusCodeFromError(error);
    if (statusCode === 412) {
      throw new GarminHealthPermissionError(firebaseUserID);
    }
    throw requestFailure(error);
  }

  const storedReceivedAtMs = queueItem.garminHealthReceivedAtMs;
  const receivedAtMs = typeof storedReceivedAtMs === 'number'
    && Number.isSafeInteger(storedReceivedAtMs)
    && storedReceivedAtMs >= 0
    ? storedReceivedAtMs
    : Date.now();
  stage('callback_mapping');
  const healthResults = mapGarminHealthSummaries(
    queueItem.garminSummaryType,
    payload,
    queueItem.providerUserId,
    callback.uploadEndTimeMs,
    receivedAtMs,
  );
  stage('result_assembly');
  const payloadDigest = getGarminHealthPayloadDigest(
    queueItem.garminSummaryType,
    healthResults,
  );
  const storedCursor = queueItem.garminHealthWriteCursor;
  const resumesStoredPayload = queueItem.garminHealthPayloadDigest === payloadDigest;
  if (resumesStoredPayload
    && (typeof storedCursor !== 'number'
      || !Number.isSafeInteger(storedCursor)
      || storedCursor < 0
      || storedCursor > healthResults.length)) {
    throw new GarminHealthValidationError('Garmin Health callback cursor exceeds the normalized response.');
  }
  const startIndex = resumesStoredPayload ? storedCursor ?? 0 : 0;
  const finalTokenSnapshot = await refreshed.tokenSnapshot.ref.get();
  const finalLifecycleGuards = await captureActiveGarminHealthWriteLifecycleGuards(
    admin.firestore(),
    firebaseUserID,
    queueItem.providerUserId,
    finalTokenSnapshot,
  );
  if (!finalLifecycleGuards
    || !areGarminHealthWriteLifecycleGuardsContinuous(
      refreshed.lifecycleGuards,
      finalLifecycleGuards,
    )) {
    throw new GarminHealthAccountValidationError();
  }
  return {
    healthResults,
    lifecycleGuards: finalLifecycleGuards,
    continuation: {
      payloadDigest,
      receivedAtMs,
      startIndex,
      recordsWritten: resumesStoredPayload ? queueItem.garminHealthRecordsWritten ?? 0 : 0,
      recordsUnchanged: resumesStoredPayload ? queueItem.garminHealthRecordsUnchanged ?? 0 : 0,
      recordsStale: resumesStoredPayload ? queueItem.garminHealthRecordsStale ?? 0 : 0,
    },
  };
}
