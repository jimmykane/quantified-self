import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import type * as admin from 'firebase-admin';

const hoisted = vi.hoisted(() => ({
  metaSet: vi.fn().mockResolvedValue(undefined),
  metaGet: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
  refreshTokenRef: { path: 'wahooAPIAccessTokens/user-1/tokens/provider-1' },
  refreshTokenGet: vi.fn(),
  disableActivitySyncRoutesForDisconnectedService: vi.fn().mockResolvedValue(undefined),
  restoreActivitySyncRoutesForPendingDisconnectClear: vi.fn().mockResolvedValue(undefined),
  releaseQueueItemsDeferredForPendingDisconnect: vi.fn().mockResolvedValue(0),
  releaseQueueItemsDeferredForReconnectRequired: vi.fn().mockResolvedValue(0),
  releaseQueueItemsDeferredForRouteRestore: vi.fn().mockResolvedValue(0),
  getUserDeletionGuardStateInTransaction: vi.fn().mockResolvedValue({
    userExists: true,
    deletionInProgress: false,
    shouldSkip: false,
  }),
  runTransaction: vi.fn(),
  fieldValueDelete: vi.fn(() => 'delete-sentinel'),
  tokenRootRef: { path: 'wahooAPIAccessTokens/user-1' },
  tokenRootGet: vi.fn(),
  metaData: {} as Record<string, unknown>,
  updateHealthSyncState: vi.fn().mockResolvedValue(true),
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
  releaseQueueItemsDeferredForPendingDisconnect: hoisted.releaseQueueItemsDeferredForPendingDisconnect,
  releaseQueueItemsDeferredForReconnectRequired: hoisted.releaseQueueItemsDeferredForReconnectRequired,
}));

vi.mock('./queue/sync-route-eligibility', () => ({
  releaseQueueItemsDeferredForRouteRestore: hoisted.releaseQueueItemsDeferredForRouteRestore,
}));

vi.mock('./health/writer', () => ({
  updateHealthSyncState: hoisted.updateHealthSyncState,
}));

vi.mock('./service-token-store', () => ({
  OAUTH_FLOW_CREATED_AT_FIELD: 'oauthFlowCreatedAt',
  OAUTH_FLOW_EXPIRES_AT_FIELD: 'oauthFlowExpiresAt',
  OAUTH_FLOW_GENERATION_FIELD: 'oauthFlowGeneration',
  SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD: 'disconnectOperationGeneration',
  getServiceDisconnectOperationGeneration: (data: Record<string, unknown> | undefined) => {
    const generation = typeof data?.disconnectOperationGeneration === 'string'
      ? data.disconnectOperationGeneration.trim()
      : '';
    return generation || null;
  },
  getServiceTokenRootDocumentRef: () => ({
    ...hoisted.tokenRootRef,
    get: hoisted.tokenRootGet,
  }),
}));

vi.mock('firebase-admin', () => {
  const firestore = Object.assign(() => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            get: hoisted.metaGet,
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
  type MarkServiceReconnectRequiredOptions,
  markServiceConnected,
  markServiceReconnectRequired,
  mirrorServiceDisconnectPendingToUserMeta,
  recordWahooOpaqueRefreshFailure,
  beginPendingDisconnectQueueReleaseRepair,
  retryPendingHealthLifecycleProjection,
  retryPendingCOROSHealthLifecycleProjection,
  supersedePendingCOROSHealthLifecycleProjectionForTokenRootDelete,
  retryPendingDisconnectQueueRelease,
  retryPendingServiceRouteRestore,
  retryWahooReconnectQueueRelease,
  setServiceConnectionProviderUserId,
  pinServiceConnectionProviderUserIdIfUnset,
} from './service-connection-meta';

function getCurrentWahooRefreshClaim() {
  return {
    tokenRef: hoisted.refreshTokenRef as unknown as admin.firestore.DocumentReference,
    leaseOwner: 'lease-1',
    credential: {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1_000,
      dateCreated: 100,
      dateRefreshed: 100,
      credentialGeneration: null,
    },
    connectionStateGeneration: null,
  };
}

describe('service-connection-meta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.metaData = {};
    hoisted.metaSet.mockImplementation(async (_ref: unknown, data: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(data)) {
        if (value === 'delete-sentinel') delete hoisted.metaData[key];
        else hoisted.metaData[key] = value;
      }
    });
    hoisted.runTransaction.mockImplementation(async (runner: (transaction: {
      set: typeof hoisted.metaSet;
      get: (target: unknown) => unknown;
    }) => unknown) => runner({
      set: hoisted.metaSet,
      get: (target: unknown) => {
        if (target === hoisted.refreshTokenRef) return hoisted.refreshTokenGet();
        if ((target as { path?: string } | null)?.path === hoisted.tokenRootRef.path) {
          return hoisted.tokenRootGet();
        }
        return hoisted.metaGet();
      },
    }));
    hoisted.metaGet.mockImplementation(async () => ({
      exists: Object.keys(hoisted.metaData).length > 0,
      data: () => Object.keys(hoisted.metaData).length > 0 ? hoisted.metaData : undefined,
    }));
    hoisted.restoreActivitySyncRoutesForPendingDisconnectClear.mockImplementation(async (
      _userID: string,
      _serviceName: ServiceNames,
      options: { clearRouteRestoreMarker?: boolean },
    ) => {
      if (options.clearRouteRestoreMarker) {
        delete hoisted.metaData.routeRestorePending;
        delete hoisted.metaData.routeRestoreParkingClosed;
        delete hoisted.metaData.routeRestoreConnectionGeneration;
        delete hoisted.metaData.routeRestoreLastAttemptAt;
        delete hoisted.metaData.routeRestoreAttemptCount;
      }
    });
    hoisted.tokenRootGet.mockResolvedValue({ exists: false, data: () => undefined });
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
    expect(hoisted.metaSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      connectionState: 'reconnect_required',
      connectionStateGeneration: expect.any(String),
      lastAuthFailureCode: 'invalid_grant',
      lastAuthFailureMessage: 'Reconnect required',
      lastDisconnectedAt: 123,
    }), { merge: true });
    expect(hoisted.disableActivitySyncRoutesForDisconnectedService).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      expect.objectContaining({
        trackPendingDisconnectRestore: true,
        expectedConnectionStateGeneration: expect.any(String),
        requiredConnectionState: 'reconnect_required',
      }),
    );
  });

  it('mirrors COROS terminal auth and reconnect transitions to Health state', async () => {
    await expect(markServiceReconnectRequired(
      'user-1',
      ServiceNames.COROSAPI,
      'invalid_grant',
      'Reconnect required',
      123,
    )).resolves.toBe(true);

    const reconnectGeneration = hoisted.metaData.connectionStateGeneration;
    expect(reconnectGeneration).toEqual(expect.any(String));

    expect(hoisted.updateHealthSyncState).toHaveBeenCalledWith(
      'user-1',
      'COROSAPI',
      {
        status: 'reconnect_required',
        lastErrorCode: 'provider_auth_reconnect_required',
      },
      123,
      expect.objectContaining({
        authoritativeLifecycleTransition: true,
        requiredDocumentFieldValues: expect.objectContaining({
          expectedFields: {
            connectionState: 'reconnect_required',
            connectionStateGeneration: reconnectGeneration,
            healthLifecycleProjectionPending: true,
            healthLifecycleProjectionConnectionGeneration: reconnectGeneration,
            healthLifecycleProjectionTransitionAtMs: 123,
          },
        }),
      }),
    );
    expect(hoisted.metaData).not.toHaveProperty('healthLifecycleProjectionPending');

    hoisted.updateHealthSyncState.mockClear();
    await expect(markServiceConnected(
      'user-1',
      ServiceNames.COROSAPI,
      'coros-account',
    )).resolves.toBe(true);

    const connectedGeneration = hoisted.metaData.connectionStateGeneration;
    expect(connectedGeneration).toEqual(expect.any(String));
    expect(connectedGeneration).not.toBe(reconnectGeneration);

    expect(hoisted.updateHealthSyncState).toHaveBeenCalledWith(
      'user-1',
      'COROSAPI',
      {
        status: 'ready',
        lastErrorCode: null,
      },
      expect.any(Number),
      expect.objectContaining({
        authoritativeLifecycleTransition: true,
        requiredDocumentFieldValues: expect.objectContaining({
          expectedFields: {
            connectionState: 'connected',
            connectionStateGeneration: connectedGeneration,
            healthLifecycleProjectionPending: true,
            healthLifecycleProjectionConnectionGeneration: connectedGeneration,
            healthLifecycleProjectionTransitionAtMs: expect.any(Number),
          },
        }),
      }),
    );
    expect(hoisted.metaData).not.toHaveProperty('healthLifecycleProjectionPending');
  });

  it('does not create Health lifecycle state for providers outside this integration', async () => {
    await expect(markServiceConnected('user-1', ServiceNames.WahooAPI)).resolves.toBe(true);

    expect(hoisted.updateHealthSyncState).not.toHaveBeenCalled();
  });

  it('mirrors Garmin connection and terminal-auth transitions to Health state for every user', async () => {
    const garminUserID = 'garmin-health-user';

    await expect(markServiceConnected(
      garminUserID,
      ServiceNames.GarminAPI,
      'garmin-account',
    )).resolves.toBe(true);
    expect(hoisted.updateHealthSyncState).toHaveBeenCalledWith(
      garminUserID,
      'GarminAPI',
      { status: 'ready', lastErrorCode: null },
      expect.any(Number),
      expect.objectContaining({ authoritativeLifecycleTransition: true }),
    );
    expect(hoisted.metaData.providerUserId).toBe('garmin-account');

    hoisted.updateHealthSyncState.mockClear();
    await expect(markServiceReconnectRequired(
      garminUserID,
      ServiceNames.GarminAPI,
      'invalid_grant',
      'Reconnect required',
      123,
    )).resolves.toBe(true);
    expect(hoisted.updateHealthSyncState).toHaveBeenCalledWith(
      garminUserID,
      'GarminAPI',
      {
        status: 'reconnect_required',
        lastErrorCode: 'provider_auth_reconnect_required',
      },
      123,
      expect.objectContaining({ authoritativeLifecycleTransition: true }),
    );
  });

  it('mirrors Suunto connection and terminal-auth transitions to Health state', async () => {
    const healthUserID = 'suunto-health-user';

    await expect(markServiceConnected(healthUserID, ServiceNames.SuuntoApp)).resolves.toBe(true);
    expect(hoisted.updateHealthSyncState).toHaveBeenCalledWith(
      healthUserID,
      'SuuntoApp',
      { status: 'ready', lastErrorCode: null },
      expect.any(Number),
      expect.objectContaining({ authoritativeLifecycleTransition: true }),
    );
    expect(hoisted.metaData).not.toHaveProperty('healthLifecycleProjectionPending');

    hoisted.updateHealthSyncState.mockRejectedValueOnce(new Error('temporary health write failure'));
    await expect(markServiceReconnectRequired(
      healthUserID,
      ServiceNames.SuuntoApp,
      'invalid_grant',
      'Reconnect required',
      123,
    )).resolves.toBe(true);
    expect(hoisted.metaData.healthLifecycleProjectionPending).toBe(true);

    await expect(retryPendingHealthLifecycleProjection(
      healthUserID,
      ServiceNames.SuuntoApp,
    )).resolves.toBe(true);
    expect(hoisted.updateHealthSyncState).toHaveBeenLastCalledWith(
      healthUserID,
      'SuuntoApp',
      {
        status: 'reconnect_required',
        lastErrorCode: 'provider_auth_reconnect_required',
      },
      123,
      expect.objectContaining({ authoritativeLifecycleTransition: true }),
    );
    expect(hoisted.metaData).not.toHaveProperty('healthLifecycleProjectionPending');
  });

  it('repairs a pending Suunto Health projection for any connected user', async () => {
    hoisted.metaData = {
      connectionState: 'connected',
      connectionStateGeneration: 'connected-generation',
      healthLifecycleProjectionPending: true,
      healthLifecycleProjectionConnectionGeneration: 'connected-generation',
      healthLifecycleProjectionTransitionAtMs: 123,
    };

    await expect(retryPendingHealthLifecycleProjection(
      'user-1',
      ServiceNames.SuuntoApp,
    )).resolves.toBe(true);

    expect(hoisted.updateHealthSyncState).toHaveBeenCalledWith(
      'user-1',
      'SuuntoApp',
      { status: 'ready', lastErrorCode: null },
      123,
      expect.objectContaining({ authoritativeLifecycleTransition: true }),
    );
    expect(hoisted.metaData).not.toHaveProperty('healthLifecycleProjectionPending');
    expect(hoisted.metaData).not.toHaveProperty('healthLifecycleProjectionConnectionGeneration');
    expect(hoisted.metaData).not.toHaveProperty('healthLifecycleProjectionTransitionAtMs');
  });

  it('durably repairs a failed COROS Health lifecycle projection for the exact generation', async () => {
    hoisted.updateHealthSyncState.mockRejectedValueOnce(new Error('temporary health write failure'));

    await expect(markServiceReconnectRequired(
      'user-1',
      ServiceNames.COROSAPI,
      'invalid_grant',
      'Reconnect required',
      123,
    )).resolves.toBe(true);

    const generation = hoisted.metaData.connectionStateGeneration;
    expect(hoisted.metaData).toEqual(expect.objectContaining({
      healthLifecycleProjectionPending: true,
      healthLifecycleProjectionConnectionGeneration: generation,
      healthLifecycleProjectionTransitionAtMs: 123,
    }));
    expect(logger.error).toHaveBeenCalledWith(
      '[ServiceConnectionMeta] Failed to update provider Health lifecycle state.',
      { serviceName: ServiceNames.COROSAPI, errorName: 'Error' },
    );

    await expect(retryPendingCOROSHealthLifecycleProjection('user-1')).resolves.toBe(true);

    expect(hoisted.updateHealthSyncState).toHaveBeenLastCalledWith(
      'user-1',
      'COROSAPI',
      {
        status: 'reconnect_required',
        lastErrorCode: 'provider_auth_reconnect_required',
      },
      123,
      expect.objectContaining({
        authoritativeLifecycleTransition: true,
        requiredDocumentFieldValues: expect.objectContaining({
          expectedFields: {
            connectionState: 'reconnect_required',
            connectionStateGeneration: generation,
            healthLifecycleProjectionPending: true,
            healthLifecycleProjectionConnectionGeneration: generation,
            healthLifecycleProjectionTransitionAtMs: 123,
          },
        }),
      }),
    );
    expect(hoisted.metaData).not.toHaveProperty('healthLifecycleProjectionPending');
    expect(hoisted.metaData).not.toHaveProperty('healthLifecycleProjectionConnectionGeneration');
    expect(hoisted.metaData).not.toHaveProperty('healthLifecycleProjectionTransitionAtMs');
  });

  it('clears a superseded COROS Health projection marker without writing stale state', async () => {
    hoisted.metaData = {
      connectionState: 'connected',
      connectionStateGeneration: 'current-generation',
      healthLifecycleProjectionPending: true,
      healthLifecycleProjectionConnectionGeneration: 'stale-generation',
      healthLifecycleProjectionTransitionAtMs: 123,
    };

    await expect(retryPendingCOROSHealthLifecycleProjection('user-1')).resolves.toBe(false);

    expect(hoisted.updateHealthSyncState).not.toHaveBeenCalled();
    expect(hoisted.metaData).not.toHaveProperty('healthLifecycleProjectionPending');
    expect(hoisted.metaData.connectionStateGeneration).toBe('current-generation');
  });

  it('supersedes a connected COROS Health projection marker while the token root is absent', async () => {
    hoisted.metaData = {
      connectionState: 'connected',
      connectionStateGeneration: 'connected-generation',
      healthLifecycleProjectionPending: true,
      healthLifecycleProjectionConnectionGeneration: 'connected-generation',
      healthLifecycleProjectionTransitionAtMs: 123,
    };
    hoisted.tokenRootGet.mockResolvedValue({ exists: false, data: () => undefined });

    await expect(supersedePendingCOROSHealthLifecycleProjectionForTokenRootDelete(
      'user-1',
    )).resolves.toBe(true);

    expect(hoisted.metaData).not.toHaveProperty('healthLifecycleProjectionPending');
    expect(hoisted.metaData).not.toHaveProperty('healthLifecycleProjectionConnectionGeneration');
    expect(hoisted.metaData).not.toHaveProperty('healthLifecycleProjectionTransitionAtMs');

    hoisted.updateHealthSyncState.mockClear();
    await expect(retryPendingCOROSHealthLifecycleProjection('user-1')).resolves.toBe(false);
    expect(hoisted.updateHealthSyncState).not.toHaveBeenCalled();
  });

  it('does not supersede a COROS Health projection marker after the token root reconnects', async () => {
    hoisted.metaData = {
      connectionState: 'connected',
      connectionStateGeneration: 'connected-generation',
      healthLifecycleProjectionPending: true,
      healthLifecycleProjectionConnectionGeneration: 'connected-generation',
      healthLifecycleProjectionTransitionAtMs: 123,
    };
    hoisted.tokenRootGet.mockResolvedValue({ exists: true, data: () => ({}) });

    await expect(supersedePendingCOROSHealthLifecycleProjectionForTokenRootDelete(
      'user-1',
    )).resolves.toBe(false);

    expect(hoisted.metaData).toEqual(expect.objectContaining({
      healthLifecycleProjectionPending: true,
      healthLifecycleProjectionConnectionGeneration: 'connected-generation',
    }));
  });

  it('pins the retained provider account while marking reconnect-required', async () => {
    await expect(markServiceReconnectRequired(
      'user-1',
      ServiceNames.WahooAPI,
      'invalid_grant',
      'Reconnect required',
      123,
      { providerUserId: ' wahoo-account-a ' },
    )).resolves.toBe(true);

    expect(hoisted.metaSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      connectionState: 'reconnect_required',
      providerUserId: 'wahoo-account-a',
    }), { merge: true });
  });

  it('does not replace another pinned provider account while marking reconnect-required', async () => {
    hoisted.metaGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ providerUserId: 'wahoo-account-b' }),
    });

    await expect(markServiceReconnectRequired(
      'user-1',
      ServiceNames.WahooAPI,
      'invalid_grant',
      'Reconnect required',
      123,
      { providerUserId: 'wahoo-account-a' },
    )).resolves.toBe(false);

    expect(hoisted.metaSet).not.toHaveBeenCalled();
    expect(hoisted.disableActivitySyncRoutesForDisconnectedService).not.toHaveBeenCalled();
  });

  it('does not fail reconnect-required writes when activity sync route disable fails', async () => {
    hoisted.disableActivitySyncRoutesForDisconnectedService.mockRejectedValueOnce(new Error('settings write failed'));

    await expect(markServiceReconnectRequired('user-1', ServiceNames.SuuntoApp, 'invalid_grant', 'Reconnect required', 123))
      .resolves.toBe(true);

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
      '[ServiceConnectionMeta] Skipping suuntoApp reconnect-required transition for user user-1 because the user is missing or deletion is in progress.',
    );
  });

  it('does not let stale terminal cleanup overwrite a newer connection generation', async () => {
    hoisted.metaGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ connectionStateGeneration: 'oauth-generation' }),
    });

    await expect(markServiceReconnectRequired(
      'user-1',
      ServiceNames.WahooAPI,
      'invalid_grant',
      'Reconnect required',
      123,
      { expectedConnectionStateGeneration: 'failed-token-generation' },
    )).resolves.toBe(false);

    expect(hoisted.metaSet).not.toHaveBeenCalled();
    expect(hoisted.disableActivitySyncRoutesForDisconnectedService).not.toHaveBeenCalled();
  });

  it('does not let terminal cleanup overwrite a fresh OAuth credential', async () => {
    const tokenCollection = { path: 'wahooAPIAccessTokens/user-1/tokens' };
    hoisted.runTransaction.mockImplementationOnce(async (runner: (transaction: {
      set: typeof hoisted.metaSet;
      get: (target: unknown) => unknown;
    }) => unknown) => runner({
      set: hoisted.metaSet,
      get: (target: unknown) => target === tokenCollection
        ? Promise.resolve({ empty: false })
        : hoisted.metaGet(),
    }));

    await expect(markServiceReconnectRequired(
      'user-1',
      ServiceNames.WahooAPI,
      'invalid_grant',
      'Reconnect required',
      123,
      {
        expectedConnectionStateGeneration: null,
        requireEmptyTokenCollection: tokenCollection as unknown as NonNullable<
          MarkServiceReconnectRequiredOptions['requireEmptyTokenCollection']
        >,
      },
    )).resolves.toBe(false);

    expect(hoisted.metaSet).not.toHaveBeenCalled();
    expect(hoisted.disableActivitySyncRoutesForDisconnectedService).not.toHaveBeenCalled();
  });

  it('allows a pinned account failure when only unrelated legacy tokens remain', async () => {
    hoisted.refreshTokenGet.mockResolvedValueOnce({ exists: false, data: () => undefined });

    await expect(markServiceReconnectRequired(
      'user-1',
      ServiceNames.WahooAPI,
      'invalid_grant',
      'Reconnect required',
      123,
      {
        providerUserId: 'wahoo-account-a',
        requireMissingToken: hoisted.refreshTokenRef as unknown as admin.firestore.DocumentReference,
      },
    )).resolves.toBe(true);

    expect(hoisted.metaSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      connectionState: 'reconnect_required',
      providerUserId: 'wahoo-account-a',
    }), { merge: true });
  });

  it('does not mark reconnect-required after the failed account token was replaced', async () => {
    hoisted.refreshTokenGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });

    await expect(markServiceReconnectRequired(
      'user-1',
      ServiceNames.WahooAPI,
      'invalid_grant',
      'Reconnect required',
      123,
      {
        providerUserId: 'wahoo-account-a',
        requireMissingToken: hoisted.refreshTokenRef as unknown as admin.firestore.DocumentReference,
      },
    )).resolves.toBe(false);

    expect(hoisted.metaSet).not.toHaveBeenCalled();
    expect(hoisted.disableActivitySyncRoutesForDisconnectedService).not.toHaveBeenCalled();
  });

  it('does not let fallback cleanup cross a newer OAuth root generation', async () => {
    const tokenRoot = { path: 'wahooAPIAccessTokens/user-1' };
    hoisted.runTransaction.mockImplementationOnce(async (runner: (transaction: {
      set: typeof hoisted.metaSet;
      get: (target: unknown) => unknown;
    }) => unknown) => runner({
      set: hoisted.metaSet,
      get: (target: unknown) => target === tokenRoot
        ? Promise.resolve({
          exists: true,
          data: () => ({ activeOAuthCredentialGeneration: 'new-oauth-generation' }),
        })
        : hoisted.metaGet(),
    }));

    await expect(markServiceReconnectRequired(
      'user-1',
      ServiceNames.WahooAPI,
      'invalid_grant',
      'Reconnect required',
      123,
      {
        expectedTokenRootCredentialGeneration: {
          documentRef: tokenRoot as unknown as admin.firestore.DocumentReference,
          fieldName: 'activeOAuthCredentialGeneration',
          expectedGeneration: 'failed-generation',
        },
      },
    )).resolves.toBe(false);

    expect(hoisted.metaSet).not.toHaveBeenCalled();
    expect(hoisted.disableActivitySyncRoutesForDisconnectedService).not.toHaveBeenCalled();
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

  it('keeps the route-restore marker durable when parked queue reconciliation fails', async () => {
    hoisted.releaseQueueItemsDeferredForRouteRestore.mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(markServiceConnected('user-1', ServiceNames.SuuntoApp)).resolves.toBe(true);

    expect(hoisted.restoreActivitySyncRoutesForPendingDisconnectClear).toHaveBeenCalledTimes(1);
    expect(hoisted.restoreActivitySyncRoutesForPendingDisconnectClear).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      expect.objectContaining({ clearRouteRestoreMarker: false }),
    );
    expect(hoisted.metaSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      routeRestorePending: true,
    }), { merge: true });
  });

  it('does not run a route-restoration repair while explicit disconnect is active', async () => {
    hoisted.metaData = {
      connectionState: 'connected',
      connectionStateGeneration: 'connection-1',
      routeRestorePending: true,
      routeRestoreConnectionGeneration: 'connection-1',
    };
    hoisted.tokenRootGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        disconnectOperationGeneration: 'disconnect-operation-1',
        disconnectOperationLeaseExpiresAt: Date.now() + 60_000,
      }),
    });

    await expect(retryPendingServiceRouteRestore(
      'user-1',
      ServiceNames.WahooAPI,
    )).rejects.toThrow('disconnect is still active');

    expect(hoisted.restoreActivitySyncRoutesForPendingDisconnectClear).not.toHaveBeenCalled();
    expect(hoisted.releaseQueueItemsDeferredForRouteRestore).not.toHaveBeenCalled();
  });

  it('does not let a stale OAuth callback mark an older credential connected', async () => {
    hoisted.refreshTokenGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: 2_000,
        dateCreated: 200,
        dateRefreshed: 200,
        tokenCredentialGeneration: 'new-generation',
      }),
    });

    await expect(markServiceConnected(
      'user-1',
      ServiceNames.WahooAPI,
      'provider-1',
      {
        documentRef: hoisted.refreshTokenRef as unknown as admin.firestore.DocumentReference,
        fieldName: 'activeOAuthCredentialGeneration',
        expectedGeneration: 'old-generation',
      },
    )).resolves.toBe(false);

    expect(hoisted.metaSet).not.toHaveBeenCalled();
    expect(hoisted.releaseQueueItemsDeferredForReconnectRequired).not.toHaveBeenCalled();
  });

  it('allows the authorized credential generation to connect after an intervening token refresh', async () => {
    hoisted.refreshTokenGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        activeOAuthCredentialGeneration: 'oauth-generation',
      }),
    });

    await expect(markServiceConnected(
      'user-1',
      ServiceNames.WahooAPI,
      'provider-1',
      {
        documentRef: hoisted.refreshTokenRef as unknown as admin.firestore.DocumentReference,
        fieldName: 'activeOAuthCredentialGeneration',
        expectedGeneration: 'oauth-generation',
      },
    )).resolves.toBe(true);

    expect(hoisted.metaSet).toHaveBeenCalled();
  });

  it('consumes the exact OAuth flow generation in the connected-state transaction', async () => {
    hoisted.tokenRootGet.mockResolvedValue({
      exists: true,
      data: () => ({
        activeOAuthCredentialGeneration: 'credential-generation',
        oauthFlowGeneration: 'oauth-flow-generation',
      }),
    });

    await expect(markServiceConnected(
      'user-1',
      ServiceNames.SuuntoApp,
      null,
      {
        documentRef: hoisted.tokenRootRef as unknown as admin.firestore.DocumentReference,
        fieldName: 'activeOAuthCredentialGeneration',
        expectedGeneration: 'credential-generation',
      },
      {
        documentRef: hoisted.tokenRootRef as unknown as admin.firestore.DocumentReference,
        fieldName: 'oauthFlowGeneration',
        expectedGeneration: 'oauth-flow-generation',
      },
    )).resolves.toBe(true);

    expect(hoisted.metaSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: hoisted.tokenRootRef.path }),
      {
        oauthFlowGeneration: 'delete-sentinel',
        oauthFlowCreatedAt: 'delete-sentinel',
        oauthFlowExpiresAt: 'delete-sentinel',
      },
      { merge: true },
    );
  });

  it('does not promote an OAuth credential while its root remains disconnect pending', async () => {
    hoisted.tokenRootGet.mockResolvedValue({
      exists: true,
      data: () => ({
        activeOAuthCredentialGeneration: 'credential-generation',
        oauthFlowGeneration: 'oauth-flow-generation',
        disconnectState: 'disconnect_pending',
        disconnectGeneration: 'disconnect-generation',
      }),
    });

    await expect(markServiceConnected(
      'user-1',
      ServiceNames.SuuntoApp,
      null,
      {
        documentRef: hoisted.tokenRootRef as unknown as admin.firestore.DocumentReference,
        fieldName: 'activeOAuthCredentialGeneration',
        expectedGeneration: 'credential-generation',
      },
      {
        documentRef: hoisted.tokenRootRef as unknown as admin.firestore.DocumentReference,
        fieldName: 'oauthFlowGeneration',
        expectedGeneration: 'oauth-flow-generation',
      },
    )).resolves.toBe(false);

    expect(hoisted.metaSet).not.toHaveBeenCalled();
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
      connectionStateGeneration: expect.any(String),
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
      wahooReconnectReleasePending: true,
      wahooReconnectReleaseAttemptCount: 0,
    }), { merge: true });
    expect(hoisted.releaseQueueItemsDeferredForReconnectRequired).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.WahooAPI,
      expect.any(String),
    );
    expect(hoisted.restoreActivitySyncRoutesForPendingDisconnectClear).toHaveBeenNthCalledWith(
      1,
      'user-1',
      ServiceNames.WahooAPI,
      expect.objectContaining({ clearRouteRestoreMarker: false }),
    );
    expect(hoisted.restoreActivitySyncRoutesForPendingDisconnectClear).toHaveBeenNthCalledWith(
      2,
      'user-1',
      ServiceNames.WahooAPI,
      expect.objectContaining({ clearRouteRestoreMarker: true }),
    );
    const parkingBarrierCallIndex = hoisted.metaSet.mock.calls.findIndex(
      call => (call[1] as Record<string, unknown>)?.routeRestoreParkingClosed === true,
    );
    expect(parkingBarrierCallIndex).toBeGreaterThanOrEqual(0);
    expect(hoisted.restoreActivitySyncRoutesForPendingDisconnectClear.mock.invocationCallOrder[0])
      .toBeLessThan(hoisted.metaSet.mock.invocationCallOrder[parkingBarrierCallIndex]);
    expect(hoisted.metaSet.mock.invocationCallOrder[parkingBarrierCallIndex])
      .toBeLessThan(hoisted.releaseQueueItemsDeferredForRouteRestore.mock.invocationCallOrder[0]);
    expect(hoisted.releaseQueueItemsDeferredForRouteRestore.mock.invocationCallOrder[0])
      .toBeLessThan(hoisted.restoreActivitySyncRoutesForPendingDisconnectClear.mock.invocationCallOrder[1]);
    expect(hoisted.restoreActivitySyncRoutesForPendingDisconnectClear.mock.invocationCallOrder[1])
      .toBeLessThan(hoisted.releaseQueueItemsDeferredForReconnectRequired.mock.invocationCallOrder[0]);
  });

  it('records a durable repair marker when reconnect queue release is only partially completed', async () => {
    hoisted.metaGet.mockImplementation(async () => ({
      exists: true,
      data: () => {
        const connectedPayload = hoisted.metaSet.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
        return {
          connectionState: 'connected',
          connectionStateGeneration: connectedPayload?.connectionStateGeneration,
        };
      },
    }));
    hoisted.releaseQueueItemsDeferredForReconnectRequired.mockRejectedValueOnce(new Error('one queue write failed'));

    await expect(markServiceConnected('user-1', ServiceNames.WahooAPI)).resolves.toBe(true);

    expect(hoisted.metaSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      wahooReconnectReleasePending: true,
      wahooReconnectReleaseAttemptCount: 1,
    }), { merge: true });
  });

  it('continues a Wahoo reconnect queue release after routes were already restored', async () => {
    hoisted.releaseQueueItemsDeferredForReconnectRequired
      .mockRejectedValueOnce(new Error('one queue write failed'));

    await expect(markServiceConnected('user-1', ServiceNames.WahooAPI)).resolves.toBe(true);

    expect(hoisted.metaData).toEqual(expect.objectContaining({
      wahooReconnectReleasePending: true,
    }));
    expect(hoisted.metaData).not.toHaveProperty('routeRestorePending');

    await expect(retryWahooReconnectQueueRelease('user-1')).resolves.toBe(true);

    // The route stage cleared its marker successfully during the OAuth
    // callback. The repair resumes the second Wahoo queue-release stage,
    // rather than treating that completed route stage as stale.
    expect(hoisted.restoreActivitySyncRoutesForPendingDisconnectClear).toHaveBeenCalledTimes(2);
    expect(hoisted.releaseQueueItemsDeferredForRouteRestore).toHaveBeenCalledTimes(1);
    expect(hoisted.releaseQueueItemsDeferredForReconnectRequired).toHaveBeenCalledTimes(2);
    expect(hoisted.metaData).not.toHaveProperty('wahooReconnectReleasePending');
  });

  it('releases a bounded pending-disconnect remainder without restoring disconnect pending', async () => {
    hoisted.metaData = {
      connectionState: 'disconnect_pending',
      disconnectGeneration: 'pending-generation-1',
    };
    await expect(beginPendingDisconnectQueueReleaseRepair(
      'user-1',
      ServiceNames.SuuntoApp,
      'pending-generation-1',
    )).resolves.toBe(true);
    expect(hoisted.metaData).toEqual(expect.objectContaining({
      pendingDisconnectQueueReleasePending: true,
      pendingDisconnectQueueReleaseGeneration: 'pending-generation-1',
      pendingDisconnectQueueReleaseAttemptCount: 0,
    }));
    delete hoisted.metaData.connectionState;
    delete hoisted.metaData.disconnectGeneration;

    await expect(retryPendingDisconnectQueueRelease('user-1', ServiceNames.SuuntoApp))
      .resolves.toBe(true);

    expect(hoisted.releaseQueueItemsDeferredForPendingDisconnect).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      'pending-generation-1',
    );
    expect(hoisted.metaData).not.toHaveProperty('pendingDisconnectQueueReleasePending');
    expect(hoisted.metaData.connectionState).not.toBe('disconnect_pending');
  });

  it('stages the queue-release repair when the pending root is current before its metadata mirror exists', async () => {
    hoisted.tokenRootGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        disconnectState: 'disconnect_pending',
        disconnectGeneration: 'pending-generation-root-only',
      }),
    });

    await expect(beginPendingDisconnectQueueReleaseRepair(
      'user-1',
      ServiceNames.SuuntoApp,
      'pending-generation-root-only',
    )).resolves.toBe(true);

    expect(hoisted.metaData).toEqual(expect.objectContaining({
      pendingDisconnectQueueReleasePending: true,
      pendingDisconnectQueueReleaseGeneration: 'pending-generation-root-only',
    }));
  });

  it('stops reconnect release when disconnect supersedes restoration after the parking barrier closes', async () => {
    hoisted.restoreActivitySyncRoutesForPendingDisconnectClear
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => undefined);
    hoisted.releaseQueueItemsDeferredForRouteRestore.mockImplementationOnce(async () => {
      hoisted.tokenRootGet.mockResolvedValue({
        exists: true,
        data: () => ({
          disconnectOperationGeneration: 'disconnect-operation-new',
          disconnectOperationLeaseExpiresAt: Date.now() + 60_000,
        }),
      });
      return 0;
    });

    await expect(markServiceConnected('user-1', ServiceNames.WahooAPI, 'provider-1')).resolves.toBe(true);

    expect(hoisted.releaseQueueItemsDeferredForReconnectRequired).not.toHaveBeenCalled();
    expect(hoisted.metaData).toEqual(expect.objectContaining({
      routeRestorePending: true,
      wahooReconnectReleasePending: true,
    }));
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

  it('does not pin a legacy provider account after its selected token was removed', async () => {
    hoisted.refreshTokenGet.mockResolvedValueOnce({ exists: false, data: () => undefined });

    await expect(pinServiceConnectionProviderUserIdIfUnset(
      'user-1',
      ServiceNames.WahooAPI,
      'wahoo-account-a',
      {
        expectedProviderToken: {
          documentRef: hoisted.refreshTokenRef as unknown as admin.firestore.DocumentReference,
          providerUserIdField: 'wahooUserID',
        },
      },
    )).resolves.toBe('token_unavailable');

    expect(hoisted.metaSet).not.toHaveBeenCalled();
  });

  it('pins a legacy provider account while its selected token still matches', async () => {
    hoisted.refreshTokenGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ wahooUserID: 'wahoo-account-a' }),
    });

    await expect(pinServiceConnectionProviderUserIdIfUnset(
      'user-1',
      ServiceNames.WahooAPI,
      'wahoo-account-a',
      {
        expectedProviderToken: {
          documentRef: hoisted.refreshTokenRef as unknown as admin.firestore.DocumentReference,
          providerUserIdField: 'wahooUserID',
        },
      },
    )).resolves.toBe('pinned');

    expect(hoisted.metaSet).toHaveBeenCalledWith(expect.any(Object), {
      providerUserId: 'wahoo-account-a',
    }, { merge: true });
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

  it('preserves the staged pending-disconnect queue-release repair while clearing recovery state', async () => {
    hoisted.metaData = {
      connectionState: 'disconnect_pending',
      disconnectGeneration: 'pending-generation-1',
      pendingDisconnectQueueReleasePending: true,
      pendingDisconnectQueueReleaseGeneration: 'pending-generation-1',
      pendingDisconnectQueueReleaseAttemptCount: 0,
    };

    await expect(clearServiceConnectionState('user-1', ServiceNames.SuuntoApp, {
      preservePendingDisconnectQueueReleaseRepair: true,
    })).resolves.toBe(true);

    expect(hoisted.metaData).toEqual(expect.objectContaining({
      pendingDisconnectQueueReleasePending: true,
      pendingDisconnectQueueReleaseGeneration: 'pending-generation-1',
      pendingDisconnectQueueReleaseAttemptCount: 0,
    }));
  });

  it('accepts a missing token root only when the guarded credential generation is null', async () => {
    hoisted.refreshTokenGet.mockResolvedValueOnce({ exists: false, data: () => undefined });

    await expect(clearServiceConnectionState('user-1', ServiceNames.SuuntoApp, {
      expectedTokenCredentialGeneration: {
        documentRef: hoisted.refreshTokenRef as unknown as admin.firestore.DocumentReference,
        fieldName: 'activeOAuthCredentialGeneration',
        expectedGeneration: null,
      },
    })).resolves.toBe(true);

    expect(hoisted.metaSet).toHaveBeenCalled();
  });

  it('rejects a missing token root when cleanup expects a live credential generation', async () => {
    hoisted.refreshTokenGet.mockResolvedValueOnce({ exists: false, data: () => undefined });

    await expect(clearServiceConnectionState('user-1', ServiceNames.SuuntoApp, {
      expectedTokenCredentialGeneration: {
        documentRef: hoisted.refreshTokenRef as unknown as admin.firestore.DocumentReference,
        fieldName: 'activeOAuthCredentialGeneration',
        expectedGeneration: 'credential-generation-a',
      },
    })).resolves.toBe(false);

    expect(hoisted.metaSet).not.toHaveBeenCalled();
  });

  it('allows an idempotent retry after pending metadata was cleared but root cleanup failed', async () => {
    hoisted.metaGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    hoisted.refreshTokenGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ activeOAuthCredentialGeneration: 'credential-generation-a' }),
    });

    await expect(clearServiceConnectionState('user-1', ServiceNames.SuuntoApp, {
      expectedPendingDisconnectGeneration: 'disconnect-generation-a',
      expectedTokenCredentialGeneration: {
        documentRef: hoisted.refreshTokenRef as unknown as admin.firestore.DocumentReference,
        fieldName: 'activeOAuthCredentialGeneration',
        expectedGeneration: 'credential-generation-a',
      },
    })).resolves.toBe(true);

    expect(hoisted.metaSet).toHaveBeenCalled();
  });

  it('does not treat a newer connected state as an idempotently cleared pending episode', async () => {
    hoisted.metaGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ connectionState: 'connected', connectionStateGeneration: 'oauth-generation-b' }),
    });
    hoisted.refreshTokenGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ activeOAuthCredentialGeneration: 'credential-generation-a' }),
    });

    await expect(clearServiceConnectionState('user-1', ServiceNames.SuuntoApp, {
      expectedPendingDisconnectGeneration: 'disconnect-generation-a',
      expectedTokenCredentialGeneration: {
        documentRef: hoisted.refreshTokenRef as unknown as admin.firestore.DocumentReference,
        fieldName: 'activeOAuthCredentialGeneration',
        expectedGeneration: 'credential-generation-a',
      },
    })).resolves.toBe(false);

    expect(hoisted.metaSet).not.toHaveBeenCalled();
  });

  it('tracks route restore state when mirroring pending disconnect metadata', async () => {
    hoisted.tokenRootGet.mockResolvedValue({
      exists: true,
      data: () => ({
        disconnectState: 'disconnect_pending',
        disconnectGeneration: 'pending-generation-1',
      }),
    });

    await mirrorServiceDisconnectPendingToUserMeta('user-1', ServiceNames.SuuntoApp, {
      generation: 'pending-generation-1',
      reason: 'subscription_enforcement',
      attemptCount: 0,
      nextAttemptAt: 'next-attempt',
      retryExpiresAt: 'expires-at',
      manualReviewRequired: false,
    });

    expect(hoisted.disableActivitySyncRoutesForDisconnectedService).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      {
        trackPendingDisconnectRestore: true,
        expectedConnectionStateGeneration: 'pending-generation-1',
        requiredConnectionState: 'disconnect_pending',
      },
    );
  });

  it('does not mirror an obsolete pending generation after OAuth clears the root', async () => {
    hoisted.metaGet.mockResolvedValue({
      exists: true,
      data: () => ({ activeOAuthCredentialGeneration: 'oauth-generation-2' }),
    });

    await expect(mirrorServiceDisconnectPendingToUserMeta('user-1', ServiceNames.SuuntoApp, {
      generation: 'pending-generation-1',
      reason: 'subscription_enforcement',
      attemptCount: 0,
      nextAttemptAt: 'next-attempt',
      retryExpiresAt: 'expires-at',
    })).resolves.toBe(false);

    expect(hoisted.metaSet).not.toHaveBeenCalled();
    expect(hoisted.disableActivitySyncRoutesForDisconnectedService).not.toHaveBeenCalled();
  });

  it('restores pending-disconnect activity sync routes when requested after clearing state', async () => {
    await clearServiceConnectionState('user-1', ServiceNames.SuuntoApp, {
      restorePendingDisconnectActivitySyncRoutes: true,
    });

    expect(hoisted.restoreActivitySyncRoutesForPendingDisconnectClear).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      expect.objectContaining({
        expectedConnectionStateGeneration: expect.any(String),
        clearRouteRestoreMarker: true,
      }),
    );
    expect(hoisted.restoreActivitySyncRoutesForPendingDisconnectClear).toHaveBeenNthCalledWith(
      1,
      'user-1',
      ServiceNames.SuuntoApp,
      expect.objectContaining({ clearRouteRestoreMarker: false }),
    );
    expect(hoisted.releaseQueueItemsDeferredForRouteRestore.mock.invocationCallOrder[0])
      .toBeLessThan(hoisted.restoreActivitySyncRoutesForPendingDisconnectClear.mock.invocationCallOrder[1]);
  });
});
