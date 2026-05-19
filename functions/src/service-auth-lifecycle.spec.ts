import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const {
  mockMarkServiceReconnectRequired,
  mockClearServiceConnectionState,
  mockRunTransaction,
  mockRecursiveDelete,
  mockDeleteLocalServiceToken,
  tokenRef,
  tokenCollectionRef,
  tokenRootRef,
} = vi.hoisted(() => {
  const tokenRef = {
    id: 'suunto-user',
    parent: {
      parent: { id: 'firebase-user-123' },
    },
  };

  const tokenCollectionRef = {
    get: vi.fn(),
    limit: vi.fn(),
  };

  const tokenRootRef = {
    id: 'firebase-user-123',
    collection: vi.fn((name: string) => {
      if (name !== 'tokens') {
        throw new Error(`Unexpected subcollection ${name}`);
      }
      return tokenCollectionRef;
    }),
  };

  return {
    mockMarkServiceReconnectRequired: vi.fn().mockResolvedValue(undefined),
    mockClearServiceConnectionState: vi.fn().mockResolvedValue(undefined),
    mockRunTransaction: vi.fn(),
    mockRecursiveDelete: vi.fn().mockResolvedValue(undefined),
    mockDeleteLocalServiceToken: vi.fn(),
    tokenRef,
    tokenCollectionRef,
    tokenRootRef,
  };
});

vi.mock('firebase-admin', () => {
  const firestore = Object.assign(() => ({
    runTransaction: mockRunTransaction,
    recursiveDelete: mockRecursiveDelete,
  }), {
    FieldValue: {
      delete: vi.fn().mockReturnValue('delete-sentinel'),
    },
  });

  return {
    default: {
      firestore,
    },
    firestore,
  };
});

vi.mock('./service-connection-meta', () => ({
  markServiceReconnectRequired: mockMarkServiceReconnectRequired,
  clearServiceConnectionState: mockClearServiceConnectionState,
}));

vi.mock('./service-token-store', () => ({
  deleteLocalServiceToken: mockDeleteLocalServiceToken,
  getServiceTokenCollectionRef: vi.fn(() => tokenCollectionRef),
  getServiceTokenRootDocumentRef: vi.fn(() => tokenRootRef),
}));

vi.mock('./auth/factory', () => ({
  getServiceAdapter: vi.fn(() => ({
    deauthorize: vi.fn(),
    tokenCollectionName: 'suuntoAppAccessTokens',
  })),
}));

import {
  cleanupServiceConnectionForUser,
  cleanupServiceTokenById,
  handleTerminalServiceAuthFailure,
  SERVICE_AUTH_CLEANUP_REASONS,
} from './service-auth-lifecycle';

function makeTimestamp(seconds: number, nanoseconds: number) {
  return {
    seconds,
    nanoseconds,
    toMillis: () => Math.trunc((seconds * 1000) + (nanoseconds / 1_000_000)),
    isEqual(other: { seconds?: number; nanoseconds?: number } | null | undefined) {
      return !!other
        && other.seconds === seconds
        && other.nanoseconds === nanoseconds;
    },
  };
}

describe('service-auth-lifecycle terminal auth handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteLocalServiceToken.mockReset();
    tokenCollectionRef.get.mockReset();
    tokenCollectionRef.limit.mockReset().mockReturnValue({
      get: vi.fn().mockResolvedValue({ empty: false }),
    });
  });

  it('returns a retry resolution when a newer token snapshot already replaced the failing one', async () => {
    const staleTokenSnapshot: any = {
      id: 'suunto-user',
      updateTime: makeTimestamp(1, 100_000),
      ref: tokenRef,
    };
    const latestTokenSnapshot: any = {
      exists: true,
      id: 'suunto-user',
      updateTime: makeTimestamp(2, 200_000),
      ref: tokenRef,
      data: () => ({
        accessToken: 'replacement-access',
      }),
    };

    mockRunTransaction.mockImplementationOnce(async (callback: any) => callback({
      get: vi.fn(async () => latestTokenSnapshot),
      delete: vi.fn(),
    }));

    const resolution = await handleTerminalServiceAuthFailure(
      staleTokenSnapshot,
      ServiceNames.SuuntoApp,
      {
        serviceName: ServiceNames.SuuntoApp,
        accessToken: 'stale-access',
        refreshToken: 'stale-refresh',
        expiresAt: 0,
        userName: 'suunto-user',
      } as any,
      {
        statusCode: 400,
        providerErrorCode: 'invalid_grant',
        providerErrorMessage: 'User no longer active/connected with the partner',
        isInvalidGrant: true,
        isTerminalAuthFailure: true,
        isTransientError: true,
        logMessage: 'invalid_grant',
      },
      new Error('400 invalid_grant'),
    );

    expect(resolution).toMatchObject({
      kind: 'retry_with_latest_snapshot',
      latestSnapshot: latestTokenSnapshot,
    });
    expect(mockMarkServiceReconnectRequired).not.toHaveBeenCalled();
  });

  it('treats a newer token snapshot with the same millisecond value as replaced', async () => {
    const staleTokenSnapshot: any = {
      id: 'suunto-user',
      updateTime: makeTimestamp(1, 100_000),
      ref: tokenRef,
    };
    const latestTokenSnapshot: any = {
      exists: true,
      id: 'suunto-user',
      updateTime: makeTimestamp(1, 900_000),
      ref: tokenRef,
      data: () => ({
        accessToken: 'replacement-access',
      }),
    };
    const transactionDelete = vi.fn();

    mockRunTransaction.mockImplementationOnce(async (callback: any) => callback({
      get: vi.fn(async () => latestTokenSnapshot),
      delete: transactionDelete,
    }));

    const resolution = await handleTerminalServiceAuthFailure(
      staleTokenSnapshot,
      ServiceNames.SuuntoApp,
      {
        serviceName: ServiceNames.SuuntoApp,
        accessToken: 'stale-access',
        refreshToken: 'stale-refresh',
        expiresAt: 0,
        userName: 'suunto-user',
      } as any,
      {
        statusCode: 400,
        providerErrorCode: 'invalid_grant',
        providerErrorMessage: 'User no longer active/connected with the partner',
        isInvalidGrant: true,
        isTerminalAuthFailure: true,
        isTransientError: true,
        logMessage: 'invalid_grant',
      },
      new Error('400 invalid_grant'),
    );

    expect(staleTokenSnapshot.updateTime.toMillis()).toBe(latestTokenSnapshot.updateTime.toMillis());
    expect(resolution).toMatchObject({
      kind: 'retry_with_latest_snapshot',
      latestSnapshot: latestTokenSnapshot,
    });
    expect(transactionDelete).not.toHaveBeenCalled();
    expect(mockMarkServiceReconnectRequired).not.toHaveBeenCalled();
  });

  it('deletes the last stale token version and marks reconnect required without querying the whole provider root', async () => {
    const currentTokenSnapshot: any = {
      exists: true,
      id: 'suunto-user',
      updateTime: makeTimestamp(1, 100_000),
      ref: tokenRef,
      data: () => ({
        accessToken: 'stale-access',
      }),
    };
    const transactionDelete = vi.fn();

    mockRunTransaction.mockImplementationOnce(async (callback: any) => callback({
      get: vi.fn(async (ref: unknown) => {
        if (ref === tokenRef) {
          return currentTokenSnapshot;
        }
        if (ref === tokenCollectionRef) {
          return { docs: [currentTokenSnapshot] };
        }
        if (ref === tokenRootRef) {
          return {
            exists: true,
            data: () => ({}),
          };
        }
        throw new Error('Unexpected transaction get target');
      }),
      delete: transactionDelete,
    }));

    const resolution = await handleTerminalServiceAuthFailure(
      {
        id: 'suunto-user',
        updateTime: makeTimestamp(1, 100_000),
        ref: tokenRef,
      } as any,
      ServiceNames.SuuntoApp,
      {
        serviceName: ServiceNames.SuuntoApp,
        accessToken: 'stale-access',
        refreshToken: 'stale-refresh',
        expiresAt: 0,
        userName: 'suunto-user',
      } as any,
      {
        statusCode: 400,
        providerErrorCode: 'invalid_grant',
        providerErrorMessage: 'User no longer active/connected with the partner',
        isInvalidGrant: true,
        isTerminalAuthFailure: true,
        isTransientError: true,
        logMessage: 'invalid_grant',
      },
      new Error('400 invalid_grant'),
    );

    expect(resolution.kind).toBe('terminal_error');
    if (resolution.kind !== 'terminal_error') {
      throw new Error('Expected terminal_error resolution');
    }
    expect(transactionDelete).toHaveBeenCalledWith(tokenRef);
    expect(transactionDelete).toHaveBeenCalledWith(tokenRootRef);
    expect(mockMarkServiceReconnectRequired).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      'invalid_grant',
      'User no longer active/connected with the partner',
    );
    expect(resolution.error.cleanupOutcome).toMatchObject({
      deletedTokenCount: 1,
      connectionStateUpdate: 'reconnect_required',
      tokenCount: 1,
      preservedTokenCount: 0,
    });
  });

  it('preserves the token root when reconnect state is already stored on it', async () => {
    const currentTokenSnapshot: any = {
      exists: true,
      id: 'suunto-user',
      updateTime: makeTimestamp(1, 100_000),
      ref: tokenRef,
      data: () => ({
        accessToken: 'stale-access',
      }),
    };
    const transactionDelete = vi.fn();

    mockRunTransaction.mockImplementationOnce(async (callback: any) => callback({
      get: vi.fn(async (ref: unknown) => {
        if (ref === tokenRef) {
          return currentTokenSnapshot;
        }
        if (ref === tokenCollectionRef) {
          return { docs: [currentTokenSnapshot] };
        }
        if (ref === tokenRootRef) {
          return {
            exists: true,
            data: () => ({
              state: 'oauth-state',
              codeVerifier: 'pkce-verifier',
            }),
          };
        }
        throw new Error('Unexpected transaction get target');
      }),
      delete: transactionDelete,
    }));

    const resolution = await handleTerminalServiceAuthFailure(
      {
        id: 'suunto-user',
        updateTime: makeTimestamp(1, 100_000),
        ref: tokenRef,
      } as any,
      ServiceNames.SuuntoApp,
      {
        serviceName: ServiceNames.SuuntoApp,
        accessToken: 'stale-access',
        refreshToken: 'stale-refresh',
        expiresAt: 0,
        userName: 'suunto-user',
      } as any,
      {
        statusCode: 400,
        providerErrorCode: 'invalid_grant',
        providerErrorMessage: 'User no longer active/connected with the partner',
        isInvalidGrant: true,
        isTerminalAuthFailure: true,
        isTransientError: true,
        logMessage: 'invalid_grant',
      },
      new Error('400 invalid_grant'),
    );

    expect(resolution.kind).toBe('terminal_error');
    if (resolution.kind !== 'terminal_error') {
      throw new Error('Expected terminal_error resolution');
    }
    expect(transactionDelete).toHaveBeenCalledWith(tokenRef);
    expect(transactionDelete).not.toHaveBeenCalledWith(tokenRootRef);
    expect(mockMarkServiceReconnectRequired).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      'invalid_grant',
      'User no longer active/connected with the partner',
    );
    expect(resolution.error.cleanupOutcome).toMatchObject({
      deletedTokenCount: 1,
      connectionStateUpdate: 'reconnect_required',
      tokenCount: 1,
      preservedTokenCount: 0,
    });
  });

  it('recursively deletes the orphaned token doc when the Firebase user root cannot be resolved', async () => {
    const orphanRef = { id: 'orphan-token', parent: { parent: null } };

    const resolution = await handleTerminalServiceAuthFailure(
      {
        id: 'orphan-token',
        ref: orphanRef,
      } as any,
      ServiceNames.SuuntoApp,
      {
        serviceName: ServiceNames.SuuntoApp,
        accessToken: 'stale-access',
        refreshToken: 'stale-refresh',
        expiresAt: 0,
        userName: 'suunto-user',
      } as any,
      {
        statusCode: 400,
        providerErrorCode: 'invalid_grant',
        providerErrorMessage: 'User no longer active/connected with the partner',
        isInvalidGrant: true,
        isTerminalAuthFailure: true,
        isTransientError: true,
        logMessage: 'invalid_grant',
      },
      new Error('400 invalid_grant'),
    );

    expect(mockRecursiveDelete).toHaveBeenCalledWith(orphanRef);
    expect(resolution.kind).toBe('terminal_error');
    if (resolution.kind !== 'terminal_error') {
      throw new Error('Expected terminal_error resolution');
    }
    expect(resolution.error.cleanupOutcome).toMatchObject({
      deletedTokenCount: 1,
      localCleanupStatus: 'completed',
      connectionStateUpdate: 'unchanged',
    });
    expect(mockMarkServiceReconnectRequired).not.toHaveBeenCalled();
  });

  it('marks orphaned token cleanup as partial when recursive delete fails', async () => {
    const orphanRef = { id: 'orphan-token', parent: { parent: null } };
    mockRecursiveDelete.mockRejectedValueOnce(new Error('recursive delete failed'));

    const resolution = await handleTerminalServiceAuthFailure(
      {
        id: 'orphan-token',
        ref: orphanRef,
      } as any,
      ServiceNames.SuuntoApp,
      {
        serviceName: ServiceNames.SuuntoApp,
        accessToken: 'stale-access',
        refreshToken: 'stale-refresh',
        expiresAt: 0,
        userName: 'suunto-user',
      } as any,
      {
        statusCode: 400,
        providerErrorCode: 'invalid_grant',
        providerErrorMessage: 'User no longer active/connected with the partner',
        isInvalidGrant: true,
        isTerminalAuthFailure: true,
        isTransientError: true,
        logMessage: 'invalid_grant',
      },
      new Error('400 invalid_grant'),
    );

    expect(mockRecursiveDelete).toHaveBeenCalledWith(orphanRef);
    expect(resolution.kind).toBe('terminal_error');
    if (resolution.kind !== 'terminal_error') {
      throw new Error('Expected terminal_error resolution');
    }
    expect(resolution.error.cleanupOutcome).toMatchObject({
      deletedTokenCount: 0,
      localCleanupStatus: 'partial',
      connectionStateUpdate: 'unchanged',
    });
  });

  it('throws a cleanup error when targeted local token deletion fails', async () => {
    mockDeleteLocalServiceToken.mockRejectedValueOnce(new Error('firestore delete failed'));

    await expect(
      cleanupServiceTokenById(
        'firebase-user-123',
        ServiceNames.GarminAPI,
        'garmin-token-id',
        SERVICE_AUTH_CLEANUP_REASONS.PartnerDisconnect,
      ),
    ).rejects.toMatchObject({
      name: 'ServiceTokenCleanupError',
      userID: 'firebase-user-123',
      serviceName: ServiceNames.GarminAPI,
      tokenID: 'garmin-token-id',
      cleanupOutcome: expect.objectContaining({
        localCleanupStatus: 'partial',
        deletedTokenCount: 0,
      }),
    });
  });

  it('throws when user disconnect local cleanup is partial', async () => {
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'garmin-token-id',
          data: () => ({
            serviceName: ServiceNames.GarminAPI,
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            expiresAt: Date.now() + 60_000,
          }),
        },
      ],
    });
    mockDeleteLocalServiceToken.mockRejectedValueOnce(new Error('firestore delete failed'));

    await expect(
      cleanupServiceConnectionForUser(
        'firebase-user-123',
        ServiceNames.GarminAPI,
        SERVICE_AUTH_CLEANUP_REASONS.UserDisconnect,
        {
          tokenResolver: async () => ({
            serviceName: ServiceNames.GarminAPI,
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            expiresAt: Date.now() + 60_000,
          } as any),
        },
      ),
    ).rejects.toMatchObject({
      name: 'ServiceConnectionCleanupError',
      userID: 'firebase-user-123',
      serviceName: ServiceNames.GarminAPI,
      reason: SERVICE_AUTH_CLEANUP_REASONS.UserDisconnect,
      cleanupOutcome: expect.objectContaining({
        localCleanupStatus: 'partial',
        connectionStateUpdate: 'unchanged',
      }),
    });

    expect(mockClearServiceConnectionState).not.toHaveBeenCalled();
  });
});
