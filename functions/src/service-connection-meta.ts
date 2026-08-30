import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  HEALTH_PROVIDERS,
  HEALTH_SYNC_STATUSES,
  HealthProvider,
  HealthSyncStatus,
} from '../../shared/health';
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
import {
  releaseQueueItemsDeferredForPendingDisconnect,
  releaseQueueItemsDeferredForReconnectRequired,
} from './queue/pending-disconnect-release';
import { releaseQueueItemsDeferredForRouteRestore } from './queue/sync-route-eligibility';
import {
  areTokenCredentialSnapshotsEqual,
  getTokenCredentialSnapshot,
  type TokenCredentialGuard,
  type DocumentGenerationGuard,
  type TokenCredentialSnapshot,
} from './token-refresh-coordinator';
import {
  getServiceTokenRootDocumentRef,
  getServiceDisconnectOperationGeneration,
} from './service-token-store';
import {
  doesRootMatchServiceDisconnectLifecycleGuard,
  getServiceDisconnectLifecycleGuardFromRootData,
  isServiceDisconnectPendingData,
  type ServiceDisconnectLifecycleGuard,
} from './service-disconnect-pending-state';
import { updateHealthSyncState } from './health/writer';

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

interface HealthLifecycleProjectionClaim {
  connectionStateGeneration: string | null;
  transitionAtMs: number | null;
}

function healthLifecycleProjectionMarker(
  connectionStateGeneration: string,
  transitionAtMs: number,
): Pick<
  ServiceConnectionMetaFields,
  | 'healthLifecycleProjectionPending'
  | 'healthLifecycleProjectionConnectionGeneration'
  | 'healthLifecycleProjectionTransitionAtMs'
> {
  return {
    healthLifecycleProjectionPending: true,
    healthLifecycleProjectionConnectionGeneration: connectionStateGeneration,
    healthLifecycleProjectionTransitionAtMs: transitionAtMs,
  };
}

function healthLifecycleProjectionDeletes(): Record<string, FieldValue> {
  return {
    healthLifecycleProjectionPending: FieldValue.delete(),
    healthLifecycleProjectionConnectionGeneration: FieldValue.delete(),
    healthLifecycleProjectionTransitionAtMs: FieldValue.delete(),
  };
}

function getHealthLifecycleProjectionClaim(
  meta: ServiceConnectionMetaFields | null | undefined,
): HealthLifecycleProjectionClaim {
  const generation = typeof meta?.healthLifecycleProjectionConnectionGeneration === 'string'
    ? meta.healthLifecycleProjectionConnectionGeneration.trim()
    : '';
  const transitionAtMs = meta?.healthLifecycleProjectionTransitionAtMs;
  return {
    connectionStateGeneration: generation || null,
    transitionAtMs: typeof transitionAtMs === 'number'
      && Number.isSafeInteger(transitionAtMs)
      && transitionAtMs >= 0
      ? transitionAtMs
      : null,
  };
}

function healthProviderForService(serviceName: ServiceNames): HealthProvider | null {
  if (serviceName === ServiceNames.COROSAPI) return HEALTH_PROVIDERS.COROSAPI;
  if (serviceName === ServiceNames.GarminAPI) return HEALTH_PROVIDERS.GarminAPI;
  if (serviceName === ServiceNames.SuuntoApp) {
    return HEALTH_PROVIDERS.SuuntoApp;
  }
  return null;
}

function supportsHealthLifecycleProjection(serviceName: ServiceNames): boolean {
  return serviceName === ServiceNames.COROSAPI
    || serviceName === ServiceNames.GarminAPI
    || serviceName === ServiceNames.SuuntoApp;
}

async function clearHealthLifecycleProjectionMarker(
  userID: string,
  serviceName: ServiceNames,
  claim: HealthLifecycleProjectionClaim,
  expectedLifecycle?: {
    connectionState: ServiceConnectionMetaFields['connectionState'];
    connectionStateGeneration: string;
  },
): Promise<boolean> {
  const db = admin.firestore();
  const ref = serviceMetaRef(db, userID, serviceName);
  return db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(
        userID,
        'health_lifecycle_projection_clear',
        error,
      );
    }
    if (deletionGuard.shouldSkip) return false;

    const snapshot = await transaction.get(ref);
    const meta = snapshot.exists
      ? snapshot.data() as ServiceConnectionMetaFields | undefined
      : undefined;
    const currentClaim = getHealthLifecycleProjectionClaim(meta);
    if (
      !meta
      || meta.healthLifecycleProjectionPending !== true
      || currentClaim.connectionStateGeneration !== claim.connectionStateGeneration
      || currentClaim.transitionAtMs !== claim.transitionAtMs
      || (expectedLifecycle && (
        meta.connectionState !== expectedLifecycle.connectionState
        || meta.connectionStateGeneration !== expectedLifecycle.connectionStateGeneration
      ))
    ) {
      return false;
    }

    transaction.set(ref, healthLifecycleProjectionDeletes(), { merge: true });
    return true;
  });
}

/**
 * Supersedes any pending provider Health lifecycle projection after token-root
 * deletion. Reading the missing root and clearing the marker in one
 * transaction prevents a delayed connected projection from restoring Ready;
 * a concurrent reconnect conflicts on either the root or metadata read.
 */
export async function supersedePendingHealthLifecycleProjectionForTokenRootDelete(
  userID: string,
  serviceName: ServiceNames,
): Promise<boolean> {
  if (!supportsHealthLifecycleProjection(serviceName)) return false;
  const db = admin.firestore();
  const metaRef = serviceMetaRef(db, userID, serviceName);
  const tokenRootRef = getServiceTokenRootDocumentRef(userID, serviceName);
  return db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(
        userID,
        'health_lifecycle_projection_token_root_delete',
        error,
      );
    }
    if (deletionGuard.shouldSkip) return false;

    const [metaSnapshot, tokenRootSnapshot] = await Promise.all([
      transaction.get(metaRef),
      transaction.get(tokenRootRef),
    ]);
    if (tokenRootSnapshot.exists) return false;

    const meta = metaSnapshot.exists
      ? metaSnapshot.data() as ServiceConnectionMetaFields | undefined
      : undefined;
    if (meta && (
      meta.healthLifecycleProjectionPending !== undefined
      || meta.healthLifecycleProjectionConnectionGeneration !== undefined
      || meta.healthLifecycleProjectionTransitionAtMs !== undefined
    )) {
      transaction.set(metaRef, healthLifecycleProjectionDeletes(), { merge: true });
    }
    return true;
  });
}

export function supersedePendingCOROSHealthLifecycleProjectionForTokenRootDelete(
  userID: string,
): Promise<boolean> {
  return supersedePendingHealthLifecycleProjectionForTokenRootDelete(userID, ServiceNames.COROSAPI);
}

async function updateHealthLifecycleState(
  userID: string,
  serviceName: ServiceNames,
  healthProvider: HealthProvider,
  status: HealthSyncStatus,
  lastErrorCode: string | null,
  transitionAtMs: number,
  connectionState: ServiceConnectionMetaFields['connectionState'],
  connectionStateGeneration: string,
): Promise<boolean> {
  try {
    const written = await updateHealthSyncState(userID, healthProvider, {
      status,
      lastErrorCode,
    }, transitionAtMs, {
      requiredDocumentFieldValues: {
        documentRef: serviceMetaRef(admin.firestore(), userID, serviceName),
        expectedFields: {
          connectionState,
          connectionStateGeneration,
          ...healthLifecycleProjectionMarker(connectionStateGeneration, transitionAtMs),
        },
      },
      authoritativeLifecycleTransition: true,
    });
    if (!written) return false;

    const markerCleared = await clearHealthLifecycleProjectionMarker(userID, serviceName, {
      connectionStateGeneration,
      transitionAtMs,
    }, {
      connectionState,
      connectionStateGeneration,
    });
    return markerCleared;
  } catch (error) {
    // Service connection state remains authoritative and must not be rolled
    // back after a successful guarded transition. The generation-keyed marker
    // remains durable for the lifecycle repair scheduler.
    logger.error('[ServiceConnectionMeta] Failed to update provider Health lifecycle state.', {
      serviceName,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return false;
  }
}

/** Retries the exact derived provider Health state left pending by a lifecycle transition. */
export async function retryPendingHealthLifecycleProjection(
  userID: string,
  serviceName: ServiceNames,
): Promise<boolean> {
  if (!supportsHealthLifecycleProjection(serviceName)) return false;
  const meta = await getServiceConnectionMeta(userID, serviceName);
  if (meta?.healthLifecycleProjectionPending !== true) return false;

  const claim = getHealthLifecycleProjectionClaim(meta);
  const healthProvider = healthProviderForService(serviceName);
  if (!healthProvider) {
    await clearHealthLifecycleProjectionMarker(userID, serviceName, claim);
    return false;
  }
  const currentGeneration = typeof meta.connectionStateGeneration === 'string'
    ? meta.connectionStateGeneration.trim()
    : '';
  if (
    !claim.connectionStateGeneration
    || claim.transitionAtMs === null
    || claim.connectionStateGeneration !== currentGeneration
  ) {
    await clearHealthLifecycleProjectionMarker(userID, serviceName, claim);
    return false;
  }

  if (meta.connectionState === SERVICE_CONNECTION_STATES.Connected) {
    return updateHealthLifecycleState(
      userID,
      serviceName,
      healthProvider,
      HEALTH_SYNC_STATUSES.Ready,
      null,
      claim.transitionAtMs,
      meta.connectionState,
      claim.connectionStateGeneration,
    );
  }
  if (meta.connectionState === SERVICE_CONNECTION_STATES.ReconnectRequired) {
    return updateHealthLifecycleState(
      userID,
      serviceName,
      healthProvider,
      HEALTH_SYNC_STATUSES.ReconnectRequired,
      'provider_auth_reconnect_required',
      claim.transitionAtMs,
      meta.connectionState,
      claim.connectionStateGeneration,
    );
  }

  await clearHealthLifecycleProjectionMarker(userID, serviceName, claim);
  return false;
}

export function retryPendingCOROSHealthLifecycleProjection(userID: string): Promise<boolean> {
  return retryPendingHealthLifecycleProjection(userID, ServiceNames.COROSAPI);
}

/** The current refresh owner proves an opaque response still applies to this account. */
export interface WahooOpaqueRefreshFailureClaim {
  tokenRef: admin.firestore.DocumentReference;
  leaseOwner: string;
  credential: TokenCredentialSnapshot;
  connectionStateGeneration: string | null;
}

function serviceMetaRef(
  db: admin.firestore.Firestore,
  userID: string,
  serviceName: ServiceNames,
): admin.firestore.DocumentReference {
  return db.collection('users').doc(userID).collection('meta').doc(serviceName);
}

async function restoreRoutesAndReleaseDeferredWork(
  userID: string,
  serviceName: ServiceNames,
  connectionStateGeneration: string,
  requireServiceConnected: boolean,
): Promise<void> {
  const tokenRootSnapshot = await getServiceTokenRootDocumentRef(userID, serviceName).get();
  const disconnectLifecycleGuard = getServiceDisconnectLifecycleGuardFromRootData(
    tokenRootSnapshot.exists
      ? tokenRootSnapshot.data() as Record<string, unknown>
      : null,
  );
  if (
    disconnectLifecycleGuard.disconnectGeneration
    || getServiceDisconnectOperationGeneration(
      tokenRootSnapshot.exists
        ? tokenRootSnapshot.data() as Record<string, unknown>
        : null,
    )
  ) {
    throw new Error(`Cannot restore ${serviceName} routes while disconnect is still active.`);
  }
  const restoreOptions = {
    requireServiceConnected,
    expectedConnectionStateGeneration: connectionStateGeneration,
    expectedDisconnectLifecycleGuard: disconnectLifecycleGuard,
  };
  // Wahoo reconnect recovery has a second, independently retryable queue
  // release stage. Once routes for this exact connection generation have
  // already been restored, that later repair must continue to the Wahoo queue
  // release instead of treating the cleared route marker as a supersession.
  if (await isRouteRestoreCompleteForLifecycle(
    userID,
    serviceName,
    connectionStateGeneration,
    requireServiceConnected,
    disconnectLifecycleGuard,
  )) {
    return;
  }
  // Keep routeRestorePending durable until every parked row has been either
  // reopened or finalized against the restored settings. Any failure before
  // the final transaction therefore remains visible to the repair scheduler.
  await restoreActivitySyncRoutesForPendingDisconnectClear(userID, serviceName, {
    ...restoreOptions,
    clearRouteRestoreMarker: false,
  });
  const parkingClosed = await closeRouteRestoreParkingIfCurrent(
    userID,
    serviceName,
    connectionStateGeneration,
    requireServiceConnected,
    disconnectLifecycleGuard,
  );
  if (!parkingClosed) {
    throw new Error(`Route restoration for ${serviceName} was superseded before its release barrier closed.`);
  }
  await releaseQueueItemsDeferredForRouteRestore(
    userID,
    serviceName,
    connectionStateGeneration,
    disconnectLifecycleGuard,
  );
  await restoreActivitySyncRoutesForPendingDisconnectClear(userID, serviceName, {
    ...restoreOptions,
    clearRouteRestoreMarker: true,
  });
  const restorationCompleted = await isRouteRestoreCompleteForLifecycle(
    userID,
    serviceName,
    connectionStateGeneration,
    requireServiceConnected,
    disconnectLifecycleGuard,
  );
  if (!restorationCompleted) {
    throw new Error(`Route restoration for ${serviceName} was superseded before its marker was cleared.`);
  }
}

async function closeRouteRestoreParkingIfCurrent(
  userID: string,
  serviceName: ServiceNames,
  connectionStateGeneration: string,
  requireServiceConnected: boolean,
  lifecycleGuard: ServiceDisconnectLifecycleGuard,
): Promise<boolean> {
  const db = admin.firestore();
  const metaRef = serviceMetaRef(db, userID, serviceName);
  const tokenRootRef = getServiceTokenRootDocumentRef(userID, serviceName);
  return db.runTransaction(async transaction => {
    const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    if (deletionGuard.shouldSkip) return false;
    const [metaSnapshot, tokenRootSnapshot] = await Promise.all([
      transaction.get(metaRef),
      transaction.get(tokenRootRef),
    ]);
    const meta = metaSnapshot.data() as ServiceConnectionMetaFields | undefined;
    if (
      meta?.routeRestorePending !== true
      || meta.routeRestoreConnectionGeneration !== connectionStateGeneration
      || meta.connectionStateGeneration !== connectionStateGeneration
      || (requireServiceConnected && meta.connectionState !== SERVICE_CONNECTION_STATES.Connected)
      || !doesRootMatchServiceDisconnectLifecycleGuard(
        tokenRootSnapshot.exists
          ? tokenRootSnapshot.data() as Record<string, unknown>
          : null,
        lifecycleGuard,
      )
    ) return false;
    if (meta.routeRestoreParkingClosed !== true) {
      transaction.set(metaRef, { routeRestoreParkingClosed: true }, { merge: true });
    }
    return true;
  });
}

async function isRouteRestoreCompleteForLifecycle(
  userID: string,
  serviceName: ServiceNames,
  connectionStateGeneration: string,
  requireServiceConnected: boolean,
  lifecycleGuard: ServiceDisconnectLifecycleGuard,
): Promise<boolean> {
  const db = admin.firestore();
  const metaRef = serviceMetaRef(db, userID, serviceName);
  const tokenRootRef = getServiceTokenRootDocumentRef(userID, serviceName);
  return db.runTransaction(async transaction => {
    const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    if (deletionGuard.shouldSkip) return false;
    const [metaSnapshot, tokenRootSnapshot] = await Promise.all([
      transaction.get(metaRef),
      transaction.get(tokenRootRef),
    ]);
    const meta = metaSnapshot.data() as ServiceConnectionMetaFields | undefined;
    return meta?.connectionStateGeneration === connectionStateGeneration
      && (!requireServiceConnected || meta.connectionState === SERVICE_CONNECTION_STATES.Connected)
      && meta.routeRestorePending !== true
      && !meta.routeRestoreConnectionGeneration
      && doesRootMatchServiceDisconnectLifecycleGuard(
        tokenRootSnapshot.exists
          ? tokenRootSnapshot.data() as Record<string, unknown>
          : null,
        lifecycleGuard,
      );
  });
}

async function setServiceMetaIfUserActive(
  userID: string,
  serviceName: ServiceNames,
  payload: Record<string, unknown>,
  expectedTokenCredentialGeneration?: DocumentGenerationGuard,
  expectedOAuthFlowGeneration?: DocumentGenerationGuard,
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

    const [credentialGenerationSnapshot, oauthFlowGenerationSnapshot] = await Promise.all([
      expectedTokenCredentialGeneration
        ? transaction.get(expectedTokenCredentialGeneration.documentRef)
        : Promise.resolve(null),
      expectedOAuthFlowGeneration
        ? transaction.get(expectedOAuthFlowGeneration.documentRef)
        : Promise.resolve(null),
    ]);
    if (expectedTokenCredentialGeneration && credentialGenerationSnapshot && (
      !credentialGenerationSnapshot.exists
      || credentialGenerationSnapshot.data()?.[expectedTokenCredentialGeneration.fieldName]
        !== expectedTokenCredentialGeneration.expectedGeneration
    )) {
      return false;
    }
    if (expectedOAuthFlowGeneration && oauthFlowGenerationSnapshot && (
      !oauthFlowGenerationSnapshot.exists
      || oauthFlowGenerationSnapshot.data()?.[expectedOAuthFlowGeneration.fieldName]
        !== expectedOAuthFlowGeneration.expectedGeneration
    )) {
      return false;
    }

    transaction.set(ref, payload, { merge: true });
    if (expectedOAuthFlowGeneration) {
      transaction.set(expectedOAuthFlowGeneration.documentRef, {
        [expectedOAuthFlowGeneration.fieldName]: FieldValue.delete(),
      }, { merge: true });
    }
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
 * Durably starts the pending-disconnect queue-release hand-off before the
 * lifecycle is cleared. This is intentionally separate from the queue work:
 * if OAuth callbacks race or the invocation stops while releasing pages, the
 * marker remains for the winner or scheduler to finish.
 */
export async function beginPendingDisconnectQueueReleaseRepair(
  userID: string,
  serviceName: ServiceNames,
  pendingDisconnectGeneration: string,
  expectedTokenCredentialGeneration?: DocumentGenerationGuard,
  expectedOAuthFlowGeneration?: DocumentGenerationGuard,
  nowMs = Date.now(),
): Promise<boolean> {
  const releaseGeneration = normalizedGeneration(pendingDisconnectGeneration);
  if (!releaseGeneration) return false;

  const db = admin.firestore();
  const ref = serviceMetaRef(db, userID, serviceName);
  const tokenRootRef = getServiceTokenRootDocumentRef(userID, serviceName);
  return db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(
        db,
        transaction,
        userID,
      );
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, 'pending_disconnect_queue_release_repair', error);
    }
    if (deletionGuard.shouldSkip) return false;

    const [metaSnapshot, tokenRootSnapshot, credentialSnapshot, oauthFlowSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(tokenRootRef),
      expectedTokenCredentialGeneration
        ? transaction.get(expectedTokenCredentialGeneration.documentRef)
        : Promise.resolve(null),
      expectedOAuthFlowGeneration
        ? transaction.get(expectedOAuthFlowGeneration.documentRef)
        : Promise.resolve(null),
    ]);
    if (expectedTokenCredentialGeneration && credentialSnapshot && (
      !credentialSnapshot.exists
      || credentialSnapshot.data()?.[expectedTokenCredentialGeneration.fieldName]
        !== expectedTokenCredentialGeneration.expectedGeneration
    )) return false;
    if (expectedOAuthFlowGeneration && oauthFlowSnapshot && (
      !oauthFlowSnapshot.exists
      || oauthFlowSnapshot.data()?.[expectedOAuthFlowGeneration.fieldName]
        !== expectedOAuthFlowGeneration.expectedGeneration
    )) return false;

    const meta = metaSnapshot.data() as ServiceConnectionMetaFields | undefined;
    const rootData = tokenRootSnapshot.data() as Record<string, unknown> | undefined;
    const existingReleaseGeneration = normalizedGeneration(meta?.pendingDisconnectQueueReleaseGeneration);
    const hasCurrentRootPendingDisconnect = isServiceDisconnectPendingData(rootData)
      && normalizedGeneration(rootData?.disconnectGeneration) === releaseGeneration;
    const hasCurrentMetaPendingDisconnect = meta?.connectionState === SERVICE_CONNECTION_STATES.DisconnectPending
      && normalizedGeneration(meta.disconnectGeneration) === releaseGeneration;
    if (
      (!hasCurrentRootPendingDisconnect && !hasCurrentMetaPendingDisconnect)
      || (isServiceDisconnectPendingData(rootData) && !hasCurrentRootPendingDisconnect)
      || getServiceDisconnectOperationGeneration(rootData) !== null
      || (existingReleaseGeneration && existingReleaseGeneration !== releaseGeneration)
    ) return false;

    if (meta?.pendingDisconnectQueueReleasePending === true
      && existingReleaseGeneration === releaseGeneration) {
      return true;
    }

    transaction.set(ref, {
      pendingDisconnectQueueReleasePending: true,
      pendingDisconnectQueueReleaseGeneration: releaseGeneration,
      pendingDisconnectQueueReleaseLastAttemptAt: nowMs,
      pendingDisconnectQueueReleaseAttemptCount: 0,
    }, { merge: true });
    return true;
  });
}

async function notePendingDisconnectQueueReleaseRepairAttempt(
  userID: string,
  serviceName: ServiceNames,
  pendingDisconnectGeneration: string,
  nowMs = Date.now(),
): Promise<boolean> {
  const db = admin.firestore();
  const ref = serviceMetaRef(db, userID, serviceName);
  return db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(
        db,
        transaction,
        userID,
      );
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, 'pending_disconnect_queue_release_retry', error);
    }
    if (deletionGuard.shouldSkip) return false;

    const snapshot = await transaction.get(ref);
    const meta = snapshot.data() as ServiceConnectionMetaFields | undefined;
    if (
      meta?.pendingDisconnectQueueReleasePending !== true
      || normalizedGeneration(meta.pendingDisconnectQueueReleaseGeneration) !== pendingDisconnectGeneration
      || isServiceUnavailableForSyncConnection(meta)
    ) return false;

    transaction.set(ref, {
      pendingDisconnectQueueReleaseLastAttemptAt: nowMs,
      pendingDisconnectQueueReleaseAttemptCount: Math.max(
        0,
        Number(meta.pendingDisconnectQueueReleaseAttemptCount) || 0,
      ) + 1,
    }, { merge: true });
    return true;
  });
}

export async function completePendingDisconnectQueueReleaseRepair(
  userID: string,
  serviceName: ServiceNames,
  pendingDisconnectGeneration: string,
): Promise<boolean> {
  const db = admin.firestore();
  const ref = serviceMetaRef(db, userID, serviceName);
  const tokenRootRef = getServiceTokenRootDocumentRef(userID, serviceName);
  return db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(
        db,
        transaction,
        userID,
      );
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, 'pending_disconnect_queue_release_complete', error);
    }
    if (deletionGuard.shouldSkip) return false;

    const [metaSnapshot, tokenRootSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(tokenRootRef),
    ]);
    const meta = metaSnapshot.data() as ServiceConnectionMetaFields | undefined;
    const rootData = tokenRootSnapshot.data() as Record<string, unknown> | undefined;
    if (
      meta?.pendingDisconnectQueueReleasePending !== true
      || normalizedGeneration(meta.pendingDisconnectQueueReleaseGeneration) !== pendingDisconnectGeneration
      || isServiceUnavailableForSyncConnection(meta)
      || isServiceDisconnectPendingData(rootData)
      || getServiceDisconnectOperationGeneration(rootData) !== null
    ) return false;

    transaction.set(ref, {
      pendingDisconnectQueueReleasePending: FieldValue.delete(),
      pendingDisconnectQueueReleaseGeneration: FieldValue.delete(),
      pendingDisconnectQueueReleaseLastAttemptAt: FieldValue.delete(),
      pendingDisconnectQueueReleaseAttemptCount: FieldValue.delete(),
    }, { merge: true });
    return true;
  });
}

/** Continues a bounded pending-disconnect queue release after lifecycle recovery. */
export async function retryPendingDisconnectQueueRelease(
  userID: string,
  serviceName: ServiceNames,
): Promise<boolean> {
  const meta = await getServiceConnectionMeta(userID, serviceName);
  const pendingDisconnectGeneration = normalizedGeneration(meta?.pendingDisconnectQueueReleaseGeneration);
  if (
    meta?.pendingDisconnectQueueReleasePending !== true
    || !pendingDisconnectGeneration
    || isServiceUnavailableForSyncConnection(meta)
  ) return false;

  try {
    await releaseQueueItemsDeferredForPendingDisconnect(
      userID,
      serviceName,
      pendingDisconnectGeneration,
    );
  } catch (error) {
    try {
      await notePendingDisconnectQueueReleaseRepairAttempt(
        userID,
        serviceName,
        pendingDisconnectGeneration,
      );
    } catch (attemptError) {
      logger.error('[ServiceConnectionMeta] Failed to record pending-disconnect queue release repair attempt.', {
        userID,
        serviceName,
        error: attemptError instanceof Error ? attemptError.message : `${attemptError}`,
      });
    }
    logger.error('[ServiceConnectionMeta] Failed to continue a bounded pending-disconnect queue release.', {
      userID,
      serviceName,
      error: error instanceof Error ? error.message : `${error}`,
    });
    return false;
  }

  try {
    return await completePendingDisconnectQueueReleaseRepair(
      userID,
      serviceName,
      pendingDisconnectGeneration,
    );
  } catch (error) {
    // The release is already complete. Retaining the marker only schedules an
    // idempotent retry, so do not report a failed recovery to the scheduler.
    logger.error('[ServiceConnectionMeta] Failed to clear pending-disconnect queue release repair marker.', {
      userID,
      serviceName,
      error: error instanceof Error ? error.message : `${error}`,
    });
    return true;
  }
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

export interface MarkServiceReconnectRequiredOptions {
  /** Abort when OAuth or another lifecycle transition already won. */
  expectedConnectionStateGeneration?: string | null;
  /** Terminal cleanup can prove no replacement credential exists. */
  requireEmptyTokenCollection?: admin.firestore.CollectionReference;
  /** Terminal cleanup can prove the failed account token was not replaced. */
  requireMissingToken?: admin.firestore.DocumentReference;
  /** A failed deletion may only mark the still-current credential generation. */
  expectedTokenCredential?: TokenCredentialGuard;
  /** Also bind fallback cleanup to the provider token root's OAuth generation. */
  expectedTokenRootCredentialGeneration?: DocumentGenerationGuard;
  /** Preserve the stable provider account identity while credentials are unavailable. */
  providerUserId?: string | null;
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
  const healthProvider = healthProviderForService(serviceName);
  const connectionStateGeneration = crypto.randomUUID();
  const guardsConnectionGeneration = Object.prototype.hasOwnProperty.call(
    options,
    'expectedConnectionStateGeneration',
  );
  const expectedTokenCredential = options.expectedTokenCredential;
  const expectedTokenRootCredentialGeneration = options.expectedTokenRootCredentialGeneration;
  const providerUserId = `${options.providerUserId || ''}`.trim();
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

    const [
      metaSnapshot,
      tokenSnapshot,
      missingTokenSnapshot,
      expectedTokenSnapshot,
      expectedTokenRootSnapshot,
    ] = await Promise.all([
      transaction.get(ref),
      options.requireEmptyTokenCollection
        ? transaction.get(options.requireEmptyTokenCollection)
        : Promise.resolve(null),
      options.requireMissingToken
        ? transaction.get(options.requireMissingToken)
        : Promise.resolve(null),
      expectedTokenCredential
        ? transaction.get(expectedTokenCredential.tokenRef)
        : Promise.resolve(null),
      expectedTokenRootCredentialGeneration
        ? transaction.get(expectedTokenRootCredentialGeneration.documentRef)
        : Promise.resolve(null),
    ]);
    const currentGeneration = typeof metaSnapshot.data()?.connectionStateGeneration === 'string'
      ? `${metaSnapshot.data()?.connectionStateGeneration}`
      : null;
    const currentProviderUserId = `${metaSnapshot.data()?.providerUserId || ''}`.trim();
    if (
      (guardsConnectionGeneration
        && currentGeneration !== (options.expectedConnectionStateGeneration || null))
      || (tokenSnapshot && !tokenSnapshot.empty)
      || (missingTokenSnapshot?.exists === true)
      || (expectedTokenCredential && expectedTokenSnapshot && (
        !expectedTokenSnapshot.exists
        || !areTokenCredentialSnapshotsEqual(
          getTokenCredentialSnapshot(expectedTokenSnapshot.data() as Record<string, unknown> | undefined),
          expectedTokenCredential.credential,
        )
      ))
      || (expectedTokenRootCredentialGeneration && expectedTokenRootSnapshot && (
        (typeof expectedTokenRootSnapshot.data()?.[expectedTokenRootCredentialGeneration.fieldName] === 'string'
          ? expectedTokenRootSnapshot.data()?.[expectedTokenRootCredentialGeneration.fieldName]
          : null) !== expectedTokenRootCredentialGeneration.expectedGeneration
      ))
      || (providerUserId && currentProviderUserId && currentProviderUserId !== providerUserId)
    ) {
      return false;
    }

    transaction.set(ref, {
      connectionState: SERVICE_CONNECTION_STATES.ReconnectRequired,
      connectionStateGeneration,
      ...(healthProvider
        ? healthLifecycleProjectionMarker(connectionStateGeneration, nowMs)
        : {}),
      routeRestorePending: FieldValue.delete(),
      routeRestoreParkingClosed: FieldValue.delete(),
      routeRestoreConnectionGeneration: FieldValue.delete(),
      routeRestoreLastAttemptAt: FieldValue.delete(),
      routeRestoreAttemptCount: FieldValue.delete(),
      lastAuthFailureCode: failureCode || null,
      lastAuthFailureMessage: failureMessage || null,
      lastDisconnectedAt: nowMs,
      ...(providerUserId ? { providerUserId } : {}),
    }, { merge: true });
    return true;
  });
  if (!didWrite) {
    return false;
  }

  if (healthProvider) {
    await updateHealthLifecycleState(
      userID,
      serviceName,
      healthProvider,
      HEALTH_SYNC_STATUSES.ReconnectRequired,
      'provider_auth_reconnect_required',
      nowMs,
      SERVICE_CONNECTION_STATES.ReconnectRequired,
      connectionStateGeneration,
    );
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
  /** Clear authoritative pending-disconnect root fields in the same transaction as metadata. */
  clearPendingDisconnectRoot?: boolean;
  expectedPendingDisconnectGeneration?: string;
  expectedTokenCredentialGeneration?: DocumentGenerationGuard;
  expectedOAuthFlowGeneration?: DocumentGenerationGuard;
  expectedDisconnectLifecycleGuard?: ServiceDisconnectLifecycleGuard;
  /** Keep an already-staged pending-disconnect queue-release marker intact. */
  preservePendingDisconnectQueueReleaseRepair?: boolean;
}

function pendingDisconnectRootFieldDeletes(): Record<string, FieldValue> {
  return {
    disconnectGeneration: FieldValue.delete(),
    disconnectState: FieldValue.delete(),
    disconnectReason: FieldValue.delete(),
    disconnectAttemptCount: FieldValue.delete(),
    disconnectNextAttemptAt: FieldValue.delete(),
    disconnectLastAttemptAt: FieldValue.delete(),
    disconnectRetryExpiresAt: FieldValue.delete(),
    disconnectLastStatusCode: FieldValue.delete(),
    disconnectLastErrorMessage: FieldValue.delete(),
    disconnectManualReviewRequired: FieldValue.delete(),
  };
}

function normalizedGeneration(value: unknown): string | null {
  const generation = typeof value === 'string' ? value.trim() : '';
  return generation || null;
}

function matchesDisconnectLifecycleGuard(
  data: Record<string, unknown> | undefined,
  guard: ServiceDisconnectLifecycleGuard,
): boolean {
  return doesRootMatchServiceDisconnectLifecycleGuard(data, guard);
}

export async function mirrorServiceDisconnectPendingToUserMeta(
  userID: string,
  serviceName: ServiceNames,
  input: ServiceDisconnectPendingMetaInput,
): Promise<boolean> {
  const db = admin.firestore();
  const ref = serviceMetaRef(db, userID, serviceName);
  const tokenRootRef = getServiceTokenRootDocumentRef(userID, serviceName);
  const didWrite = await db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, `service_disconnect_pending_mirror:${serviceName}`, error);
    }
    if (deletionGuard.shouldSkip) return false;

    // The token root is authoritative. OAuth recovery may clear the pending
    // episode before this denormalized mirror runs, so only publish the exact
    // still-current pending generation.
    const rootSnapshot = await transaction.get(tokenRootRef);
    const rootData = rootSnapshot.data() as Record<string, unknown> | undefined;
    if (
      !rootSnapshot.exists
      || !isServiceDisconnectPendingData(rootData)
      || rootData?.disconnectGeneration !== input.generation
      || Number(rootData?.disconnectAttemptCount || 0) !== input.attemptCount
    ) {
      return false;
    }

    transaction.set(ref, {
      connectionState: SERVICE_CONNECTION_STATES.DisconnectPending,
      connectionStateGeneration: input.generation,
      disconnectGeneration: input.generation,
      ...healthLifecycleProjectionDeletes(),
      routeRestorePending: FieldValue.delete(),
      routeRestoreParkingClosed: FieldValue.delete(),
      routeRestoreConnectionGeneration: FieldValue.delete(),
      routeRestoreLastAttemptAt: FieldValue.delete(),
      routeRestoreAttemptCount: FieldValue.delete(),
      pendingDisconnectQueueReleasePending: FieldValue.delete(),
      pendingDisconnectQueueReleaseLastAttemptAt: FieldValue.delete(),
      pendingDisconnectQueueReleaseAttemptCount: FieldValue.delete(),
      pendingDisconnectQueueReleaseGeneration: FieldValue.delete(),
      disconnectReason: input.reason,
      disconnectAttemptCount: input.attemptCount,
      disconnectNextAttemptAt: input.nextAttemptAt,
      disconnectLastAttemptAt: input.lastAttemptAt || null,
      disconnectRetryExpiresAt: input.retryExpiresAt,
      disconnectLastStatusCode: input.lastStatusCode ?? null,
      disconnectLastErrorMessage: input.lastErrorMessage || null,
      disconnectManualReviewRequired: input.manualReviewRequired === true,
      lastDisconnectedAt: Date.now(),
    }, { merge: true });
    return true;
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
  expectedOAuthFlowGeneration?: DocumentGenerationGuard,
): Promise<boolean> {
  const normalizedProviderUserId = `${providerUserId || ''}`.trim();
  const healthProvider = healthProviderForService(serviceName);
  const connectionStateGeneration = crypto.randomUUID();
  const nowMs = Date.now();
  const didWrite = await setServiceMetaIfUserActive(userID, serviceName, {
    connectionState: SERVICE_CONNECTION_STATES.Connected,
    connectionStateGeneration,
    ...(healthProvider
      ? healthLifecycleProjectionMarker(connectionStateGeneration, nowMs)
      : {}),
    disconnectGeneration: FieldValue.delete(),
    routeRestorePending: true,
    routeRestoreParkingClosed: false,
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
  }, expectedTokenCredentialGeneration, expectedOAuthFlowGeneration);
  if (!didWrite) {
    return didWrite;
  }

  if (healthProvider) {
    await updateHealthLifecycleState(
      userID,
      serviceName,
      healthProvider,
      HEALTH_SYNC_STATUSES.Ready,
      null,
      nowMs,
      SERVICE_CONNECTION_STATES.Connected,
      connectionStateGeneration,
    );
  }

  if (serviceName === ServiceNames.WahooAPI) {
    await releaseWahooReconnectQueueItemsWithRepair(userID, connectionStateGeneration);
    return true;
  }

  try {
    await restoreRoutesAndReleaseDeferredWork(
      userID,
      serviceName,
      connectionStateGeneration,
      false,
    );
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
  | 'token_unavailable'
  | 'user_inactive';

export interface ServiceConnectionProviderUserIdPinOptions {
  expectedProviderToken?: {
    documentRef: admin.firestore.DocumentReference;
    providerUserIdField: string;
  };
}

/**
 * Pins a legacy connection without replacing an account selected by a
 * concurrent OAuth callback. A non-empty existing identifier is immutable in
 * this migration path; reconnect owns account changes through markConnected.
 */
export async function pinServiceConnectionProviderUserIdIfUnset(
  userID: string,
  serviceName: ServiceNames,
  providerUserId: string | null | undefined,
  options: ServiceConnectionProviderUserIdPinOptions = {},
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

    const [snapshot, expectedTokenSnapshot] = await Promise.all([
      transaction.get(ref),
      options.expectedProviderToken
        ? transaction.get(options.expectedProviderToken.documentRef)
        : Promise.resolve(null),
    ]);
    if (options.expectedProviderToken && expectedTokenSnapshot && (
      !expectedTokenSnapshot.exists
      || `${expectedTokenSnapshot.data()?.[options.expectedProviderToken.providerUserIdField] || ''}`.trim()
        !== normalizedProviderUserId
    )) {
      return 'token_unavailable';
    }
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
  const tokenRootRef = getServiceTokenRootDocumentRef(userID, serviceName);
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

    let lifecycleRootSnapshot: admin.firestore.DocumentSnapshot | null = null;
    if (options.expectedPendingDisconnectGeneration
      || options.expectedTokenCredentialGeneration
      || options.expectedOAuthFlowGeneration
      || options.expectedDisconnectLifecycleGuard
      || options.clearPendingDisconnectRoot) {
      const [metaSnapshot, tokenSnapshot, oauthFlowSnapshot, rootSnapshot] = await Promise.all([
        transaction.get(ref),
        options.expectedTokenCredentialGeneration
          ? transaction.get(options.expectedTokenCredentialGeneration.documentRef)
          : Promise.resolve(null),
        options.expectedOAuthFlowGeneration
          ? transaction.get(options.expectedOAuthFlowGeneration.documentRef)
          : Promise.resolve(null),
        options.expectedDisconnectLifecycleGuard || options.clearPendingDisconnectRoot
          ? transaction.get(tokenRootRef)
          : Promise.resolve(null),
      ]);
      lifecycleRootSnapshot = rootSnapshot;
      const meta = metaSnapshot.data() as ServiceConnectionMetaFields | undefined;
      const expectedPendingDisconnectMatches = !options.expectedPendingDisconnectGeneration || (
        meta?.connectionState === SERVICE_CONNECTION_STATES.DisconnectPending
        && meta.disconnectGeneration === options.expectedPendingDisconnectGeneration
      );
      const pendingDisconnectWasAlreadyCleared = !!options.expectedPendingDisconnectGeneration
        && !meta?.connectionState
        && !meta?.disconnectGeneration;
      if (
        (!expectedPendingDisconnectMatches && !pendingDisconnectWasAlreadyCleared)
        || (options.expectedTokenCredentialGeneration && tokenSnapshot
          && (tokenSnapshot.exists
            ? tokenSnapshot.data()?.[options.expectedTokenCredentialGeneration.fieldName] ?? null
            : null) !== options.expectedTokenCredentialGeneration.expectedGeneration)
        || (options.expectedOAuthFlowGeneration && oauthFlowSnapshot
          && (oauthFlowSnapshot.exists
            ? oauthFlowSnapshot.data()?.[options.expectedOAuthFlowGeneration.fieldName] ?? null
            : null) !== options.expectedOAuthFlowGeneration.expectedGeneration)
        || (options.expectedDisconnectLifecycleGuard && lifecycleRootSnapshot
          && !matchesDisconnectLifecycleGuard(
            lifecycleRootSnapshot.exists
              ? lifecycleRootSnapshot.data() as Record<string, unknown>
              : undefined,
            options.expectedDisconnectLifecycleGuard,
          ))
      ) {
        return false;
      }
    }

    if (options.clearPendingDisconnectRoot && lifecycleRootSnapshot?.exists) {
      transaction.set(tokenRootRef, pendingDisconnectRootFieldDeletes(), { merge: true });
    }

    transaction.set(ref, {
      connectionState: FieldValue.delete(),
      connectionStateGeneration,
      disconnectGeneration: FieldValue.delete(),
      ...healthLifecycleProjectionDeletes(),
      ...(options.restorePendingDisconnectActivitySyncRoutes ? {
        routeRestorePending: true,
        routeRestoreParkingClosed: false,
        routeRestoreConnectionGeneration: connectionStateGeneration,
        routeRestoreLastAttemptAt: nowMs,
        routeRestoreAttemptCount: 0,
      } : {
        routeRestorePending: FieldValue.delete(),
        routeRestoreParkingClosed: FieldValue.delete(),
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
      ...(options.preservePendingDisconnectQueueReleaseRepair ? {} : {
        pendingDisconnectQueueReleasePending: FieldValue.delete(),
        pendingDisconnectQueueReleaseLastAttemptAt: FieldValue.delete(),
        pendingDisconnectQueueReleaseAttemptCount: FieldValue.delete(),
        pendingDisconnectQueueReleaseGeneration: FieldValue.delete(),
      }),
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
    await restoreRoutesAndReleaseDeferredWork(
      userID,
      serviceName,
      connectionStateGeneration,
      false,
    );
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

  await restoreRoutesAndReleaseDeferredWork(
    userID,
    serviceName,
    generation,
    meta.connectionState === SERVICE_CONNECTION_STATES.Connected,
  );
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
