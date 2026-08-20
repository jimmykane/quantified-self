import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  isServiceUnavailableForSyncConnection,
  isReconnectRequiredServiceConnection,
  ServiceConnectionMetaFields,
  SERVICE_CONNECTION_STATES,
} from '../../shared/service-connection';
import {
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from './shared/user-deletion-guard';
import {
  disableActivitySyncRoutesForDisconnectedService,
  restoreActivitySyncRoutesForPendingDisconnectClear,
} from './activity-sync/route-cleanup';
import { releaseQueueItemsDeferredForReconnectRequired } from './queue/pending-disconnect-release';
import {
  areTokenCredentialSnapshotsEqual,
  getTokenCredentialSnapshot,
  type TokenCredentialSnapshot,
} from './token-refresh-coordinator';

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
}

function serviceMetaRef(
  db: admin.firestore.Firestore,
  userID: string,
  serviceName: ServiceNames,
): admin.firestore.DocumentReference {
  return db.collection('users').doc(userID).collection('meta').doc(serviceName);
}

async function setServiceMetaIfUserActive(
  userID: string,
  serviceName: ServiceNames,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const db = admin.firestore();
  const ref = serviceMetaRef(db, userID, serviceName);

  return db.runTransaction(async (transaction) => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, `service_connection_meta:${serviceName}`, error);
    }

    if (deletionGuard.shouldSkip) {
      logger.warn(
        `[ServiceConnectionMeta] Skipping ${serviceName} meta write for user ${userID} because the user is missing or deletion is in progress.`,
      );
      return false;
    }

    transaction.set(ref, payload, { merge: true });
    return true;
  });
}

export async function markServiceReconnectRequired(
  userID: string,
  serviceName: ServiceNames,
  failureCode: string | null | undefined,
  failureMessage: string | null | undefined,
  nowMs = Date.now(),
): Promise<void> {
  const didWrite = await setServiceMetaIfUserActive(userID, serviceName, {
    connectionState: SERVICE_CONNECTION_STATES.ReconnectRequired,
    lastAuthFailureCode: failureCode || null,
    lastAuthFailureMessage: failureMessage || null,
    lastDisconnectedAt: nowMs,
  });
  if (!didWrite) {
    return;
  }

  try {
    await disableActivitySyncRoutesForDisconnectedService(userID, serviceName);
  } catch (error) {
    logger.error(
      `[ServiceConnectionMeta] Failed to disable activity sync routes for reconnect-required ${serviceName} user ${userID}.`,
      error,
    );
  }
}

export interface ServiceDisconnectPendingMetaInput {
  reason: string;
  attemptCount: number;
  nextAttemptAt: unknown;
  lastAttemptAt?: unknown | null;
  retryExpiresAt: unknown;
  lastStatusCode?: number | null;
  lastErrorMessage?: string | null;
  manualReviewRequired?: boolean;
}

interface ClearServiceConnectionStateOptions {
  restorePendingDisconnectActivitySyncRoutes?: boolean;
}

export async function mirrorServiceDisconnectPendingToUserMeta(
  userID: string,
  serviceName: ServiceNames,
  input: ServiceDisconnectPendingMetaInput,
): Promise<boolean> {
  const didWrite = await setServiceMetaIfUserActive(userID, serviceName, {
    connectionState: SERVICE_CONNECTION_STATES.DisconnectPending,
    disconnectReason: input.reason,
    disconnectAttemptCount: input.attemptCount,
    disconnectNextAttemptAt: input.nextAttemptAt,
    disconnectLastAttemptAt: input.lastAttemptAt || null,
    disconnectRetryExpiresAt: input.retryExpiresAt,
    disconnectLastStatusCode: input.lastStatusCode ?? null,
    disconnectLastErrorMessage: input.lastErrorMessage || null,
    disconnectManualReviewRequired: input.manualReviewRequired === true,
    lastDisconnectedAt: Date.now(),
  });
  if (!didWrite) {
    return false;
  }

  try {
    await disableActivitySyncRoutesForDisconnectedService(userID, serviceName, {
      trackPendingDisconnectRestore: true,
    });
  } catch (error) {
    logger.error(
      `[ServiceConnectionMeta] Failed to disable activity sync routes for pending-disconnect ${serviceName} user ${userID}.`,
      error,
    );
  }
  return true;
}

export async function markServiceConnected(
  userID: string,
  serviceName: ServiceNames,
  providerUserId?: string | null,
): Promise<boolean> {
  const normalizedProviderUserId = `${providerUserId || ''}`.trim();
  const didWrite = await setServiceMetaIfUserActive(userID, serviceName, {
    connectionState: SERVICE_CONNECTION_STATES.Connected,
    ...(normalizedProviderUserId ? { providerUserId: normalizedProviderUserId } : {}),
    lastAuthFailureCode: FieldValue.delete(),
    lastAuthFailureMessage: FieldValue.delete(),
    lastDisconnectedAt: FieldValue.delete(),
    wahooRefreshFailureCount: FieldValue.delete(),
    wahooRefreshFailureLastAt: FieldValue.delete(),
    wahooRefreshRetryAt: FieldValue.delete(),
    disconnectReason: FieldValue.delete(),
    disconnectAttemptCount: FieldValue.delete(),
    disconnectNextAttemptAt: FieldValue.delete(),
    disconnectLastAttemptAt: FieldValue.delete(),
    disconnectRetryExpiresAt: FieldValue.delete(),
    disconnectLastStatusCode: FieldValue.delete(),
    disconnectLastErrorMessage: FieldValue.delete(),
    disconnectManualReviewRequired: FieldValue.delete(),
    providerBindingState: FieldValue.delete(),
    providerBindingCheckedAt: FieldValue.delete(),
    providerBindingCheckLeaseId: FieldValue.delete(),
    providerBindingCheckLeaseExpiresAt: FieldValue.delete(),
    providerBindingCheckNextRetryAt: FieldValue.delete(),
  });
  if (!didWrite || serviceName !== ServiceNames.WahooAPI) {
    return didWrite;
  }

  try {
    await releaseQueueItemsDeferredForReconnectRequired(userID, serviceName);
  } catch (error) {
    // The connection is usable after the OAuth callback even if a parked item
    // cannot be released immediately. Keep the reconnect successful and let a
    // later callback or operator retry the durable release.
    logger.error(
      `[ServiceConnectionMeta] Failed to release reconnect-required ${serviceName} queue items for user ${userID}.`,
      error,
    );
  }
  return true;
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

    const [tokenSnapshot, metaSnapshot] = await Promise.all([
      transaction.get(claim.tokenRef),
      transaction.get(ref),
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
        lastDisconnectedAt: nowMs,
      } : {}),
    }, { merge: true });

    return { failureCount, retryAt, reconnectRequired, stale: false };
  });
}

/**
 * Stores only the provider's stable display identifier in the browser-readable
 * service metadata. OAuth tokens remain in their server-only token collection.
 */
export async function setServiceConnectionProviderUserId(
  userID: string,
  serviceName: ServiceNames,
  providerUserId: string | null | undefined,
): Promise<boolean> {
  const normalizedProviderUserId = `${providerUserId || ''}`.trim();
  if (!normalizedProviderUserId) {
    return false;
  }
  return setServiceMetaIfUserActive(userID, serviceName, {
    providerUserId: normalizedProviderUserId,
  });
}

export type ServiceConnectionProviderUserIdPinResult =
  | 'pinned'
  | 'already_pinned'
  | 'conflict'
  | 'invalid'
  | 'user_inactive';

/**
 * Pins a legacy connection without replacing an account selected by a
 * concurrent OAuth callback. A non-empty existing identifier is immutable in
 * this migration path; reconnect owns account changes through markConnected.
 */
export async function pinServiceConnectionProviderUserIdIfUnset(
  userID: string,
  serviceName: ServiceNames,
  providerUserId: string | null | undefined,
): Promise<ServiceConnectionProviderUserIdPinResult> {
  const normalizedProviderUserId = `${providerUserId || ''}`.trim();
  if (!normalizedProviderUserId) {
    return 'invalid';
  }

  const db = admin.firestore();
  const ref = serviceMetaRef(db, userID, serviceName);
  return db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, `service_connection_provider_pin:${serviceName}`, error);
    }
    if (deletionGuard.shouldSkip) {
      return 'user_inactive';
    }

    const snapshot = await transaction.get(ref);
    const existingProviderUserId = `${snapshot.data()?.providerUserId || ''}`.trim();
    if (existingProviderUserId) {
      return existingProviderUserId === normalizedProviderUserId ? 'already_pinned' : 'conflict';
    }

    transaction.set(ref, { providerUserId: normalizedProviderUserId }, { merge: true });
    return 'pinned';
  });
}

export async function clearServiceConnectionState(
  userID: string,
  serviceName: ServiceNames,
  options: ClearServiceConnectionStateOptions = {},
): Promise<void> {
  const didWrite = await setServiceMetaIfUserActive(userID, serviceName, {
    connectionState: FieldValue.delete(),
    providerUserId: FieldValue.delete(),
    lastAuthFailureCode: FieldValue.delete(),
    lastAuthFailureMessage: FieldValue.delete(),
    lastDisconnectedAt: FieldValue.delete(),
    wahooRefreshFailureCount: FieldValue.delete(),
    wahooRefreshFailureLastAt: FieldValue.delete(),
    wahooRefreshRetryAt: FieldValue.delete(),
    disconnectReason: FieldValue.delete(),
    disconnectAttemptCount: FieldValue.delete(),
    disconnectNextAttemptAt: FieldValue.delete(),
    disconnectRetryExpiresAt: FieldValue.delete(),
    disconnectLastStatusCode: FieldValue.delete(),
    disconnectLastErrorMessage: FieldValue.delete(),
    disconnectManualReviewRequired: FieldValue.delete(),
    providerBindingState: FieldValue.delete(),
    providerBindingCheckedAt: FieldValue.delete(),
    providerBindingCheckLeaseId: FieldValue.delete(),
    providerBindingCheckLeaseExpiresAt: FieldValue.delete(),
    providerBindingCheckNextRetryAt: FieldValue.delete(),
  });
  if (!didWrite || !options.restorePendingDisconnectActivitySyncRoutes) {
    return;
  }

  try {
    await restoreActivitySyncRoutesForPendingDisconnectClear(userID, serviceName);
  } catch (error) {
    logger.error(
      `[ServiceConnectionMeta] Failed to restore activity sync routes for recovered pending-disconnect ${serviceName} user ${userID}.`,
      error,
    );
  }
}

export async function getServiceConnectionMeta(
  userID: string,
  serviceName: ServiceNames,
): Promise<ServiceConnectionMetaFields | null> {
  const snapshot = await serviceMetaRef(admin.firestore(), userID, serviceName).get();
  return snapshot.exists ? snapshot.data() as ServiceConnectionMetaFields : null;
}

export async function isServiceReconnectRequiredForUser(
  userID: string,
  serviceName: ServiceNames,
): Promise<boolean> {
  return isReconnectRequiredServiceConnection(await getServiceConnectionMeta(userID, serviceName));
}

export async function isServiceUnavailableForSyncForUser(
  userID: string,
  serviceName: ServiceNames,
): Promise<boolean> {
  return isServiceUnavailableForSyncConnection(await getServiceConnectionMeta(userID, serviceName));
}
