import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
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
  type TokenCredentialGuard,
  type DocumentGenerationGuard,
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
  expectedTokenCredentialGeneration?: DocumentGenerationGuard,
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

    if (expectedTokenCredentialGeneration) {
      const generationSnapshot = await transaction.get(expectedTokenCredentialGeneration.documentRef);
      if (
        !generationSnapshot.exists
        || generationSnapshot.data()?.[expectedTokenCredentialGeneration.fieldName]
          !== expectedTokenCredentialGeneration.expectedGeneration
      ) {
        return false;
      }
    }

    transaction.set(ref, payload, { merge: true });
    return true;
  });
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
async function releaseWahooReconnectQueueItemsWithRepair(
  userID: string,
  connectionStateGeneration: string,
): Promise<boolean> {
  try {
    await restoreActivitySyncRoutesForPendingDisconnectClear(userID, ServiceNames.WahooAPI, {
      requireServiceConnected: true,
      expectedConnectionStateGeneration: connectionStateGeneration,
      clearRouteRestoreMarker: true,
    });
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

export interface MarkServiceReconnectRequiredOptions {
  /** Abort when OAuth or another lifecycle transition already won. */
  expectedConnectionStateGeneration?: string | null;
  /** Terminal cleanup can prove no replacement credential exists. */
  requireEmptyTokenCollection?: admin.firestore.CollectionReference;
  /** A failed deletion may only mark the still-current credential generation. */
  expectedTokenCredential?: TokenCredentialGuard;
}

export async function markServiceReconnectRequired(
  userID: string,
  serviceName: ServiceNames,
  failureCode: string | null | undefined,
  failureMessage: string | null | undefined,
  nowMs = Date.now(),
  options: MarkServiceReconnectRequiredOptions = {},
): Promise<boolean> {
  const db = admin.firestore();
  const ref = serviceMetaRef(db, userID, serviceName);
  const connectionStateGeneration = crypto.randomUUID();
  const guardsConnectionGeneration = Object.prototype.hasOwnProperty.call(
    options,
    'expectedConnectionStateGeneration',
  );
  const expectedTokenCredential = options.expectedTokenCredential;
  const didWrite = await db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, `service_reconnect_required:${serviceName}`, error);
    }
    if (deletionGuard.shouldSkip) {
      logger.warn(
        `[ServiceConnectionMeta] Skipping ${serviceName} reconnect-required transition for user ${userID} because the user is missing or deletion is in progress.`,
      );
      return false;
    }

    const [metaSnapshot, tokenSnapshot, expectedTokenSnapshot] = await Promise.all([
      transaction.get(ref),
      options.requireEmptyTokenCollection
        ? transaction.get(options.requireEmptyTokenCollection)
        : Promise.resolve(null),
      expectedTokenCredential
        ? transaction.get(expectedTokenCredential.tokenRef)
        : Promise.resolve(null),
    ]);
    const currentGeneration = typeof metaSnapshot.data()?.connectionStateGeneration === 'string'
      ? `${metaSnapshot.data()?.connectionStateGeneration}`
      : null;
    if (
      (guardsConnectionGeneration
        && currentGeneration !== (options.expectedConnectionStateGeneration || null))
      || (tokenSnapshot && !tokenSnapshot.empty)
      || (expectedTokenCredential && expectedTokenSnapshot && (
        !expectedTokenSnapshot.exists
        || !areTokenCredentialSnapshotsEqual(
          getTokenCredentialSnapshot(expectedTokenSnapshot.data() as Record<string, unknown> | undefined),
          expectedTokenCredential.credential,
        )
      ))
    ) {
      return false;
    }

    transaction.set(ref, {
      connectionState: SERVICE_CONNECTION_STATES.ReconnectRequired,
      connectionStateGeneration,
      routeRestorePending: FieldValue.delete(),
      routeRestoreConnectionGeneration: FieldValue.delete(),
      routeRestoreLastAttemptAt: FieldValue.delete(),
      routeRestoreAttemptCount: FieldValue.delete(),
      lastAuthFailureCode: failureCode || null,
      lastAuthFailureMessage: failureMessage || null,
      lastDisconnectedAt: nowMs,
    }, { merge: true });
    return true;
  });
  if (!didWrite) {
    return false;
  }

  try {
    await disableActivitySyncRoutesForDisconnectedService(userID, serviceName, {
      trackPendingDisconnectRestore: true,
      expectedConnectionStateGeneration: connectionStateGeneration,
      requiredConnectionState: SERVICE_CONNECTION_STATES.ReconnectRequired,
    });
  } catch (error) {
    logger.error(
      `[ServiceConnectionMeta] Failed to disable activity sync routes for reconnect-required ${serviceName} user ${userID}.`,
      error,
    );
  }
  return true;
}

export interface ServiceDisconnectPendingMetaInput {
  generation: string;
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
  expectedPendingDisconnectGeneration?: string;
  expectedTokenCredentialGeneration?: DocumentGenerationGuard;
}

export async function mirrorServiceDisconnectPendingToUserMeta(
  userID: string,
  serviceName: ServiceNames,
  input: ServiceDisconnectPendingMetaInput,
): Promise<boolean> {
  const didWrite = await setServiceMetaIfUserActive(userID, serviceName, {
    connectionState: SERVICE_CONNECTION_STATES.DisconnectPending,
    connectionStateGeneration: input.generation,
    disconnectGeneration: input.generation,
    routeRestorePending: FieldValue.delete(),
    routeRestoreConnectionGeneration: FieldValue.delete(),
    routeRestoreLastAttemptAt: FieldValue.delete(),
    routeRestoreAttemptCount: FieldValue.delete(),
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
      expectedConnectionStateGeneration: input.generation,
      requiredConnectionState: SERVICE_CONNECTION_STATES.DisconnectPending,
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
  expectedTokenCredentialGeneration?: DocumentGenerationGuard,
): Promise<boolean> {
  const normalizedProviderUserId = `${providerUserId || ''}`.trim();
  const connectionStateGeneration = crypto.randomUUID();
  const nowMs = Date.now();
  const didWrite = await setServiceMetaIfUserActive(userID, serviceName, {
    connectionState: SERVICE_CONNECTION_STATES.Connected,
    connectionStateGeneration,
    disconnectGeneration: FieldValue.delete(),
    routeRestorePending: true,
    routeRestoreConnectionGeneration: connectionStateGeneration,
    routeRestoreLastAttemptAt: nowMs,
    routeRestoreAttemptCount: 0,
    ...(normalizedProviderUserId ? { providerUserId: normalizedProviderUserId } : {}),
    lastAuthFailureCode: FieldValue.delete(),
    lastAuthFailureMessage: FieldValue.delete(),
    lastDisconnectedAt: FieldValue.delete(),
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
  }, expectedTokenCredentialGeneration);
  if (!didWrite) {
    return didWrite;
  }

  if (serviceName === ServiceNames.WahooAPI) {
    await releaseWahooReconnectQueueItemsWithRepair(userID, connectionStateGeneration);
    return true;
  }

  try {
    await restoreActivitySyncRoutesForPendingDisconnectClear(userID, serviceName, {
      expectedConnectionStateGeneration: connectionStateGeneration,
      clearRouteRestoreMarker: true,
    });
  } catch (error) {
    // OAuth has still succeeded; route restoration is independently guarded
    // and the durable marker lets the lifecycle scheduler retry it.
    logger.error(
      `[ServiceConnectionMeta] Failed to restore activity sync routes for reconnected ${serviceName} user ${userID}.`,
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
        connectionStateGeneration: crypto.randomUUID(),
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
): Promise<boolean> {
  const db = admin.firestore();
  const ref = serviceMetaRef(db, userID, serviceName);
  const connectionStateGeneration = crypto.randomUUID();
  const nowMs = Date.now();
  const didWrite = await db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, `service_connection_clear:${serviceName}`, error);
    }
    if (deletionGuard.shouldSkip) return false;

    if (options.expectedPendingDisconnectGeneration || options.expectedTokenCredentialGeneration) {
      const [metaSnapshot, tokenSnapshot] = await Promise.all([
        transaction.get(ref),
        options.expectedTokenCredentialGeneration
          ? transaction.get(options.expectedTokenCredentialGeneration.documentRef)
          : Promise.resolve(null),
      ]);
      const meta = metaSnapshot.data() as ServiceConnectionMetaFields | undefined;
      if (
        (options.expectedPendingDisconnectGeneration && (
          meta?.connectionState !== SERVICE_CONNECTION_STATES.DisconnectPending
          || meta.disconnectGeneration !== options.expectedPendingDisconnectGeneration
        ))
        || (options.expectedTokenCredentialGeneration && tokenSnapshot && (
          !tokenSnapshot.exists
          || tokenSnapshot.data()?.[options.expectedTokenCredentialGeneration.fieldName]
            !== options.expectedTokenCredentialGeneration.expectedGeneration
        ))
      ) {
        return false;
      }
    }

    transaction.set(ref, {
      connectionState: FieldValue.delete(),
      connectionStateGeneration,
      disconnectGeneration: FieldValue.delete(),
      ...(options.restorePendingDisconnectActivitySyncRoutes ? {
        routeRestorePending: true,
        routeRestoreConnectionGeneration: connectionStateGeneration,
        routeRestoreLastAttemptAt: nowMs,
        routeRestoreAttemptCount: 0,
      } : {
        routeRestorePending: FieldValue.delete(),
        routeRestoreConnectionGeneration: FieldValue.delete(),
        routeRestoreLastAttemptAt: FieldValue.delete(),
        routeRestoreAttemptCount: FieldValue.delete(),
      }),
      providerUserId: FieldValue.delete(),
      lastAuthFailureCode: FieldValue.delete(),
      lastAuthFailureMessage: FieldValue.delete(),
      lastDisconnectedAt: FieldValue.delete(),
      wahooRefreshFailureCount: FieldValue.delete(),
      wahooRefreshFailureLastAt: FieldValue.delete(),
      wahooRefreshRetryAt: FieldValue.delete(),
      wahooReconnectReleasePending: FieldValue.delete(),
      wahooReconnectReleaseLastAttemptAt: FieldValue.delete(),
      wahooReconnectReleaseAttemptCount: FieldValue.delete(),
      wahooReconnectReleaseConnectionGeneration: FieldValue.delete(),
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
    }, { merge: true });
    return true;
  });
  if (!didWrite || !options.restorePendingDisconnectActivitySyncRoutes) {
    return didWrite;
  }

  try {
    await restoreActivitySyncRoutesForPendingDisconnectClear(userID, serviceName, {
      expectedConnectionStateGeneration: connectionStateGeneration,
      clearRouteRestoreMarker: true,
    });
  } catch (error) {
    logger.error(
      `[ServiceConnectionMeta] Failed to restore activity sync routes for recovered pending-disconnect ${serviceName} user ${userID}.`,
      error,
    );
  }
  return true;
}

/** Retries a provider-neutral route restoration marker after a partial transition. */
export async function retryPendingServiceRouteRestore(
  userID: string,
  serviceName: ServiceNames,
): Promise<boolean> {
  const meta = await getServiceConnectionMeta(userID, serviceName);
  const generation = `${meta?.routeRestoreConnectionGeneration || ''}`.trim();
  if (meta?.routeRestorePending !== true || !generation) return false;
  if (isServiceUnavailableForSyncConnection(meta)) return false;

  await restoreActivitySyncRoutesForPendingDisconnectClear(userID, serviceName, {
    requireServiceConnected: meta.connectionState === SERVICE_CONNECTION_STATES.Connected,
    expectedConnectionStateGeneration: generation,
    clearRouteRestoreMarker: true,
  });
  return true;
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
