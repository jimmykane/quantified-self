'use strict';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestGetMock = vi.fn();

interface MockSuuntoToken {
  id: string;
  userName: string;
  accessToken: string;
}

const suuntoTokens: MockSuuntoToken[] = [];

vi.mock('../request-helper', () => ({
  default: {
    get: (...args: any[]) => requestGetMock(...args),
  },
  get: (...args: any[]) => requestGetMock(...args),
}));

vi.mock('./retry-helper', () => ({
  executeWithTokenRetry: async (
    tokenSnapshot: { data: () => { accessToken: string } },
    operation: (accessToken: string) => Promise<unknown>,
  ) => operation(tokenSnapshot.data().accessToken),
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: vi.fn().mockResolvedValue({
    userExists: true,
    deletionInProgress: false,
    shouldSkip: false,
  }),
  getUserDeletionGuardStateInTransaction: vi.fn().mockResolvedValue({
    userExists: true,
    deletionInProgress: false,
    shouldSkip: false,
  }),
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
    readonly name = 'UserDeletionGuardReadError';
  },
}));

vi.mock('../service-disconnect-pending', () => ({
  isServiceDisconnectPendingForUser: vi.fn().mockResolvedValue(false),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_options: unknown, handler: unknown) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
      this.name = 'HttpsError';
    }
  },
}));

vi.mock('firebase-admin', () => {
  function createTokenSnapshot(token: MockSuuntoToken) {
    const snapshot: any = {
      id: token.id,
      exists: true,
      data: () => ({
        userName: token.userName,
        accessToken: token.accessToken,
      }),
    };
    snapshot.ref = {
      get: vi.fn().mockResolvedValue(snapshot),
    };
    return snapshot;
  }

  return {
    firestore: () => ({
      collection: () => ({
        doc: () => ({
          collection: () => ({
            get: vi.fn().mockImplementation(async () => ({
              size: suuntoTokens.length,
              empty: suuntoTokens.length === 0,
              docs: suuntoTokens.map(createTokenSnapshot),
            })),
          }),
        }),
      }),
    }),
    initializeApp: vi.fn(),
  };
});

import { exportSuuntoRouteAsGPX, listSuuntoRoutes } from './routes';

describe('Suunto route reads with multiple accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    suuntoTokens.length = 0;
  });

  it('aggregates routes from every connected Suunto account and preserves the provider user identity', async () => {
    suuntoTokens.push(
      { id: 'token-a', userName: 'suunto-user-a', accessToken: 'token-a' },
      { id: 'token-b', userName: 'suunto-user-b', accessToken: 'token-b' },
    );
    requestGetMock.mockImplementation(async ({ headers, url }: { headers: Record<string, string>; url: string }) => {
      if (url !== 'https://cloudapi.suunto.com/v2/route') {
        throw new Error(`Unexpected URL ${url}`);
      }

      if (headers.Authorization === 'Bearer token-a') {
        return [{ id: 'route-a', description: 'Account A route' }];
      }
      if (headers.Authorization === 'Bearer token-b') {
        return [{ id: 'route-b', description: 'Account B route' }];
      }

      throw new Error(`Unexpected auth header ${headers.Authorization}`);
    });

    const result = await listSuuntoRoutes('user-1');

    expect(result).toEqual({
      routes: [
        expect.objectContaining({
          providerUserId: 'suunto-user-a',
          id: 'route-a',
          description: 'Account A route',
        }),
        expect.objectContaining({
          providerUserId: 'suunto-user-b',
          id: 'route-b',
          description: 'Account B route',
        }),
      ],
      successfulProviderUserIds: ['suunto-user-a', 'suunto-user-b'],
      failedProviderUserIds: [],
      successfulProviderSourceKeys: ['suunto-user-a:unknown-created', 'suunto-user-b:unknown-created'],
      failedProviderSourceKeys: [],
    });
    expect(requestGetMock).toHaveBeenCalledTimes(2);
  });

  it('reports partial provider failures without dropping successful route listings', async () => {
    suuntoTokens.push(
      { id: 'token-a', userName: 'suunto-user-a', accessToken: 'token-a' },
      { id: 'token-b', userName: 'suunto-user-b', accessToken: 'token-b' },
    );
    requestGetMock.mockImplementation(async ({ headers, url }: { headers: Record<string, string>; url: string }) => {
      if (url !== 'https://cloudapi.suunto.com/v2/route') {
        throw new Error(`Unexpected URL ${url}`);
      }

      if (headers.Authorization === 'Bearer token-a') {
        return [{ id: 'route-a', description: 'Account A route' }];
      }
      if (headers.Authorization === 'Bearer token-b') {
        throw new Error('provider unavailable');
      }

      throw new Error(`Unexpected auth header ${headers.Authorization}`);
    });

    const result = await listSuuntoRoutes('user-1');

    expect(result).toEqual({
      routes: [
        expect.objectContaining({
          providerUserId: 'suunto-user-a',
          id: 'route-a',
          description: 'Account A route',
        }),
      ],
      successfulProviderUserIds: ['suunto-user-a'],
      failedProviderUserIds: ['suunto-user-b'],
      successfulProviderSourceKeys: ['suunto-user-a:unknown-created'],
      failedProviderSourceKeys: ['suunto-user-b:unknown-created'],
    });
  });

  it('targets the matching Suunto account when exporting a provider route', async () => {
    suuntoTokens.push(
      { id: 'token-a', userName: 'suunto-user-a', accessToken: 'token-a' },
      { id: 'token-b', userName: 'suunto-user-b', accessToken: 'token-b' },
    );
    requestGetMock.mockImplementation(async ({ headers, url }: { headers: Record<string, string>; url: string }) => {
      if (url !== 'https://cloudapi.suunto.com/v2/route/provider-route-2/export') {
        throw new Error(`Unexpected URL ${url}`);
      }

      if (headers.Authorization !== 'Bearer token-b') {
        throw new Error(`Unexpected auth header ${headers.Authorization}`);
      }

      return '<gpx>provider-route-2</gpx>';
    });

    const gpx = await exportSuuntoRouteAsGPX('user-1', 'provider-route-2', {
      providerUserId: 'suunto-user-b',
    });

    expect(gpx).toBe('<gpx>provider-route-2</gpx>');
    expect(requestGetMock).toHaveBeenCalledTimes(1);
    expect(requestGetMock).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer token-b',
      }),
      url: 'https://cloudapi.suunto.com/v2/route/provider-route-2/export',
    }));
  });

  it('does not fall back to another connected Suunto account when the source provider token is missing', async () => {
    suuntoTokens.push(
      { id: 'token-a', userName: 'suunto-user-a', accessToken: 'token-a' },
      { id: 'token-b', userName: 'suunto-user-b', accessToken: 'token-b' },
    );

    await expect(exportSuuntoRouteAsGPX('user-1', 'provider-route-2', {
      providerUserId: 'suunto-user-missing',
    })).rejects.toMatchObject({
      code: 'unauthenticated',
    });

    expect(requestGetMock).not.toHaveBeenCalled();
  });
});
