import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SERVICE_CONNECTION_STATES } from '../../shared/service-connection';
import { getServiceTokenRootDocumentRef } from './service-token-store';
import {
  clearServiceConnectionState,
  mirrorServiceDisconnectPendingToUserMeta,
} from './service-connection-meta';

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

export async function markServiceDisconnectPending(
  userID: string,
  serviceName: ServiceNames,
  failure: PendingServiceDisconnectFailure,
  reason: ServiceDisconnectPendingReason = SERVICE_DISCONNECT_PENDING_REASON.SubscriptionEnforcement,
  nowMs = Date.now(),
): Promise<void> {
  const rootRef = getServiceTokenRootDocumentRef(userID, serviceName);
  const nowTimestamp = admin.firestore.Timestamp.fromMillis(nowMs);
  const initialNextAttemptAt = buildPendingServiceDisconnectNextAttemptAt(0, nowMs);
  const initialRetryExpiresAt = buildRetryWindowExpiresAt(nowMs);

  const rootData = await admin.firestore().runTransaction(async (transaction) => {
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
}

export async function recordServiceDisconnectRetryFailure(
  userID: string,
  serviceName: ServiceNames,
  failure: PendingServiceDisconnectFailure,
  nowMs = Date.now(),
): Promise<void> {
  const rootRef = getServiceTokenRootDocumentRef(userID, serviceName);
  const nowTimestamp = admin.firestore.Timestamp.fromMillis(nowMs);

  const rootData = await admin.firestore().runTransaction(async (transaction) => {
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
}

export async function clearServiceDisconnectPending(
  userID: string,
  serviceName: ServiceNames,
): Promise<void> {
  const rootRef = getServiceTokenRootDocumentRef(userID, serviceName);
  const snapshot = await rootRef.get();
  if (snapshot.exists) {
    await rootRef.set(buildPendingDisconnectFieldDeletes(), { merge: true });
  }
  await clearServiceConnectionState(userID, serviceName);
}
