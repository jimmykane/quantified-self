import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import type * as admin from 'firebase-admin';

const hoisted = vi.hoisted(() => ({
  runTransaction: vi.fn(),
  transactionGet: vi.fn(),
  transactionSet: vi.fn(),
  rootGet: vi.fn(),
  rootRef: { path: 'suuntoAppAccessTokens/user-1', get: vi.fn() },
  serviceMetaRef: { path: 'users/user-1/meta/Suunto App' },
  getServiceTokenRootDocumentRef: vi.fn(),
  beginPendingDisconnectQueueReleaseRepair: vi.fn(),
  clearServiceConnectionState: vi.fn(),
  completePendingDisconnectQueueReleaseRepair: vi.fn(),
  mirrorServiceDisconnectPendingToUserMeta: vi.fn(),
  getUserDeletionGuardStateInTransaction: vi.fn(),
  releaseQueueItemsDeferredForPendingDisconnect: vi.fn(),
  DeferredQueueReleaseIncompleteError: class DeferredQueueReleaseIncompleteError extends Error {},
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  fieldValueDelete: vi.fn(() => 'DELETE_SENTINEL'),
}));

vi.mock('firebase-admin', () => {
  const firestore = () => ({
    runTransaction: hoisted.runTransaction,
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => hoisted.serviceMetaRef),
        })),
      })),
    })),
  });

  return {
    default: { firestore },
    firestore,
  };
});

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    delete: hoisted.fieldValueDelete,
  },
  Timestamp: {
    fromMillis: vi.fn((value: number) => ({ toMillis: () => value })),
  },
}));

vi.mock('firebase-functions/logger', () => ({
  error: hoisted.loggerError,
  warn: hoisted.loggerWarn,
}));

vi.mock('./service-token-store', () => ({
  OAUTH_FLOW_GENERATION_FIELD: 'oauthFlowGeneration',
  SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD: 'disconnectOperationGeneration',
  getServiceTokenRootDocumentRef: hoisted.getServiceTokenRootDocumentRef,
}));

vi.mock('./service-connection-meta', () => ({
  beginPendingDisconnectQueueReleaseRepair: hoisted.beginPendingDisconnectQueueReleaseRepair,
  clearServiceConnectionState: hoisted.clearServiceConnectionState,
  completePendingDisconnectQueueReleaseRepair: hoisted.completePendingDisconnectQueueReleaseRepair,
  mirrorServiceDisconnectPendingToUserMeta: hoisted.mirrorServiceDisconnectPendingToUserMeta,
}));

vi.mock('./shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: hoisted.getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
    public readonly name = 'UserDeletionGuardReadError';
  },
}));

vi.mock('./queue/pending-disconnect-release', () => ({
  DeferredQueueReleaseIncompleteError: hoisted.DeferredQueueReleaseIncompleteError,
  releaseQueueItemsDeferredForPendingDisconnect: hoisted.releaseQueueItemsDeferredForPendingDisconnect,
}));

import {
  clearServiceDisconnectPending,
  isServiceDisconnectManualReviewRequiredForUser,
  markServiceDisconnectPending,
  recordServiceDisconnectRetryFailure,
  resumeServiceDisconnectRetryAfterRecoveryFailure,
  sanitizePendingServiceDisconnectErrorMessage,
} from './service-disconnect-pending';

describe('service-disconnect-pending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.getServiceTokenRootDocumentRef.mockReturnValue(hoisted.rootRef);
    hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
    hoisted.transactionGet.mockResolvedValue({ exists: true, data: () => ({}) });
    hoisted.rootGet.mockResolvedValue({ exists: false });
    hoisted.rootRef.get = hoisted.rootGet;
    hoisted.runTransaction.mockImplementation(async (callback: (transaction: unknown) => Promise<unknown>) => callback({
      get: hoisted.transactionGet,
      set: hoisted.transactionSet,
    }));
    hoisted.beginPendingDisconnectQueueReleaseRepair.mockResolvedValue(true);
    hoisted.clearServiceConnectionState.mockResolvedValue(true);
    hoisted.completePendingDisconnectQueueReleaseRepair.mockResolvedValue(true);
    hoisted.mirrorServiceDisconnectPendingToUserMeta.mockResolvedValue(true);
    hoisted.releaseQueueItemsDeferredForPendingDisconnect.mockResolvedValue(0);
  });

  it('redacts token material from persisted disconnect error messages', () => {
    const message = [
      'request failed',
      'Authorization: "Bearer access-token-secret"',
      'access_token=access-token-query',
      'refresh_token: "refresh-token-json"',
      'client_secret=client-secret-query',
    ].join(' ');

    const sanitized = sanitizePendingServiceDisconnectErrorMessage(message);

    expect(sanitized).toContain('Authorization: "[redacted]"');
    expect(sanitized).toContain('access_token=[redacted]');
    expect(sanitized).toContain('refresh_token: "[redacted]"');
    expect(sanitized).toContain('client_secret=[redacted]');
    expect(sanitized).not.toContain('access-token-secret');
    expect(sanitized).not.toContain('access-token-query');
    expect(sanitized).not.toContain('refresh-token-json');
    expect(sanitized).not.toContain('client-secret-query');
  });

  it('identifies manual-review pending disconnect roots', async () => {
    hoisted.rootGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        disconnectState: 'disconnect_pending',
        disconnectManualReviewRequired: true,
      }),
    });

    await expect(isServiceDisconnectManualReviewRequiredForUser('user-1', ServiceNames.SuuntoApp)).resolves.toBe(true);
  });

  it('does not identify retrying pending disconnect roots as manual review', async () => {
    hoisted.rootGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        disconnectState: 'disconnect_pending',
        disconnectManualReviewRequired: false,
      }),
    });

    await expect(isServiceDisconnectManualReviewRequiredForUser('user-1', ServiceNames.SuuntoApp)).resolves.toBe(false);
  });

  it('clears pending fields before releasing deferred queue items when the user is active', async () => {
    hoisted.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        disconnectState: 'disconnect_pending',
        disconnectGeneration: 'pending-generation-1',
      }),
    });

    await clearServiceDisconnectPending('user-1', ServiceNames.SuuntoApp);

    expect(hoisted.releaseQueueItemsDeferredForPendingDisconnect).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      'pending-generation-1',
    );
    expect(hoisted.transactionSet).not.toHaveBeenCalled();
    expect(hoisted.clearServiceConnectionState).toHaveBeenCalledWith('user-1', ServiceNames.SuuntoApp, {
      restorePendingDisconnectActivitySyncRoutes: true,
      clearPendingDisconnectRoot: true,
      preservePendingDisconnectQueueReleaseRepair: true,
      expectedDisconnectLifecycleGuard: {
        disconnectGeneration: 'pending-generation-1',
        oauthCredentialGeneration: null,
        oauthFlowGeneration: null,
        disconnectOperationGeneration: null,
      },
      expectedPendingDisconnectGeneration: 'pending-generation-1',
    });
    expect(hoisted.clearServiceConnectionState.mock.invocationCallOrder[0])
      .toBeLessThan(hoisted.releaseQueueItemsDeferredForPendingDisconnect.mock.invocationCallOrder[0]);
    expect(hoisted.beginPendingDisconnectQueueReleaseRepair.mock.invocationCallOrder[0])
      .toBeLessThan(hoisted.clearServiceConnectionState.mock.invocationCallOrder[0]);
    expect(hoisted.completePendingDisconnectQueueReleaseRepair).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      'pending-generation-1',
    );
  });

  it('does not let a stale OAuth credential clear a newer connection lifecycle', async () => {
    const staleTokenRef = { path: 'suuntoAppAccessTokens/user-1/tokens/provider-1' };
    hoisted.transactionGet.mockImplementation(async (target: unknown) => target === staleTokenRef
      ? {
        exists: true,
        data: () => ({
          activeOAuthCredentialGeneration: 'new-generation',
        }),
      }
      : { exists: true, data: () => ({ disconnectState: 'disconnect_pending' }) });

    await clearServiceDisconnectPending('user-1', ServiceNames.SuuntoApp, {
      documentRef: staleTokenRef as any,
      fieldName: 'activeOAuthCredentialGeneration',
      expectedGeneration: 'old-generation',
    });

    expect(hoisted.transactionSet).not.toHaveBeenCalled();
    expect(hoisted.clearServiceConnectionState).not.toHaveBeenCalled();
    expect(hoisted.releaseQueueItemsDeferredForPendingDisconnect).not.toHaveBeenCalled();
  });

  it('does not let a claimed callback clear pending state after disconnect rotates its OAuth flow', async () => {
    const credentialGuard = {
      documentRef: hoisted.rootRef as unknown as admin.firestore.DocumentReference,
      fieldName: 'activeOAuthCredentialGeneration',
      expectedGeneration: 'credential-generation',
    };
    const staleFlowGuard = {
      documentRef: hoisted.rootRef as unknown as admin.firestore.DocumentReference,
      fieldName: 'oauthFlowGeneration',
      expectedGeneration: 'claimed-flow',
    };
    hoisted.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        activeOAuthCredentialGeneration: 'credential-generation',
        oauthFlowGeneration: 'disconnect-fence',
        disconnectState: 'disconnect_pending',
      }),
    });

    await clearServiceDisconnectPending(
      'user-1',
      ServiceNames.SuuntoApp,
      credentialGuard,
      staleFlowGuard,
    );

    expect(hoisted.transactionSet).not.toHaveBeenCalled();
    expect(hoisted.clearServiceConnectionState).not.toHaveBeenCalled();
    expect(hoisted.releaseQueueItemsDeferredForPendingDisconnect).not.toHaveBeenCalled();
  });

  it('recovers and releases the pending generation left in metadata by a stale OAuth callback', async () => {
    hoisted.transactionGet.mockImplementation(async (target: unknown) => {
      if (target === hoisted.rootRef) {
        return {
          exists: true,
          data: () => ({ activeOAuthCredentialGeneration: 'winning-generation' }),
        };
      }
      if (target === hoisted.serviceMetaRef) {
        return {
          exists: true,
          data: () => ({
            connectionState: 'disconnect_pending',
            connectionStateGeneration: 'pending-generation-from-meta',
            disconnectGeneration: 'pending-generation-from-meta',
            disconnectReason: 'subscription_enforcement',
            disconnectAttemptCount: 2,
          }),
        };
      }
      throw new Error('Unexpected transaction target');
    });

    const winningGuard = {
      documentRef: hoisted.rootRef as unknown as admin.firestore.DocumentReference,
      fieldName: 'activeOAuthCredentialGeneration',
      expectedGeneration: 'winning-generation',
    };
    const winningFlowGuard = {
      documentRef: hoisted.rootRef as unknown as admin.firestore.DocumentReference,
      fieldName: 'oauthFlowGeneration',
      expectedGeneration: 'winning-flow',
    };
    hoisted.transactionGet.mockImplementation(async (target: unknown) => {
      if (target === hoisted.rootRef) {
        return {
          exists: true,
          data: () => ({
            activeOAuthCredentialGeneration: 'winning-generation',
            oauthFlowGeneration: 'winning-flow',
          }),
        };
      }
      if (target === hoisted.serviceMetaRef) {
        return {
          exists: true,
          data: () => ({
            connectionState: 'disconnect_pending',
            connectionStateGeneration: 'pending-generation-from-meta',
            disconnectGeneration: 'pending-generation-from-meta',
            disconnectReason: 'subscription_enforcement',
            disconnectAttemptCount: 2,
          }),
        };
      }
      throw new Error('Unexpected transaction target');
    });
    await clearServiceDisconnectPending(
      'user-1',
      ServiceNames.SuuntoApp,
      winningGuard,
      winningFlowGuard,
    );

    expect(hoisted.clearServiceConnectionState).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      {
        restorePendingDisconnectActivitySyncRoutes: true,
        clearPendingDisconnectRoot: true,
        preservePendingDisconnectQueueReleaseRepair: true,
        expectedDisconnectLifecycleGuard: {
          disconnectGeneration: null,
          oauthCredentialGeneration: 'winning-generation',
          oauthFlowGeneration: 'winning-flow',
          disconnectOperationGeneration: null,
        },
        expectedTokenCredentialGeneration: winningGuard,
        expectedOAuthFlowGeneration: winningFlowGuard,
        expectedPendingDisconnectGeneration: 'pending-generation-from-meta',
      },
    );
    expect(hoisted.releaseQueueItemsDeferredForPendingDisconnect).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      'pending-generation-from-meta',
    );
  });

  it('restores pending state when deferred queue release fails after clear', async () => {
    hoisted.transactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        disconnectState: 'disconnect_pending',
        disconnectGeneration: 'pending-generation-2',
        disconnectReason: 'subscription_enforcement',
        disconnectAttemptCount: 2,
        disconnectNextAttemptAt: 'next-attempt',
        disconnectLastAttemptAt: 'last-attempt',
        disconnectRetryExpiresAt: 'retry-expires',
        disconnectLastStatusCode: 504,
        disconnectLastErrorMessage: 'gateway timeout',
        disconnectManualReviewRequired: false,
      }),
    }).mockResolvedValueOnce({
      exists: true,
      data: () => ({}),
    });
    hoisted.releaseQueueItemsDeferredForPendingDisconnect.mockRejectedValueOnce(new Error('release failed'));

    await expect(clearServiceDisconnectPending('user-1', ServiceNames.SuuntoApp))
      .rejects.toThrow('release failed');

    expect(hoisted.releaseQueueItemsDeferredForPendingDisconnect).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      'pending-generation-2',
    );
    expect(hoisted.clearServiceConnectionState).toHaveBeenCalledWith('user-1', ServiceNames.SuuntoApp, {
      restorePendingDisconnectActivitySyncRoutes: true,
      clearPendingDisconnectRoot: true,
      preservePendingDisconnectQueueReleaseRepair: true,
      expectedDisconnectLifecycleGuard: {
        disconnectGeneration: 'pending-generation-2',
        oauthCredentialGeneration: null,
        oauthFlowGeneration: null,
        disconnectOperationGeneration: null,
      },
      expectedPendingDisconnectGeneration: 'pending-generation-2',
    });
    expect(hoisted.transactionSet).toHaveBeenNthCalledWith(
      1,
      hoisted.rootRef,
      expect.objectContaining({
        disconnectState: 'disconnect_pending',
        disconnectAttemptCount: 2,
        disconnectNextAttemptAt: 'next-attempt',
        disconnectLastStatusCode: 504,
      }),
      { merge: true },
    );
    expect(hoisted.mirrorServiceDisconnectPendingToUserMeta).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      expect.objectContaining({
        attemptCount: 2,
        nextAttemptAt: 'next-attempt',
        lastStatusCode: 504,
        manualReviewRequired: false,
      }),
    );
  });

  it('keeps OAuth recovery complete when a bounded queue release needs durable repair', async () => {
    hoisted.transactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        disconnectState: 'disconnect_pending',
        disconnectGeneration: 'pending-generation-2',
      }),
    });
    hoisted.releaseQueueItemsDeferredForPendingDisconnect.mockRejectedValueOnce(
      new hoisted.DeferredQueueReleaseIncompleteError('bounded release'),
    );

    await expect(clearServiceDisconnectPending('user-1', ServiceNames.SuuntoApp))
      .resolves.toBeUndefined();

    expect(hoisted.beginPendingDisconnectQueueReleaseRepair).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      'pending-generation-2',
      undefined,
      undefined,
    );
    expect(hoisted.completePendingDisconnectQueueReleaseRepair).not.toHaveBeenCalled();
    expect(hoisted.transactionSet).not.toHaveBeenCalled();
    expect(hoisted.mirrorServiceDisconnectPendingToUserMeta).not.toHaveBeenCalled();
  });

  it('does not restore an old pending episode when OAuth wins after the atomic clear', async () => {
    hoisted.transactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        disconnectState: 'disconnect_pending',
        disconnectGeneration: 'pending-generation-old',
        activeOAuthCredentialGeneration: 'oauth-generation-old',
        disconnectReason: 'subscription_enforcement',
        disconnectAttemptCount: 2,
        disconnectNextAttemptAt: 'next-attempt',
        disconnectRetryExpiresAt: 'retry-expires',
      }),
    }).mockResolvedValueOnce({
      exists: true,
      data: () => ({
        activeOAuthCredentialGeneration: 'oauth-generation-new',
      }),
    });
    hoisted.releaseQueueItemsDeferredForPendingDisconnect.mockRejectedValueOnce(new Error('release failed'));

    await expect(clearServiceDisconnectPending('user-1', ServiceNames.SuuntoApp))
      .rejects.toThrow('release failed');

    expect(hoisted.transactionSet).not.toHaveBeenCalled();
    expect(hoisted.mirrorServiceDisconnectPendingToUserMeta).not.toHaveBeenCalled();
  });

  it('does not clear a healthy connection when the token root is not pending disconnect', async () => {
    hoisted.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({ connectionState: 'connected' }),
    });

    await clearServiceDisconnectPending('user-1', ServiceNames.SuuntoApp);

    expect(hoisted.releaseQueueItemsDeferredForPendingDisconnect).not.toHaveBeenCalled();
    expect(hoisted.transactionSet).not.toHaveBeenCalled();
    expect(hoisted.clearServiceConnectionState).not.toHaveBeenCalled();
  });

  it('clears stale user meta when the pending token root is already missing', async () => {
    hoisted.transactionGet.mockImplementation(async (target: unknown) => {
      if (target === hoisted.rootRef) return { exists: false, data: () => undefined };
      if (target === hoisted.serviceMetaRef) {
        return {
          exists: true,
          data: () => ({
            connectionState: 'disconnect_pending',
            connectionStateGeneration: 'pending-generation-from-meta',
            disconnectGeneration: 'pending-generation-from-meta',
            disconnectReason: 'subscription_enforcement',
            disconnectAttemptCount: 1,
          }),
        };
      }
      throw new Error('Unexpected transaction target');
    });

    await clearServiceDisconnectPending('user-1', ServiceNames.SuuntoApp);

    expect(hoisted.transactionSet).not.toHaveBeenCalled();
    expect(hoisted.clearServiceConnectionState).toHaveBeenCalledWith('user-1', ServiceNames.SuuntoApp, {
      restorePendingDisconnectActivitySyncRoutes: true,
      clearPendingDisconnectRoot: true,
      preservePendingDisconnectQueueReleaseRepair: true,
      expectedDisconnectLifecycleGuard: {
        disconnectGeneration: null,
        oauthCredentialGeneration: null,
        oauthFlowGeneration: null,
        disconnectOperationGeneration: null,
      },
      expectedPendingDisconnectGeneration: 'pending-generation-from-meta',
    });
    expect(hoisted.releaseQueueItemsDeferredForPendingDisconnect).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      'pending-generation-from-meta',
    );
  });

  it('does not clear root or meta state when the user is missing or deletion is in progress', async () => {
    hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
      userExists: true,
      deletionInProgress: true,
      shouldSkip: true,
    });

    await clearServiceDisconnectPending('user-1', ServiceNames.SuuntoApp);

    expect(hoisted.transactionGet).not.toHaveBeenCalled();
    expect(hoisted.transactionSet).not.toHaveBeenCalled();
    expect(hoisted.clearServiceConnectionState).not.toHaveBeenCalled();
    expect(hoisted.releaseQueueItemsDeferredForPendingDisconnect).not.toHaveBeenCalled();
  });

  it('marks pending disconnect when the user is active', async () => {
    const didMark = await markServiceDisconnectPending(
      'user-1',
      ServiceNames.SuuntoApp,
      { tokenID: 'token-1', statusCode: 504, errorMessage: 'gateway timeout' },
    );

    expect(didMark).toBe(true);
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.rootRef,
      expect.objectContaining({
        disconnectState: 'disconnect_pending',
        disconnectLastStatusCode: 504,
        disconnectManualReviewRequired: false,
      }),
      { merge: true },
    );
    expect(hoisted.mirrorServiceDisconnectPendingToUserMeta).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      expect.objectContaining({
        lastStatusCode: 504,
        manualReviewRequired: false,
      }),
    );
  });

  it('starts a new generation for a new pending-disconnect episode', async () => {
    hoisted.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        disconnectState: 'connected',
        disconnectGeneration: 'stale-generation',
      }),
    });

    await markServiceDisconnectPending(
      'user-1',
      ServiceNames.SuuntoApp,
      { tokenID: 'token-1', statusCode: 504, errorMessage: 'gateway timeout' },
    );

    const persistedRoot = hoisted.transactionSet.mock.calls[0][1] as Record<string, unknown>;
    expect(persistedRoot.disconnectGeneration).toEqual(expect.any(String));
    expect(persistedRoot.disconnectGeneration).not.toBe('stale-generation');
    expect(hoisted.mirrorServiceDisconnectPendingToUserMeta).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      expect.objectContaining({ generation: persistedRoot.disconnectGeneration }),
    );
  });

  it('does not let stale cleanup create a pending episode after OAuth replaced the credential', async () => {
    hoisted.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({ activeOAuthCredentialGeneration: 'oauth-generation-new' }),
    });

    const didMark = await markServiceDisconnectPending(
      'user-1',
      ServiceNames.SuuntoApp,
      {
        tokenID: 'token-1',
        statusCode: 504,
        errorMessage: 'gateway timeout',
        lifecycleGuard: {
          disconnectGeneration: null,
          oauthCredentialGeneration: 'oauth-generation-old',
        },
      },
    );

    expect(didMark).toBe(false);
    expect(hoisted.transactionSet).not.toHaveBeenCalled();
    expect(hoisted.mirrorServiceDisconnectPendingToUserMeta).not.toHaveBeenCalled();
  });

  it('does not mark pending disconnect when the user is missing or deletion is in progress', async () => {
    hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
      userExists: false,
      deletionInProgress: false,
      shouldSkip: true,
    });

    const didMark = await markServiceDisconnectPending(
      'user-1',
      ServiceNames.SuuntoApp,
      { tokenID: 'token-1', statusCode: 504, errorMessage: 'gateway timeout' },
    );

    expect(didMark).toBe(false);
    expect(hoisted.transactionGet).not.toHaveBeenCalled();
    expect(hoisted.transactionSet).not.toHaveBeenCalled();
    expect(hoisted.mirrorServiceDisconnectPendingToUserMeta).not.toHaveBeenCalled();
  });

  it('records retry failures when the user is active', async () => {
    const didRecord = await recordServiceDisconnectRetryFailure(
      'user-1',
      ServiceNames.SuuntoApp,
      { tokenID: 'token-1', statusCode: 504, errorMessage: 'gateway timeout' },
    );

    expect(didRecord).toBe(true);
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.rootRef,
      expect.objectContaining({
        disconnectState: 'disconnect_pending',
        disconnectAttemptCount: 1,
        disconnectLastStatusCode: 504,
        disconnectManualReviewRequired: false,
      }),
      { merge: true },
    );
    expect(hoisted.mirrorServiceDisconnectPendingToUserMeta).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      expect.objectContaining({
        attemptCount: 1,
        lastStatusCode: 504,
        manualReviewRequired: false,
      }),
    );
  });

  it('does not let a stale retry overwrite a newer disconnect or OAuth generation', async () => {
    hoisted.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        disconnectState: 'disconnect_pending',
        disconnectGeneration: 'disconnect-generation-new',
        activeOAuthCredentialGeneration: 'oauth-generation-new',
      }),
    });

    const didRecord = await recordServiceDisconnectRetryFailure(
      'user-1',
      ServiceNames.SuuntoApp,
      {
        tokenID: 'token-1',
        statusCode: 504,
        errorMessage: 'gateway timeout',
        lifecycleGuard: {
          disconnectGeneration: 'disconnect-generation-old',
          oauthCredentialGeneration: 'oauth-generation-old',
        },
      },
    );

    expect(didRecord).toBe(false);
    expect(hoisted.transactionSet).not.toHaveBeenCalled();
    expect(hoisted.mirrorServiceDisconnectPendingToUserMeta).not.toHaveBeenCalled();
  });

  it('finalizes manual-review roots only after mirroring terminal pending state to user meta', async () => {
    hoisted.transactionGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          disconnectState: 'disconnect_pending',
          disconnectAttemptCount: 9,
        }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          disconnectState: 'disconnect_pending',
          disconnectAttemptCount: 10,
          disconnectManualReviewRequired: false,
        }),
      });

    const didRecord = await recordServiceDisconnectRetryFailure(
      'user-1',
      ServiceNames.SuuntoApp,
      { tokenID: 'token-1', statusCode: 504, errorMessage: 'gateway timeout' },
    );

    expect(didRecord).toBe(true);
    expect(hoisted.transactionSet).toHaveBeenNthCalledWith(
      1,
      hoisted.rootRef,
      expect.objectContaining({
        disconnectState: 'disconnect_pending',
        disconnectAttemptCount: 10,
        disconnectManualReviewRequired: false,
        disconnectNextAttemptAt: expect.objectContaining({ toMillis: expect.any(Function) }),
      }),
      { merge: true },
    );
    expect(hoisted.mirrorServiceDisconnectPendingToUserMeta).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      expect.objectContaining({
        attemptCount: 10,
        nextAttemptAt: null,
        manualReviewRequired: true,
      }),
    );
    expect(hoisted.transactionSet).toHaveBeenNthCalledWith(
      2,
      hoisted.rootRef,
      expect.objectContaining({
        disconnectState: 'disconnect_pending',
        disconnectAttemptCount: 10,
        disconnectManualReviewRequired: true,
        disconnectNextAttemptAt: null,
      }),
      { merge: true },
    );
    expect(hoisted.mirrorServiceDisconnectPendingToUserMeta.mock.invocationCallOrder[0])
      .toBeLessThan(hoisted.transactionSet.mock.invocationCallOrder[1]);
  });

  it('keeps manual-review retry failures scheduler-visible when the user-meta mirror fails', async () => {
    hoisted.transactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        disconnectState: 'disconnect_pending',
        disconnectAttemptCount: 9,
      }),
    });
    hoisted.mirrorServiceDisconnectPendingToUserMeta.mockRejectedValueOnce(new Error('meta write failed'));

    await expect(recordServiceDisconnectRetryFailure(
      'user-1',
      ServiceNames.SuuntoApp,
      { tokenID: 'token-1', statusCode: 504, errorMessage: 'gateway timeout' },
    )).rejects.toThrow('meta write failed');

    expect(hoisted.transactionSet).toHaveBeenCalledTimes(1);
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.rootRef,
      expect.objectContaining({
        disconnectState: 'disconnect_pending',
        disconnectAttemptCount: 10,
        disconnectManualReviewRequired: false,
        disconnectNextAttemptAt: expect.objectContaining({ toMillis: expect.any(Function) }),
      }),
      { merge: true },
    );
  });

  it('resumes retry scheduling after a manual-review OAuth recovery deauthorization fails retryably', async () => {
    hoisted.transactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        disconnectState: 'disconnect_pending',
        disconnectReason: 'subscription_enforcement',
        disconnectAttemptCount: 10,
        disconnectNextAttemptAt: null,
        disconnectRetryExpiresAt: { toMillis: () => 1 },
        disconnectManualReviewRequired: true,
      }),
    });

    const didResume = await resumeServiceDisconnectRetryAfterRecoveryFailure(
      'user-1',
      ServiceNames.SuuntoApp,
      { tokenID: 'token-1', statusCode: 504, errorMessage: 'gateway timeout' },
      1_000,
    );

    expect(didResume).toBe(true);
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.rootRef,
      expect.objectContaining({
        disconnectState: 'disconnect_pending',
        disconnectAttemptCount: 0,
        disconnectLastStatusCode: 504,
        disconnectManualReviewRequired: false,
        disconnectNextAttemptAt: expect.objectContaining({ toMillis: expect.any(Function) }),
      }),
      { merge: true },
    );
    expect(hoisted.mirrorServiceDisconnectPendingToUserMeta).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      expect.objectContaining({
        attemptCount: 0,
        lastStatusCode: 504,
        manualReviewRequired: false,
        nextAttemptAt: expect.objectContaining({ toMillis: expect.any(Function) }),
      }),
    );
  });

  it('does not resume stale recovery failure state after a newer OAuth callback wins', async () => {
    hoisted.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({ activeOAuthCredentialGeneration: 'oauth-generation-new' }),
    });

    const didResume = await resumeServiceDisconnectRetryAfterRecoveryFailure(
      'user-1',
      ServiceNames.SuuntoApp,
      {
        tokenID: 'token-1',
        statusCode: 504,
        errorMessage: 'gateway timeout',
        lifecycleGuard: {
          disconnectGeneration: null,
          oauthCredentialGeneration: 'oauth-generation-old',
        },
      },
    );

    expect(didResume).toBe(false);
    expect(hoisted.transactionSet).not.toHaveBeenCalled();
    expect(hoisted.mirrorServiceDisconnectPendingToUserMeta).not.toHaveBeenCalled();
  });

  it('does not record retry failures when the user is missing or deletion is in progress', async () => {
    hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
      userExists: true,
      deletionInProgress: true,
      shouldSkip: true,
    });

    const didRecord = await recordServiceDisconnectRetryFailure(
      'user-1',
      ServiceNames.SuuntoApp,
      { tokenID: 'token-1', statusCode: 504, errorMessage: 'gateway timeout' },
    );

    expect(didRecord).toBe(false);
    expect(hoisted.transactionGet).not.toHaveBeenCalled();
    expect(hoisted.transactionSet).not.toHaveBeenCalled();
    expect(hoisted.mirrorServiceDisconnectPendingToUserMeta).not.toHaveBeenCalled();
  });
});
