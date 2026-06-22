import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SERVICE_CONNECTION_STATES } from '../../shared/service-connection';
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

export const SERVICE_DISCONNECT_PENDING_REASON = {
  SubscriptionEnforcement: 'subscription_enforcement',
} as const;

export type ServiceDisconnectPendingReason = typeof SERVICE_DISCONNECT_PENDING_REASON[keyof typeof SERVICE_DISCONNECT_PENDING_REASON];

export interface PendingServiceDisconnectFailure {
  tokenID: string;
  statusCode: number | null;
  errorMessage: string;
}

export interface PendingServiceDisconnectRootData {
  disconnectState?: string | null;
  disconnectReason?: string | null;
  disconnectAttemptCount?: number | null;
  disconnectNextAttemptAt?: admin.firestore.Timestamp | null;
  disconnectLastAttemptAt?: admin.firestore.Timestamp | null;
  disconnectRetryExpiresAt?: admin.firestore.Timestamp | null;
  disconnectLastStatusCode?: number | null;
  disconnectLastErrorMessage?: string | null;
  disconnectManualReviewRequired?: boolean | null;
}

export const PENDING_SERVICE_DISCONNECT_MAX_ATTEMPTS = 10;
export const PENDING_SERVICE_DISCONNECT_RETRY_WINDOW_DAYS = 30;
export const PENDING_SERVICE_DISCONNECT_BATCH_LIMIT = 50;

const PENDING_SERVICE_DISCONNECT_BACKOFF_MS = [
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
];

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

function asTimestamp(value: admin.firestore.Timestamp | null | undefined, fallbackMs: number): admin.firestore.Timestamp {
  return value || admin.firestore.Timestamp.fromMillis(fallbackMs);
}

function buildRetryWindowExpiresAt(nowMs: number): admin.firestore.Timestamp {
  return admin.firestore.Timestamp.fromMillis(
    nowMs + PENDING_SERVICE_DISCONNECT_RETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
}

export function isServiceDisconnectPendingData(
  data: PendingServiceDisconnectRootData | null | undefined,
): boolean {
  return data?.disconnectState === SERVICE_CONNECTION_STATES.DisconnectPending;
}

export function isRetryableSubscriptionEnforcementDisconnectStatus(statusCode: number | null): boolean {
  return statusCode === null
    || statusCode === 408
    || statusCode === 429
    || (statusCode >= 500 && statusCode <= 599);
}

export function buildPendingServiceDisconnectNextAttemptAt(attemptCount: number, nowMs = Date.now()): admin.firestore.Timestamp {
  const backoffIndex = Math.min(
    Math.max(0, attemptCount),
    PENDING_SERVICE_DISCONNECT_BACKOFF_MS.length - 1,
  );
  return admin.firestore.Timestamp.fromMillis(nowMs + PENDING_SERVICE_DISCONNECT_BACKOFF_MS[backoffIndex]);
}

function normalizeErrorMessage(value: string | null | undefined): string | null {
  const trimmed = `${value || ''}`.trim();
  if (!trimmed) {
    return null;
  }
  return sanitizePendingServiceDisconnectErrorMessage(trimmed).slice(0, 500);
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

export function sanitizePendingServiceDisconnectErrorMessage(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(access_token|refresh_token|id_token|client_secret|authorization|token)=([^&\s]+)/gi, '$1=[redacted]')
    .replace(/\b(access_token|refresh_token|id_token|client_secret|authorization|token)["']?\s*:\s*["'][^"']+["']/gi, '$1: "[redacted]"');
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
  const nowTimestamp = admin.firestore.Timestamp.fromMillis(nowMs);
  const initialNextAttemptAt = buildPendingServiceDisconnectNextAttemptAt(0, nowMs);
  const initialRetryExpiresAt = buildRetryWindowExpiresAt(nowMs);

  const rootData = await db.runTransaction(async (transaction) => {
    if (await shouldSkipPendingDisconnectWrite(db, transaction, userID, serviceName, 'mark')) {
      return null;
    }

    const snapshot = await transaction.get(rootRef);
    const existing = snapshot.exists ? snapshot.data() as PendingServiceDisconnectRootData : {};
    const alreadyPending = isServiceDisconnectPendingData(existing);
    const attemptCount = alreadyPending && typeof existing.disconnectAttemptCount === 'number'
      ? existing.disconnectAttemptCount
      : 0;
    const nextAttemptAt = alreadyPending
      ? asTimestamp(existing.disconnectNextAttemptAt, initialNextAttemptAt.toMillis())
      : initialNextAttemptAt;
    const retryExpiresAt = alreadyPending
      ? asTimestamp(existing.disconnectRetryExpiresAt, initialRetryExpiresAt.toMillis())
      : initialRetryExpiresAt;

    const nextData: PendingServiceDisconnectRootData = {
      disconnectState: SERVICE_CONNECTION_STATES.DisconnectPending,
      disconnectReason: reason,
      disconnectAttemptCount: attemptCount,
      disconnectNextAttemptAt: nextAttemptAt,
      disconnectLastAttemptAt: existing.disconnectLastAttemptAt || nowTimestamp,
      disconnectRetryExpiresAt: retryExpiresAt,
      disconnectLastStatusCode: failure.statusCode,
      disconnectLastErrorMessage: normalizeErrorMessage(failure.errorMessage),
      disconnectManualReviewRequired: existing.disconnectManualReviewRequired === true,
    };

    transaction.set(rootRef, nextData, { merge: true });
    return nextData;
  });

  if (!rootData) {
    return false;
  }

  await mirrorServiceDisconnectPendingToUserMeta(userID, serviceName, {
    reason: rootData.disconnectReason || reason,
    attemptCount: rootData.disconnectAttemptCount || 0,
    nextAttemptAt: rootData.disconnectNextAttemptAt || initialNextAttemptAt,
    lastAttemptAt: rootData.disconnectLastAttemptAt || nowTimestamp,
    retryExpiresAt: rootData.disconnectRetryExpiresAt || initialRetryExpiresAt,
    lastStatusCode: rootData.disconnectLastStatusCode ?? null,
    lastErrorMessage: rootData.disconnectLastErrorMessage || null,
    manualReviewRequired: rootData.disconnectManualReviewRequired === true,
  });
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
  const nowTimestamp = admin.firestore.Timestamp.fromMillis(nowMs);

  const rootData = await db.runTransaction(async (transaction) => {
    if (await shouldSkipPendingDisconnectWrite(db, transaction, userID, serviceName, 'retry_failure')) {
      return null;
    }

    const snapshot = await transaction.get(rootRef);
    const existing = snapshot.exists ? snapshot.data() as PendingServiceDisconnectRootData : {};
    const previousAttemptCount = typeof existing.disconnectAttemptCount === 'number'
      ? existing.disconnectAttemptCount
      : 0;
    const nextAttemptCount = previousAttemptCount + 1;
    const retryExpiresAt = asTimestamp(existing.disconnectRetryExpiresAt, buildRetryWindowExpiresAt(nowMs).toMillis());
    const retryWindowExpired = retryExpiresAt.toMillis() <= nowMs;
    const manualReviewRequired = nextAttemptCount >= PENDING_SERVICE_DISCONNECT_MAX_ATTEMPTS || retryWindowExpired;
    const nextAttemptAt = manualReviewRequired
      ? null
      : buildPendingServiceDisconnectNextAttemptAt(nextAttemptCount, nowMs);

    const nextData: PendingServiceDisconnectRootData = {
      disconnectState: SERVICE_CONNECTION_STATES.DisconnectPending,
      disconnectReason: existing.disconnectReason || SERVICE_DISCONNECT_PENDING_REASON.SubscriptionEnforcement,
      disconnectAttemptCount: nextAttemptCount,
      disconnectNextAttemptAt: nextAttemptAt,
      disconnectLastAttemptAt: nowTimestamp,
      disconnectRetryExpiresAt: retryExpiresAt,
      disconnectLastStatusCode: failure.statusCode,
      disconnectLastErrorMessage: normalizeErrorMessage(failure.errorMessage),
      disconnectManualReviewRequired: manualReviewRequired,
    };

    transaction.set(rootRef, nextData, { merge: true });
    return nextData;
  });

  if (!rootData) {
    return false;
  }

  await mirrorServiceDisconnectPendingToUserMeta(userID, serviceName, {
    reason: rootData.disconnectReason || SERVICE_DISCONNECT_PENDING_REASON.SubscriptionEnforcement,
    attemptCount: rootData.disconnectAttemptCount || 0,
    nextAttemptAt: rootData.disconnectNextAttemptAt || null,
    lastAttemptAt: rootData.disconnectLastAttemptAt || nowTimestamp,
    retryExpiresAt: rootData.disconnectRetryExpiresAt || buildRetryWindowExpiresAt(nowMs),
    lastStatusCode: rootData.disconnectLastStatusCode ?? null,
    lastErrorMessage: rootData.disconnectLastErrorMessage || null,
    manualReviewRequired: rootData.disconnectManualReviewRequired === true,
  });

  if (rootData.disconnectManualReviewRequired) {
    logger.error('[ServiceDisconnectPending] Pending disconnect requires manual review', {
      userID,
      serviceName,
      tokenID: failure.tokenID,
      statusCode: failure.statusCode,
      attemptCount: rootData.disconnectAttemptCount,
      retryExpiresAt: rootData.disconnectRetryExpiresAt?.toDate().toISOString(),
    });
  }
  return true;
}

export async function clearServiceDisconnectPending(
  userID: string,
  serviceName: ServiceNames,
): Promise<void> {
  const db = admin.firestore();
  const rootRef = getServiceTokenRootDocumentRef(userID, serviceName);

  const releaseReadiness = await db.runTransaction(async (transaction) => {
    if (await shouldSkipPendingDisconnectWrite(db, transaction, userID, serviceName, 'clear')) {
      return 'skipped' as const;
    }

    const snapshot = await transaction.get(rootRef);
    if (!snapshot.exists) {
      return 'root_missing' as const;
    }

    return isServiceDisconnectPendingData(snapshot.data() as PendingServiceDisconnectRootData)
      ? 'release_required' as const
      : 'clear_only' as const;
  });

  if (releaseReadiness === 'skipped') {
    return;
  }

  if (releaseReadiness === 'root_missing') {
    await clearServiceConnectionState(userID, serviceName, {
      restorePendingDisconnectActivitySyncRoutes: true,
    });
    return;
  }

  if (releaseReadiness === 'release_required') {
    await releaseQueueItemsDeferredForPendingDisconnect(userID, serviceName);
  }

  const clearResult = await db.runTransaction(async (transaction) => {
    if (await shouldSkipPendingDisconnectWrite(db, transaction, userID, serviceName, 'clear')) {
      return 'skipped' as const;
    }

    const snapshot = await transaction.get(rootRef);
    if (!snapshot.exists) {
      return 'root_missing' as const;
    }

    transaction.set(rootRef, buildPendingDisconnectFieldDeletes(), { merge: true });
    return 'cleared' as const;
  });

  if (clearResult === 'skipped') {
    return;
  }

  await clearServiceConnectionState(userID, serviceName, {
    restorePendingDisconnectActivitySyncRoutes: true,
  });
}
