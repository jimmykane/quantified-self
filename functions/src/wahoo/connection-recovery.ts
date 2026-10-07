import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  SERVICE_CONNECTION_STATES,
  type ServiceConnectionMetaFields,
} from '../../../shared/service-connection';
import {
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import { releaseQueueItemsDeferredForReconnectRequired } from '../queue/pending-disconnect-release';
import {
  areTokenCredentialSnapshotsEqual,
  getTokenCredentialSnapshot,
  type TokenCredentialSnapshot,
} from '../token-refresh-coordinator';
import {
  getServiceTokenRootDocumentRef,
  getServiceDisconnectOperationGeneration,
} from '../service-token-store';
import { isServiceDisconnectPendingData } from '../service-disconnect-pending-state';
import {
  getServiceConnectionMeta,
  normalizedGeneration,
  restoreRoutesAndReleaseDeferredWork,
  serviceMetaRef,
} from '../service-connection-lifecycle';

export const WAHOO_OPAQUE_REFRESH_FAILURE_THRESHOLD = 3;
const WAHOO_OPAQUE_REFRESH_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
const WAHOO_OPAQUE_REFRESH_BACKOFF_MS = [
  5 * 60 * 1000,
  15 * 60 * 1000,
] as const;

export interface WahooOpaqueRefreshFailureOutcome {
  failureCount: number;
  retryAt: number | null;
  reconnectRequired: boolean;
  stale: boolean;
}

/** The current refresh owner proves an opaque response still applies to this account. */
export interface WahooOpaqueRefreshFailureClaim {
  tokenRef: admin.firestore.DocumentReference;
  leaseOwner: string;
  credential: TokenCredentialSnapshot;
  connectionStateGeneration: string | null;
}

/** These fields must join the connected-state transaction before release starts. */
export function getWahooConnectedRecoveryFields(
  serviceName: ServiceNames,
  connectionStateGeneration: string,
  nowMs: number,
): Record<string, unknown> {
  return {
    wahooRefreshFailureCount: FieldValue.delete(),
    wahooRefreshFailureLastAt: FieldValue.delete(),
    wahooRefreshRetryAt: FieldValue.delete(),
    ...(serviceName === ServiceNames.WahooAPI ? {
      // Persist before the multi-collection release begins. If this callback
      // stops at any later point, the scheduled repair path owns the retry.
      wahooReconnectReleasePending: true,
      wahooReconnectReleaseLastAttemptAt: nowMs,
      wahooReconnectReleaseAttemptCount: 0,
      wahooReconnectReleaseConnectionGeneration: connectionStateGeneration,
    } : {
      wahooReconnectReleasePending: FieldValue.delete(),
      wahooReconnectReleaseLastAttemptAt: FieldValue.delete(),
      wahooReconnectReleaseAttemptCount: FieldValue.delete(),
      wahooReconnectReleaseConnectionGeneration: FieldValue.delete(),
    }),
  };
}

/** Preserve cleanup of legacy Wahoo recovery fields on every service's metadata. */
export function getWahooRecoveryFieldDeletes(): Record<string, FieldValue> {
  return {
    wahooRefreshFailureCount: FieldValue.delete(),
    wahooRefreshFailureLastAt: FieldValue.delete(),
    wahooRefreshRetryAt: FieldValue.delete(),
    wahooReconnectReleasePending: FieldValue.delete(),
    wahooReconnectReleaseLastAttemptAt: FieldValue.delete(),
    wahooReconnectReleaseAttemptCount: FieldValue.delete(),
    wahooReconnectReleaseConnectionGeneration: FieldValue.delete(),
  };
}

async function setWahooReconnectReleasePendingIfConnected(
  userID: string,
  connectionStateGeneration: string,
  nowMs = Date.now(),
): Promise<boolean> {
  const db = admin.firestore();
  const ref = serviceMetaRef(db, userID, ServiceNames.WahooAPI);
  return db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, 'wahoo_reconnect_queue_release_retry', error);
    }
    if (deletionGuard.shouldSkip) return false;

    const snapshot = await transaction.get(ref);
    const data = snapshot.data() as ServiceConnectionMetaFields | undefined;
    if (
      data?.connectionState !== SERVICE_CONNECTION_STATES.Connected
      || data.connectionStateGeneration !== connectionStateGeneration
    ) return false;

    const attemptCount = Math.max(0, Number(data?.wahooReconnectReleaseAttemptCount) || 0) + 1;
    transaction.set(ref, {
      wahooReconnectReleasePending: true,
      wahooReconnectReleaseLastAttemptAt: nowMs,
      wahooReconnectReleaseAttemptCount: attemptCount,
      wahooReconnectReleaseConnectionGeneration: connectionStateGeneration,
    }, { merge: true });
    return true;
  });
}

async function clearWahooReconnectReleasePendingIfConnected(
  userID: string,
  connectionStateGeneration: string,
): Promise<boolean> {
  const db = admin.firestore();
  const ref = serviceMetaRef(db, userID, ServiceNames.WahooAPI);
  return db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, 'wahoo_reconnect_queue_release_complete', error);
    }
    if (deletionGuard.shouldSkip) return false;

    const snapshot = await transaction.get(ref);
    const data = snapshot.data() as ServiceConnectionMetaFields | undefined;
    if (
      data?.connectionState !== SERVICE_CONNECTION_STATES.Connected
      || data.connectionStateGeneration !== connectionStateGeneration
      || data.wahooReconnectReleaseConnectionGeneration !== connectionStateGeneration
    ) return false;

    transaction.set(ref, {
      wahooReconnectReleasePending: FieldValue.delete(),
      wahooReconnectReleaseLastAttemptAt: FieldValue.delete(),
      wahooReconnectReleaseAttemptCount: FieldValue.delete(),
      wahooReconnectReleaseConnectionGeneration: FieldValue.delete(),
    }, { merge: true });
    return true;
  });
}

/**
 * Restores only routes that were enabled before Wahoo was parked, then opens
 * reconnect-required queue rows. A failed partial release is marked durably
 * so the scheduled repair path retries it after the OAuth callback returns.
 */
export async function releaseWahooReconnectQueueItemsWithRepair(
  userID: string,
  connectionStateGeneration: string,
): Promise<boolean> {
  try {
    await restoreRoutesAndReleaseDeferredWork(
      userID,
      ServiceNames.WahooAPI,
      connectionStateGeneration,
      true,
    );
    await releaseQueueItemsDeferredForReconnectRequired(
      userID,
      ServiceNames.WahooAPI,
      connectionStateGeneration,
    );
  } catch (error) {
    let retryRecorded = false;
    try {
      retryRecorded = await setWahooReconnectReleasePendingIfConnected(
        userID,
        connectionStateGeneration,
      );
    } catch (retryError) {
      logger.error(
        `[ServiceConnectionMeta] Failed to persist reconnect-release repair for Wahoo user ${userID}.`,
        retryError,
      );
    }
    logger.error(
      `[ServiceConnectionMeta] Failed to release reconnect-required Wahoo queue items for user ${userID}.${retryRecorded ? ' A durable retry was scheduled.' : ''}`,
      error,
    );
    return false;
  }

  try {
    await clearWahooReconnectReleasePendingIfConnected(userID, connectionStateGeneration);
  } catch (error) {
    // The release is already complete; retaining the marker only causes an
    // idempotent repair pass, so do not make a successful OAuth callback fail.
    logger.error(
      `[ServiceConnectionMeta] Failed to clear reconnect-release repair marker for Wahoo user ${userID}.`,
      error,
    );
  }
  return true;
}

/** Retries a durable Wahoo reconnect-release repair marker. */
export async function retryWahooReconnectQueueRelease(userID: string): Promise<boolean> {
  const meta = await getServiceConnectionMeta(userID, ServiceNames.WahooAPI);
  if (
    meta?.connectionState !== SERVICE_CONNECTION_STATES.Connected
    || meta.wahooReconnectReleasePending !== true
    || !meta.wahooReconnectReleaseConnectionGeneration
    || meta.wahooReconnectReleaseConnectionGeneration !== meta.connectionStateGeneration
  ) {
    return false;
  }
  return releaseWahooReconnectQueueItemsWithRepair(
    userID,
    meta.wahooReconnectReleaseConnectionGeneration,
  );
}

/**
 * Tracks an opaque Wahoo refresh rejection without storing provider bodies or
 * credential values. A single 400 remains retryable; repeated failures become
 * an explicit reconnect requirement before sync queues can exhaust retries.
 */
export async function recordWahooOpaqueRefreshFailure(
  userID: string,
  claim: WahooOpaqueRefreshFailureClaim,
  nowMs = Date.now(),
): Promise<WahooOpaqueRefreshFailureOutcome> {
  const db = admin.firestore();
  const ref = serviceMetaRef(db, userID, ServiceNames.WahooAPI);
  return db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, 'wahoo_opaque_refresh_failure', error);
    }
    if (deletionGuard.shouldSkip) {
      return { failureCount: 0, retryAt: null, reconnectRequired: false, stale: true };
    }

    const [tokenSnapshot, metaSnapshot, tokenRootSnapshot] = await Promise.all([
      transaction.get(claim.tokenRef),
      transaction.get(ref),
      transaction.get(getServiceTokenRootDocumentRef(userID, ServiceNames.WahooAPI)),
    ]);
    const tokenData = tokenSnapshot.data() as Record<string, unknown> | undefined;
    if (
      !tokenSnapshot.exists
      || tokenData?.tokenRefreshLeaseOwner !== claim.leaseOwner
      || !areTokenCredentialSnapshotsEqual(
        getTokenCredentialSnapshot(tokenData),
        claim.credential,
      )
    ) {
      return { failureCount: 0, retryAt: null, reconnectRequired: false, stale: true };
    }

    const data = metaSnapshot.data() as ServiceConnectionMetaFields | undefined;
    const tokenRootData = tokenRootSnapshot.data() as Record<string, unknown> | undefined;
    if (
      normalizedGeneration(data?.connectionStateGeneration) !== claim.connectionStateGeneration
      || data?.connectionState === SERVICE_CONNECTION_STATES.DisconnectPending
      || data?.connectionState === SERVICE_CONNECTION_STATES.ReconnectRequired
      || isServiceDisconnectPendingData(tokenRootData)
      || getServiceDisconnectOperationGeneration(tokenRootData) !== null
    ) {
      return { failureCount: 0, retryAt: null, reconnectRequired: false, stale: true };
    }
    const previousFailureAt = Number(data?.wahooRefreshFailureLastAt || 0);
    const previousFailureCount = Number(data?.wahooRefreshFailureCount || 0);
    const withinWindow = Number.isFinite(previousFailureAt)
      && previousFailureAt > nowMs - WAHOO_OPAQUE_REFRESH_FAILURE_WINDOW_MS;
    const failureCount = Math.min(
      WAHOO_OPAQUE_REFRESH_FAILURE_THRESHOLD,
      (withinWindow && Number.isFinite(previousFailureCount) ? Math.max(0, previousFailureCount) : 0) + 1,
    );
    const reconnectRequired = failureCount >= WAHOO_OPAQUE_REFRESH_FAILURE_THRESHOLD;
    const retryAt = reconnectRequired
      ? null
      : nowMs + WAHOO_OPAQUE_REFRESH_BACKOFF_MS[Math.min(failureCount - 1, WAHOO_OPAQUE_REFRESH_BACKOFF_MS.length - 1)];

    transaction.set(ref, {
      wahooRefreshFailureCount: failureCount,
      wahooRefreshFailureLastAt: nowMs,
      wahooRefreshRetryAt: retryAt,
      lastAuthFailureCode: 'wahoo_opaque_refresh_400',
      lastAuthFailureMessage: reconnectRequired
        ? 'Reconnect Wahoo to resume sync.'
        : 'Wahoo could not refresh this connection. Retrying later.',
      ...(reconnectRequired ? {
        connectionState: SERVICE_CONNECTION_STATES.ReconnectRequired,
        connectionStateGeneration: crypto.randomUUID(),
        lastDisconnectedAt: nowMs,
      } : {}),
    }, { merge: true });

    return { failureCount, retryAt, reconnectRequired, stale: false };
  });
}
