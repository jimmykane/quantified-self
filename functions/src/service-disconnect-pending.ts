import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getServiceTokenRootDocumentRef } from './service-token-store';
import {
  clearServiceConnectionState,
  mirrorServiceDisconnectPendingToUserMeta,
} from './service-connection-meta';
import {
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from './shared/user-deletion-guard';
import { releaseQueueItemsDeferredForPendingDisconnect } from './queue/pending-disconnect-release';
import {
  buildPendingDisconnectMarkState,
  buildPendingDisconnectMetaInputFromRootData,
  buildPendingDisconnectRecoveryRetryData,
  buildPendingDisconnectRetryFailureTransition,
  buildRestoredPendingDisconnectData,
  isServiceDisconnectPendingData,
  SERVICE_DISCONNECT_PENDING_REASON,
  timestampToISOString,
  type PendingServiceDisconnectFailure,
  type PendingServiceDisconnectRootData,
  type ServiceDisconnectPendingReason,
} from './service-disconnect-pending-state';

export {
  buildPendingServiceDisconnectNextAttemptAt,
  isRetryableSubscriptionEnforcementDisconnectStatus,
  isServiceDisconnectPendingData,
  PENDING_SERVICE_DISCONNECT_BATCH_LIMIT,
  PENDING_SERVICE_DISCONNECT_MAX_ATTEMPTS,
  PENDING_SERVICE_DISCONNECT_RETRY_WINDOW_DAYS,
  sanitizePendingServiceDisconnectErrorMessage,
  SERVICE_DISCONNECT_PENDING_REASON,
} from './service-disconnect-pending-state';
export type {
  PendingServiceDisconnectFailure,
  PendingServiceDisconnectRootData,
  ServiceDisconnectPendingReason,
} from './service-disconnect-pending-state';

function buildPendingDisconnectFieldDeletes(): Record<string, admin.firestore.FieldValue> {
  return {
    disconnectState: admin.firestore.FieldValue.delete(),
    disconnectReason: admin.firestore.FieldValue.delete(),
    disconnectAttemptCount: admin.firestore.FieldValue.delete(),
    disconnectNextAttemptAt: admin.firestore.FieldValue.delete(),
    disconnectLastAttemptAt: admin.firestore.FieldValue.delete(),
    disconnectRetryExpiresAt: admin.firestore.FieldValue.delete(),
    disconnectLastStatusCode: admin.firestore.FieldValue.delete(),
    disconnectLastErrorMessage: admin.firestore.FieldValue.delete(),
    disconnectManualReviewRequired: admin.firestore.FieldValue.delete(),
  };
}

async function shouldSkipPendingDisconnectWrite(
  db: admin.firestore.Firestore,
  transaction: admin.firestore.Transaction,
  userID: string,
  serviceName: ServiceNames,
  operation: string,
): Promise<boolean> {
  let deletionGuard;
  try {
    deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
  } catch (error) {
    throw new UserDeletionGuardReadError(userID, `service_disconnect_pending_${operation}:${serviceName}`, error);
  }

  if (!deletionGuard.shouldSkip) {
    return false;
  }

  logger.warn('[ServiceDisconnectPending] Skipping pending disconnect write because the user is missing or deletion is in progress.', {
    userID,
    serviceName,
    operation,
    userExists: deletionGuard.userExists,
    deletionInProgress: deletionGuard.deletionInProgress,
  });
  return true;
}

export async function getServiceDisconnectPendingData(
  userID: string,
  serviceName: ServiceNames,
): Promise<PendingServiceDisconnectRootData | null> {
  const snapshot = await getServiceTokenRootDocumentRef(userID, serviceName).get();
  return snapshot.exists ? snapshot.data() as PendingServiceDisconnectRootData : null;
}

export async function isServiceDisconnectPendingForUser(
  userID: string,
  serviceName: ServiceNames,
): Promise<boolean> {
  return isServiceDisconnectPendingData(await getServiceDisconnectPendingData(userID, serviceName));
}

export async function isServiceDisconnectManualReviewRequiredForUser(
  userID: string,
  serviceName: ServiceNames,
): Promise<boolean> {
  const data = await getServiceDisconnectPendingData(userID, serviceName);
  return isServiceDisconnectPendingData(data) && data?.disconnectManualReviewRequired === true;
}

export async function markServiceDisconnectPending(
  userID: string,
  serviceName: ServiceNames,
  failure: PendingServiceDisconnectFailure,
  reason: ServiceDisconnectPendingReason = SERVICE_DISCONNECT_PENDING_REASON.SubscriptionEnforcement,
  nowMs = Date.now(),
): Promise<boolean> {
  const db = admin.firestore();
  const rootRef = getServiceTokenRootDocumentRef(userID, serviceName);

  const rootData = await db.runTransaction(async (transaction) => {
    if (await shouldSkipPendingDisconnectWrite(db, transaction, userID, serviceName, 'mark')) {
      return null;
    }

    const snapshot = await transaction.get(rootRef);
    const existing = snapshot.exists ? snapshot.data() as PendingServiceDisconnectRootData : {};
    const nextState = buildPendingDisconnectMarkState(existing, failure, reason, nowMs);

    transaction.set(rootRef, nextState.rootData, { merge: true });
    return nextState.rootData;
  });

  if (!rootData) {
    return false;
  }

  await mirrorServiceDisconnectPendingToUserMeta(
    userID,
    serviceName,
    buildPendingDisconnectMetaInputFromRootData(rootData, nowMs),
  );
  return true;
}

export async function recordServiceDisconnectRetryFailure(
  userID: string,
  serviceName: ServiceNames,
  failure: PendingServiceDisconnectFailure,
  nowMs = Date.now(),
): Promise<boolean> {
  const db = admin.firestore();
  const rootRef = getServiceTokenRootDocumentRef(userID, serviceName);

  const retryUpdate = await db.runTransaction(async (transaction) => {
    if (await shouldSkipPendingDisconnectWrite(db, transaction, userID, serviceName, 'retry_failure')) {
      return null;
    }

    const snapshot = await transaction.get(rootRef);
    const existing = snapshot.exists ? snapshot.data() as PendingServiceDisconnectRootData : {};
    const nextTransition = buildPendingDisconnectRetryFailureTransition(existing, failure, nowMs);

    transaction.set(rootRef, nextTransition.rootData, { merge: true });
    return nextTransition;
  });

  if (!retryUpdate) {
    return false;
  }

  const didMirror = await mirrorServiceDisconnectPendingToUserMeta(
    userID,
    serviceName,
    buildPendingDisconnectMetaInputFromRootData(retryUpdate.finalData, nowMs),
  );

  if (retryUpdate.manualReviewRequired && !didMirror) {
    logger.warn('[ServiceDisconnectPending] Keeping pending disconnect retryable because manual-review meta mirror was skipped.', {
      userID,
      serviceName,
      tokenID: failure.tokenID,
      statusCode: failure.statusCode,
      attemptCount: retryUpdate.finalData.disconnectAttemptCount,
      retryExpiresAt: timestampToISOString(retryUpdate.finalData.disconnectRetryExpiresAt),
    });
    return false;
  }

  if (retryUpdate.manualReviewRequired) {
    const didFinalizeManualReviewRoot = await db.runTransaction(async (transaction) => {
      if (await shouldSkipPendingDisconnectWrite(db, transaction, userID, serviceName, 'manual_review_finalize')) {
        return false;
      }

      const snapshot = await transaction.get(rootRef);
      if (!snapshot.exists) {
        return false;
      }

      const current = snapshot.data() as PendingServiceDisconnectRootData;
      if (current.disconnectManualReviewRequired === true) {
        return true;
      }
      if (!isServiceDisconnectPendingData(current)
        || current.disconnectAttemptCount !== retryUpdate.rootData.disconnectAttemptCount) {
        return false;
      }

      transaction.set(rootRef, retryUpdate.finalData, { merge: true });
      return true;
    });

    if (!didFinalizeManualReviewRoot) {
      logger.warn('[ServiceDisconnectPending] Manual-review meta was mirrored but the pending disconnect root stayed retryable.', {
        userID,
        serviceName,
        tokenID: failure.tokenID,
        statusCode: failure.statusCode,
        attemptCount: retryUpdate.finalData.disconnectAttemptCount,
      });
      return false;
    }

    logger.error('[ServiceDisconnectPending] Pending disconnect requires manual review', {
      userID,
      serviceName,
      tokenID: failure.tokenID,
      statusCode: failure.statusCode,
      attemptCount: retryUpdate.finalData.disconnectAttemptCount,
      retryExpiresAt: timestampToISOString(retryUpdate.finalData.disconnectRetryExpiresAt),
    });
  }
  return true;
}

export async function resumeServiceDisconnectRetryAfterRecoveryFailure(
  userID: string,
  serviceName: ServiceNames,
  failure: PendingServiceDisconnectFailure,
  nowMs = Date.now(),
): Promise<boolean> {
  const db = admin.firestore();
  const rootRef = getServiceTokenRootDocumentRef(userID, serviceName);

  const rootData = await db.runTransaction(async (transaction) => {
    if (await shouldSkipPendingDisconnectWrite(db, transaction, userID, serviceName, 'recovery_retry_resume')) {
      return null;
    }

    const snapshot = await transaction.get(rootRef);
    const existing = snapshot.exists ? snapshot.data() as PendingServiceDisconnectRootData : {};
    const nextData = buildPendingDisconnectRecoveryRetryData(existing, failure, nowMs);

    transaction.set(rootRef, nextData, { merge: true });
    return nextData;
  });

  if (!rootData) {
    return false;
  }

  await mirrorServiceDisconnectPendingToUserMeta(
    userID,
    serviceName,
    buildPendingDisconnectMetaInputFromRootData(rootData, nowMs),
  );
  return true;
}

async function restoreServiceDisconnectPendingAfterClearFailure(
  userID: string,
  serviceName: ServiceNames,
  pendingData: PendingServiceDisconnectRootData,
  originalError: unknown,
): Promise<void> {
  const db = admin.firestore();
  const rootRef = getServiceTokenRootDocumentRef(userID, serviceName);
  const restoredData = buildRestoredPendingDisconnectData(pendingData);

  const didRestoreRoot = await db.runTransaction(async (transaction) => {
    if (await shouldSkipPendingDisconnectWrite(db, transaction, userID, serviceName, 'restore_after_clear_failure')) {
      return false;
    }

    const snapshot = await transaction.get(rootRef);
    if (isServiceDisconnectPendingData(snapshot.exists ? snapshot.data() as PendingServiceDisconnectRootData : null)) {
      return false;
    }

    transaction.set(rootRef, restoredData, { merge: true });
    return true;
  });

  if (!didRestoreRoot) {
    return;
  }

  await mirrorServiceDisconnectPendingToUserMeta(
    userID,
    serviceName,
    buildPendingDisconnectMetaInputFromRootData(restoredData),
  );

  logger.error('[ServiceDisconnectPending] Restored pending disconnect after clear-side recovery failed.', {
    userID,
    serviceName,
    error: originalError instanceof Error ? originalError.message : `${originalError}`,
  });
}

export async function clearServiceDisconnectPending(
  userID: string,
  serviceName: ServiceNames,
): Promise<void> {
  const db = admin.firestore();
  const rootRef = getServiceTokenRootDocumentRef(userID, serviceName);

  const clearResult = await db.runTransaction(async (transaction) => {
    if (await shouldSkipPendingDisconnectWrite(db, transaction, userID, serviceName, 'clear')) {
      return { status: 'skipped' as const };
    }

    const snapshot = await transaction.get(rootRef);
    if (!snapshot.exists) {
      return { status: 'root_missing' as const };
    }

    const rootData = snapshot.data() as PendingServiceDisconnectRootData;
    const wasPending = isServiceDisconnectPendingData(rootData);
    transaction.set(rootRef, buildPendingDisconnectFieldDeletes(), { merge: true });

    return wasPending
      ? { status: 'pending_cleared' as const, pendingData: rootData }
      : { status: 'clear_only' as const };
  });

  if (clearResult.status === 'skipped') {
    return;
  }

  if (clearResult.status === 'root_missing') {
    await clearServiceConnectionState(userID, serviceName, {
      restorePendingDisconnectActivitySyncRoutes: true,
    });
    return;
  }

  try {
    await clearServiceConnectionState(userID, serviceName, {
      restorePendingDisconnectActivitySyncRoutes: true,
    });

    if (clearResult.status === 'pending_cleared') {
      await releaseQueueItemsDeferredForPendingDisconnect(userID, serviceName);
    }
  } catch (error) {
    if (clearResult.status === 'pending_cleared') {
      await restoreServiceDisconnectPendingAfterClearFailure(
        userID,
        serviceName,
        clearResult.pendingData,
        error,
      );
    }
    throw error;
  }
}
