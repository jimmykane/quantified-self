import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const hoisted = vi.hoisted(() => ({
  runTransaction: vi.fn(),
  transactionGet: vi.fn(),
  transactionSet: vi.fn(),
  rootGet: vi.fn(),
  rootRef: { path: 'suuntoAppAccessTokens/user-1', get: vi.fn() },
  getServiceTokenRootDocumentRef: vi.fn(),
  clearServiceConnectionState: vi.fn(),
  mirrorServiceDisconnectPendingToUserMeta: vi.fn(),
  getUserDeletionGuardStateInTransaction: vi.fn(),
  releaseQueueItemsDeferredForPendingDisconnect: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('firebase-admin', () => {
  const firestore = Object.assign(() => ({
    runTransaction: hoisted.runTransaction,
  }), {
    FieldValue: {
      delete: vi.fn(() => 'DELETE_SENTINEL'),
    },
    Timestamp: {
      fromMillis: vi.fn((value: number) => ({ toMillis: () => value })),
    },
  });

  return {
    default: { firestore },
    firestore,
  };
});

vi.mock('firebase-functions/logger', () => ({
  error: hoisted.loggerError,
  warn: hoisted.loggerWarn,
}));

vi.mock('./service-token-store', () => ({
  getServiceTokenRootDocumentRef: hoisted.getServiceTokenRootDocumentRef,
}));

vi.mock('./service-connection-meta', () => ({
  clearServiceConnectionState: hoisted.clearServiceConnectionState,
  mirrorServiceDisconnectPendingToUserMeta: hoisted.mirrorServiceDisconnectPendingToUserMeta,
}));

vi.mock('./shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: hoisted.getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
    public readonly name = 'UserDeletionGuardReadError';
  },
}));

vi.mock('./queue/pending-disconnect-release', () => ({
  releaseQueueItemsDeferredForPendingDisconnect: hoisted.releaseQueueItemsDeferredForPendingDisconnect,
}));

import {
  clearServiceDisconnectPending,
  isServiceDisconnectManualReviewRequiredForUser,
  markServiceDisconnectPending,
  recordServiceDisconnectRetryFailure,
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
    hoisted.clearServiceConnectionState.mockResolvedValue(undefined);
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

  it('clears pending fields from the token root and user meta when the user is active', async () => {
    hoisted.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({ disconnectState: 'disconnect_pending' }),
    });

    await clearServiceDisconnectPending('user-1', ServiceNames.SuuntoApp);

    expect(hoisted.releaseQueueItemsDeferredForPendingDisconnect).toHaveBeenCalledWith('user-1', ServiceNames.SuuntoApp);
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.rootRef,
      expect.objectContaining({
        disconnectState: 'DELETE_SENTINEL',
        disconnectReason: 'DELETE_SENTINEL',
        disconnectManualReviewRequired: 'DELETE_SENTINEL',
      }),
      { merge: true },
    );
    expect(hoisted.clearServiceConnectionState).toHaveBeenCalledWith('user-1', ServiceNames.SuuntoApp, {
      restorePendingDisconnectActivitySyncRoutes: true,
    });
    expect(hoisted.releaseQueueItemsDeferredForPendingDisconnect.mock.invocationCallOrder[0])
      .toBeLessThan(hoisted.transactionSet.mock.invocationCallOrder[0]);
  });

  it('does not clear pending state when deferred queue release fails', async () => {
    hoisted.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({ disconnectState: 'disconnect_pending' }),
    });
    hoisted.releaseQueueItemsDeferredForPendingDisconnect.mockRejectedValueOnce(new Error('release failed'));

    await expect(clearServiceDisconnectPending('user-1', ServiceNames.SuuntoApp))
      .rejects.toThrow('release failed');

    expect(hoisted.releaseQueueItemsDeferredForPendingDisconnect).toHaveBeenCalledWith('user-1', ServiceNames.SuuntoApp);
    expect(hoisted.transactionSet).not.toHaveBeenCalled();
    expect(hoisted.clearServiceConnectionState).not.toHaveBeenCalled();
  });

  it('clears non-pending token roots without releasing deferred pending-disconnect queue items', async () => {
    hoisted.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({ connectionState: 'connected' }),
    });

    await clearServiceDisconnectPending('user-1', ServiceNames.SuuntoApp);

    expect(hoisted.releaseQueueItemsDeferredForPendingDisconnect).not.toHaveBeenCalled();
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.rootRef,
      expect.objectContaining({
        disconnectState: 'DELETE_SENTINEL',
        disconnectReason: 'DELETE_SENTINEL',
        disconnectManualReviewRequired: 'DELETE_SENTINEL',
      }),
      { merge: true },
    );
    expect(hoisted.clearServiceConnectionState).toHaveBeenCalledWith('user-1', ServiceNames.SuuntoApp, {
      restorePendingDisconnectActivitySyncRoutes: true,
    });
  });

  it('clears stale user meta when the pending token root is already missing', async () => {
    hoisted.transactionGet.mockResolvedValueOnce({ exists: false });

    await clearServiceDisconnectPending('user-1', ServiceNames.SuuntoApp);

    expect(hoisted.transactionSet).not.toHaveBeenCalled();
    expect(hoisted.clearServiceConnectionState).toHaveBeenCalledWith('user-1', ServiceNames.SuuntoApp, {
      restorePendingDisconnectActivitySyncRoutes: true,
    });
    expect(hoisted.releaseQueueItemsDeferredForPendingDisconnect).not.toHaveBeenCalled();
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
