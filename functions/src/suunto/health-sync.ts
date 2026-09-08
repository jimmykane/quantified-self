import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import { config } from '../config';
import * as requestPromise from '../request-helper';
import { getServiceTokenRootDocumentRef } from '../service-token-store';
import { shouldSkipQueueWorkForDeletedUser } from '../queue/user-deletion-skip';
import { getTokenData, TokenRefreshSkippedForDeletedUserError } from '../tokens';
import {
  ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD,
  areTokenCredentialSnapshotsEqual,
  doesOAuthCredentialGenerationAuthorizeToken,
  getTokenCredentialSnapshot,
  TokenCredentialSnapshot,
} from '../token-refresh-coordinator';
import { toSuuntoAuthorizationHeader } from './authorization-header';
import {
  areSuuntoWebhookWriteLifecycleGuardsContinuous,
  captureCurrentSuuntoWebhookWriteLifecycleGuards,
  getSuuntoWebhookWriteLifecycleAuthorityDigest,
  type SuuntoWebhookWriteLifecycleGuards,
} from './health-webhook-binding-lifecycle';
import {
  assertSuuntoHealthRange,
  assertSuuntoHealthSamplesInRange,
  mapSuuntoActivityHealth,
  mapSuuntoDailyStatisticsHealth,
  mapSuuntoRecoveryHealth,
  parseSuuntoActivitySamples,
  parseSuuntoRecoverySamples,
  SUUNTO_HEALTH_MAX_RESPONSE_BYTES,
  SUUNTO_HEALTH_MAX_SERIES_SOURCE_RECORDS,
  SUUNTO_HEALTH_MAX_DAILY_SOURCE_RECORDS,
  SUUNTO_HEALTH_MAX_WINDOW_DAYS,
  SUUNTO_HEALTH_REQUEST_TIMEOUT_MS,
  SuuntoHealthResult,
  SuuntoHealthResponseLimitError,
  SuuntoHealthValidationError,
} from './health';
import { isValidSuuntoHealthProgress, type SuuntoHealthProgress } from './health-progress';

type TokenSnapshot = admin.firestore.DocumentSnapshot | admin.firestore.QueryDocumentSnapshot;
const DAY_MS = 24 * 60 * 60 * 1000;
const SUUNTO_HEALTH_CONTEXT_PADDING_MS = DAY_MS;
const SUUNTO_HEALTH_MAX_TARGET_WINDOW_MS = (SUUNTO_HEALTH_MAX_WINDOW_DAYS - 2) * DAY_MS;
const SUUNTO_HEALTH_MAX_PULL_ATTEMPTS = 64;
const SUUNTO_HEALTH_PULL_BUDGET_MS = 4 * 60 * 1000;
const SUUNTO_HEALTH_MAX_RESULT_BYTES = 16 * 1024 * 1024;

interface SuuntoHealthRequestWindow {
  targetStartMs: number;
  targetEndMs: number;
  requestStartMs: number;
  requestEndMs: number;
}

export type SuuntoHealthWriteLifecycleGuards = SuuntoWebhookWriteLifecycleGuards;

export class SuuntoHealthAccountValidationError extends Error {
  public readonly name = 'SuuntoHealthAccountValidationError';
  public readonly code = 'suunto_health_account_changed';

  constructor() {
    super('Suunto Health account lifecycle changed during processing.');
  }
}

export class SuuntoHealthRequestError extends Error {
  public readonly name = 'SuuntoHealthRequestError';
  public readonly code = 'suunto_health_request_failed';

  constructor(
    public readonly providerStatusCode?: number,
    public readonly responseByteLimitExceeded = false,
  ) {
    super('Suunto Health request failed.');
  }
}

export interface SuuntoHealthRequestTelemetry {
  errorName: 'SuuntoHealthRequestError';
  errorCode: 'suunto_health_request_failed';
  providerStatusCode?: number;
  failureCategory?: 'response_byte_limit';
}

/**
 * Provider response bodies can contain sensitive data. Keep production logs
 * limited to the already-validated HTTP status and a stable error category.
 */
export function getSuuntoHealthRequestTelemetry(error: unknown): SuuntoHealthRequestTelemetry | null {
  if (!(error instanceof SuuntoHealthRequestError)) return null;
  const statusCode = error.providerStatusCode;
  return {
    errorName: 'SuuntoHealthRequestError',
    errorCode: 'suunto_health_request_failed',
    ...(error.responseByteLimitExceeded === true
      ? { failureCategory: 'response_byte_limit' as const }
      : {}),
    ...(typeof statusCode === 'number'
      && Number.isSafeInteger(statusCode) && statusCode >= 100 && statusCode <= 599
      ? { providerStatusCode: statusCode }
      : {}),
  };
}

export async function captureSuuntoHealthWriteLifecycleGuards(
  firebaseUserID: string,
  tokenRef: admin.firestore.DocumentReference,
  expectedCredential: TokenCredentialSnapshot,
  authorityBaseline: SuuntoWebhookWriteLifecycleGuards,
): Promise<SuuntoHealthWriteLifecycleGuards> {
  let currentAuthority: SuuntoWebhookWriteLifecycleGuards | null;
  try {
    currentAuthority = await captureCurrentSuuntoWebhookWriteLifecycleGuards(
      admin.firestore(),
      firebaseUserID,
      tokenRef.id,
    );
  } catch {
    throw new SuuntoHealthAccountValidationError();
  }
  if (!currentAuthority
    || !areSuuntoWebhookWriteLifecycleGuardsContinuous(authorityBaseline, currentAuthority)
    || !areTokenCredentialSnapshotsEqual(
      currentAuthority.requiredExistingTokenCredential,
      expectedCredential,
    )) {
    throw new SuuntoHealthAccountValidationError();
  }
  return currentAuthority;
}

function capturedTokenRootGeneration(
  guards: SuuntoHealthWriteLifecycleGuards,
): string | null {
  const value = [
    guards.requiredDocumentFieldValues,
    ...guards.additionalRequiredDocumentFieldValues,
  ].map(guard => guard.expectedFields[ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD])
    .find(candidate => candidate !== undefined);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function assertCurrentTokenRootGeneration(
  firebaseUserID: string,
  expectedRootGeneration: string | null,
): Promise<void> {
  let tokenRootSnapshot: admin.firestore.DocumentSnapshot;
  try {
    tokenRootSnapshot = await getServiceTokenRootDocumentRef(
      firebaseUserID,
      ServiceNames.SuuntoApp,
    ).get();
  } catch {
    throw new SuuntoHealthAccountValidationError();
  }
  if (!tokenRootSnapshot.exists
    || !doesOAuthCredentialGenerationAuthorizeToken(
      tokenRootSnapshot.data() as Record<string, unknown> | undefined,
      expectedRootGeneration,
    )) {
    throw new SuuntoHealthAccountValidationError();
  }
}

function assertLifecycleContinuity(
  initial: SuuntoHealthWriteLifecycleGuards,
  current: SuuntoHealthWriteLifecycleGuards,
): void {
  if (!areSuuntoWebhookWriteLifecycleGuardsContinuous(initial, current)
    || initial.requiredExistingTokenCredential.credentialGeneration
      !== current.requiredExistingTokenCredential.credentialGeneration) {
    throw new SuuntoHealthAccountValidationError();
  }
}

async function currentTokenCredential(
  tokenRef: admin.firestore.DocumentReference,
  expectedAccessToken: string,
): Promise<TokenCredentialSnapshot> {
  let snapshot: admin.firestore.DocumentSnapshot;
  try {
    snapshot = await tokenRef.get();
  } catch {
    throw new SuuntoHealthAccountValidationError();
  }
  if (!snapshot.exists) throw new SuuntoHealthAccountValidationError();
  const credential = getTokenCredentialSnapshot(snapshot.data() as Record<string, unknown> | undefined);
  if (!credential.accessToken || credential.accessToken !== expectedAccessToken) {
    throw new SuuntoHealthAccountValidationError();
  }
  return credential;
}

async function assertCurrentLifecycle(
  firebaseUserID: string,
  tokenRef: admin.firestore.DocumentReference,
  expectedCredential: TokenCredentialSnapshot,
  initialGuards: SuuntoHealthWriteLifecycleGuards,
): Promise<SuuntoHealthWriteLifecycleGuards> {
  const currentCredential = await currentTokenCredential(tokenRef, expectedCredential.accessToken);
  if (!areTokenCredentialSnapshotsEqual(currentCredential, expectedCredential)) {
    throw new SuuntoHealthAccountValidationError();
  }
  await assertCurrentTokenRootGeneration(firebaseUserID, capturedTokenRootGeneration(initialGuards));
  const currentGuards = await captureSuuntoHealthWriteLifecycleGuards(
    firebaseUserID,
    tokenRef,
    currentCredential,
    initialGuards,
  );
  assertLifecycleContinuity(initialGuards, currentGuards);
  return currentGuards;
}

function requestHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: toSuuntoAuthorizationHeader(accessToken),
    'Content-Type': 'application/json',
    'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
  };
}

async function requestBoundedSuuntoHealthPayload(url: string, accessToken: string): Promise<unknown> {
  return requestPromise.get({
    headers: requestHeaders(accessToken),
    json: true,
    maxResponseBytes: SUUNTO_HEALTH_MAX_RESPONSE_BYTES,
    timeout: SUUNTO_HEALTH_REQUEST_TIMEOUT_MS,
    url,
  });
}

function providerStatusCode(error: unknown): number | null {
  const candidate = error as {
    statusCode?: unknown;
    output?: { statusCode?: unknown };
    response?: { statusCode?: unknown };
  } | null;
  for (const value of [
    candidate?.statusCode,
    candidate?.output?.statusCode,
    candidate?.response?.statusCode,
  ]) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 100 && parsed <= 599) return parsed;
  }
  return null;
}

async function assertUserActiveBeforeProviderRequest(
  firebaseUserID: string,
  queueItemID: string,
  tokenDocumentID: string,
): Promise<void> {
  if (await shouldSkipQueueWorkForDeletedUser(
    firebaseUserID,
    ServiceNames.SuuntoApp,
    queueItemID,
    'before_sleep_provider_sync',
  )) {
    throw new TokenRefreshSkippedForDeletedUserError(
      firebaseUserID,
      ServiceNames.SuuntoApp,
      tokenDocumentID,
      'before_return',
    );
  }
}

function buildSuuntoHealthRequestWindows(startMs: number, endMs: number): SuuntoHealthRequestWindow[] {
  const windows: SuuntoHealthRequestWindow[] = [];
  for (let targetStartMs = startMs; targetStartMs < endMs; targetStartMs += SUUNTO_HEALTH_MAX_TARGET_WINDOW_MS) {
    const targetEndMs = Math.min(endMs, targetStartMs + SUUNTO_HEALTH_MAX_TARGET_WINDOW_MS);
    windows.push({
      targetStartMs,
      targetEndMs,
      requestStartMs: Math.max(0, targetStartMs - SUUNTO_HEALTH_CONTEXT_PADDING_MS),
      requestEndMs: targetEndMs + SUUNTO_HEALTH_CONTEXT_PADDING_MS,
    });
  }
  return windows;
}

function resultIntersectsTarget(
  result: SuuntoHealthResult,
  window: SuuntoHealthRequestWindow,
): boolean {
  return result.input.endTimeMs > window.targetStartMs
    && result.input.startTimeMs < window.targetEndMs;
}

function sourceResultIdentity(result: SuuntoHealthResult): string {
  return [
    result.input.sourceRecordType,
    result.input.sourceRecordKey,
  ].join('\0');
}

export async function processSuuntoHealthQueueItem(
  queueItem: SleepSyncQueueItemInterface,
  tokenSnapshot: TokenSnapshot,
  firebaseUserID: string,
  initialGuards: SuuntoHealthWriteLifecycleGuards,
  onLifecycleGuardsCaptured?: (guards: SuuntoHealthWriteLifecycleGuards) => void,
): Promise<{
  healthResults: SuuntoHealthResult[];
  lifecycleGuards: SuuntoHealthWriteLifecycleGuards;
  continuation: Pick<SuuntoHealthProgress, 'nextStartMs' | 'targetWindowMs' | 'authorityDigest'> | null;
}> {
  const { startMs, endMs } = assertSuuntoHealthRange(queueItem.rangeStartMs, queueItem.rangeEndMs);
  if (!isValidSuuntoHealthProgress(queueItem)) throw new SuuntoHealthValidationError('Invalid Suunto Health progress.');
  const authorityDigest = getSuuntoWebhookWriteLifecycleAuthorityDigest(initialGuards);
  if (queueItem.suuntoHealthProgress && queueItem.suuntoHealthProgress.authorityDigest !== authorityDigest) {
    throw new SuuntoHealthAccountValidationError();
  }
  const expectedRootGeneration = capturedTokenRootGeneration(initialGuards);
  const tokenData = await getTokenData(tokenSnapshot, ServiceNames.SuuntoApp, false, {
    opaqueTelemetry: true,
    expectedActiveOAuthCredentialGeneration: expectedRootGeneration,
  });
  let accessToken = typeof tokenData.accessToken === 'string' ? tokenData.accessToken : '';
  const providerUserID = typeof tokenData.userName === 'string' ? tokenData.userName.trim() : '';
  if (!accessToken || providerUserID !== queueItem.providerUserId.trim()) {
    throw new SuuntoHealthAccountValidationError();
  }
  let tokenCredential = await currentTokenCredential(tokenSnapshot.ref, accessToken);
  if (tokenCredential.credentialGeneration
    !== initialGuards.requiredExistingTokenCredential.credentialGeneration) {
    throw new SuuntoHealthAccountValidationError();
  }
  let lifecycleGuards = await captureSuuntoHealthWriteLifecycleGuards(
    firebaseUserID,
    tokenSnapshot.ref,
    tokenCredential,
    initialGuards,
  );
  assertLifecycleContinuity(initialGuards, lifecycleGuards);
  onLifecycleGuardsCaptured?.(lifecycleGuards);

  let pullAttempts = 0;
  const pullDeadline = Date.now() + SUUNTO_HEALTH_PULL_BUDGET_MS;
  const claimPullAttempt = (): void => {
    if (++pullAttempts > SUUNTO_HEALTH_MAX_PULL_ATTEMPTS || Date.now() >= pullDeadline) {
      throw new SuuntoHealthValidationError('Suunto Health pull budget exceeded.');
    }
  };
  const fetchPayload = async (url: string): Promise<unknown> => {
    await assertUserActiveBeforeProviderRequest(firebaseUserID, queueItem.id, tokenSnapshot.id);
    lifecycleGuards = await assertCurrentLifecycle(
      firebaseUserID,
      tokenSnapshot.ref,
      tokenCredential,
      initialGuards,
    );
    onLifecycleGuardsCaptured?.(lifecycleGuards);
    claimPullAttempt();
    try {
      return await requestBoundedSuuntoHealthPayload(url, accessToken);
    } catch (error) {
      const statusCode = providerStatusCode(error);
      if (statusCode !== 401) {
        // Provider errors may contain request URLs, credentials, or response
        // fragments. The validated numeric HTTP status is safe and lets us
        // distinguish provider failures from transport failures in Cloud Logs.
        throw new SuuntoHealthRequestError(
          statusCode ?? undefined,
          error instanceof requestPromise.ResponseBodyTooLargeError,
        );
      }
    }

    const refreshedToken = await getTokenData(tokenSnapshot, ServiceNames.SuuntoApp, true, {
      opaqueTelemetry: true,
      expectedActiveOAuthCredentialGeneration: expectedRootGeneration,
    });
    const refreshedAccessToken = typeof refreshedToken.accessToken === 'string'
      ? refreshedToken.accessToken
      : '';
    const refreshedProviderUserID = typeof refreshedToken.userName === 'string'
      ? refreshedToken.userName.trim()
      : '';
    if (!refreshedAccessToken || refreshedProviderUserID !== queueItem.providerUserId.trim()) {
      throw new SuuntoHealthAccountValidationError();
    }
    const refreshedCredential = await currentTokenCredential(tokenSnapshot.ref, refreshedAccessToken);
    if (refreshedCredential.credentialGeneration
      !== initialGuards.requiredExistingTokenCredential.credentialGeneration) {
      throw new SuuntoHealthAccountValidationError();
    }
    accessToken = refreshedAccessToken;
    tokenCredential = refreshedCredential;
    lifecycleGuards = await captureSuuntoHealthWriteLifecycleGuards(
      firebaseUserID,
      tokenSnapshot.ref,
      tokenCredential,
      initialGuards,
    );
    assertLifecycleContinuity(initialGuards, lifecycleGuards);
    onLifecycleGuardsCaptured?.(lifecycleGuards);
    await assertUserActiveBeforeProviderRequest(firebaseUserID, queueItem.id, tokenSnapshot.id);
    lifecycleGuards = await assertCurrentLifecycle(
      firebaseUserID,
      tokenSnapshot.ref,
      tokenCredential,
      initialGuards,
    );
    onLifecycleGuardsCaptured?.(lifecycleGuards);
    claimPullAttempt();
    try {
      return await requestBoundedSuuntoHealthPayload(url, accessToken);
    } catch (error) {
      throw new SuuntoHealthRequestError(
        providerStatusCode(error) ?? undefined,
        error instanceof requestPromise.ResponseBodyTooLargeError,
      );
    }
  };

  const receivedAtMs = Date.now();
  const healthResultsBySource = new Map<string, SuuntoHealthResult>();
  let resultBytes = 0;
  const processWindow = async (window: SuuntoHealthRequestWindow): Promise<SuuntoHealthRequestWindow> => {
    try {
      await processBoundedWindow(window);
      return window;
    } catch (error) {
      const responseLimitExceeded = error instanceof SuuntoHealthResponseLimitError
        || (error instanceof SuuntoHealthRequestError && error.responseByteLimitExceeded === true);
      if (!responseLimitExceeded
        || window.targetEndMs - window.targetStartMs <= DAY_MS) throw error;
      // Re-fetch, never truncate. Padding is reapplied to each child so a
      // split cannot replace a complete provider-local day with half a day.
      const midpoint = Math.floor((window.targetStartMs + window.targetEndMs) / 2);
      // Finish only the left child in this invocation. After its records are
      // durable, the queue hands off the remaining range at this learned size.
      // Retrying later work must not refetch already committed target windows.
      return processWindow({
        targetStartMs: window.targetStartMs, targetEndMs: midpoint,
        requestStartMs: window.requestStartMs,
        requestEndMs: midpoint + SUUNTO_HEALTH_CONTEXT_PADDING_MS,
      });
    }
  };
  const processBoundedWindow = async (window: SuuntoHealthRequestWindow): Promise<void> => {
    const windowResults: SuuntoHealthResult[] = [];
    const activityPayload = await fetchPayload(
      `https://cloudapi.suunto.com/247samples/activity?from=${window.requestStartMs}&to=${window.requestEndMs - 1}`,
    );
    const activitySamples = parseSuuntoActivitySamples(activityPayload);
    assertSuuntoHealthSamplesInRange(
      activitySamples,
      window.requestStartMs,
      window.requestEndMs,
      'Suunto activity',
    );
    for (const result of mapSuuntoActivityHealth(
      activitySamples,
      queueItem.providerUserId,
      receivedAtMs,
    )) {
      if (resultIntersectsTarget(result, window)) {
        windowResults.push(result);
      }
    }

    const statisticsPayload = await fetchPayload(
      `https://cloudapi.suunto.com/247samples/daily-activity-statistics?startdate=${encodeURIComponent(new Date(window.requestStartMs).toISOString())}&enddate=${encodeURIComponent(new Date(window.requestEndMs - 1).toISOString())}`,
    );
    const statisticsResults = mapSuuntoDailyStatisticsHealth(
      statisticsPayload,
      queueItem.providerUserId,
      receivedAtMs,
    );
    // Suunto may include the current provider-local day even when it falls
    // beyond the requested end date. The response has already passed the
    // byte, group, source, sample, timestamp, and value bounds. Persist only
    // complete daily records intersecting the original target, just as we do
    // for the padded Activity and Recovery responses.
    for (const result of statisticsResults) {
      if (resultIntersectsTarget(result, window)) {
        windowResults.push(result);
      }
    }

    const recoveryPayload = await fetchPayload(
      `https://cloudapi.suunto.com/247samples/recovery?from=${window.requestStartMs}&to=${window.requestEndMs - 1}`,
    );
    const recoverySamples = parseSuuntoRecoverySamples(recoveryPayload);
    assertSuuntoHealthSamplesInRange(
      recoverySamples,
      window.requestStartMs,
      window.requestEndMs,
      'Suunto recovery',
    );
    for (const result of mapSuuntoRecoveryHealth(
      recoverySamples,
      queueItem.providerUserId,
      receivedAtMs,
    )) {
      if (resultIntersectsTarget(result, window)) {
        windowResults.push(result);
      }
    }
    for (const result of windowResults) {
      const key = sourceResultIdentity(result);
      const previous = healthResultsBySource.get(key);
      resultBytes += Buffer.byteLength(JSON.stringify(result), 'utf8')
        - (previous ? Buffer.byteLength(JSON.stringify(previous), 'utf8') : 0);
      if (resultBytes > SUUNTO_HEALTH_MAX_RESULT_BYTES
        || (!previous && healthResultsBySource.size
          >= 2 * SUUNTO_HEALTH_MAX_SERIES_SOURCE_RECORDS + SUUNTO_HEALTH_MAX_DAILY_SOURCE_RECORDS)) {
        throw new SuuntoHealthValidationError('Suunto Health result budget exceeded.');
      }
      healthResultsBySource.set(key, result);
    }
  };
  const targetStartMs = queueItem.suuntoHealthProgress?.nextStartMs ?? startMs;
  const targetEndMs = Math.min(endMs, targetStartMs
    + (queueItem.suuntoHealthProgress?.targetWindowMs ?? SUUNTO_HEALTH_MAX_TARGET_WINDOW_MS));
  const completedWindow = await processWindow({
    targetStartMs, targetEndMs,
    requestStartMs: Math.max(0, targetStartMs - SUUNTO_HEALTH_CONTEXT_PADDING_MS),
    requestEndMs: targetEndMs + SUUNTO_HEALTH_CONTEXT_PADDING_MS,
  });

  lifecycleGuards = await assertCurrentLifecycle(firebaseUserID, tokenSnapshot.ref, tokenCredential, initialGuards);
  onLifecycleGuardsCaptured?.(lifecycleGuards);
  return {
    healthResults: [...healthResultsBySource.values()]
      .sort((left, right) => left.input.startTimeMs - right.input.startTimeMs
        || left.input.sourceRecordType.localeCompare(right.input.sourceRecordType)
        || left.input.sourceRecordKey.localeCompare(right.input.sourceRecordKey)),
    lifecycleGuards,
    continuation: completedWindow.targetEndMs < endMs ? {
      nextStartMs: completedWindow.targetEndMs,
      targetWindowMs: completedWindow.targetEndMs - completedWindow.targetStartMs,
      authorityDigest,
    } : null,
  };
}

export const suuntoHealthSyncTestInternals = {
  buildSuuntoHealthRequestWindows,
};

export function suuntoCredentialFromSnapshot(tokenSnapshot: TokenSnapshot): TokenCredentialSnapshot {
  const credential = getTokenCredentialSnapshot(
    tokenSnapshot.data() as Record<string, unknown> | undefined,
  );
  if (!credential.accessToken) throw new SuuntoHealthAccountValidationError();
  return credential;
}

export function sanitizeSuuntoHealthErrorForTelemetry(error: unknown): Error {
  if (error instanceof SuuntoHealthAccountValidationError
    || error instanceof SuuntoHealthRequestError) {
    return error;
  }
  if (error instanceof Error && error.name === 'SuuntoHealthValidationError') {
    const validationCode = suuntoHealthValidationTelemetryCode(error.message);
    return new Error(`Suunto Health response validation failed [${validationCode}].`);
  }
  return new Error('Suunto Health processing failed.');
}

function suuntoHealthValidationTelemetryCode(message: string): string {
  const rules: ReadonlyArray<readonly [RegExp, string]> = [
    [/ must be an object\.$/, 'expected_object'],
    [/ must be a string\.$/, 'expected_string'],
    [/ must be a bounded non-empty string\.$/, 'invalid_bounded_string'],
    [/ must be a valid ISO8601 timestamp(?: with an offset)?\.$/, 'invalid_timestamp'],
    [/ contains an invalid calendar value\.$/, 'invalid_calendar_value'],
    [/ contains an unsupported timezone offset\.$/, 'unsupported_timezone_offset'],
    [/ is outside the supported timestamp range\.$/, 'timestamp_out_of_range'],
    [/ is outside the supported numeric range\.$/, 'numeric_value_out_of_range'],
    [/ response must be an array\.$/, 'expected_array'],
    [/ response exceeds the bounded item count\.$/, 'response_item_limit'],
    [/^Suunto Health pull budget exceeded\.$/, 'pull_budget'],
    [/^Suunto Health result budget exceeded\.$/, 'result_budget'],
    [/^Suunto activity HRExt minimum exceeds maximum\.$/, 'invalid_heart_rate_extrema'],
    [/ statistic value must be numeric or null\.$/, 'invalid_statistic_value'],
    [/ statistic value is outside the supported range\.$/, 'statistic_value_out_of_range'],
    [/^Suunto daily statistics contains an unsupported aggregation\.$/, 'unsupported_aggregation'],
    [/^Suunto daily statistics contains conflicting non-null duplicates\.$/, 'conflicting_daily_statistic'],
    [/^Suunto Health samples exceed the bounded source-record count\.$/, 'source_record_limit'],
    [/^Suunto daily statistics exceeds the bounded source-record count\.$/, 'daily_source_record_limit'],
    [/^Suunto daily statistics has conflicting day boundaries for one source\.$/, 'conflicting_day_boundaries'],
    [/^Suunto Health range must be a supported positive window of at most 28 days\.$/, 'invalid_request_range'],
    [/ response contains a timestamp outside the requested range\.$/, 'timestamp_outside_request'],
  ];
  return rules.find(([pattern]) => pattern.test(message))?.[1] || 'unclassified_validation';
}
