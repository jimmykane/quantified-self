import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { ServiceNames } from '@sports-alliance/sports-lib';

import {
  isDisconnectPendingServiceConnection,
  isReconnectRequiredServiceConnection,
} from '../../../shared/service-connection';
import {
  getServiceConnectionMeta,
  pinServiceConnectionProviderUserIdIfUnset,
} from '../service-connection-meta';
import { ProviderPendingDisconnectError } from '../shared/provider-pending-disconnect-error';
import { WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME } from './constants';
import {
  WahooCredentialSupersededError,
  WahooReconnectRequiredError,
} from './refresh-recovery';
import {
  ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD,
  areTokenCredentialSnapshotsEqual,
  getTokenCredentialSnapshot,
  type TokenCredentialSnapshot,
} from '../token-refresh-coordinator';
import { getServiceDisconnectOperationGeneration } from '../service-token-store';
import { isServiceDisconnectPendingData } from '../service-disconnect-pending-state';

type WahooTokenSnapshot = admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot;
const MAX_WAHOO_USER_ID_LENGTH = 200;

export interface WahooActiveAccountGuard {
  providerUserId: string;
  connectionStateGeneration: string | null;
  activeCredentialGeneration: string | null;
  credential: TokenCredentialSnapshot | null;
}

export function normalizeWahooUserID(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized
    || normalized.length > MAX_WAHOO_USER_ID_LENGTH
    || normalized.includes('/')
    || [...normalized].some(character => {
      const codePoint = character.codePointAt(0) || 0;
      return codePoint <= 0x1F || codePoint === 0x7F;
    })) {
    return null;
  }
  return normalized;
}

function finiteTimestamp(value: unknown): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function tokenSortValue(snapshot: WahooTokenSnapshot): [number, number, string] {
  const data = snapshot.data() as Record<string, unknown> | undefined;
  return [
    finiteTimestamp(data?.dateRefreshed),
    finiteTimestamp(data?.dateCreated),
    snapshot.id,
  ];
}

export function selectActiveWahooTokenSnapshot<T extends WahooTokenSnapshot>(snapshots: T[]): T | null {
  return [...snapshots].sort((left, right) => {
    const leftValue = tokenSortValue(left);
    const rightValue = tokenSortValue(right);
    return rightValue[0] - leftValue[0]
      || rightValue[1] - leftValue[1]
      || rightValue[2].localeCompare(leftValue[2]);
  })[0] || null;
}

function snapshotMatchesWahooUserID(snapshot: WahooTokenSnapshot, wahooUserID: string): boolean {
  const tokenUserID = normalizeWahooUserID(
    (snapshot.data() as Record<string, unknown> | undefined)?.wahooUserID,
  );
  return snapshot.id === wahooUserID && tokenUserID === wahooUserID;
}

function getWahooTokenCollection(userID: string): admin.firestore.CollectionReference {
  return admin.firestore()
    .collection(WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME)
    .doc(userID)
    .collection('tokens');
}

function getWahooTokenRootDocument(userID: string): admin.firestore.DocumentReference {
  return admin.firestore().collection(WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME).doc(userID);
}

function getWahooConnectionMetaDocument(userID: string): admin.firestore.DocumentReference {
  return admin.firestore()
    .collection('users')
    .doc(userID)
    .collection('meta')
    .doc(ServiceNames.WahooAPI);
}

function normalizeGeneration(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

async function readWahooActiveAccountGuardInTransaction(
  transaction: admin.firestore.Transaction,
  userID: string,
  expectedProviderUserId: string,
  expectedAccessToken?: string,
): Promise<WahooActiveAccountGuard> {
  const providerUserId = normalizeWahooUserID(expectedProviderUserId);
  if (!providerUserId) {
    throw new HttpsError('unauthenticated', 'Reconnect Wahoo before sending data.');
  }

  const [metaSnapshot, tokenRootSnapshot, tokenSnapshot] = await Promise.all([
    transaction.get(getWahooConnectionMetaDocument(userID)),
    transaction.get(getWahooTokenRootDocument(userID)),
    transaction.get(getWahooTokenCollection(userID).doc(providerUserId)),
  ]);
  const meta = metaSnapshot.data();
  const tokenRoot = tokenRootSnapshot.data() as Record<string, unknown> | undefined;
  if (isDisconnectPendingServiceConnection(meta)
    || isServiceDisconnectPendingData(tokenRoot)
    || getServiceDisconnectOperationGeneration(tokenRoot)) {
    throw new ProviderPendingDisconnectError(userID, ServiceNames.WahooAPI, 'active_account_guard');
  }
  if (isReconnectRequiredServiceConnection(meta)) {
    throw new WahooReconnectRequiredError();
  }
  const rawPinnedProviderUserId = meta?.providerUserId;
  const hasPinnedProviderUserId = rawPinnedProviderUserId !== undefined
    && rawPinnedProviderUserId !== null
    && rawPinnedProviderUserId !== '';
  const pinnedProviderUserId = normalizeWahooUserID(rawPinnedProviderUserId);
  if ((hasPinnedProviderUserId && !pinnedProviderUserId)
    || (pinnedProviderUserId && pinnedProviderUserId !== providerUserId)
    || !tokenSnapshot.exists
    || !snapshotMatchesWahooUserID(tokenSnapshot, providerUserId)) {
    throw new HttpsError('unauthenticated', 'The selected Wahoo account changed before data could be sent.');
  }

  const credential = getTokenCredentialSnapshot(
    tokenSnapshot.data() as Record<string, unknown> | undefined,
  );
  const activeCredentialGeneration = normalizeGeneration(
    tokenRoot?.[ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD],
  );
  if ((activeCredentialGeneration && activeCredentialGeneration !== credential.credentialGeneration)
    || (expectedAccessToken !== undefined && credential.accessToken !== expectedAccessToken)) {
    // A normal coordinated refresh preserves the account and its OAuth
    // credential generation while changing the access token. Do not collapse
    // that race into a permanent authentication failure: callers must retry
    // with the current token before issuing provider I/O.
    throw new WahooCredentialSupersededError();
  }
  return {
    providerUserId,
    connectionStateGeneration: normalizeGeneration(meta?.connectionStateGeneration),
    activeCredentialGeneration,
    credential: expectedAccessToken === undefined ? null : credential,
  };
}

/**
 * Captures the Wahoo account and optional credential in one Firestore read
 * transaction. Reusing the returned guard immediately before provider work
 * prevents a disconnect/reconnect or rotating refresh from switching the
 * account underneath an already prepared operation. Credential-only changes
 * are surfaced as retryable supersession, never as a disconnected account.
 */
export async function captureWahooActiveAccountGuard(
  userID: string,
  expectedProviderUserId: string,
  expectedAccessToken?: string,
): Promise<WahooActiveAccountGuard> {
  const db = admin.firestore();
  return db.runTransaction(transaction => readWahooActiveAccountGuardInTransaction(
    transaction,
    userID,
    expectedProviderUserId,
    expectedAccessToken,
  ));
}

/** Revalidates a captured account/credential atomically immediately before I/O. */
export async function assertWahooActiveAccountGuardCurrent(
  userID: string,
  expected: WahooActiveAccountGuard,
): Promise<void> {
  const current = await captureWahooActiveAccountGuard(
    userID,
    expected.providerUserId,
    expected.credential?.accessToken,
  );
  if (current.connectionStateGeneration !== expected.connectionStateGeneration
  ) {
    throw new HttpsError('unauthenticated', 'The selected Wahoo account changed before data could be sent.');
  }
  if (current.activeCredentialGeneration !== expected.activeCredentialGeneration
    || (expected.credential !== null
      && (current.credential === null
        || !areTokenCredentialSnapshotsEqual(current.credential, expected.credential)))) {
    throw new WahooCredentialSupersededError();
  }
}

/** Enforces the account fence inside the transaction that performs a durable write. */
export async function assertWahooActiveAccountGuardCurrentInTransaction(
  transaction: admin.firestore.Transaction,
  userID: string,
  expected: WahooActiveAccountGuard,
): Promise<void> {
  const current = await readWahooActiveAccountGuardInTransaction(
    transaction,
    userID,
    expected.providerUserId,
    expected.credential?.accessToken,
  );
  if (current.connectionStateGeneration !== expected.connectionStateGeneration
  ) {
    throw new HttpsError('unauthenticated', 'The selected Wahoo account changed before data could be sent.');
  }
  if (current.activeCredentialGeneration !== expected.activeCredentialGeneration
    || (expected.credential !== null
      && (current.credential === null
        || !areTokenCredentialSnapshotsEqual(current.credential, expected.credential)))) {
    throw new WahooCredentialSupersededError();
  }
}

export class WahooOAuthAccountMismatchError extends Error {
  public readonly name = 'WahooOAuthAccountMismatchError';
  public readonly statusCode = 409;

  constructor(
    public readonly expectedProviderUserId: string,
    public readonly receivedProviderUserId: string,
  ) {
    super('Reconnect using the same Wahoo account, or disconnect the retained account first.');
  }
}

export function isWahooOAuthAccountMismatchError(error: unknown): error is WahooOAuthAccountMismatchError {
  return error instanceof WahooOAuthAccountMismatchError
    || (error instanceof Error && error.name === 'WahooOAuthAccountMismatchError');
}

/**
 * A reconnect-required connection deliberately retains its account identity so
 * parked work can resume safely. A callback for another Wahoo account must not
 * replace that identity while the retained credential and queue rows exist.
 */
export async function assertWahooOAuthAccountCompatible(
  userID: string,
  providerUserId: string,
): Promise<void> {
  const receivedProviderUserId = normalizeWahooUserID(providerUserId);
  if (!receivedProviderUserId) {
    throw new HttpsError('failed-precondition', 'Wahoo did not return a valid account identifier.');
  }

  const meta = await getServiceConnectionMeta(userID, ServiceNames.WahooAPI);
  let expectedProviderUserId = normalizeWahooUserID(meta?.providerUserId);
  if (!expectedProviderUserId) {
    const retainedTokens = await getWahooTokenCollection(userID).get();
    const retainedActiveToken = selectActiveWahooTokenSnapshot(retainedTokens.docs);
    expectedProviderUserId = retainedActiveToken
      ? normalizeWahooUserID(
        (retainedActiveToken.data() as Record<string, unknown> | undefined)?.wahooUserID,
      )
      : null;
  }
  if (expectedProviderUserId && expectedProviderUserId !== receivedProviderUserId) {
    throw new WahooOAuthAccountMismatchError(expectedProviderUserId, receivedProviderUserId);
  }
}

/** Resolves and pins exactly one active Wahoo account for every token consumer. */
export async function getActiveWahooTokenSnapshot(
  userID: string,
  expectedProviderUserId?: string,
): Promise<WahooTokenSnapshot> {
  const tokenCollection = getWahooTokenCollection(userID);
  const meta = await getServiceConnectionMeta(userID, ServiceNames.WahooAPI);
  if (isDisconnectPendingServiceConnection(meta)) {
    throw new ProviderPendingDisconnectError(userID, ServiceNames.WahooAPI, 'active_account_lookup');
  }
  if (isReconnectRequiredServiceConnection(meta)) {
    throw new WahooReconnectRequiredError();
  }

  const rawPinnedUserID = meta?.providerUserId;
  const pinnedUserID = normalizeWahooUserID(rawPinnedUserID);
  const expectedUserID = expectedProviderUserId === undefined
    ? null
    : normalizeWahooUserID(expectedProviderUserId);
  if ((rawPinnedUserID !== undefined && rawPinnedUserID !== null && rawPinnedUserID !== '' && !pinnedUserID)
    || (expectedProviderUserId !== undefined && !expectedUserID)) {
    throw new HttpsError('unauthenticated', 'Reconnect Wahoo before sending data.');
  }

  const assertExpectedAccount = (snapshot: WahooTokenSnapshot): WahooTokenSnapshot => {
    if (expectedUserID && snapshot.id !== expectedUserID) {
      throw new HttpsError('unauthenticated', 'The selected Wahoo account changed before data could be sent.');
    }
    return snapshot;
  };

  if (pinnedUserID) {
    const pinnedSnapshot = await tokenCollection.doc(pinnedUserID).get();
    if (!pinnedSnapshot.exists || !snapshotMatchesWahooUserID(pinnedSnapshot, pinnedUserID)) {
      throw new HttpsError('unauthenticated', 'Reconnect Wahoo before sending data.');
    }
    return assertExpectedAccount(pinnedSnapshot);
  }

  const tokenSnapshots = await tokenCollection.get();
  const selectedSnapshot = selectActiveWahooTokenSnapshot(tokenSnapshots.docs);
  if (!selectedSnapshot) {
    throw new HttpsError('unauthenticated', 'Connect Wahoo before sending data.');
  }
  const selectedUserID = normalizeWahooUserID(
    (selectedSnapshot.data() as Record<string, unknown> | undefined)?.wahooUserID,
  );
  if (!selectedUserID || !snapshotMatchesWahooUserID(selectedSnapshot, selectedUserID)) {
    throw new HttpsError('unauthenticated', 'Reconnect Wahoo before sending data.');
  }
  const expectedSnapshot = assertExpectedAccount(selectedSnapshot);
  const pinResult = await pinServiceConnectionProviderUserIdIfUnset(
    userID,
    ServiceNames.WahooAPI,
    selectedUserID,
    {
      expectedProviderToken: {
        documentRef: selectedSnapshot.ref,
        providerUserIdField: 'wahooUserID',
      },
    },
  );
  if (pinResult === 'conflict') {
    throw new HttpsError('unauthenticated', 'The selected Wahoo account changed before data could be sent.');
  }
  if (pinResult !== 'pinned' && pinResult !== 'already_pinned') {
    throw new HttpsError('failed-precondition', 'Account is being deleted or no longer exists.');
  }
  return expectedSnapshot;
}
