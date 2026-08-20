import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import { getUserDeletionGuardStateInTransaction } from './shared/user-deletion-guard';

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

export interface TokenCredentialSnapshot {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  dateCreated: number;
  dateRefreshed: number;
  credentialGeneration: string | null;
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
  ): Promise<TokenRefreshClaimResult> {
    return db.runTransaction(async (transaction) => {
      if (!(await isTokenRefreshWriteAllowed(db as admin.firestore.Firestore, transaction, ref))) {
        return { kind: 'skipped_user_deletion' };
      }

      const snapshot = await transaction.get(ref) as TokenSnapshot;
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
  ): Promise<PersistTokenRefreshResult> {
    return db.runTransaction(async (transaction) => {
      if (!(await isTokenRefreshWriteAllowed(db as admin.firestore.Firestore, transaction, ref))) {
        return { kind: 'skipped_user_deletion' };
      }

      const snapshot = await transaction.get(ref) as TokenSnapshot;
      if (!snapshot.exists) {
        return { kind: 'superseded', snapshot: null };
      }

      const data = snapshot.data() as Record<string, unknown> | undefined;
      if (
        data?.tokenRefreshLeaseOwner !== leaseOwner
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
): Promise<TokenRefreshClaimResult> {
  return createTokenRefreshCoordinator().claim(ref, expectedCredential);
}

export async function persistTokenRefresh(
  ref: TokenReference,
  leaseOwner: string,
  expectedCredential: TokenCredentialSnapshot,
  tokenData: Record<string, unknown>,
): Promise<PersistTokenRefreshResult> {
  return createTokenRefreshCoordinator().persist(ref, leaseOwner, expectedCredential, tokenData);
}

export async function releaseTokenRefreshClaim(
  ref: TokenReference,
  leaseOwner: string,
  expectedCredential: TokenCredentialSnapshot,
): Promise<void> {
  await createTokenRefreshCoordinator().release(ref, leaseOwner, expectedCredential);
}
