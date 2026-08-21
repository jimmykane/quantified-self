import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  getServiceTokenRootDocumentRef,
} from './service-token-store';
import {
  clearServiceConnectionState,
  mirrorServiceDisconnectPendingToUserMeta,
} from './service-connection-meta';
import {
  SERVICE_CONNECTION_STATES,
  type ServiceConnectionMetaFields,
} from '../../shared/service-connection';
import {
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from './shared/user-deletion-guard';
import type { DocumentGenerationGuard } from './token-refresh-coordinator';
import { releaseQueueItemsDeferredForPendingDisconnect } from './queue/pending-disconnect-release';
import {
  buildPendingDisconnectMarkState,
  buildPendingDisconnectMetaInputFromRootData,
  buildPendingDisconnectRecoveryRetryData,
  buildPendingDisconnectRetryFailureTransition,
  buildRestoredPendingDisconnectData,
  doesRootMatchServiceDisconnectLifecycleGuard,
  getServiceDisconnectLifecycleGuardFromRootData,
  isServiceDisconnectPendingData,
  SERVICE_DISCONNECT_PENDING_REASON,
  timestampToISOString,
  type PendingServiceDisconnectFailure,
  type PendingServiceDisconnectRootData,
  type ServiceDisconnectLifecycleGuard,
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
  ServiceDisconnectLifecycleGuard,
  ServiceDisconnectPendingReason,
} from './service-disconnect-pending-state';

export { getServiceDisconnectLifecycleGuardFromRootData } from './service-disconnect-pending-state';

function buildPendingDisconnectDataFromServiceMeta(
  data: ServiceConnectionMetaFields | undefined,
): PendingServiceDisconnectRootData | null {
  if (data?.connectionState !== SERVICE_CONNECTION_STATES.DisconnectPending) {
    return null;
  }

  return {
    disconnectGeneration: data.disconnectGeneration || data.connectionStateGeneration || null,
    disconnectState: SERVICE_CONNECTION_STATES.DisconnectPending,
    disconnectReason: data.disconnectReason || null,
    disconnectAttemptCount: data.disconnectAttemptCount ?? null,
    disconnectNextAttemptAt: data.disconnectNextAttemptAt as PendingServiceDisconnectRootData['disconnectNextAttemptAt'],
    disconnectLastAttemptAt: data.disconnectLastAttemptAt as PendingServiceDisconnectRootData['disconnectLastAttemptAt'],
    disconnectRetryExpiresAt: data.disconnectRetryExpiresAt as PendingServiceDisconnectRootData['disconnectRetryExpiresAt'],
    disconnectLastStatusCode: data.disconnectLastStatusCode ?? null,
    disconnectLastErrorMessage: data.disconnectLastErrorMessage || null,
    disconnectManualReviewRequired: data.disconnectManualReviewRequired === true,
  };
}

function withPendingDisconnectGeneration(
  data: PendingServiceDisconnectRootData,
  existing: PendingServiceDisconnectRootData,
): PendingServiceDisconnectRootData {
  const existingGeneration = isServiceDisconnectPendingData(existing)
    ? `${existing.disconnectGeneration || ''}`.trim()
    : '';
  return {
    ...data,
    disconnectGeneration: existingGeneration || crypto.randomUUID(),
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

async function isExpectedOAuthCredentialGenerationCurrent(
  transaction: admin.firestore.Transaction,
  expectedOAuthCredentialGeneration?: DocumentGenerationGuard,
): Promise<boolean> {
  if (!expectedOAuthCredentialGeneration) return true;
  const generationSnapshot = await transaction.get(expectedOAuthCredentialGeneration.documentRef);
  return generationSnapshot.exists
    && (generationSnapshot.data()?.[expectedOAuthCredentialGeneration.fieldName] ?? null)
      === expectedOAuthCredentialGeneration.expectedGeneration;
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
    if (!doesRootMatchServiceDisconnectLifecycleGuard(
      snapshot.exists ? snapshot.data() as Record<string, unknown> : null,
      failure.lifecycleGuard,
    )) {
      return null;
    }
    const nextState = buildPendingDisconnectMarkState(existing, failure, reason, nowMs);
    const rootData = withPendingDisconnectGeneration(nextState.rootData, existing);

    transaction.set(rootRef, rootData, { merge: true });
    return rootData;
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
    if (!doesRootMatchServiceDisconnectLifecycleGuard(
      snapshot.exists ? snapshot.data() as Record<string, unknown> : null,
      failure.lifecycleGuard,
    )) {
      return null;
    }
    const nextTransition = buildPendingDisconnectRetryFailureTransition(existing, failure, nowMs);
    nextTransition.rootData = withPendingDisconnectGeneration(nextTransition.rootData, existing);
    nextTransition.finalData = {
      ...nextTransition.finalData,
      disconnectGeneration: nextTransition.rootData.disconnectGeneration,
    };

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
      if (!doesRootMatchServiceDisconnectLifecycleGuard(
        snapshot.data() as Record<string, unknown>,
        failure.lifecycleGuard,
      )) {
        return false;
      }
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
    if (!doesRootMatchServiceDisconnectLifecycleGuard(
      snapshot.exists ? snapshot.data() as Record<string, unknown> : null,
      failure.lifecycleGuard,
    )) {
      return null;
    }
    const nextData = withPendingDisconnectGeneration(
      buildPendingDisconnectRecoveryRetryData(existing, failure, nowMs),
      existing,
    );

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
  expectedPostClearLifecycleGuard: ServiceDisconnectLifecycleGuard,
): Promise<void> {
  const db = admin.firestore();
  const rootRef = getServiceTokenRootDocumentRef(userID, serviceName);
  const restoredData = withPendingDisconnectGeneration(
    buildRestoredPendingDisconnectData(pendingData),
    pendingData,
  );

  const didRestoreRoot = await db.runTransaction(async (transaction) => {
    if (await shouldSkipPendingDisconnectWrite(db, transaction, userID, serviceName, 'restore_after_clear_failure')) {
      return false;
    }
    const snapshot = await transaction.get(rootRef);
    if (!doesRootMatchServiceDisconnectLifecycleGuard(
      snapshot.exists ? snapshot.data() as Record<string, unknown> : null,
      expectedPostClearLifecycleGuard,
    )) {
      return false;
    }
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
  expectedOAuthCredentialGeneration?: DocumentGenerationGuard,
  expectedOAuthFlowGeneration?: DocumentGenerationGuard,
): Promise<void> {
  const db = admin.firestore();
  const rootRef = getServiceTokenRootDocumentRef(userID, serviceName);
  const serviceMetaRef = db.collection('users').doc(userID).collection('meta').doc(serviceName);

  const clearResult = await db.runTransaction(async (transaction) => {
    if (await shouldSkipPendingDisconnectWrite(db, transaction, userID, serviceName, 'clear')) {
      return { status: 'skipped' as const };
    }
    if (
      !(await isExpectedOAuthCredentialGenerationCurrent(transaction, expectedOAuthCredentialGeneration))
      || !(await isExpectedOAuthCredentialGenerationCurrent(transaction, expectedOAuthFlowGeneration))
    ) {
      return { status: 'stale_credential' as const };
    }

    const snapshot = await transaction.get(rootRef);
    const rootData = snapshot.exists
      ? snapshot.data() as PendingServiceDisconnectRootData
      : null;
    let pendingData = isServiceDisconnectPendingData(rootData) ? rootData : null;

    // A previous OAuth callback may have cleared the root fields and then lost
    // its credential-generation race before clearing metadata or releasing the
    // parked queue rows. The winning callback must recover that generation
    // from the still-authoritative user metadata instead of stranding work.
    if (!pendingData) {
      const metaSnapshot = await transaction.get(serviceMetaRef);
      pendingData = buildPendingDisconnectDataFromServiceMeta(
        metaSnapshot.data() as ServiceConnectionMetaFields | undefined,
      );
    }

    const lifecycleGuard = getServiceDisconnectLifecycleGuardFromRootData(
      snapshot.exists ? snapshot.data() as Record<string, unknown> : null,
    );

    if (pendingData) {
      return { status: 'pending_found' as const, pendingData, lifecycleGuard };
    }
    return { status: 'no_pending' as const };
  });

  if (
    clearResult.status === 'skipped'
    || clearResult.status === 'stale_credential'
    || clearResult.status === 'no_pending'
  ) {
    return;
  }

  try {
    const pendingDisconnectGeneration = clearResult.status === 'pending_found'
      ? `${clearResult.pendingData.disconnectGeneration || ''}`.trim() || undefined
      : undefined;
    const didClearConnectionState = await clearServiceConnectionState(userID, serviceName, {
      restorePendingDisconnectActivitySyncRoutes: true,
      clearPendingDisconnectRoot: true,
      expectedDisconnectLifecycleGuard: clearResult.lifecycleGuard,
      ...(expectedOAuthCredentialGeneration ? {
        expectedTokenCredentialGeneration: expectedOAuthCredentialGeneration,
      } : {}),
      ...(expectedOAuthFlowGeneration ? {
        expectedOAuthFlowGeneration,
      } : {}),
      ...(pendingDisconnectGeneration ? {
        expectedPendingDisconnectGeneration: pendingDisconnectGeneration,
      } : {}),
    });
    if (!didClearConnectionState) {
      return;
    }

    if (clearResult.status === 'pending_found') {
      await releaseQueueItemsDeferredForPendingDisconnect(
        userID,
        serviceName,
        pendingDisconnectGeneration,
      );
    }
  } catch (error) {
    if (clearResult.status === 'pending_found') {
      await restoreServiceDisconnectPendingAfterClearFailure(
        userID,
        serviceName,
        clearResult.pendingData,
        error,
        {
          ...clearResult.lifecycleGuard,
          disconnectGeneration: null,
        },
      );
    }
    throw error;
  }
}
