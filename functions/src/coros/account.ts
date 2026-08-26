import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { ServiceNames } from '@sports-alliance/sports-lib';

import {
  isDisconnectPendingServiceConnection,
  isReconnectRequiredServiceConnection,
  isServiceUnavailableForSyncConnection,
} from '../../../shared/service-connection';
import { getServiceConnectionMeta, pinServiceConnectionProviderUserIdIfUnset } from '../service-connection-meta';
import { ProviderPendingDisconnectError } from '../shared/provider-pending-disconnect-error';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from './constants';
import { containsASCIIControlCharacter } from './input-validation';
import { doesOAuthCredentialGenerationAuthorizeToken } from '../token-refresh-coordinator';

type COROSTokenSnapshot = admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot;
const MAX_COROS_OPEN_ID_LENGTH = 200;

export function normalizeCOROSOpenId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized
    || normalized.length > MAX_COROS_OPEN_ID_LENGTH
    || normalized.includes('/')
    || containsASCIIControlCharacter(normalized)) {
    return null;
  }
  return normalized;
}

function finiteTimestamp(value: unknown): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function tokenSortValue(snapshot: COROSTokenSnapshot): [number, number, string] {
  const data = snapshot.data() as Record<string, unknown> | undefined;
  return [
    finiteTimestamp(data?.dateRefreshed),
    finiteTimestamp(data?.dateCreated),
    snapshot.id,
  ];
}

/** Selects one legacy COROS connection deterministically when metadata was not pinned yet. */
export function selectActiveCOROSTokenSnapshot<T extends COROSTokenSnapshot>(snapshots: T[]): T | null {
  return [...snapshots].sort((left, right) => {
    const leftValue = tokenSortValue(left);
    const rightValue = tokenSortValue(right);
    return rightValue[0] - leftValue[0]
      || rightValue[1] - leftValue[1]
      || rightValue[2].localeCompare(leftValue[2]);
  })[0] || null;
}

function snapshotMatchesOpenId(snapshot: COROSTokenSnapshot, openId: string): boolean {
  const tokenOpenIdValue = (snapshot.data() as Record<string, unknown> | undefined)?.openId;
  const hasTokenOpenId = tokenOpenIdValue !== undefined && tokenOpenIdValue !== null && tokenOpenIdValue !== '';
  const tokenOpenId = hasTokenOpenId ? normalizeCOROSOpenId(tokenOpenIdValue) : null;
  return snapshot.id === openId && (!hasTokenOpenId || tokenOpenId === openId);
}

function tokenMatchesRootCredentialGeneration(
  tokenRootSnapshot: admin.firestore.DocumentSnapshot,
  tokenSnapshot: COROSTokenSnapshot,
): boolean {
  return tokenSnapshot.exists && doesOAuthCredentialGenerationAuthorizeToken(
    tokenRootSnapshot.exists
      ? tokenRootSnapshot.data() as Record<string, unknown> | undefined
      : null,
    tokenSnapshot.data()?.tokenCredentialGeneration,
  );
}

/**
 * Revalidates the pinned COROS account in the same transaction that persists
 * downstream work. This prevents a reconnect or disconnect from racing a
 * history queue write after provider data has already been retrieved.
 */
export async function assertActiveCOROSAccountInTransaction(
  userID: string,
  expectedProviderUserId: string,
  transaction: admin.firestore.Transaction,
): Promise<void> {
  const expectedOpenId = normalizeCOROSOpenId(expectedProviderUserId);
  if (!expectedOpenId) {
    throw new HttpsError('unauthenticated', 'Reconnect COROS before importing data.');
  }

  const db = admin.firestore();
  const tokenRootRef = db.collection(COROSAPI_ACCESS_TOKENS_COLLECTION_NAME).doc(userID);
  const connectionMetaRef = db.collection('users').doc(userID).collection('meta').doc(ServiceNames.COROSAPI);
  const tokenRef = tokenRootRef
    .collection('tokens')
    .doc(expectedOpenId);
  const [connectionMetaSnapshot, tokenRootSnapshot, tokenSnapshot] = await Promise.all([
    transaction.get(connectionMetaRef),
    transaction.get(tokenRootRef),
    transaction.get(tokenRef),
  ]);
  const connectionMeta = connectionMetaSnapshot.data() as Record<string, unknown> | undefined;
  const pinnedOpenId = normalizeCOROSOpenId(connectionMeta?.providerUserId);
  if (isServiceUnavailableForSyncConnection(connectionMeta)
    || pinnedOpenId !== expectedOpenId
    || !tokenSnapshot.exists
    || !tokenMatchesRootCredentialGeneration(tokenRootSnapshot, tokenSnapshot)
    || !snapshotMatchesOpenId(tokenSnapshot, expectedOpenId)) {
    throw new HttpsError('unauthenticated', 'The selected COROS account changed before data could be saved.');
  }
}

/**
 * Resolves the single active COROS account. Once pinned, a missing token fails
 * closed instead of silently delivering to another connected account.
 */
export async function getActiveCOROSTokenSnapshot(
  userID: string,
  expectedProviderUserId?: string,
): Promise<COROSTokenSnapshot> {
  const tokenRootRef = admin.firestore()
    .collection(COROSAPI_ACCESS_TOKENS_COLLECTION_NAME)
    .doc(userID);
  const tokenCollection = tokenRootRef.collection('tokens');
  const [connectionMeta, tokenRootSnapshot] = await Promise.all([
    getServiceConnectionMeta(userID, ServiceNames.COROSAPI),
    tokenRootRef.get(),
  ]);
  if (!tokenRootSnapshot.exists) {
    throw new HttpsError('unauthenticated', 'Connect COROS before sending data.');
  }
  if (isDisconnectPendingServiceConnection(connectionMeta)) {
    throw new ProviderPendingDisconnectError(userID, ServiceNames.COROSAPI, 'active_account_lookup');
  }
  if (isReconnectRequiredServiceConnection(connectionMeta)) {
    throw new HttpsError('unauthenticated', 'Reconnect COROS before sending data.');
  }
  const rawPinnedOpenId = connectionMeta?.providerUserId;
  const pinnedOpenId = normalizeCOROSOpenId(rawPinnedOpenId);
  const expectedOpenId = expectedProviderUserId === undefined
    ? null
    : normalizeCOROSOpenId(expectedProviderUserId);
  if ((rawPinnedOpenId !== undefined && rawPinnedOpenId !== null && rawPinnedOpenId !== '' && !pinnedOpenId)
    || (expectedProviderUserId !== undefined && !expectedOpenId)) {
    throw new HttpsError('unauthenticated', 'Reconnect COROS before sending data.');
  }

  const assertExpectedAccount = (snapshot: COROSTokenSnapshot): COROSTokenSnapshot => {
    if (expectedOpenId && snapshot.id !== expectedOpenId) {
      throw new HttpsError('unauthenticated', 'The selected COROS account changed before data could be sent.');
    }
    return snapshot;
  };

  if (pinnedOpenId) {
    const pinnedSnapshot = await tokenCollection.doc(pinnedOpenId).get();
    if (!pinnedSnapshot.exists
      || !snapshotMatchesOpenId(pinnedSnapshot, pinnedOpenId)
      || !tokenMatchesRootCredentialGeneration(tokenRootSnapshot, pinnedSnapshot)) {
      throw new HttpsError('unauthenticated', 'Reconnect COROS before sending data.');
    }
    return assertExpectedAccount(pinnedSnapshot);
  }

  const tokenSnapshots = await tokenCollection.get();
  const selectedSnapshot = selectActiveCOROSTokenSnapshot(tokenSnapshots.docs);
  if (!selectedSnapshot) {
    throw new HttpsError('unauthenticated', 'Connect COROS before sending data.');
  }

  const tokenOpenId = (selectedSnapshot.data() as Record<string, unknown> | undefined)?.openId;
  const selectedOpenId = normalizeCOROSOpenId(
    tokenOpenId === undefined || tokenOpenId === null || tokenOpenId === '' ? selectedSnapshot.id : tokenOpenId,
  );
  if (!selectedOpenId || !snapshotMatchesOpenId(selectedSnapshot, selectedOpenId)) {
    throw new HttpsError('unauthenticated', 'Reconnect COROS before sending data.');
  }
  const expectedSnapshot = assertExpectedAccount(selectedSnapshot);
  if (!tokenMatchesRootCredentialGeneration(tokenRootSnapshot, expectedSnapshot)) {
    throw new HttpsError('unauthenticated', 'Reconnect COROS before sending data.');
  }

  const pinResult = await pinServiceConnectionProviderUserIdIfUnset(userID, ServiceNames.COROSAPI, selectedOpenId);
  if (pinResult === 'conflict') {
    throw new HttpsError('unauthenticated', 'The selected COROS account changed before data could be sent.');
  }
  if (pinResult !== 'pinned' && pinResult !== 'already_pinned') {
    throw new HttpsError('failed-precondition', 'Account is being deleted or no longer exists.');
  }
  return expectedSnapshot;
}
