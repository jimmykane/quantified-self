import * as admin from 'firebase-admin';
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

export interface COROSBindingStateResult {
  status: 'bound' | 'unbound' | 'stale';
  bound: boolean | null;
  checkedAt?: number;
}

export class COROSBindingStateUnavailableError extends Error {
  readonly name = 'COROSBindingStateUnavailableError';

  constructor(public readonly reason: string) {
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

async function persistBindingStateIfCurrent(params: {
  userID: string;
  openId: string;
  accessToken: string;
  tokenDateCreated: number | null;
  tokenRef: admin.firestore.DocumentReference;
  bound: boolean;
  checkedAt: number;
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
      || normalizeCOROSOpenId(metaData?.providerUserId) !== params.openId
      || isServiceUnavailableForSyncConnection(metaData)) {
      return 'stale';
    }

    if (params.bound) {
      transaction.set(metaRef, {
        providerBindingState: 'bound',
        providerBindingCheckedAt: params.checkedAt,
      }, { merge: true });
      return 'updated';
    }

    transaction.set(metaRef, {
      connectionState: SERVICE_CONNECTION_STATES.ReconnectRequired,
      providerBindingState: 'unbound',
      providerBindingCheckedAt: params.checkedAt,
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

  const bound = await fetchCOROSBindingState(accessToken, openId);
  const writeResult = await persistBindingStateIfCurrent({
    userID,
    openId,
    accessToken,
    tokenDateCreated,
    tokenRef: tokenSnapshot.ref,
    bound,
    checkedAt,
  });
  if (writeResult === 'user_inactive') {
    throw new HttpsError('failed-precondition', 'Account is being deleted or no longer exists.');
  }
  if (writeResult === 'stale') return { status: 'stale', bound: null };
  return { status: bound ? 'bound' : 'unbound', bound, checkedAt };
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
      throw new HttpsError('unavailable', 'Could not verify the COROS connection. Please retry.');
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
