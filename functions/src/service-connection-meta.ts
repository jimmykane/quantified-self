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
  return setServiceMetaIfUserActive(userID, serviceName, {
    connectionState: SERVICE_CONNECTION_STATES.Connected,
    ...(normalizedProviderUserId ? { providerUserId: normalizedProviderUserId } : {}),
    lastAuthFailureCode: FieldValue.delete(),
    lastAuthFailureMessage: FieldValue.delete(),
    lastDisconnectedAt: FieldValue.delete(),
    disconnectReason: FieldValue.delete(),
    disconnectAttemptCount: FieldValue.delete(),
    disconnectNextAttemptAt: FieldValue.delete(),
    disconnectLastAttemptAt: FieldValue.delete(),
    disconnectRetryExpiresAt: FieldValue.delete(),
    disconnectLastStatusCode: FieldValue.delete(),
    disconnectLastErrorMessage: FieldValue.delete(),
    disconnectManualReviewRequired: FieldValue.delete(),
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
    disconnectReason: FieldValue.delete(),
    disconnectAttemptCount: FieldValue.delete(),
    disconnectNextAttemptAt: FieldValue.delete(),
    disconnectRetryExpiresAt: FieldValue.delete(),
    disconnectLastStatusCode: FieldValue.delete(),
    disconnectLastErrorMessage: FieldValue.delete(),
    disconnectManualReviewRequired: FieldValue.delete(),
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
