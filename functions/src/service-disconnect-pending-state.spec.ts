import * as admin from 'firebase-admin';
import { describe, expect, it, vi } from 'vitest';
import {
  buildPendingDisconnectMarkState,
  buildPendingDisconnectMetaInputFromRootData,
  buildPendingDisconnectRecoveryRetryData,
  buildPendingDisconnectRetryFailureTransition,
  buildRestoredPendingDisconnectData,
  normalizePendingServiceDisconnectErrorMessage,
  sanitizePendingServiceDisconnectErrorMessage,
  SERVICE_DISCONNECT_PENDING_REASON,
  type PendingServiceDisconnectRootData,
} from './service-disconnect-pending-state';

vi.mock('firebase-admin', () => {
  const firestore = Object.assign(() => ({}), {
    Timestamp: {
      fromMillis: (value: number) => ({
        toMillis: () => value,
        toDate: () => new Date(value),
      }),
    },
  });

  return {
    default: { firestore },
    firestore,
  };
});

const NOW_MS = Date.UTC(2026, 0, 2, 3, 4, 5);
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function timestamp(value: number): admin.firestore.Timestamp {
  return admin.firestore.Timestamp.fromMillis(value);
}

function toMillis(value: admin.firestore.Timestamp | null | undefined): number | null | undefined {
  return value?.toMillis();
}

describe('service-disconnect-pending-state', () => {
  it('builds first pending mark data', () => {
    const state = buildPendingDisconnectMarkState(
      {},
      { tokenID: 'token-1', statusCode: 504, errorMessage: 'gateway timeout' },
      SERVICE_DISCONNECT_PENDING_REASON.SubscriptionEnforcement,
      NOW_MS,
    );

    expect(state.rootData).toMatchObject({
      disconnectState: 'disconnect_pending',
      disconnectReason: SERVICE_DISCONNECT_PENDING_REASON.SubscriptionEnforcement,
      disconnectAttemptCount: 0,
      disconnectLastStatusCode: 504,
      disconnectLastErrorMessage: 'gateway timeout',
      disconnectManualReviewRequired: false,
    });
    expect(toMillis(state.rootData.disconnectNextAttemptAt)).toBe(NOW_MS + 30 * MINUTE_MS);
    expect(toMillis(state.rootData.disconnectLastAttemptAt)).toBe(NOW_MS);
    expect(toMillis(state.rootData.disconnectRetryExpiresAt)).toBe(NOW_MS + 30 * DAY_MS);
    expect(toMillis(state.initialNextAttemptAt)).toBe(NOW_MS + 30 * MINUTE_MS);
    expect(toMillis(state.initialRetryExpiresAt)).toBe(NOW_MS + 30 * DAY_MS);
    expect(toMillis(state.nowTimestamp)).toBe(NOW_MS);
  });

  it('preserves existing pending mark scheduling and manual-review state', () => {
    const existingNextAttemptAt = timestamp(NOW_MS + 12_345);
    const existingLastAttemptAt = timestamp(NOW_MS - 12_345);
    const existingRetryExpiresAt = timestamp(NOW_MS + 10 * DAY_MS);
    const existing: PendingServiceDisconnectRootData = {
      disconnectState: 'disconnect_pending',
      disconnectAttemptCount: 3,
      disconnectNextAttemptAt: existingNextAttemptAt,
      disconnectLastAttemptAt: existingLastAttemptAt,
      disconnectRetryExpiresAt: existingRetryExpiresAt,
      disconnectManualReviewRequired: true,
    };

    const state = buildPendingDisconnectMarkState(
      existing,
      { tokenID: 'token-1', statusCode: null, errorMessage: 'retry queued' },
      SERVICE_DISCONNECT_PENDING_REASON.SubscriptionEnforcement,
      NOW_MS,
    );

    expect(state.rootData).toMatchObject({
      disconnectAttemptCount: 3,
      disconnectLastStatusCode: null,
      disconnectLastErrorMessage: 'retry queued',
      disconnectManualReviewRequired: true,
    });
    expect(state.rootData.disconnectNextAttemptAt).toBe(existingNextAttemptAt);
    expect(state.rootData.disconnectLastAttemptAt).toBe(existingLastAttemptAt);
    expect(state.rootData.disconnectRetryExpiresAt).toBe(existingRetryExpiresAt);
  });

  it('builds retry failure data before manual review is required', () => {
    const retryExpiresAt = timestamp(NOW_MS + 5 * DAY_MS);
    const transition = buildPendingDisconnectRetryFailureTransition(
      {
        disconnectState: 'disconnect_pending',
        disconnectAttemptCount: 2,
        disconnectRetryExpiresAt: retryExpiresAt,
      },
      { tokenID: 'token-1', statusCode: 503, errorMessage: 'upstream unavailable' },
      NOW_MS,
    );

    expect(transition.manualReviewRequired).toBe(false);
    expect(transition.finalData).toBe(transition.rootData);
    expect(transition.rootData).toMatchObject({
      disconnectState: 'disconnect_pending',
      disconnectReason: SERVICE_DISCONNECT_PENDING_REASON.SubscriptionEnforcement,
      disconnectAttemptCount: 3,
      disconnectLastStatusCode: 503,
      disconnectLastErrorMessage: 'upstream unavailable',
      disconnectManualReviewRequired: false,
    });
    expect(toMillis(transition.rootData.disconnectNextAttemptAt)).toBe(NOW_MS + DAY_MS);
    expect(toMillis(transition.rootData.disconnectLastAttemptAt)).toBe(NOW_MS);
    expect(transition.rootData.disconnectRetryExpiresAt).toBe(retryExpiresAt);
  });

  it('builds fresh recovery retry data from a manual-review root', () => {
    const restored = buildPendingDisconnectRecoveryRetryData(
      {
        disconnectState: 'disconnect_pending',
        disconnectReason: SERVICE_DISCONNECT_PENDING_REASON.SubscriptionEnforcement,
        disconnectAttemptCount: 10,
        disconnectNextAttemptAt: null,
        disconnectRetryExpiresAt: timestamp(NOW_MS - DAY_MS),
        disconnectManualReviewRequired: true,
      },
      { tokenID: 'token-1', statusCode: 504, errorMessage: 'gateway timeout' },
      NOW_MS,
    );

    expect(restored).toMatchObject({
      disconnectState: 'disconnect_pending',
      disconnectReason: SERVICE_DISCONNECT_PENDING_REASON.SubscriptionEnforcement,
      disconnectAttemptCount: 0,
      disconnectLastStatusCode: 504,
      disconnectLastErrorMessage: 'gateway timeout',
      disconnectManualReviewRequired: false,
    });
    expect(toMillis(restored.disconnectNextAttemptAt)).toBe(NOW_MS + 30 * MINUTE_MS);
    expect(toMillis(restored.disconnectLastAttemptAt)).toBe(NOW_MS);
    expect(toMillis(restored.disconnectRetryExpiresAt)).toBe(NOW_MS + 30 * DAY_MS);
  });

  it('builds retry failure data at max attempts with terminal manual-review projection', () => {
    const transition = buildPendingDisconnectRetryFailureTransition(
      {
        disconnectState: 'disconnect_pending',
        disconnectAttemptCount: 9,
        disconnectRetryExpiresAt: timestamp(NOW_MS + DAY_MS),
      },
      { tokenID: 'token-1', statusCode: 504, errorMessage: 'gateway timeout' },
      NOW_MS,
    );

    expect(transition.manualReviewRequired).toBe(true);
    expect(transition.rootData.disconnectAttemptCount).toBe(10);
    expect(transition.rootData.disconnectManualReviewRequired).toBe(false);
    expect(toMillis(transition.rootData.disconnectNextAttemptAt)).toBe(NOW_MS + DAY_MS);
    expect(transition.finalData).toMatchObject({
      disconnectAttemptCount: 10,
      disconnectNextAttemptAt: null,
      disconnectManualReviewRequired: true,
    });
  });

  it('builds retry failure data after retry window expiry with terminal manual-review projection', () => {
    const transition = buildPendingDisconnectRetryFailureTransition(
      {
        disconnectState: 'disconnect_pending',
        disconnectAttemptCount: 1,
        disconnectRetryExpiresAt: timestamp(NOW_MS - 1),
      },
      { tokenID: 'token-1', statusCode: 429, errorMessage: 'rate limited' },
      NOW_MS,
    );

    expect(transition.manualReviewRequired).toBe(true);
    expect(transition.rootData.disconnectAttemptCount).toBe(2);
    expect(transition.rootData.disconnectManualReviewRequired).toBe(false);
    expect(toMillis(transition.rootData.disconnectNextAttemptAt)).toBe(NOW_MS + 6 * HOUR_MS);
    expect(transition.finalData.disconnectNextAttemptAt).toBeNull();
    expect(transition.finalData.disconnectManualReviewRequired).toBe(true);
  });

  it('projects pending root data to user meta input', () => {
    const nextAttemptAt = timestamp(NOW_MS + HOUR_MS);
    const lastAttemptAt = timestamp(NOW_MS - HOUR_MS);
    const retryExpiresAt = timestamp(NOW_MS + 2 * DAY_MS);

    expect(buildPendingDisconnectMetaInputFromRootData({
      disconnectReason: SERVICE_DISCONNECT_PENDING_REASON.SubscriptionEnforcement,
      disconnectAttemptCount: 4,
      disconnectNextAttemptAt: nextAttemptAt,
      disconnectLastAttemptAt: lastAttemptAt,
      disconnectRetryExpiresAt: retryExpiresAt,
      disconnectLastStatusCode: 429,
      disconnectLastErrorMessage: 'rate limited',
      disconnectManualReviewRequired: true,
    }, NOW_MS)).toEqual({
      reason: SERVICE_DISCONNECT_PENDING_REASON.SubscriptionEnforcement,
      attemptCount: 4,
      nextAttemptAt,
      lastAttemptAt,
      retryExpiresAt,
      lastStatusCode: 429,
      lastErrorMessage: 'rate limited',
      manualReviewRequired: true,
    });
  });

  it('builds restore-after-clear-failure data', () => {
    const lastAttemptAt = timestamp(NOW_MS - HOUR_MS);
    const restored = buildRestoredPendingDisconnectData({
      disconnectAttemptCount: 2,
      disconnectLastAttemptAt: lastAttemptAt,
      disconnectLastStatusCode: 500,
      disconnectLastErrorMessage: 'server error',
    }, NOW_MS);

    expect(restored).toMatchObject({
      disconnectState: 'disconnect_pending',
      disconnectReason: SERVICE_DISCONNECT_PENDING_REASON.SubscriptionEnforcement,
      disconnectAttemptCount: 2,
      disconnectLastAttemptAt: lastAttemptAt,
      disconnectLastStatusCode: 500,
      disconnectLastErrorMessage: 'server error',
      disconnectManualReviewRequired: false,
    });
    expect(toMillis(restored.disconnectNextAttemptAt)).toBe(NOW_MS + 6 * HOUR_MS);
    expect(toMillis(restored.disconnectRetryExpiresAt)).toBe(NOW_MS + 30 * DAY_MS);

    const manualReviewRetryExpiresAt = timestamp(NOW_MS + DAY_MS);
    const manualReviewRestore = buildRestoredPendingDisconnectData({
      disconnectManualReviewRequired: true,
      disconnectNextAttemptAt: timestamp(NOW_MS + HOUR_MS),
      disconnectRetryExpiresAt: manualReviewRetryExpiresAt,
    }, NOW_MS);

    expect(manualReviewRestore.disconnectNextAttemptAt).toBeNull();
    expect(manualReviewRestore.disconnectRetryExpiresAt).toBe(manualReviewRetryExpiresAt);
    expect(manualReviewRestore.disconnectManualReviewRequired).toBe(true);
  });

  it('sanitizes secrets and normalizes persisted error messages', () => {
    const sanitized = sanitizePendingServiceDisconnectErrorMessage([
      'request failed',
      'Bearer access-token-secret',
      'access_token=access-token-query',
      'refresh_token: "refresh-token-json"',
      'client_secret=client-secret-query',
    ].join(' '));

    expect(sanitized).toContain('Bearer [redacted]');
    expect(sanitized).toContain('access_token=[redacted]');
    expect(sanitized).toContain('refresh_token: "[redacted]"');
    expect(sanitized).toContain('client_secret=[redacted]');
    expect(sanitized).not.toContain('access-token-secret');
    expect(sanitized).not.toContain('access-token-query');
    expect(sanitized).not.toContain('refresh-token-json');
    expect(sanitized).not.toContain('client-secret-query');
    expect(normalizePendingServiceDisconnectErrorMessage('   ')).toBeNull();
    expect(normalizePendingServiceDisconnectErrorMessage(` ${'x'.repeat(600)} `)).toHaveLength(500);
  });
});
