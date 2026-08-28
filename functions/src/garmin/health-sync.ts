import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import * as requestPromise from '../request-helper';
import { getTokenData } from '../tokens';
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

  constructor(public readonly statusCode: number | null = null) {
    super('Garmin Health callback request failed.');
  }
}

function assertGarminHealthPermission(tokenData: Record<string, unknown>, userID: string): void {
  const permissions = tokenData.permissions;
  if (Array.isArray(permissions)
    && permissions.length > 0
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

async function verifyLegacyGarminProviderIdentity(
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
  } catch {
    throw new GarminHealthAccountValidationError();
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

async function refreshAndCaptureGarminHealthGuards(
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
): Promise<{
  healthResults: GarminHealthResult[];
  lifecycleGuards: GarminHealthWriteLifecycleGuards;
}> {
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

  const refreshed = await refreshAndCaptureGarminHealthGuards(
    queueItem,
    tokenSnapshot,
    firebaseUserID,
    initialGuards,
  );
  onLifecycleGuardsCaptured?.(refreshed.lifecycleGuards);
  assertGarminHealthPermission(refreshed.tokenData, firebaseUserID);
  if (!refreshed.lifecycleGuards.providerIdentityPinned) {
    await verifyLegacyGarminProviderIdentity(
      refreshed.tokenData.accessToken,
      queueItem.providerUserId,
    );
  }

  let payload: unknown;
  try {
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
    throw new GarminHealthRequestError(statusCode);
  }

  const healthResults = mapGarminHealthSummaries(
    queueItem.garminSummaryType,
    payload,
    queueItem.providerUserId,
    callback.uploadEndTimeMs,
    Date.now(),
  );
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
  return { healthResults, lifecycleGuards: finalLifecycleGuards };
}
