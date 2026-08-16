import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { ServiceNames } from '@sports-alliance/sports-lib';

import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import {
  isServiceUnavailableForSyncConnection,
  SERVICE_CONNECTION_STATES,
  type ServiceConnectionMetaFields,
} from '../../../shared/service-connection';
import { getDisabledServiceSyncSettingsUpdate } from '../activity-sync/route-cleanup';
import * as requestPromise from '../request-helper';
import {
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';
import { getActiveCOROSTokenSnapshot, normalizeCOROSOpenId } from './account';
import {
  COROS_API_REQUEST_TIMEOUT_MS,
  PRODUCTION_URL,
  STAGING_URL,
  USE_STAGING,
} from './constants';
import { parseCOROSJSON } from './json';

interface COROSBindingStateResponse {
  result?: unknown;
  message?: unknown;
  data?: unknown;
}

const COROS_BINDING_STATE_CACHE_MS = 5 * 60 * 1000;
const COROS_BINDING_STATE_STALE_WHILE_IN_FLIGHT_MS = 15 * 60 * 1000;
const COROS_BINDING_STATE_LEASE_MS = 45 * 1000;
const COROS_BINDING_STATE_ACCOUNT_COOLDOWN_MS = 15 * 1000;
const COROS_BINDING_STATE_MAX_RESPONSE_BYTES = 16 * 1024;
const COROS_BINDING_STATE_GLOBAL_WINDOW_MS = 60 * 1000;
const COROS_BINDING_STATE_GLOBAL_REQUESTS_PER_WINDOW = 60;
const PROVIDER_OPERATION_LIMITS_COLLECTION = 'providerOperationLimits';
const COROS_BINDING_STATE_LIMIT_DOCUMENT = 'coros-binding-state';

export interface COROSBindingStateResult {
  status: 'bound' | 'unbound' | 'stale';
  bound: boolean | null;
  checkedAt?: number;
  retryAt?: number;
}

export class COROSBindingStateUnavailableError extends Error {
  readonly name = 'COROSBindingStateUnavailableError';

  constructor(
    public readonly reason: string,
    public readonly retryAt?: number,
  ) {
    super('COROS binding state is temporarily unavailable.');
  }
}

function parseBindingState(rawResponse: unknown): boolean {
  if (typeof rawResponse !== 'string' && !Buffer.isBuffer(rawResponse)) {
    throw new COROSBindingStateUnavailableError('invalid_response_body');
  }
  let response: COROSBindingStateResponse;
  try {
    response = parseCOROSJSON<COROSBindingStateResponse>(rawResponse);
  } catch {
    throw new COROSBindingStateUnavailableError('invalid_json');
  }
  const resultCode = `${response.result ?? ''}`.trim();
  const message = `${response.message ?? ''}`.trim();
  if (!resultCode || !/^0+$/.test(resultCode) || (message && message !== 'OK')) {
    throw new COROSBindingStateUnavailableError('provider_rejected_request');
  }
  if (!response.data || typeof response.data !== 'object' || Array.isArray(response.data)) {
    throw new COROSBindingStateUnavailableError('missing_data');
  }
  const bindState = (response.data as { bindState?: unknown }).bindState;
  if (bindState !== 0 && bindState !== 1) {
    throw new COROSBindingStateUnavailableError('invalid_bind_state');
  }
  return bindState === 1;
}

async function fetchCOROSBindingState(accessToken: string, openId: string): Promise<boolean> {
  const query = new URLSearchParams({ token: accessToken, openId });
  try {
    return parseBindingState(await requestPromise.get({
      url: `${USE_STAGING ? STAGING_URL : PRODUCTION_URL}/coros/bindState?${query.toString()}`,
      headers: { token: accessToken },
      timeout: COROS_API_REQUEST_TIMEOUT_MS,
      maxResponseBytes: COROS_BINDING_STATE_MAX_RESPONSE_BYTES,
    }));
  } catch (error) {
    if (error instanceof COROSBindingStateUnavailableError) throw error;
    throw new COROSBindingStateUnavailableError('provider_request_failed');
  }
}

function tokenIdentityMatches(
  tokenData: Record<string, unknown> | undefined,
  openId: string,
  accessToken: string,
  tokenDateCreated: number | null,
): boolean {
  const currentDateCreated = Number(tokenData?.dateCreated);
  return typeof tokenData?.accessToken === 'string'
    && tokenData.accessToken === accessToken
    && normalizeCOROSOpenId(tokenData.openId || openId) === openId
    && (tokenDateCreated === null
      || (Number.isFinite(currentDateCreated) && currentDateCreated === tokenDateCreated));
}

function getCachedBindingState(
  metaData: ServiceConnectionMetaFields | undefined,
  nowMs: number,
  maximumAgeMs: number,
): COROSBindingStateResult | null {
  const checkedAt = Number(metaData?.providerBindingCheckedAt);
  const ageMs = nowMs - checkedAt;
  if (!Number.isFinite(checkedAt) || checkedAt <= 0 || ageMs < 0 || ageMs > maximumAgeMs) {
    return null;
  }
  if (metaData?.providerBindingState === 'bound') {
    return { status: 'bound', bound: true, checkedAt };
  }
  if (metaData?.providerBindingState === 'unbound') {
    return { status: 'unbound', bound: false, checkedAt };
  }
  return null;
}

type COROSBindingCheckClaim =
  | { status: 'cached'; result: COROSBindingStateResult }
  | { status: 'claimed'; leaseId: string };

async function claimCOROSBindingStateCheck(params: {
  userID: string;
  openId: string;
  accessToken: string;
  tokenDateCreated: number | null;
  tokenRef: admin.firestore.DocumentReference;
  checkedAt: number;
  leaseId: string;
}): Promise<COROSBindingCheckClaim> {
  const db = admin.firestore();
  const metaRef = db.collection('users').doc(params.userID).collection('meta').doc(ServiceNames.COROSAPI);
  const rateLimitRef = db.collection(PROVIDER_OPERATION_LIMITS_COLLECTION)
    .doc(COROS_BINDING_STATE_LIMIT_DOCUMENT);
  const windowStartMs = Math.floor(params.checkedAt / COROS_BINDING_STATE_GLOBAL_WINDOW_MS)
    * COROS_BINDING_STATE_GLOBAL_WINDOW_MS;

  return db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, params.userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(params.userID, 'coros_binding_state_claim', error);
    }
    if (deletionGuard.shouldSkip) {
      throw new HttpsError('failed-precondition', 'Account is being deleted or no longer exists.');
    }

    const [tokenSnapshot, metaSnapshot] = await Promise.all([
      transaction.get(params.tokenRef),
      transaction.get(metaRef),
    ]);
    const tokenData = tokenSnapshot.data() as Record<string, unknown> | undefined;
    const metaData = metaSnapshot.data() as ServiceConnectionMetaFields | undefined;
    if (!tokenSnapshot.exists
      || !tokenIdentityMatches(
        tokenData,
        params.openId,
        params.accessToken,
        params.tokenDateCreated,
      )
      || normalizeCOROSOpenId(metaData?.providerUserId) !== params.openId
      || isServiceUnavailableForSyncConnection(metaData)) {
      throw new HttpsError('unauthenticated', 'Reconnect COROS before checking the connection.');
    }

    const cachedResult = getCachedBindingState(
      metaData,
      params.checkedAt,
      COROS_BINDING_STATE_CACHE_MS,
    );
    if (cachedResult) {
      return { status: 'cached' as const, result: cachedResult };
    }

    const nextRetryAt = Number(metaData?.providerBindingCheckNextRetryAt);
    if (Number.isFinite(nextRetryAt) && nextRetryAt > params.checkedAt) {
      const staleResult = getCachedBindingState(
        metaData,
        params.checkedAt,
        COROS_BINDING_STATE_STALE_WHILE_IN_FLIGHT_MS,
      );
      if (staleResult) {
        return { status: 'cached' as const, result: staleResult };
      }
      throw new HttpsError(
        'resource-exhausted',
        'COROS connection checks are cooling down after a recent check. Please retry shortly.',
        { retryAt: nextRetryAt },
      );
    }

    const leaseExpiresAt = Number(metaData?.providerBindingCheckLeaseExpiresAt);
    if (Number.isFinite(leaseExpiresAt) && leaseExpiresAt > params.checkedAt) {
      const staleResult = getCachedBindingState(
        metaData,
        params.checkedAt,
        COROS_BINDING_STATE_STALE_WHILE_IN_FLIGHT_MS,
      );
      if (staleResult) {
        return { status: 'cached' as const, result: staleResult };
      }
      throw new HttpsError(
        'resource-exhausted',
        'A COROS connection check is already in progress. Please retry shortly.',
        { retryAt: leaseExpiresAt },
      );
    }

    // Cached and already-in-flight requests never contend on the shared
    // provider budget document. Read it only once an upstream call is needed.
    const rateLimitSnapshot = await transaction.get(rateLimitRef);
    const rateLimitData = rateLimitSnapshot.data() as Record<string, unknown> | undefined;
    const storedWindowStartMs = Number(rateLimitData?.windowStartMs);
    const storedCount = Number(rateLimitData?.count);
    const currentCount = storedWindowStartMs === windowStartMs
      && Number.isSafeInteger(storedCount)
      && storedCount >= 0
      ? storedCount
      : 0;
    if (currentCount >= COROS_BINDING_STATE_GLOBAL_REQUESTS_PER_WINDOW) {
      logger.warn('[COROSBindingState] Shared provider request budget exhausted.', {
        windowStartMs,
        requestCount: currentCount,
      });
      throw new HttpsError(
        'resource-exhausted',
        'COROS connection checks are temporarily busy. Please retry shortly.',
        { retryAt: windowStartMs + COROS_BINDING_STATE_GLOBAL_WINDOW_MS },
      );
    }

    transaction.set(rateLimitRef, {
      provider: 'COROS',
      operation: 'binding_state',
      windowStartMs,
      count: currentCount + 1,
      updatedAtMs: params.checkedAt,
    }, { merge: true });
    transaction.set(metaRef, {
      providerBindingCheckLeaseId: params.leaseId,
      providerBindingCheckLeaseExpiresAt: params.checkedAt + COROS_BINDING_STATE_LEASE_MS,
      providerBindingCheckNextRetryAt: 0,
    }, { merge: true });
    return { status: 'claimed' as const, leaseId: params.leaseId };
  });
}

async function persistBindingStateIfCurrent(params: {
  userID: string;
  openId: string;
  accessToken: string;
  tokenDateCreated: number | null;
  tokenRef: admin.firestore.DocumentReference;
  bound: boolean;
  checkedAt: number;
  leaseId: string;
}): Promise<'updated' | 'stale' | 'user_inactive'> {
  const db = admin.firestore();
  const metaRef = db.collection('users').doc(params.userID).collection('meta').doc(ServiceNames.COROSAPI);
  const settingsRef = db.collection('users').doc(params.userID).collection('config').doc('settings');

  return db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, params.userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(params.userID, 'coros_binding_state_persist', error);
    }
    if (deletionGuard.shouldSkip) return 'user_inactive';

    const [tokenSnapshot, metaSnapshot] = await Promise.all([
      transaction.get(params.tokenRef),
      transaction.get(metaRef),
    ]);
    const tokenData = tokenSnapshot.data() as Record<string, unknown> | undefined;
    const metaData = metaSnapshot.data() as ServiceConnectionMetaFields | undefined;
    if (!tokenSnapshot.exists
      || !tokenIdentityMatches(
        tokenData,
        params.openId,
        params.accessToken,
        params.tokenDateCreated,
      )
      || metaData?.providerBindingCheckLeaseId !== params.leaseId
      || normalizeCOROSOpenId(metaData?.providerUserId) !== params.openId
      || isServiceUnavailableForSyncConnection(metaData)) {
      return 'stale';
    }

    if (params.bound) {
      transaction.set(metaRef, {
        providerBindingState: 'bound',
        providerBindingCheckedAt: params.checkedAt,
        providerBindingCheckLeaseId: null,
        providerBindingCheckLeaseExpiresAt: 0,
        providerBindingCheckNextRetryAt: 0,
      }, { merge: true });
      return 'updated';
    }

    transaction.set(metaRef, {
      connectionState: SERVICE_CONNECTION_STATES.ReconnectRequired,
      providerBindingState: 'unbound',
      providerBindingCheckedAt: params.checkedAt,
      providerBindingCheckLeaseId: null,
      providerBindingCheckLeaseExpiresAt: 0,
      providerBindingCheckNextRetryAt: 0,
      lastAuthFailureCode: 'coros_unbound',
      lastAuthFailureMessage: 'The COROS account is no longer bound. Reconnect COROS.',
      lastDisconnectedAt: params.checkedAt,
    }, { merge: true });
    const serviceSyncSettings = getDisabledServiceSyncSettingsUpdate(ServiceNames.COROSAPI);
    if (Object.keys(serviceSyncSettings).length > 0) {
      transaction.set(settingsRef, { serviceSyncSettings }, { merge: true });
    }
    return 'updated';
  });
}

async function settleCOROSBindingStateCheckLeaseIfCurrent(params: {
  userID: string;
  leaseId: string;
  nextRetryAt: number;
  deletionGuardPhase: 'coros_binding_state_stale_cooldown' | 'coros_binding_state_failure_cooldown';
}): Promise<boolean> {
  const db = admin.firestore();
  const metaRef = db.collection('users').doc(params.userID).collection('meta').doc(ServiceNames.COROSAPI);

  return db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, params.userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(params.userID, params.deletionGuardPhase, error);
    }
    if (deletionGuard.shouldSkip) return false;

    const metaSnapshot = await transaction.get(metaRef);
    const metaData = metaSnapshot.data() as ServiceConnectionMetaFields | undefined;
    if (metaData?.providerBindingCheckLeaseId !== params.leaseId) return false;

    transaction.set(metaRef, {
      providerBindingCheckLeaseId: null,
      providerBindingCheckLeaseExpiresAt: 0,
      providerBindingCheckNextRetryAt: params.nextRetryAt,
    }, { merge: true });
    return true;
  });
}

async function recordCOROSBindingStateStaleCooldownIfCurrent(params: {
  userID: string;
  leaseId: string;
  staleAt: number;
}): Promise<number | null> {
  const retryAt = params.staleAt + COROS_BINDING_STATE_ACCOUNT_COOLDOWN_MS;
  const didSettleLease = await settleCOROSBindingStateCheckLeaseIfCurrent({
    userID: params.userID,
    leaseId: params.leaseId,
    nextRetryAt: retryAt,
    deletionGuardPhase: 'coros_binding_state_stale_cooldown',
  });
  return didSettleLease ? retryAt : null;
}

async function recordCOROSBindingStateFailureCooldownIfCurrent(params: {
  userID: string;
  leaseId: string;
  failedAt: number;
}): Promise<number | null> {
  const retryAt = params.failedAt + COROS_BINDING_STATE_ACCOUNT_COOLDOWN_MS;
  const didSettleLease = await settleCOROSBindingStateCheckLeaseIfCurrent({
    userID: params.userID,
    leaseId: params.leaseId,
    nextRetryAt: retryAt,
    deletionGuardPhase: 'coros_binding_state_failure_cooldown',
  });
  return didSettleLease ? retryAt : null;
}

async function recordCOROSBindingStateFailureCooldownAfterFailure(
  userID: string,
  leaseId: string,
  failedAt: number,
): Promise<number | null> {
  try {
    return await recordCOROSBindingStateFailureCooldownIfCurrent({ userID, leaseId, failedAt });
  } catch (error) {
    logger.warn('[COROSBindingState] Could not record the failed provider-check cooldown.', {
      userID,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
}

export async function checkCOROSBindingStateForUser(
  userID: string,
  checkedAt = Date.now(),
): Promise<COROSBindingStateResult> {
  const tokenSnapshot = await getActiveCOROSTokenSnapshot(userID);
  const tokenData = tokenSnapshot.data() as Record<string, unknown> | undefined;
  const openId = normalizeCOROSOpenId(tokenData?.openId || tokenSnapshot.id);
  const accessToken = typeof tokenData?.accessToken === 'string' ? tokenData.accessToken.trim() : '';
  const rawDateCreated = Number(tokenData?.dateCreated);
  const tokenDateCreated = Number.isFinite(rawDateCreated) ? rawDateCreated : null;
  if (!openId || openId !== tokenSnapshot.id || !accessToken) {
    throw new HttpsError('unauthenticated', 'Reconnect COROS before checking the connection.');
  }

  const leaseId = crypto.randomUUID();
  const claim = await claimCOROSBindingStateCheck({
    userID,
    openId,
    accessToken,
    tokenDateCreated,
    tokenRef: tokenSnapshot.ref,
    checkedAt,
    leaseId,
  });
  if (claim.status === 'cached') return claim.result;

  try {
    const bound = await fetchCOROSBindingState(accessToken, openId);
    const writeResult = await persistBindingStateIfCurrent({
      userID,
      openId,
      accessToken,
      tokenDateCreated,
      tokenRef: tokenSnapshot.ref,
      bound,
      checkedAt,
      leaseId: claim.leaseId,
    });
    if (writeResult === 'user_inactive') {
      throw new HttpsError('failed-precondition', 'Account is being deleted or no longer exists.');
    }
    if (writeResult === 'stale') {
      const retryAt = await recordCOROSBindingStateStaleCooldownIfCurrent({
        userID,
        leaseId: claim.leaseId,
        staleAt: Date.now(),
      });
      return {
        status: 'stale',
        bound: null,
        ...(retryAt !== null ? { retryAt } : {}),
      };
    }
    return { status: bound ? 'bound' : 'unbound', bound, checkedAt };
  } catch (error) {
    const retryAt = await recordCOROSBindingStateFailureCooldownAfterFailure(
      userID,
      claim.leaseId,
      Date.now(),
    );
    if (error instanceof COROSBindingStateUnavailableError && retryAt !== null) {
      throw new COROSBindingStateUnavailableError(error.reason, retryAt);
    }
    throw error;
  }
}

export async function handleCOROSBindingStateRequest(request: {
  app?: unknown;
  auth?: { uid?: string } | null;
}): Promise<COROSBindingStateResult> {
  enforceAppCheck(request);
  const userID = `${request.auth?.uid || ''}`.trim();
  if (!userID) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  try {
    return await checkCOROSBindingStateForUser(userID);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof UserDeletionGuardReadError || error instanceof COROSBindingStateUnavailableError) {
      logger.warn('[COROSBindingState] Connection check is temporarily unavailable.', {
        userID,
        reason: error instanceof COROSBindingStateUnavailableError ? error.reason : 'deletion_guard_read_failed',
      });
      throw new HttpsError(
        'unavailable',
        'Could not verify the COROS connection. Please retry.',
        error instanceof COROSBindingStateUnavailableError && error.retryAt
          ? { retryAt: error.retryAt }
          : undefined,
      );
    }
    logger.warn('[COROSBindingState] Unexpected connection check failure.', {
      userID,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    throw new HttpsError('unavailable', 'Could not verify the COROS connection. Please retry.');
  }
}

export const getCOROSAPIBindingState = onCall({
  region: FUNCTIONS_MANIFEST.getCOROSAPIBindingState.region,
  cors: ALLOWED_CORS_ORIGINS,
  timeoutSeconds: 60,
  maxInstances: 10,
}, handleCOROSBindingStateRequest);
