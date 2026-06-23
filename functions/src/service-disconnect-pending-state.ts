import * as admin from 'firebase-admin';
import { SERVICE_CONNECTION_STATES } from '../../shared/service-connection';
import type { ServiceDisconnectPendingMetaInput } from './service-connection-meta';

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

export interface PendingDisconnectMarkState {
  rootData: PendingServiceDisconnectRootData;
  initialNextAttemptAt: admin.firestore.Timestamp;
  initialRetryExpiresAt: admin.firestore.Timestamp;
  nowTimestamp: admin.firestore.Timestamp;
}

export interface PendingDisconnectRetryFailureTransition {
  rootData: PendingServiceDisconnectRootData;
  finalData: PendingServiceDisconnectRootData;
  manualReviewRequired: boolean;
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

function asTimestamp(value: admin.firestore.Timestamp | null | undefined, fallbackMs: number): admin.firestore.Timestamp {
  return value || admin.firestore.Timestamp.fromMillis(fallbackMs);
}

export function buildRetryWindowExpiresAt(nowMs: number): admin.firestore.Timestamp {
  return admin.firestore.Timestamp.fromMillis(
    nowMs + PENDING_SERVICE_DISCONNECT_RETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
}

export function timestampToISOString(value: admin.firestore.Timestamp | null | undefined): string | undefined {
  return typeof value?.toDate === 'function'
    ? value.toDate().toISOString()
    : undefined;
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

export function sanitizePendingServiceDisconnectErrorMessage(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(access_token|refresh_token|id_token|client_secret|authorization|token)=([^&\s]+)/gi, '$1=[redacted]')
    .replace(/\b(access_token|refresh_token|id_token|client_secret|authorization|token)["']?\s*:\s*["'][^"']+["']/gi, '$1: "[redacted]"');
}

export function normalizePendingServiceDisconnectErrorMessage(value: string | null | undefined): string | null {
  const trimmed = `${value || ''}`.trim();
  if (!trimmed) {
    return null;
  }
  return sanitizePendingServiceDisconnectErrorMessage(trimmed).slice(0, 500);
}

export function buildPendingDisconnectMetaInputFromRootData(
  data: PendingServiceDisconnectRootData,
  nowMs = Date.now(),
): ServiceDisconnectPendingMetaInput {
  return {
    reason: data.disconnectReason || SERVICE_DISCONNECT_PENDING_REASON.SubscriptionEnforcement,
    attemptCount: typeof data.disconnectAttemptCount === 'number' ? data.disconnectAttemptCount : 0,
    nextAttemptAt: data.disconnectNextAttemptAt || null,
    lastAttemptAt: data.disconnectLastAttemptAt || null,
    retryExpiresAt: data.disconnectRetryExpiresAt || buildRetryWindowExpiresAt(nowMs),
    lastStatusCode: data.disconnectLastStatusCode ?? null,
    lastErrorMessage: data.disconnectLastErrorMessage || null,
    manualReviewRequired: data.disconnectManualReviewRequired === true,
  };
}

export function buildRestoredPendingDisconnectData(
  data: PendingServiceDisconnectRootData,
  nowMs = Date.now(),
): PendingServiceDisconnectRootData {
  const attemptCount = typeof data.disconnectAttemptCount === 'number' ? data.disconnectAttemptCount : 0;
  const manualReviewRequired = data.disconnectManualReviewRequired === true;
  return {
    disconnectState: SERVICE_CONNECTION_STATES.DisconnectPending,
    disconnectReason: data.disconnectReason || SERVICE_DISCONNECT_PENDING_REASON.SubscriptionEnforcement,
    disconnectAttemptCount: attemptCount,
    disconnectNextAttemptAt: manualReviewRequired
      ? null
      : data.disconnectNextAttemptAt || buildPendingServiceDisconnectNextAttemptAt(attemptCount, nowMs),
    disconnectLastAttemptAt: data.disconnectLastAttemptAt || null,
    disconnectRetryExpiresAt: data.disconnectRetryExpiresAt || buildRetryWindowExpiresAt(nowMs),
    disconnectLastStatusCode: data.disconnectLastStatusCode ?? null,
    disconnectLastErrorMessage: data.disconnectLastErrorMessage || null,
    disconnectManualReviewRequired: manualReviewRequired,
  };
}

export function buildPendingDisconnectMarkState(
  existing: PendingServiceDisconnectRootData,
  failure: PendingServiceDisconnectFailure,
  reason: ServiceDisconnectPendingReason = SERVICE_DISCONNECT_PENDING_REASON.SubscriptionEnforcement,
  nowMs = Date.now(),
): PendingDisconnectMarkState {
  const nowTimestamp = admin.firestore.Timestamp.fromMillis(nowMs);
  const initialNextAttemptAt = buildPendingServiceDisconnectNextAttemptAt(0, nowMs);
  const initialRetryExpiresAt = buildRetryWindowExpiresAt(nowMs);
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

  return {
    rootData: {
      disconnectState: SERVICE_CONNECTION_STATES.DisconnectPending,
      disconnectReason: reason,
      disconnectAttemptCount: attemptCount,
      disconnectNextAttemptAt: nextAttemptAt,
      disconnectLastAttemptAt: existing.disconnectLastAttemptAt || nowTimestamp,
      disconnectRetryExpiresAt: retryExpiresAt,
      disconnectLastStatusCode: failure.statusCode,
      disconnectLastErrorMessage: normalizePendingServiceDisconnectErrorMessage(failure.errorMessage),
      disconnectManualReviewRequired: existing.disconnectManualReviewRequired === true,
    },
    initialNextAttemptAt,
    initialRetryExpiresAt,
    nowTimestamp,
  };
}

export function buildPendingDisconnectRetryFailureTransition(
  existing: PendingServiceDisconnectRootData,
  failure: PendingServiceDisconnectFailure,
  nowMs = Date.now(),
): PendingDisconnectRetryFailureTransition {
  const nowTimestamp = admin.firestore.Timestamp.fromMillis(nowMs);
  const previousAttemptCount = typeof existing.disconnectAttemptCount === 'number'
    ? existing.disconnectAttemptCount
    : 0;
  const nextAttemptCount = previousAttemptCount + 1;
  const retryExpiresAt = asTimestamp(existing.disconnectRetryExpiresAt, buildRetryWindowExpiresAt(nowMs).toMillis());
  const retryWindowExpired = retryExpiresAt.toMillis() <= nowMs;
  const manualReviewRequired = nextAttemptCount >= PENDING_SERVICE_DISCONNECT_MAX_ATTEMPTS || retryWindowExpired;
  const retryableNextAttemptAt = buildPendingServiceDisconnectNextAttemptAt(nextAttemptCount, nowMs);

  const rootData: PendingServiceDisconnectRootData = {
    disconnectState: SERVICE_CONNECTION_STATES.DisconnectPending,
    disconnectReason: existing.disconnectReason || SERVICE_DISCONNECT_PENDING_REASON.SubscriptionEnforcement,
    disconnectAttemptCount: nextAttemptCount,
    disconnectNextAttemptAt: retryableNextAttemptAt,
    disconnectLastAttemptAt: nowTimestamp,
    disconnectRetryExpiresAt: retryExpiresAt,
    disconnectLastStatusCode: failure.statusCode,
    disconnectLastErrorMessage: normalizePendingServiceDisconnectErrorMessage(failure.errorMessage),
    disconnectManualReviewRequired: false,
  };
  const finalData = manualReviewRequired
    ? {
      ...rootData,
      disconnectNextAttemptAt: null,
      disconnectManualReviewRequired: true,
    }
    : rootData;

  return {
    rootData,
    finalData,
    manualReviewRequired,
  };
}
