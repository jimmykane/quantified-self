import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const hoisted = vi.hoisted(() => ({
  metaSet: vi.fn().mockResolvedValue(undefined),
  metaGet: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
  refreshTokenRef: { path: 'wahooAPIAccessTokens/user-1/tokens/provider-1' },
  refreshTokenGet: vi.fn(),
  disableActivitySyncRoutesForDisconnectedService: vi.fn().mockResolvedValue(undefined),
  restoreActivitySyncRoutesForPendingDisconnectClear: vi.fn().mockResolvedValue(undefined),
  releaseQueueItemsDeferredForReconnectRequired: vi.fn().mockResolvedValue(0),
  getUserDeletionGuardStateInTransaction: vi.fn().mockResolvedValue({
    userExists: true,
    deletionInProgress: false,
    shouldSkip: false,
  }),
  runTransaction: vi.fn(),
  fieldValueDelete: vi.fn(() => 'delete-sentinel'),
}));

vi.mock('firebase-functions/logger', () => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('./shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: hoisted.getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
    readonly name = 'UserDeletionGuardReadError';
    readonly code = 'unavailable';
    readonly statusCode = 503;

    constructor(
      public readonly uid: string,
      public readonly phase: string,
      public readonly originalError: unknown,
    ) {
      super(`Could not read deletion guard for user ${uid} during ${phase}.`);
    }
  },
}));

vi.mock('./activity-sync/route-cleanup', () => ({
  disableActivitySyncRoutesForDisconnectedService: hoisted.disableActivitySyncRoutesForDisconnectedService,
  restoreActivitySyncRoutesForPendingDisconnectClear: hoisted.restoreActivitySyncRoutesForPendingDisconnectClear,
}));

vi.mock('./queue/pending-disconnect-release', () => ({
  releaseQueueItemsDeferredForReconnectRequired: hoisted.releaseQueueItemsDeferredForReconnectRequired,
}));

vi.mock('firebase-admin', () => {
  const firestore = Object.assign(() => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
            set: hoisted.metaSet,
          })),
        })),
      })),
    })),
    runTransaction: hoisted.runTransaction,
  }), {});

  return {
    default: { firestore },
    firestore,
  };
});

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    delete: hoisted.fieldValueDelete,
  },
}));

import * as logger from 'firebase-functions/logger';
import {
  clearServiceConnectionState,
  markServiceConnected,
  markServiceReconnectRequired,
  mirrorServiceDisconnectPendingToUserMeta,
  recordWahooOpaqueRefreshFailure,
  setServiceConnectionProviderUserId,
  pinServiceConnectionProviderUserIdIfUnset,
} from './service-connection-meta';

function getCurrentWahooRefreshClaim() {
  return {
    tokenRef: hoisted.refreshTokenRef as any,
    leaseOwner: 'lease-1',
    credential: {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1_000,
      dateCreated: 100,
      dateRefreshed: 100,
      credentialGeneration: null,
    },
  };
}

describe('service-connection-meta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.runTransaction.mockImplementation(async (runner: (transaction: {
      set: typeof hoisted.metaSet;
      get: (target: unknown) => unknown;
    }) => unknown) => runner({
      set: hoisted.metaSet,
      get: (target: unknown) => target === hoisted.refreshTokenRef
        ? hoisted.refreshTokenGet()
        : hoisted.metaGet(),
    }));
    hoisted.metaGet.mockResolvedValue({ exists: false, data: () => undefined });
    hoisted.refreshTokenGet.mockResolvedValue({
      exists: true,
      data: () => ({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: 1_000,
        dateCreated: 100,
        dateRefreshed: 100,
        tokenRefreshLeaseOwner: 'lease-1',
      }),
    });
    hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
  });

  it('writes reconnect-required state when the user deletion guard allows it', async () => {
    await markServiceReconnectRequired('user-1', ServiceNames.SuuntoApp, 'invalid_grant', 'Reconnect required', 123);

    expect(hoisted.getUserDeletionGuardStateInTransaction).toHaveBeenCalled();
    expect(hoisted.metaSet).toHaveBeenCalledWith(expect.any(Object), {
      connectionState: 'reconnect_required',
      lastAuthFailureCode: 'invalid_grant',
      lastAuthFailureMessage: 'Reconnect required',
      lastDisconnectedAt: 123,
    }, { merge: true });
    expect(hoisted.disableActivitySyncRoutesForDisconnectedService).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
    );
  });

  it('does not fail reconnect-required writes when activity sync route disable fails', async () => {
    hoisted.disableActivitySyncRoutesForDisconnectedService.mockRejectedValueOnce(new Error('settings write failed'));

    await expect(markServiceReconnectRequired('user-1', ServiceNames.SuuntoApp, 'invalid_grant', 'Reconnect required', 123))
      .resolves.toBeUndefined();

    expect(hoisted.metaSet).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[ServiceConnectionMeta] Failed to disable activity sync routes for reconnect-required suuntoApp user user-1.',
      expect.any(Error),
    );
  });

  it('skips reconnect-required writes when user deletion is in progress', async () => {
    hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValue({
      userExists: true,
      deletionInProgress: true,
      shouldSkip: true,
    });

    await markServiceReconnectRequired('user-1', ServiceNames.SuuntoApp, 'invalid_grant', 'Reconnect required');

    expect(hoisted.metaSet).not.toHaveBeenCalled();
    expect(hoisted.disableActivitySyncRoutesForDisconnectedService).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[ServiceConnectionMeta] Skipping suuntoApp meta write for user user-1 because the user is missing or deletion is in progress.',
    );
  });

  it('skips connected-state writes when the user document is missing', async () => {
    hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValue({
      userExists: false,
      deletionInProgress: false,
      shouldSkip: true,
    });

    await expect(markServiceConnected('user-1', ServiceNames.SuuntoApp)).resolves.toBe(false);

    expect(hoisted.metaSet).not.toHaveBeenCalled();
  });

  it('returns true when connected-state write succeeds', async () => {
    await expect(markServiceConnected('user-1', ServiceNames.SuuntoApp)).resolves.toBe(true);

    expect(hoisted.metaSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      connectionState: 'connected',
      lastAuthFailureCode: 'delete-sentinel',
      lastAuthFailureMessage: 'delete-sentinel',
      lastDisconnectedAt: 'delete-sentinel',
      disconnectReason: 'delete-sentinel',
      disconnectAttemptCount: 'delete-sentinel',
      disconnectNextAttemptAt: 'delete-sentinel',
      disconnectLastAttemptAt: 'delete-sentinel',
      disconnectRetryExpiresAt: 'delete-sentinel',
      disconnectLastStatusCode: 'delete-sentinel',
      disconnectLastErrorMessage: 'delete-sentinel',
      disconnectManualReviewRequired: 'delete-sentinel',
      providerBindingState: 'delete-sentinel',
      providerBindingCheckedAt: 'delete-sentinel',
      providerBindingCheckLeaseId: 'delete-sentinel',
      providerBindingCheckLeaseExpiresAt: 'delete-sentinel',
      providerBindingCheckNextRetryAt: 'delete-sentinel',
    }), { merge: true });
  });

  it('keeps the first opaque Wahoo refresh failure retryable without disabling routes', async () => {
    await expect(recordWahooOpaqueRefreshFailure('user-1', getCurrentWahooRefreshClaim(), 1_000)).resolves.toEqual({
      failureCount: 1,
      retryAt: 301_000,
      reconnectRequired: false,
      stale: false,
    });

    expect(hoisted.metaSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      wahooRefreshFailureCount: 1,
      wahooRefreshFailureLastAt: 1_000,
      wahooRefreshRetryAt: 301_000,
      lastAuthFailureCode: 'wahoo_opaque_refresh_400',
      lastAuthFailureMessage: 'Wahoo could not refresh this connection. Retrying later.',
    }), { merge: true });
    expect(hoisted.disableActivitySyncRoutesForDisconnectedService).not.toHaveBeenCalled();
  });

  it('requires Wahoo reconnection after the opaque-refresh failure threshold without changing routes', async () => {
    hoisted.metaGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        wahooRefreshFailureCount: 2,
        wahooRefreshFailureLastAt: 1_000,
      }),
    });

    await expect(recordWahooOpaqueRefreshFailure('user-1', getCurrentWahooRefreshClaim(), 2_000)).resolves.toEqual({
      failureCount: 3,
      retryAt: null,
      reconnectRequired: true,
      stale: false,
    });

    expect(hoisted.metaSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      connectionState: 'reconnect_required',
      wahooRefreshFailureCount: 3,
      wahooRefreshRetryAt: null,
      lastAuthFailureMessage: 'Reconnect Wahoo to resume sync.',
    }), { merge: true });
    expect(hoisted.disableActivitySyncRoutesForDisconnectedService).not.toHaveBeenCalled();
  });

  it('does not let an old Wahoo refresh mark a reauthorized connection as failed', async () => {
    hoisted.refreshTokenGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        accessToken: 'reauthorized-access',
        refreshToken: 'reauthorized-refresh',
        expiresAt: 2_000,
        dateCreated: 200,
        dateRefreshed: 200,
        tokenCredentialGeneration: 'new-generation',
      }),
    });

    await expect(recordWahooOpaqueRefreshFailure('user-1', getCurrentWahooRefreshClaim(), 2_000)).resolves.toEqual({
      failureCount: 0,
      retryAt: null,
      reconnectRequired: false,
      stale: true,
    });

    expect(hoisted.metaSet).not.toHaveBeenCalled();
  });

  it('clears Wahoo recovery state and releases only reconnect-parked work after OAuth succeeds', async () => {
    await expect(markServiceConnected('user-1', ServiceNames.WahooAPI, 'provider-1')).resolves.toBe(true);

    expect(hoisted.metaSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      connectionState: 'connected',
      providerUserId: 'provider-1',
      wahooRefreshFailureCount: 'delete-sentinel',
      wahooRefreshFailureLastAt: 'delete-sentinel',
      wahooRefreshRetryAt: 'delete-sentinel',
    }), { merge: true });
    expect(hoisted.releaseQueueItemsDeferredForReconnectRequired).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.WahooAPI,
    );
  });

  it('stores a normalized provider account ID without changing connection state', async () => {
    await expect(setServiceConnectionProviderUserId('user-1', ServiceNames.WahooAPI, ' 60462 ')).resolves.toBe(true);

    expect(hoisted.metaSet).toHaveBeenCalledWith(expect.any(Object), {
      providerUserId: '60462',
    }, { merge: true });
  });

  it('does not write an empty provider account ID', async () => {
    await expect(setServiceConnectionProviderUserId('user-1', ServiceNames.WahooAPI, '   ')).resolves.toBe(false);

    expect(hoisted.metaSet).not.toHaveBeenCalled();
  });

  it('pins a legacy provider account only when no account is already selected', async () => {
    await expect(pinServiceConnectionProviderUserIdIfUnset(
      'user-1',
      ServiceNames.COROSAPI,
      ' open-old ',
    )).resolves.toBe('pinned');

    expect(hoisted.metaSet).toHaveBeenCalledWith(expect.any(Object), {
      providerUserId: 'open-old',
    }, { merge: true });
  });

  it('does not overwrite a provider account selected by a concurrent reconnect', async () => {
    hoisted.metaGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ providerUserId: 'open-new' }),
    });

    await expect(pinServiceConnectionProviderUserIdIfUnset(
      'user-1',
      ServiceNames.COROSAPI,
      'open-old',
    )).resolves.toBe('conflict');

    expect(hoisted.metaSet).not.toHaveBeenCalled();
  });

  it('skips clear-state writes when user deletion is in progress', async () => {
    hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValue({
      userExists: true,
      deletionInProgress: true,
      shouldSkip: true,
    });

    await clearServiceConnectionState('user-1', ServiceNames.SuuntoApp);

    expect(hoisted.metaSet).not.toHaveBeenCalled();
  });

  it('removes the provider account ID when a service is disconnected', async () => {
    await clearServiceConnectionState('user-1', ServiceNames.WahooAPI);

    expect(hoisted.metaSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      providerUserId: 'delete-sentinel',
      providerBindingState: 'delete-sentinel',
      providerBindingCheckedAt: 'delete-sentinel',
      providerBindingCheckLeaseId: 'delete-sentinel',
      providerBindingCheckLeaseExpiresAt: 'delete-sentinel',
      providerBindingCheckNextRetryAt: 'delete-sentinel',
    }), { merge: true });
  });

  it('tracks route restore state when mirroring pending disconnect metadata', async () => {
    await mirrorServiceDisconnectPendingToUserMeta('user-1', ServiceNames.SuuntoApp, {
      reason: 'subscription_enforcement',
      attemptCount: 0,
      nextAttemptAt: 'next-attempt',
      retryExpiresAt: 'expires-at',
      manualReviewRequired: false,
    });

    expect(hoisted.disableActivitySyncRoutesForDisconnectedService).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      { trackPendingDisconnectRestore: true },
    );
  });

  it('restores pending-disconnect activity sync routes when requested after clearing state', async () => {
    await clearServiceConnectionState('user-1', ServiceNames.SuuntoApp, {
      restorePendingDisconnectActivitySyncRoutes: true,
    });

    expect(hoisted.restoreActivitySyncRoutesForPendingDisconnectClear).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
    );
  });
});
