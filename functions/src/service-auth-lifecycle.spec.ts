import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth2ServiceTokenInterface, ServiceNames } from '@sports-alliance/sports-lib';

const {
  mockMarkServiceReconnectRequired,
  mockClearServiceConnectionState,
  mockRunTransaction,
  mockRecursiveDelete,
  mockDeleteLocalServiceToken,
  mockCleanupProviderOperationalDocsForServiceToken,
  mockAdapterDeauthorize,
  mockGetOAuth2Client,
  mockCreateOAuthToken,
  mockRefreshOAuthToken,
  tokenDocumentGet,
  tokenRef,
  tokenCollectionRef,
  tokenRootRef,
  serviceMetaRef,
} = vi.hoisted(() => {
  const tokenDocumentGet = vi.fn().mockResolvedValue({
    exists: true,
    data: () => ({
      serviceName: 'suuntoApp',
      userName: 'suunto-user',
    }),
  });

  const tokenRef = {
    id: 'suunto-user',
    parent: {
      parent: { id: 'firebase-user-123' },
    },
    get: tokenDocumentGet,
  };

  const tokenCollectionRef = {
    doc: vi.fn(() => ({
      get: tokenDocumentGet,
    })),
    get: vi.fn(),
    limit: vi.fn(),
  };

  const tokenRootRef = {
    id: 'firebase-user-123',
    get: vi.fn(),
    collection: vi.fn((name: string) => {
      if (name !== 'tokens') {
        throw new Error(`Unexpected subcollection ${name}`);
      }
      return tokenCollectionRef;
    }),
  };
  const serviceMetaRef = { id: 'suuntoApp', path: 'users/firebase-user-123/meta/suuntoApp' };

  return {
    mockMarkServiceReconnectRequired: vi.fn().mockResolvedValue(true),
    mockClearServiceConnectionState: vi.fn().mockResolvedValue(undefined),
    mockRunTransaction: vi.fn(),
    mockRecursiveDelete: vi.fn().mockResolvedValue(undefined),
    mockDeleteLocalServiceToken: vi.fn(),
    mockCleanupProviderOperationalDocsForServiceToken: vi.fn().mockResolvedValue({
      providerUserId: 'suunto-user',
      deletedDocCount: 0,
      skippedForActiveConnection: false,
    }),
    mockAdapterDeauthorize: vi.fn().mockResolvedValue(undefined),
    mockGetOAuth2Client: vi.fn(),
    mockCreateOAuthToken: vi.fn(),
    mockRefreshOAuthToken: vi.fn(),
    tokenDocumentGet,
    tokenRef,
    tokenCollectionRef,
    tokenRootRef,
    serviceMetaRef,
  };
});

vi.mock('firebase-admin', () => {
  const firestore = () => ({
    runTransaction: mockRunTransaction,
    recursiveDelete: mockRecursiveDelete,
    collection: vi.fn((name: string) => {
      if (name !== 'users') throw new Error(`Unexpected collection ${name}`);
      return {
        doc: vi.fn(() => ({
          collection: vi.fn(() => ({
            doc: vi.fn(() => serviceMetaRef),
          })),
        })),
      };
    }),
  });

  return {
    default: {
      firestore,
    },
    firestore,
  };
});

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    delete: vi.fn().mockReturnValue('delete-sentinel'),
  },
}));

vi.mock('./service-connection-meta', () => ({
  markServiceReconnectRequired: mockMarkServiceReconnectRequired,
  clearServiceConnectionState: mockClearServiceConnectionState,
}));

vi.mock('./service-token-store', () => ({
  OAUTH_FLOW_GENERATION_FIELD: 'oauthFlowGeneration',
  SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD: 'disconnectOperationGeneration',
  getActiveServiceDisconnectOperationGeneration: (data: Record<string, unknown> | undefined) => {
    const generation = typeof data?.disconnectOperationGeneration === 'string'
      ? data.disconnectOperationGeneration.trim()
      : '';
    const expiresAt = Number(data?.disconnectOperationLeaseExpiresAt || 0);
    return generation && Number.isFinite(expiresAt) && expiresAt > Date.now()
      ? generation
      : null;
  },
  deleteLocalServiceToken: mockDeleteLocalServiceToken,
  getServiceTokenCollectionRef: vi.fn(() => tokenCollectionRef),
  getServiceTokenRootDocumentRef: vi.fn(() => tokenRootRef),
}));

vi.mock('./service-operational-cleanup', () => ({
  cleanupProviderOperationalDocsForServiceToken: mockCleanupProviderOperationalDocsForServiceToken,
}));

vi.mock('./auth/factory', () => ({
  getServiceAdapter: vi.fn(() => ({
    deauthorize: mockAdapterDeauthorize,
    getOAuth2Client: mockGetOAuth2Client,
    tokenCollectionName: 'suuntoAppAccessTokens',
  })),
}));

import {
  cleanupServiceConnectionForUser,
  cleanupServiceTokenById,
  extractRefreshFailureDetails,
  handleTerminalServiceAuthFailure,
  isTerminalRefreshFailureForService,
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

describe('service-auth-lifecycle refresh failure policy', () => {
  it('temporarily keeps only HTTP 400 Suunto invalid_grant failures retryable', () => {
    const invalidGrant = {
      isInvalidGrant: true,
      isTerminalAuthFailure: true,
      statusCode: 400,
    };

    expect(isTerminalRefreshFailureForService(ServiceNames.SuuntoApp, invalidGrant)).toBe(false);
    expect(isTerminalRefreshFailureForService(ServiceNames.GarminAPI, invalidGrant)).toBe(true);
    expect(isTerminalRefreshFailureForService(ServiceNames.SuuntoApp, {
      ...invalidGrant,
      statusCode: 401,
    })).toBe(true);
    expect(isTerminalRefreshFailureForService(ServiceNames.SuuntoApp, {
      ...invalidGrant,
      statusCode: null,
    })).toBe(true);
    expect(isTerminalRefreshFailureForService(ServiceNames.SuuntoApp, {
      ...invalidGrant,
      statusCode: 403,
    })).toBe(true);
  });

  it('normalizes string HTTP status values before applying provider policy', () => {
    const failure = extractRefreshFailureDetails({
      statusCode: '400',
      data: { error: 'invalid_grant' },
    });

    expect(failure.statusCode).toBe(400);
    expect(isTerminalRefreshFailureForService(ServiceNames.SuuntoApp, failure)).toBe(false);
  });
});

describe('service-auth-lifecycle terminal auth handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunTransaction.mockReset().mockImplementation(async (callback: any) => callback({
      get: vi.fn(async (target: { get?: () => Promise<unknown> }) => {
        if (typeof target?.get !== 'function') throw new Error('Unexpected transaction get target');
        return target.get();
      }),
      delete: vi.fn(),
      set: vi.fn(),
      update: vi.fn(),
    }));
    mockDeleteLocalServiceToken.mockReset();
    mockCleanupProviderOperationalDocsForServiceToken.mockReset().mockResolvedValue({
      providerUserId: 'suunto-user',
      deletedDocCount: 0,
      skippedForActiveConnection: false,
    });
    mockAdapterDeauthorize.mockReset().mockResolvedValue(undefined);
    mockRefreshOAuthToken.mockReset();
    mockCreateOAuthToken.mockReset().mockReturnValue({ refresh: mockRefreshOAuthToken });
    mockGetOAuth2Client.mockReset().mockReturnValue({ createToken: mockCreateOAuthToken });
    tokenDocumentGet.mockReset().mockResolvedValue({
      exists: true,
      data: () => ({
        serviceName: 'suuntoApp',
        userName: 'suunto-user',
      }),
    });
    tokenCollectionRef.get.mockReset();
    tokenCollectionRef.limit.mockReset().mockReturnValue({
      get: vi.fn().mockResolvedValue({ empty: false }),
    });
    tokenRootRef.get.mockReset().mockResolvedValue({
      exists: false,
      data: () => undefined,
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

  it('replaces provider refresh details in opaque terminal-auth resolutions', async () => {
    const resolution = await handleTerminalServiceAuthFailure(
      {
        id: 'raw-provider-account-id',
        ref: {
          parent: { parent: undefined },
        },
      } as any,
      ServiceNames.SuuntoApp,
      {
        serviceName: ServiceNames.SuuntoApp,
        accessToken: 'stale-access',
        refreshToken: 'stale-refresh',
        expiresAt: 0,
        userName: 'raw-provider-account-id',
      } as any,
      {
        statusCode: 401,
        providerErrorCode: 'private-provider-code',
        providerErrorMessage: 'sensitive provider response',
        isInvalidGrant: false,
        isTerminalAuthFailure: true,
        isTransientError: true,
        logMessage: 'sensitive provider response',
      },
      new Error('sensitive transport detail'),
      { opaqueTelemetry: true },
    );

    expect(resolution.kind).toBe('terminal_error');
    if (resolution.kind !== 'terminal_error') {
      throw new Error('Expected terminal_error resolution');
    }
    expect(resolution.error).toMatchObject({
      providerErrorCode: 'provider_auth_failed',
      providerErrorMessage: 'Provider authentication failed.',
      originalError: expect.objectContaining({ message: 'Provider token refresh failed.' }),
    });
    expect(JSON.stringify(resolution.error)).not.toContain('sensitive provider response');
    expect(JSON.stringify(resolution.error)).not.toContain('sensitive transport detail');
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
        if (ref === serviceMetaRef) {
          return { exists: true, data: () => ({ connectionStateGeneration: 'connection-generation-1' }) };
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
      expect.any(Number),
      {
        expectedConnectionStateGeneration: 'connection-generation-1',
        providerUserId: 'suunto-user',
        requireEmptyTokenCollection: tokenRef.parent,
      },
    );
    expect(resolution.error.cleanupOutcome).toMatchObject({
      deletedTokenCount: 1,
      connectionStateUpdate: 'reconnect_required',
      tokenCount: 1,
      preservedTokenCount: 0,
    });
  });

  it('marks the pinned Wahoo account reconnect-required when an unrelated legacy token remains', async () => {
    const currentTokenSnapshot: any = {
      exists: true,
      id: 'wahoo-account-a',
      updateTime: makeTimestamp(1, 100_000),
      ref: tokenRef,
      data: () => ({ accessToken: 'stale-access', wahooUserID: 'wahoo-account-a' }),
    };
    const legacyTokenSnapshot: any = {
      exists: true,
      id: 'wahoo-account-b',
      ref: { id: 'wahoo-account-b' },
      data: () => ({ accessToken: 'legacy-access', wahooUserID: 'wahoo-account-b' }),
    };
    const transactionDelete = vi.fn();

    mockRunTransaction.mockImplementationOnce(async (callback: any) => callback({
      get: vi.fn(async (ref: unknown) => {
        if (ref === tokenRef) return currentTokenSnapshot;
        if (ref === tokenCollectionRef) return { docs: [currentTokenSnapshot, legacyTokenSnapshot] };
        if (ref === tokenRootRef) return { exists: true, data: () => ({}) };
        if (ref === serviceMetaRef) {
          return { exists: true, data: () => ({ connectionStateGeneration: 'connection-generation-1' }) };
        }
        throw new Error('Unexpected transaction get target');
      }),
      delete: transactionDelete,
    }));

    const resolution = await handleTerminalServiceAuthFailure(
      {
        id: 'wahoo-account-a',
        updateTime: makeTimestamp(1, 100_000),
        ref: tokenRef,
      } as any,
      ServiceNames.WahooAPI,
      {
        serviceName: ServiceNames.WahooAPI,
        accessToken: 'stale-access',
        refreshToken: 'stale-refresh',
        expiresAt: 0,
        wahooUserID: 'wahoo-account-a',
      } as any,
      {
        statusCode: 400,
        providerErrorCode: 'invalid_grant',
        providerErrorMessage: 'Reconnect required',
        isInvalidGrant: true,
        isTerminalAuthFailure: true,
        isTransientError: true,
        logMessage: 'invalid_grant',
      },
      new Error('400 invalid_grant'),
    );

    expect(resolution.kind).toBe('terminal_error');
    expect(transactionDelete).toHaveBeenCalledWith(tokenRef);
    expect(transactionDelete).not.toHaveBeenCalledWith(tokenRootRef);
    expect(mockMarkServiceReconnectRequired).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.WahooAPI,
      'invalid_grant',
      'Reconnect required',
      expect.any(Number),
      {
        expectedConnectionStateGeneration: 'connection-generation-1',
        providerUserId: 'wahoo-account-a',
        requireMissingToken: tokenRef,
      },
    );
    if (resolution.kind === 'terminal_error') {
      expect(resolution.error.cleanupOutcome).toMatchObject({
        connectionStateUpdate: 'reconnect_required',
        preservedTokenCount: 1,
      });
    }
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
        if (ref === serviceMetaRef) {
          return { exists: true, data: () => ({ connectionStateGeneration: 'connection-generation-1' }) };
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
      expect.any(Number),
      {
        expectedConnectionStateGeneration: 'connection-generation-1',
        providerUserId: 'suunto-user',
        requireEmptyTokenCollection: tokenRef.parent,
      },
    );
    expect(resolution.error.cleanupOutcome).toMatchObject({
      deletedTokenCount: 1,
      connectionStateUpdate: 'reconnect_required',
      tokenCount: 1,
      preservedTokenCount: 0,
    });
  });

  it('guards reconnect fallback with the failed token root generation when deletion fails', async () => {
    const currentTokenSnapshot: any = {
      exists: true,
      id: 'suunto-user',
      updateTime: makeTimestamp(1, 100_000),
      ref: tokenRef,
      data: () => ({
        accessToken: 'stale-access',
        refreshToken: 'stale-refresh',
        tokenCredentialGeneration: 'failed-generation',
      }),
    };
    mockRunTransaction.mockRejectedValueOnce(new Error('firestore delete failed'));

    const resolution = await handleTerminalServiceAuthFailure(
      currentTokenSnapshot,
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
    expect(mockMarkServiceReconnectRequired).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      'invalid_grant',
      'User no longer active/connected with the partner',
      expect.any(Number),
      expect.objectContaining({
        expectedTokenRootCredentialGeneration: {
          documentRef: tokenRootRef,
          fieldName: 'activeOAuthCredentialGeneration',
          expectedGeneration: 'failed-generation',
        },
      }),
    );
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

  it('preserves pending OAuth context for background token cleanup', async () => {
    mockDeleteLocalServiceToken.mockResolvedValueOnce({
      tokenRootDeleted: false,
      tokenRootPreservedForOAuthFlow: true,
      remainingTokenCount: 0,
    });

    await cleanupServiceTokenById(
      'firebase-user-123',
      ServiceNames.GarminAPI,
      'garmin-token-id',
      SERVICE_AUTH_CLEANUP_REASONS.PartnerDisconnect,
    );

    expect(mockDeleteLocalServiceToken).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.GarminAPI,
      'garmin-token-id',
      { preserveOAuthFlowContext: true },
    );
  });

  it('does not apply follow-up cleanup when a duplicate-token ownership guard becomes stale', async () => {
    mockDeleteLocalServiceToken.mockResolvedValueOnce({
      tokenRootDeleted: false,
      tokenRootPreservedForOAuthFlow: false,
      remainingTokenCount: 0,
      skippedByCondition: true,
    });

    const guard = vi.fn().mockResolvedValue(false);
    const outcome = await cleanupServiceTokenById(
      'firebase-user-123',
      ServiceNames.WahooAPI,
      'wahoo-user',
      SERVICE_AUTH_CLEANUP_REASONS.DuplicateConnectionCleanup,
      { shouldDeleteInTransaction: guard },
    );

    expect(mockDeleteLocalServiceToken).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.WahooAPI,
      'wahoo-user',
      expect.objectContaining({ shouldDeleteInTransaction: guard }),
    );
    expect(mockCleanupProviderOperationalDocsForServiceToken).not.toHaveBeenCalled();
    expect(mockClearServiceConnectionState).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      deletedTokenCount: 0,
      skippedByCondition: true,
    });
  });

  it('cleans provider-keyed operational docs after targeted token deletion using captured token data', async () => {
    tokenDocumentGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        serviceName: ServiceNames.GarminAPI,
        userID: 'garmin-provider-user',
      }),
    });
    mockDeleteLocalServiceToken.mockResolvedValueOnce({
      tokenRootDeleted: true,
      tokenRootPreservedForOAuthFlow: false,
      remainingTokenCount: 0,
    });

    await cleanupServiceTokenById(
      'firebase-user-123',
      ServiceNames.GarminAPI,
      'garmin-token-id',
      SERVICE_AUTH_CLEANUP_REASONS.PartnerDisconnect,
    );

    expect(mockCleanupProviderOperationalDocsForServiceToken).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.GarminAPI,
      expect.objectContaining({
        userID: 'garmin-provider-user',
      }),
    );
    expect(mockDeleteLocalServiceToken.mock.invocationCallOrder[0])
      .toBeLessThan(mockCleanupProviderOperationalDocsForServiceToken.mock.invocationCallOrder[0]);
  });

  it('cancels pending OAuth context for targeted account-deletion token cleanup', async () => {
    mockDeleteLocalServiceToken.mockResolvedValueOnce({
      tokenRootDeleted: true,
      tokenRootPreservedForOAuthFlow: false,
      remainingTokenCount: 0,
    });

    await cleanupServiceTokenById(
      'firebase-user-123',
      ServiceNames.GarminAPI,
      'garmin-token-id',
      SERVICE_AUTH_CLEANUP_REASONS.AccountDeletion,
    );

    expect(mockDeleteLocalServiceToken).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.GarminAPI,
      'garmin-token-id',
      expect.objectContaining({ preserveOAuthFlowContext: false }),
    );
  });

  it('uses the post-refresh token version when explicit disconnect deletes its own refreshed credential', async () => {
    const oldUpdateTime = makeTimestamp(1, 100_000);
    const refreshedUpdateTime = makeTimestamp(2, 100_000);
    const refreshedTokenData = {
      serviceName: ServiceNames.GarminAPI,
      accessToken: 'refreshed-access-token',
      refreshToken: 'refreshed-refresh-token',
      expiresAt: Date.now() + 60_000,
    };
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'garmin-token-id',
          ref: tokenRef,
          updateTime: oldUpdateTime,
          data: () => ({
            serviceName: ServiceNames.GarminAPI,
            accessToken: 'old-access-token',
            refreshToken: 'old-refresh-token',
            expiresAt: Date.now() + 60_000,
          }),
        },
      ],
    });
    const refreshedSnapshot = {
      exists: true,
      ref: tokenRef,
      updateTime: refreshedUpdateTime,
      data: () => refreshedTokenData,
    };
    tokenDocumentGet.mockResolvedValue(refreshedSnapshot);
    mockDeleteLocalServiceToken.mockImplementationOnce(async (
      _userID: string,
      _serviceName: ServiceNames,
      _tokenID: string,
      options: { shouldDeleteInTransaction?: (transaction: unknown) => Promise<boolean> },
    ) => {
      const shouldDelete = await options.shouldDeleteInTransaction?.({
        get: vi.fn(async (target: unknown) => target === tokenRootRef
          ? { exists: false, data: () => undefined }
          : refreshedSnapshot),
      });
      return {
        tokenRootDeleted: true,
        tokenRootPreservedForOAuthFlow: false,
        remainingTokenCount: 0,
        skippedByCondition: shouldDelete !== true,
      };
    });

    const outcome = await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.GarminAPI,
      SERVICE_AUTH_CLEANUP_REASONS.UserDisconnect,
      {
        tokenResolver: async () => refreshedTokenData as unknown as Auth2ServiceTokenInterface,
      },
    );

    expect(outcome.deletedTokenCount).toBe(1);
    expect(outcome.skippedByCondition).not.toBe(true);
    expect(mockDeleteLocalServiceToken).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.GarminAPI,
      'garmin-token-id',
      expect.objectContaining({ preserveOAuthFlowContext: false }),
    );
  });

  it('preserves pending-disconnect tokens during explicit user disconnect cleanup', async () => {
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
    const pendingError = new Error('service disconnect is pending');
    pendingError.name = 'TokenUseSkippedForPendingDisconnectError';

    const outcome = await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.GarminAPI,
      SERVICE_AUTH_CLEANUP_REASONS.UserDisconnect,
      {
        tokenResolver: async () => {
          throw pendingError;
        },
      },
    );

    expect(outcome.preservedTokenCount).toBe(1);
    expect(outcome.deletedTokenCount).toBe(0);
    expect(outcome.partnerDeauthorizeAttempted).toBe(0);
    expect(mockDeleteLocalServiceToken).not.toHaveBeenCalled();
    expect(mockClearServiceConnectionState).not.toHaveBeenCalled();
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

  it('account deletion deauthorizes with the stored token snapshot and cancels pending OAuth context', async () => {
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'suunto-token-id',
          data: () => ({
            serviceName: ServiceNames.SuuntoApp,
            accessToken: 'stored-access-token',
            refreshToken: 'stored-refresh-token',
            expiresAt: Date.now() + 120_000,
            scope: 'workout',
            tokenType: 'bearer',
            userName: 'suunto-user-id',
            dateCreated: 1,
            dateRefreshed: 2,
          }),
        },
      ],
    });
    mockDeleteLocalServiceToken.mockResolvedValueOnce({
      tokenRootDeleted: true,
      tokenRootPreservedForOAuthFlow: false,
      remainingTokenCount: 0,
    });

    await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      SERVICE_AUTH_CLEANUP_REASONS.AccountDeletion,
    );

    expect(mockAdapterDeauthorize).toHaveBeenCalledWith(expect.objectContaining({
      serviceName: ServiceNames.SuuntoApp,
      accessToken: 'stored-access-token',
      refreshToken: 'stored-refresh-token',
      userName: 'suunto-user-id',
    }));
    expect(mockDeleteLocalServiceToken).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      'suunto-token-id',
      { preserveOAuthFlowContext: false },
    );
    expect(mockClearServiceConnectionState).not.toHaveBeenCalled();
  });

  it('account deletion deauthorizes Wahoo with its stored provider identity', async () => {
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'wahoo-token-id',
          data: () => ({
            serviceName: ServiceNames.WahooAPI,
            accessToken: 'stored-wahoo-access-token',
            refreshToken: 'stored-wahoo-refresh-token',
            expiresAt: Date.now() + 120_000,
            scope: 'user_read workouts_read',
            tokenType: 'bearer',
            wahooUserID: 'wahoo-user-id',
            dateCreated: 1,
            dateRefreshed: 2,
          }),
        },
      ],
    });
    mockDeleteLocalServiceToken.mockResolvedValueOnce({
      tokenRootDeleted: true,
      tokenRootPreservedForOAuthFlow: false,
      remainingTokenCount: 0,
    });

    await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.WahooAPI,
      SERVICE_AUTH_CLEANUP_REASONS.AccountDeletion,
    );

    expect(mockAdapterDeauthorize).toHaveBeenCalledWith(expect.objectContaining({
      serviceName: ServiceNames.WahooAPI,
      accessToken: 'stored-wahoo-access-token',
      refreshToken: 'stored-wahoo-refresh-token',
      wahooUserID: 'wahoo-user-id',
    }));
    expect(mockDeleteLocalServiceToken).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.WahooAPI,
      'wahoo-token-id',
      { preserveOAuthFlowContext: false },
    );
  });

  it('refreshes expired account-deletion tokens in memory before partner deauthorization without persisting them', async () => {
    const expiredAt = Date.now() - 1_000;
    const refreshedExpiresAt = new Date(Date.now() + 3_600_000);
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'suunto-token-id',
          data: () => ({
            serviceName: ServiceNames.SuuntoApp,
            accessToken: 'expired-access-token',
            refreshToken: 'stored-refresh-token',
            expiresAt: expiredAt,
            scope: 'workout',
            tokenType: 'bearer',
            userName: 'suunto-user-id',
            dateCreated: 1,
            dateRefreshed: 2,
          }),
        },
      ],
    });
    mockRefreshOAuthToken.mockResolvedValueOnce({
      token: {
        access_token: 'fresh-access-token',
        refresh_token: 'fresh-refresh-token',
        expires_at: refreshedExpiresAt,
        scope: 'workout',
        token_type: 'bearer',
      },
    });
    mockDeleteLocalServiceToken.mockResolvedValueOnce({
      tokenRootDeleted: true,
      tokenRootPreservedForOAuthFlow: false,
      remainingTokenCount: 0,
    });

    await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      SERVICE_AUTH_CLEANUP_REASONS.AccountDeletion,
    );

    expect(mockGetOAuth2Client).toHaveBeenCalledWith(true);
    expect(mockCreateOAuthToken).toHaveBeenCalledWith({
      access_token: 'expired-access-token',
      refresh_token: 'stored-refresh-token',
      expires_at: new Date(expiredAt),
    });
    expect(mockAdapterDeauthorize).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'fresh-access-token',
      refreshToken: 'fresh-refresh-token',
      expiresAt: refreshedExpiresAt.getTime(),
      userName: 'suunto-user-id',
    }));
    expect(mockDeleteLocalServiceToken).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      'suunto-token-id',
      { preserveOAuthFlowContext: false },
    );
  });

  it('preserves the Wahoo provider identity when refreshing before account-deletion deauthorization', async () => {
    const expiredAt = Date.now() - 1_000;
    const refreshedExpiresAt = new Date(Date.now() + 3_600_000);
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'wahoo-token-id',
          data: () => ({
            serviceName: ServiceNames.WahooAPI,
            accessToken: 'expired-wahoo-access-token',
            refreshToken: 'stored-wahoo-refresh-token',
            expiresAt: expiredAt,
            scope: 'user_read workouts_read',
            tokenType: 'bearer',
            wahooUserID: 'wahoo-user-id',
            dateCreated: 1,
            dateRefreshed: 2,
          }),
        },
      ],
    });
    mockRefreshOAuthToken.mockResolvedValueOnce({
      token: {
        access_token: 'fresh-wahoo-access-token',
        refresh_token: 'fresh-wahoo-refresh-token',
        expires_at: refreshedExpiresAt,
        scope: 'user_read workouts_read',
        token_type: 'bearer',
      },
    });
    mockDeleteLocalServiceToken.mockResolvedValueOnce({
      tokenRootDeleted: true,
      tokenRootPreservedForOAuthFlow: false,
      remainingTokenCount: 0,
    });

    await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.WahooAPI,
      SERVICE_AUTH_CLEANUP_REASONS.AccountDeletion,
    );

    expect(mockAdapterDeauthorize).toHaveBeenCalledWith(expect.objectContaining({
      serviceName: ServiceNames.WahooAPI,
      accessToken: 'fresh-wahoo-access-token',
      refreshToken: 'fresh-wahoo-refresh-token',
      expiresAt: refreshedExpiresAt.getTime(),
      wahooUserID: 'wahoo-user-id',
    }));
  });

  it('returns refreshed account-deletion token material for archival when partner deauthorization fails after refresh', async () => {
    const expiredAt = Date.now() - 1_000;
    const refreshedExpiresAt = new Date(Date.now() + 3_600_000);
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'suunto-token-id',
          data: () => ({
            serviceName: ServiceNames.SuuntoApp,
            accessToken: 'expired-access-token',
            refreshToken: 'stored-refresh-token',
            expiresAt: expiredAt,
            scope: 'workout',
            tokenType: 'bearer',
            userName: 'suunto-user-id',
            dateCreated: 1,
            dateRefreshed: 2,
          }),
        },
      ],
    });
    mockRefreshOAuthToken.mockResolvedValueOnce({
      token: {
        access_token: 'fresh-access-token',
        refresh_token: 'fresh-refresh-token',
        expires_at: refreshedExpiresAt,
        scope: 'workout',
        token_type: 'bearer',
      },
    });
    mockAdapterDeauthorize.mockRejectedValueOnce(Object.assign(new Error('partner unavailable'), {
      statusCode: 500,
    }));
    mockDeleteLocalServiceToken.mockResolvedValueOnce({
      tokenRootDeleted: true,
      tokenRootPreservedForOAuthFlow: false,
      remainingTokenCount: 0,
    });

    const outcome = await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      SERVICE_AUTH_CLEANUP_REASONS.AccountDeletion,
    );

    expect(outcome.partnerDeauthorizeFailed).toBe(1);
    expect(outcome.preservedTokenCount).toBe(0);
    expect(outcome.deletedTokenCount).toBe(1);
    expect(outcome.tokensToArchive).toEqual([
      expect.objectContaining({
        tokenID: 'suunto-token-id',
        errorMessage: 'partner unavailable',
        tokenData: expect.objectContaining({
          accessToken: 'fresh-access-token',
          refreshToken: 'fresh-refresh-token',
          expiresAt: refreshedExpiresAt.getTime(),
          userName: 'suunto-user-id',
        }),
      }),
    ]);
    expect(mockDeleteLocalServiceToken).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      'suunto-token-id',
      { preserveOAuthFlowContext: false },
    );
  });

  it('archives refreshed account-deletion token material when deauthorization fails without an HTTP status', async () => {
    const expiredAt = Date.now() - 1_000;
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'suunto-token-id',
          data: () => ({
            serviceName: ServiceNames.SuuntoApp,
            accessToken: 'expired-access-token',
            refreshToken: 'stored-refresh-token',
            expiresAt: expiredAt,
            scope: 'workout',
            tokenType: 'bearer',
            userName: 'suunto-user-id',
            dateCreated: 1,
            dateRefreshed: 2,
          }),
        },
      ],
    });
    mockRefreshOAuthToken.mockResolvedValueOnce({
      token: {
        access_token: 'fresh-access-token',
        refresh_token: 'fresh-refresh-token',
        expires_in: 3600,
        scope: 'workout',
        token_type: 'bearer',
      },
    });
    mockAdapterDeauthorize.mockRejectedValueOnce(new Error('network reset'));
    mockDeleteLocalServiceToken.mockResolvedValueOnce({
      tokenRootDeleted: true,
      tokenRootPreservedForOAuthFlow: false,
      remainingTokenCount: 0,
    });

    const outcome = await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      SERVICE_AUTH_CLEANUP_REASONS.AccountDeletion,
    );

    expect(outcome.partnerDeauthorizeFailed).toBe(1);
    expect(outcome.tokensToArchive).toEqual([
      expect.objectContaining({
        tokenID: 'suunto-token-id',
        errorMessage: 'network reset',
        tokenData: expect.objectContaining({
          accessToken: 'fresh-access-token',
          refreshToken: 'fresh-refresh-token',
          userName: 'suunto-user-id',
        }),
      }),
    ]);
    expect(mockDeleteLocalServiceToken).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      'suunto-token-id',
      { preserveOAuthFlowContext: false },
    );
  });

  it('does not archive refreshed account-deletion token material for permanent partner deauthorization failures', async () => {
    const expiredAt = Date.now() - 1_000;
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'suunto-token-id',
          data: () => ({
            serviceName: ServiceNames.SuuntoApp,
            accessToken: 'expired-access-token',
            refreshToken: 'stored-refresh-token',
            expiresAt: expiredAt,
            scope: 'workout',
            tokenType: 'bearer',
            userName: 'suunto-user-id',
            dateCreated: 1,
            dateRefreshed: 2,
          }),
        },
      ],
    });
    mockRefreshOAuthToken.mockResolvedValueOnce({
      token: {
        access_token: 'fresh-access-token',
        refresh_token: 'fresh-refresh-token',
        expires_in: 3600,
        scope: 'workout',
        token_type: 'bearer',
      },
    });
    mockAdapterDeauthorize.mockRejectedValueOnce(Object.assign(new Error('registration not found'), {
      statusCode: 404,
    }));
    mockDeleteLocalServiceToken.mockResolvedValueOnce({
      tokenRootDeleted: true,
      tokenRootPreservedForOAuthFlow: false,
      remainingTokenCount: 0,
    });

    const outcome = await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      SERVICE_AUTH_CLEANUP_REASONS.AccountDeletion,
    );

    expect(outcome.partnerDeauthorizeFailed).toBe(1);
    expect(outcome.tokensToArchive).toBeUndefined();
    expect(outcome.preservedTokenCount).toBe(0);
    expect(outcome.deletedTokenCount).toBe(1);
    expect(mockDeleteLocalServiceToken).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      'suunto-token-id',
      { preserveOAuthFlowContext: false },
    );
  });

  it('preserves subscription-enforcement tokens when partner deauthorization fails retryably', async () => {
    const tokenData = {
      serviceName: ServiceNames.SuuntoApp,
      accessToken: 'valid-access-token',
      refreshToken: 'stored-refresh-token',
      expiresAt: Date.now() + 120_000,
      scope: 'workout',
      tokenType: 'bearer',
      userName: 'suunto-user-id',
      dateCreated: 1,
      dateRefreshed: 2,
    };
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'suunto-token-id',
          ref: tokenRef,
          data: () => tokenData,
        },
      ],
    });
    tokenDocumentGet.mockResolvedValueOnce({
      exists: true,
      ref: tokenRef,
      data: () => tokenData,
    });
    mockAdapterDeauthorize.mockRejectedValueOnce(Object.assign(new Error('gateway timeout'), {
      statusCode: 504,
    }));

    const outcome = await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      SERVICE_AUTH_CLEANUP_REASONS.SubscriptionEnforcement,
    );

    expect(outcome.partnerDeauthorizeFailed).toBe(1);
    expect(outcome.preservedTokenCount).toBe(1);
    expect(outcome.deletedTokenCount).toBe(0);
    expect(outcome.retryableDisconnectFailures).toEqual([
      {
        tokenID: 'suunto-token-id',
        statusCode: 504,
        errorMessage: 'gateway timeout',
        lifecycleGuard: {
          disconnectGeneration: null,
          oauthCredentialGeneration: null,
          oauthFlowGeneration: null,
          disconnectOperationGeneration: null,
        },
      },
    ]);
    expect(mockDeleteLocalServiceToken).not.toHaveBeenCalled();
  });

  it('deletes subscription-enforcement tokens when token refresh is skipped for a deleted user', async () => {
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'suunto-token-id',
          data: () => ({
            serviceName: ServiceNames.SuuntoApp,
            accessToken: 'valid-access-token',
            refreshToken: 'stored-refresh-token',
            expiresAt: Date.now() - 120_000,
            scope: 'workout',
            tokenType: 'bearer',
            userName: 'suunto-user-id',
            dateCreated: 1,
            dateRefreshed: 2,
          }),
        },
      ],
    });
    mockDeleteLocalServiceToken.mockResolvedValueOnce({
      tokenRootDeleted: true,
      tokenRootPreservedForOAuthFlow: false,
      remainingTokenCount: 0,
    });
    const deletionGuardSkip = Object.assign(new Error('Skipping suuntoApp token use because user is missing'), {
      name: 'TokenRefreshSkippedForDeletedUserError',
    });

    const outcome = await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      SERVICE_AUTH_CLEANUP_REASONS.SubscriptionEnforcement,
      {
        tokenResolver: vi.fn().mockRejectedValueOnce(deletionGuardSkip),
      },
    );

    expect(outcome.preservedTokenCount).toBe(0);
    expect(outcome.deletedTokenCount).toBe(1);
    expect(outcome.retryableDisconnectFailures).toBeUndefined();
    expect(mockAdapterDeauthorize).not.toHaveBeenCalled();
    expect(mockDeleteLocalServiceToken).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      'suunto-token-id',
      expect.objectContaining({
        preserveOAuthFlowContext: false,
        preserveTokenRootWhenEmpty: true,
        shouldDeleteInTransaction: expect.any(Function),
      }),
    );
  });

  it('deletes subscription-enforcement tokens when partner deauthorization fails terminally', async () => {
    const tokenData = {
      serviceName: ServiceNames.SuuntoApp,
      accessToken: 'valid-access-token',
      refreshToken: 'stored-refresh-token',
      expiresAt: Date.now() + 120_000,
      scope: 'workout',
      tokenType: 'bearer',
      userName: 'suunto-user-id',
      dateCreated: 1,
      dateRefreshed: 2,
    };
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'suunto-token-id',
          ref: tokenRef,
          data: () => tokenData,
        },
      ],
    });
    tokenDocumentGet.mockResolvedValueOnce({
      exists: true,
      ref: tokenRef,
      data: () => tokenData,
    });
    mockAdapterDeauthorize.mockRejectedValueOnce(Object.assign(new Error('registration not found'), {
      statusCode: 404,
    }));
    mockDeleteLocalServiceToken.mockResolvedValueOnce({
      tokenRootDeleted: true,
      tokenRootPreservedForOAuthFlow: false,
      remainingTokenCount: 0,
    });

    const outcome = await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      SERVICE_AUTH_CLEANUP_REASONS.SubscriptionEnforcement,
    );

    expect(outcome.partnerDeauthorizeFailed).toBe(1);
    expect(outcome.preservedTokenCount).toBe(0);
    expect(outcome.deletedTokenCount).toBe(1);
    expect(outcome.retryableDisconnectFailures).toBeUndefined();
    expect(mockDeleteLocalServiceToken).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      'suunto-token-id',
      expect.objectContaining({
        preserveOAuthFlowContext: false,
        preserveTokenRootWhenEmpty: true,
        shouldDeleteInTransaction: expect.any(Function),
      }),
    );
  });

  it('does not delete a replacement credential written after subscription cleanup captured the original token', async () => {
    const originalTokenData = {
      serviceName: ServiceNames.SuuntoApp,
      accessToken: 'original-access-token',
      refreshToken: 'original-refresh-token',
      expiresAt: Date.now() + 120_000,
      userName: 'suunto-user-id',
      dateCreated: 1,
      dateRefreshed: 2,
      tokenCredentialGeneration: 'credential-a',
    };
    const originalGuard = {
      disconnectGeneration: 'disconnect-generation-a',
      oauthCredentialGeneration: 'oauth-generation-a',
    };
    const originalUpdateTime = {
      isEqual: (other: unknown) => other === originalUpdateTime,
    };
    const replacementUpdateTime = {
      isEqual: (other: unknown) => other === replacementUpdateTime,
    };
    const tokenSnapshot = {
      id: tokenRef.id,
      ref: tokenRef,
      updateTime: originalUpdateTime,
      data: () => originalTokenData,
    };
    tokenCollectionRef.get.mockResolvedValue({
      empty: false,
      size: 1,
      docs: [tokenSnapshot],
    });
    tokenRootRef.get.mockResolvedValue({
      exists: true,
      data: () => ({
        disconnectGeneration: originalGuard.disconnectGeneration,
        activeOAuthCredentialGeneration: originalGuard.oauthCredentialGeneration,
      }),
    });
    mockDeleteLocalServiceToken.mockImplementationOnce(async (
      _userID: string,
      _serviceName: ServiceNames,
      _tokenID: string,
      options: { shouldDeleteInTransaction?: (transaction: unknown) => Promise<boolean> },
    ) => {
      const shouldDelete = await options.shouldDeleteInTransaction?.({
        get: vi.fn(async (target: unknown) => {
          if (target === tokenRootRef) {
            return {
              exists: true,
              data: () => ({
                disconnectGeneration: originalGuard.disconnectGeneration,
                activeOAuthCredentialGeneration: originalGuard.oauthCredentialGeneration,
              }),
            };
          }
          if (target === tokenRef) {
            return {
              exists: true,
              updateTime: replacementUpdateTime,
              // Preserve every credential field to prove that the Firestore
              // document version, rather than value comparison, owns cleanup.
              data: () => ({ ...originalTokenData }),
            };
          }
          throw new Error('Unexpected transaction get target');
        }),
      });
      return {
        tokenRootDeleted: false,
        tokenRootPreservedForOAuthFlow: true,
        remainingTokenCount: 1,
        skippedByCondition: shouldDelete !== true,
      };
    });

    const outcome = await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      SERVICE_AUTH_CLEANUP_REASONS.SubscriptionEnforcement,
      { disconnectLifecycleGuard: originalGuard },
    );

    expect(outcome.skippedByCondition).toBe(true);
    expect(outcome.deletedTokenCount).toBe(0);
    expect(outcome.preservedTokenCount).toBe(0);
  });

  it('records subscription-enforcement local cleanup failures for pending disconnect retry', async () => {
    const tokenData = {
      serviceName: ServiceNames.SuuntoApp,
      accessToken: 'valid-access-token',
      refreshToken: 'stored-refresh-token',
      expiresAt: Date.now() + 120_000,
      scope: 'workout',
      tokenType: 'bearer',
      userName: 'suunto-user-id',
      dateCreated: 1,
      dateRefreshed: 2,
    };
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'suunto-token-id',
          ref: tokenRef,
          data: () => tokenData,
        },
      ],
    });
    tokenDocumentGet.mockResolvedValueOnce({
      exists: true,
      ref: tokenRef,
      data: () => tokenData,
    });
    mockDeleteLocalServiceToken.mockRejectedValueOnce(new Error('firestore unavailable'));

    const outcome = await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      SERVICE_AUTH_CLEANUP_REASONS.SubscriptionEnforcement,
    );

    expect(outcome.localCleanupStatus).toBe('partial');
    expect(outcome.deletedTokenCount).toBe(0);
    expect(outcome.retryableDisconnectFailures).toEqual([
      {
        tokenID: 'suunto-token-id',
        statusCode: null,
        errorMessage: expect.stringContaining('local cleanup failed after subscription-enforcement deauthorization'),
        lifecycleGuard: {
          disconnectGeneration: null,
          oauthCredentialGeneration: null,
          oauthFlowGeneration: null,
          disconnectOperationGeneration: null,
        },
      },
    ]);
  });

  it('does not deauthorize or delete after OAuth replaces the disconnect episode', async () => {
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'suunto-token-id',
          data: () => ({
            serviceName: ServiceNames.SuuntoApp,
            accessToken: 'valid-access-token',
            refreshToken: 'stored-refresh-token',
            expiresAt: Date.now() + 120_000,
            userName: 'suunto-user-id',
          }),
        },
      ],
    });
    const originalGuard = {
      disconnectGeneration: 'disconnect-generation-a',
      oauthCredentialGeneration: 'credential-generation-a',
    };
    tokenRootRef.get
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          disconnectGeneration: originalGuard.disconnectGeneration,
          activeOAuthCredentialGeneration: originalGuard.oauthCredentialGeneration,
        }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          disconnectGeneration: originalGuard.disconnectGeneration,
          activeOAuthCredentialGeneration: originalGuard.oauthCredentialGeneration,
        }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          activeOAuthCredentialGeneration: 'credential-generation-b',
        }),
      });

    const outcome = await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      SERVICE_AUTH_CLEANUP_REASONS.SubscriptionEnforcement,
      {
        disconnectLifecycleGuard: originalGuard,
        tokenResolver: vi.fn().mockResolvedValue({
          serviceName: ServiceNames.SuuntoApp,
          accessToken: 'valid-access-token',
        }),
      },
    );

    expect(outcome.skippedByCondition).toBe(true);
    expect(mockAdapterDeauthorize).not.toHaveBeenCalled();
    expect(mockDeleteLocalServiceToken).not.toHaveBeenCalled();
  });

  it('does not resume expired explicit-disconnect cleanup', async () => {
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [{
        id: 'suunto-token-id',
        ref: tokenRef,
        data: () => ({
          serviceName: ServiceNames.SuuntoApp,
          accessToken: 'valid-access-token',
          refreshToken: 'stored-refresh-token',
          expiresAt: Date.now() + 120_000,
          userName: 'suunto-user-id',
        }),
      }],
    });
    const guard = {
      disconnectGeneration: null,
      oauthCredentialGeneration: null,
      oauthFlowGeneration: 'disconnect-flow-1',
      disconnectOperationGeneration: 'disconnect-operation-1',
    };
    tokenRootRef.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        oauthFlowGeneration: guard.oauthFlowGeneration,
        disconnectOperationGeneration: guard.disconnectOperationGeneration,
        disconnectOperationLeaseExpiresAt: Date.now() - 1,
      }),
    });

    const outcome = await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      SERVICE_AUTH_CLEANUP_REASONS.UserDisconnect,
      { disconnectLifecycleGuard: guard },
    );

    expect(outcome.skippedByCondition).toBe(true);
    expect(mockAdapterDeauthorize).not.toHaveBeenCalled();
    expect(mockDeleteLocalServiceToken).not.toHaveBeenCalled();
  });

  it('does not delete an empty token root after OAuth replaces the disconnect episode', async () => {
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: true,
      size: 0,
      docs: [],
    });
    const originalGuard = {
      disconnectGeneration: 'disconnect-generation-a',
      oauthCredentialGeneration: 'credential-generation-a',
    };
    tokenRootRef.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        disconnectState: 'disconnect_pending',
        disconnectGeneration: originalGuard.disconnectGeneration,
        activeOAuthCredentialGeneration: originalGuard.oauthCredentialGeneration,
      }),
    });
    mockRunTransaction.mockImplementationOnce(async (callback: any) => callback({
      get: vi.fn()
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({ activeOAuthCredentialGeneration: 'credential-generation-b' }),
        })
        .mockResolvedValueOnce({ empty: true, docs: [] }),
      delete: vi.fn(),
    }));

    const outcome = await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      SERVICE_AUTH_CLEANUP_REASONS.SubscriptionEnforcement,
      {
        disconnectLifecycleGuard: originalGuard,
        missingTokensBehavior: 'ignore',
      },
    );

    expect(outcome.skippedByCondition).toBe(true);
    expect(mockRecursiveDelete).not.toHaveBeenCalled();
    expect(mockClearServiceConnectionState).not.toHaveBeenCalled();
  });

  it('clears pending metadata before deleting the generation-bearing empty token root', async () => {
    const tokenData = {
      serviceName: ServiceNames.SuuntoApp,
      accessToken: 'valid-access-token',
      refreshToken: 'stored-refresh-token',
      expiresAt: Date.now() + 120_000,
      userName: 'suunto-user-id',
    };
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [{
        id: 'suunto-token-id',
        ref: tokenRef,
        data: () => tokenData,
      }],
    });
    tokenDocumentGet.mockResolvedValueOnce({
      exists: true,
      ref: tokenRef,
      data: () => tokenData,
    });
    const guard = {
      disconnectGeneration: 'disconnect-generation-a',
      oauthCredentialGeneration: 'credential-generation-a',
    };
    const guardedRootSnapshot = {
      exists: true,
      data: () => ({
        disconnectState: 'disconnect_pending',
        disconnectGeneration: guard.disconnectGeneration,
        activeOAuthCredentialGeneration: guard.oauthCredentialGeneration,
      }),
    };
    tokenRootRef.get.mockResolvedValue(guardedRootSnapshot);
    mockDeleteLocalServiceToken.mockResolvedValueOnce({
      tokenRootDeleted: false,
      tokenRootPreservedForOAuthFlow: false,
      remainingTokenCount: 0,
      skippedByCondition: false,
    });
    mockClearServiceConnectionState.mockResolvedValueOnce(true);
    tokenCollectionRef.limit.mockReturnValueOnce({
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
    });
    const transactionDelete = vi.fn();
    mockRunTransaction.mockImplementation(async (callback: any) => callback({
      get: vi.fn(async (target: { get?: () => Promise<unknown> }) => {
        if (typeof target?.get !== 'function') throw new Error('Unexpected transaction get target');
        return target.get();
      }),
      delete: transactionDelete,
    }));

    const outcome = await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      SERVICE_AUTH_CLEANUP_REASONS.SubscriptionEnforcement,
      { disconnectLifecycleGuard: guard },
    );

    expect(outcome.connectionStateUpdate).toBe('cleared');
    expect(mockDeleteLocalServiceToken).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      'suunto-token-id',
      expect.objectContaining({ preserveTokenRootWhenEmpty: true }),
    );
    expect(mockClearServiceConnectionState).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      expect.objectContaining({
        expectedPendingDisconnectGeneration: guard.disconnectGeneration,
        expectedDisconnectLifecycleGuard: expect.objectContaining({
          oauthCredentialGeneration: guard.oauthCredentialGeneration,
        }),
      }),
    );
    expect(transactionDelete).toHaveBeenCalledWith(tokenRootRef);
    expect(mockClearServiceConnectionState.mock.invocationCallOrder[0])
      .toBeLessThan(transactionDelete.mock.invocationCallOrder[0]);
  });

  it('archives stored account-deletion token material when partner deauthorization fails without a status before refresh', async () => {
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'suunto-token-id',
          data: () => ({
            serviceName: ServiceNames.SuuntoApp,
            accessToken: 'valid-access-token',
            refreshToken: 'stored-refresh-token',
            expiresAt: Date.now() + 120_000,
            scope: 'workout',
            tokenType: 'bearer',
            userName: 'suunto-user-id',
            dateCreated: 1,
            dateRefreshed: 2,
          }),
        },
      ],
    });
    mockAdapterDeauthorize.mockRejectedValueOnce(new Error('network reset'));
    mockDeleteLocalServiceToken.mockResolvedValueOnce({
      tokenRootDeleted: true,
      tokenRootPreservedForOAuthFlow: false,
      remainingTokenCount: 0,
    });

    const outcome = await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      SERVICE_AUTH_CLEANUP_REASONS.AccountDeletion,
    );

    expect(outcome.partnerDeauthorizeFailed).toBe(1);
    expect(outcome.preservedTokenCount).toBe(0);
    expect(outcome.deletedTokenCount).toBe(1);
    expect(outcome.tokensToArchive).toEqual([
      expect.objectContaining({
        tokenID: 'suunto-token-id',
        errorMessage: 'network reset',
        tokenData: expect.objectContaining({
          accessToken: 'valid-access-token',
          refreshToken: 'stored-refresh-token',
          userName: 'suunto-user-id',
        }),
      }),
    ]);
    expect(mockDeleteLocalServiceToken).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      'suunto-token-id',
      { preserveOAuthFlowContext: false },
    );
  });

  it('archives stored account-deletion token material when in-memory refresh fails transiently', async () => {
    const expiredAt = Date.now() - 1_000;
    tokenCollectionRef.get.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'suunto-token-id',
          data: () => ({
            serviceName: ServiceNames.SuuntoApp,
            accessToken: 'expired-access-token',
            refreshToken: 'stored-refresh-token',
            expiresAt: expiredAt,
            scope: 'workout',
            tokenType: 'bearer',
            userName: 'suunto-user-id',
            dateCreated: 1,
            dateRefreshed: 2,
          }),
        },
      ],
    });
    mockRefreshOAuthToken.mockRejectedValueOnce(new Error('refresh network reset'));
    mockDeleteLocalServiceToken.mockResolvedValueOnce({
      tokenRootDeleted: true,
      tokenRootPreservedForOAuthFlow: false,
      remainingTokenCount: 0,
    });

    const outcome = await cleanupServiceConnectionForUser(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      SERVICE_AUTH_CLEANUP_REASONS.AccountDeletion,
    );

    expect(mockAdapterDeauthorize).not.toHaveBeenCalled();
    expect(outcome.partnerDeauthorizeAttempted).toBe(0);
    expect(outcome.tokensToArchive).toEqual([
      expect.objectContaining({
        tokenID: 'suunto-token-id',
        errorMessage: 'refresh network reset',
        tokenData: expect.objectContaining({
          accessToken: 'expired-access-token',
          refreshToken: 'stored-refresh-token',
          userName: 'suunto-user-id',
        }),
      }),
    ]);
    expect(mockDeleteLocalServiceToken).toHaveBeenCalledWith(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      'suunto-token-id',
      { preserveOAuthFlowContext: false },
    );
  });
});
