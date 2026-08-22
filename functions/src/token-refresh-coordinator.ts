import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import { getUserDeletionGuardStateInTransaction } from './shared/user-deletion-guard';
import { doesServiceDisconnectOperationPermitTokenUse } from './service-token-store';

/**
 * A provider refresh can take several seconds. Keep the ownership lease short
 * enough for crash recovery, while covering normal provider latency.
 */
export const TOKEN_REFRESH_LEASE_MS = 90_000;

/**
 * Keep the provider request materially shorter than the durable lease. This
 * leaves a recovery margin while ensuring one stalled HTTP request cannot
 * outlive its ownership and race a rotating refresh credential.
 */
export const TOKEN_REFRESH_REQUEST_TIMEOUT_MS = 60_000;

/** Root field that identifies the currently authorized OAuth credential. */
export const ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD = 'activeOAuthCredentialGeneration';

export interface TokenCredentialSnapshot {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  dateCreated: number;
  dateRefreshed: number;
  credentialGeneration: string | null;
}

export interface TokenCredentialGuard {
  tokenRef: admin.firestore.DocumentReference;
  credential: TokenCredentialSnapshot;
}

export interface DocumentGenerationGuard {
  documentRef: admin.firestore.DocumentReference;
  fieldName: string;
  expectedGeneration: string | null;
}

export interface TokenRefreshCompanionWrite {
  ref: admin.firestore.DocumentReference;
  data: Record<string, unknown>;
}

export interface PersistTokenRefreshOptions {
  /** Writes committed atomically only when this refresh still owns the credential. */
  companionWrites?: readonly TokenRefreshCompanionWrite[];
  /** Only explicit-disconnect cleanup may persist while its root fence is active. */
  expectedDisconnectOperationGeneration?: string;
}

/** Only explicit-disconnect cleanup may refresh while its root fence is active. */
export interface TokenRefreshClaimOptions {
  expectedDisconnectOperationGeneration?: string;
}

type TokenSnapshot = admin.firestore.DocumentSnapshot | admin.firestore.QueryDocumentSnapshot;
type TokenReference = admin.firestore.DocumentReference;

export type TokenRefreshClaimResult =
  | {
    kind: 'owner';
    leaseOwner: string;
    snapshot: TokenSnapshot;
    credential: TokenCredentialSnapshot;
  }
  | {
    kind: 'busy';
  }
  | {
    kind: 'superseded';
    snapshot: TokenSnapshot | null;
  }
  | {
    kind: 'skipped_user_deletion';
  }
  | {
    kind: 'skipped_service_disconnect';
  };

export type PersistTokenRefreshResult =
  | { kind: 'persisted' }
  | { kind: 'superseded'; snapshot: TokenSnapshot | null }
  | { kind: 'skipped_user_deletion' };

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizedNumber(value: unknown): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function doesDisconnectOperationGenerationPermitRefresh(
  rootData: Record<string, unknown> | undefined,
  expectedDisconnectOperationGeneration: string | undefined,
  nowMs: number,
): boolean {
  return doesServiceDisconnectOperationPermitTokenUse(
    rootData,
    expectedDisconnectOperationGeneration,
    nowMs,
  );
}

/**
 * This structure is intentionally never logged. It is used only inside
 * Firestore transactions to prove that a refresh still owns the credential it
 * started with.
 */
export function getTokenCredentialSnapshot(data: Record<string, unknown> | undefined): TokenCredentialSnapshot {
  return {
    accessToken: normalizedString(data?.accessToken),
    refreshToken: normalizedString(data?.refreshToken),
    expiresAt: normalizedNumber(data?.expiresAt),
    dateCreated: normalizedNumber(data?.dateCreated),
    dateRefreshed: normalizedNumber(data?.dateRefreshed),
    credentialGeneration: typeof data?.tokenCredentialGeneration === 'string'
      && data.tokenCredentialGeneration.trim().length > 0
      ? data.tokenCredentialGeneration
      : null,
  };
}

export function areTokenCredentialSnapshotsEqual(
  left: TokenCredentialSnapshot,
  right: TokenCredentialSnapshot,
): boolean {
  return left.accessToken === right.accessToken
    && left.refreshToken === right.refreshToken
    && left.expiresAt === right.expiresAt
    && left.dateCreated === right.dateCreated
    && left.dateRefreshed === right.dateRefreshed
    && left.credentialGeneration === right.credentialGeneration;
}

function isRefreshLeaseActive(data: Record<string, unknown> | undefined, nowMs: number): boolean {
  return typeof data?.tokenRefreshLeaseOwner === 'string'
    && data.tokenRefreshLeaseOwner.length > 0
    && normalizedNumber(data?.tokenRefreshLeaseExpiresAt) > nowMs;
}

function clearTokenRefreshLeaseUpdate(): Record<string, unknown> {
  return {
    tokenRefreshLeaseOwner: FieldValue.delete(),
    tokenRefreshLeaseExpiresAt: FieldValue.delete(),
    tokenRefreshLeaseCredentialGeneration: FieldValue.delete(),
  };
}

async function isTokenRefreshWriteAllowed(
  db: admin.firestore.Firestore,
  transaction: admin.firestore.Transaction,
  ref: TokenReference,
): Promise<boolean> {
  const userID = ref.parent?.parent?.id || null;
  if (!userID) {
    // Every supported provider token is nested below the Firebase UID. An
    // unscoped reference cannot prove that account deletion is inactive, so
    // fail closed instead of writing a credential we cannot clean up safely.
    return false;
  }
  const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
  return !deletionGuard.shouldSkip;
}

/**
 * Coordinates refreshes for one durable provider-token document. Credential
 * values stay in the token document and are never emitted in logs or errors.
 */
export function createTokenRefreshCoordinator(
  db: Pick<admin.firestore.Firestore, 'runTransaction' | 'collection'> = admin.firestore(),
) {
  async function claim(
    ref: TokenReference,
    expectedCredential: TokenCredentialSnapshot,
    nowMs = Date.now(),
    options: TokenRefreshClaimOptions = {},
  ): Promise<TokenRefreshClaimResult> {
    return db.runTransaction(async (transaction) => {
      if (!(await isTokenRefreshWriteAllowed(db as admin.firestore.Firestore, transaction, ref))) {
        return { kind: 'skipped_user_deletion' };
      }

      // A pre-refresh root read is not sufficient: an explicit disconnect can
      // commit its root fence between that read and this claim. Read the root
      // in the same transaction as the token lease so a non-owner can never
      // acquire a lease after disconnect has won.
      const tokenRootRef = ref.parent?.parent;
      if (!tokenRootRef) {
        return { kind: 'skipped_service_disconnect' };
      }
      const [snapshot, tokenRootSnapshot] = await Promise.all([
        transaction.get(ref) as Promise<TokenSnapshot>,
        transaction.get(tokenRootRef),
      ]);
      if (!doesDisconnectOperationGenerationPermitRefresh(
        tokenRootSnapshot.data() as Record<string, unknown> | undefined,
        options.expectedDisconnectOperationGeneration,
        nowMs,
      )) {
        return { kind: 'skipped_service_disconnect' };
      }
      if (!snapshot.exists) {
        return { kind: 'superseded', snapshot: null };
      }

      const data = snapshot.data() as Record<string, unknown> | undefined;
      const currentCredential = getTokenCredentialSnapshot(data);
      if (!areTokenCredentialSnapshotsEqual(currentCredential, expectedCredential)) {
        return { kind: 'superseded', snapshot };
      }

      if (isRefreshLeaseActive(data, nowMs)) {
        return { kind: 'busy' };
      }

      const leaseOwner = crypto.randomUUID();
      transaction.update(ref, {
        tokenRefreshLeaseOwner: leaseOwner,
        tokenRefreshLeaseExpiresAt: nowMs + TOKEN_REFRESH_LEASE_MS,
        tokenRefreshLeaseCredentialGeneration: expectedCredential.credentialGeneration,
      });
      return {
        kind: 'owner',
        leaseOwner,
        snapshot,
        credential: currentCredential,
      };
    });
  }

  async function persist(
    ref: TokenReference,
    leaseOwner: string,
    expectedCredential: TokenCredentialSnapshot,
    tokenData: Record<string, unknown>,
    options: PersistTokenRefreshOptions = {},
  ): Promise<PersistTokenRefreshResult> {
    return db.runTransaction(async (transaction) => {
      if (!(await isTokenRefreshWriteAllowed(db as admin.firestore.Firestore, transaction, ref))) {
        return { kind: 'skipped_user_deletion' };
      }

      const tokenRootRef = ref.parent?.parent;
      if (!tokenRootRef) {
        return { kind: 'superseded', snapshot: null };
      }
      const nowMs = Date.now();
      const [snapshot, tokenRootSnapshot] = await Promise.all([
        transaction.get(ref) as Promise<TokenSnapshot>,
        transaction.get(tokenRootRef),
      ]);
      if (!doesDisconnectOperationGenerationPermitRefresh(
        tokenRootSnapshot.data() as Record<string, unknown> | undefined,
        options.expectedDisconnectOperationGeneration,
        nowMs,
      )) {
        return { kind: 'superseded', snapshot: snapshot.exists ? snapshot : null };
      }
      if (!snapshot.exists) {
        return { kind: 'superseded', snapshot: null };
      }

      const data = snapshot.data() as Record<string, unknown> | undefined;
      if (
        data?.tokenRefreshLeaseOwner !== leaseOwner
        || !isRefreshLeaseActive(data, nowMs)
        || !areTokenCredentialSnapshotsEqual(
          getTokenCredentialSnapshot(data),
          expectedCredential,
        )
      ) {
        return { kind: 'superseded', snapshot };
      }

      transaction.update(ref, {
        ...tokenData,
        ...clearTokenRefreshLeaseUpdate(),
      });
      for (const companionWrite of options.companionWrites || []) {
        transaction.set(companionWrite.ref, companionWrite.data, { merge: true });
      }
      return { kind: 'persisted' };
    });
  }

  async function release(
    ref: TokenReference,
    leaseOwner: string,
    expectedCredential: TokenCredentialSnapshot,
  ): Promise<void> {
    await db.runTransaction(async (transaction) => {
      if (!(await isTokenRefreshWriteAllowed(db as admin.firestore.Firestore, transaction, ref))) {
        return;
      }

      const snapshot = await transaction.get(ref) as TokenSnapshot;
      if (!snapshot.exists) return;

      const data = snapshot.data() as Record<string, unknown> | undefined;
      if (
        data?.tokenRefreshLeaseOwner !== leaseOwner
        || !areTokenCredentialSnapshotsEqual(
          getTokenCredentialSnapshot(data),
          expectedCredential,
        )
      ) {
        return;
      }

      transaction.update(ref, clearTokenRefreshLeaseUpdate());
    });
  }

  return { claim, persist, release };
}

export async function claimTokenRefresh(
  ref: TokenReference,
  expectedCredential: TokenCredentialSnapshot,
  options: TokenRefreshClaimOptions = {},
): Promise<TokenRefreshClaimResult> {
  return createTokenRefreshCoordinator().claim(ref, expectedCredential, Date.now(), options);
}

export async function persistTokenRefresh(
  ref: TokenReference,
  leaseOwner: string,
  expectedCredential: TokenCredentialSnapshot,
  tokenData: Record<string, unknown>,
  options: PersistTokenRefreshOptions = {},
): Promise<PersistTokenRefreshResult> {
  return createTokenRefreshCoordinator().persist(ref, leaseOwner, expectedCredential, tokenData, options);
}

export async function releaseTokenRefreshClaim(
  ref: TokenReference,
  leaseOwner: string,
  expectedCredential: TokenCredentialSnapshot,
): Promise<void> {
  await createTokenRefreshCoordinator().release(ref, leaseOwner, expectedCredential);
}
