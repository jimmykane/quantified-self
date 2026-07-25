import { describe, expect, it, vi } from 'vitest';

const {
  firestoreMock,
  timestampFromMillisMock,
} = vi.hoisted(() => ({
  firestoreMock: vi.fn(),
  timestampFromMillisMock: vi.fn((milliseconds: number) => ({ milliseconds })),
}));

vi.mock('firebase-admin', () => ({
  firestore: Object.assign(firestoreMock, {
    Timestamp: {
      fromMillis: timestampFromMillisMock,
    },
  }),
}));

import {
  AccessTokenRecord,
  buildFirestoreMcpOAuthStore,
  McpOAuthError,
  MCP_OAUTH_SCOPES,
} from './oauth.service';

interface FakeDocumentReference {
  path: string;
  collection(name: string): FakeDocumentReference;
  doc(id: string): FakeDocumentReference;
}

function fakeDocumentReference(path: string): FakeDocumentReference {
  return {
    path,
    collection: name => fakeDocumentReference(`${path}/${name}`),
    doc: id => fakeDocumentReference(`${path}/${id}`),
  };
}

function fakeSnapshot(
  exists: boolean,
  data: Record<string, unknown> = {},
): {
  exists: boolean;
  data: () => Record<string, unknown>;
} {
  return {
    exists,
    data: () => data,
  };
}

describe('Firestore MCP OAuth store', () => {
  it.each([
    {
      name: 'an active account-deletion tombstone',
      userExists: true,
      tombstoneExists: true,
    },
    {
      name: 'a missing user root',
      userExists: false,
      tombstoneExists: false,
    },
  ])('rejects bearer state writes for $name', async ({
    userExists,
    tombstoneExists,
  }) => {
    const transaction = {
      get: vi.fn(async (ref: FakeDocumentReference) => {
        if (ref.path === 'users/user-1') {
          return fakeSnapshot(userExists);
        }
        if (ref.path === 'userDeletionTombstones/user-1') {
          return fakeSnapshot(tombstoneExists, {
            expireAt: 10_000,
          });
        }
        throw new Error(`Unexpected Firestore read: ${ref.path}`);
      }),
      set: vi.fn(),
      update: vi.fn(),
    };
    const db = {
      collection: vi.fn((name: string) => fakeDocumentReference(name)),
      runTransaction: vi.fn(async (
        handler: (value: typeof transaction) => Promise<unknown>,
      ) => handler(transaction)),
    };
    firestoreMock.mockReturnValue(db);
    const token: AccessTokenRecord = {
      uid: 'user-1',
      connectionId: 'connection-1',
      clientId: 'https://client.example/mcp.json',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 1,
      expiresAtMs: 10_000,
    };

    await expect(
      buildFirestoreMcpOAuthStore().recordAuthorizedRequest(token, 5_000),
    ).rejects.toMatchObject<McpOAuthError>({
      code: 'invalid_grant',
      statusCode: 401,
    });
    expect(transaction.get).toHaveBeenCalledTimes(2);
    expect(transaction.set).not.toHaveBeenCalled();
    expect(transaction.update).not.toHaveBeenCalled();
  });

  it('rejects an access token whose scopes exceed the current connection grant', async () => {
    const transaction = {
      get: vi.fn(async (ref: FakeDocumentReference) => {
        if (ref.path === 'users/user-1') {
          return fakeSnapshot(true);
        }
        if (ref.path === 'userDeletionTombstones/user-1') {
          return fakeSnapshot(false);
        }
        if (ref.path.startsWith('mcpOAuthRateLimits/')) {
          return fakeSnapshot(false);
        }
        if (ref.path === 'users/user-1/mcpConnections/connection-1') {
          return fakeSnapshot(true, {
            scopes: [MCP_OAUTH_SCOPES.MetricsRead],
            revokedAtMs: null,
          });
        }
        throw new Error(`Unexpected Firestore read: ${ref.path}`);
      }),
      set: vi.fn(),
      update: vi.fn(),
    };
    const db = {
      collection: vi.fn((name: string) => fakeDocumentReference(name)),
      runTransaction: vi.fn(async (
        handler: (value: typeof transaction) => Promise<unknown>,
      ) => handler(transaction)),
    };
    firestoreMock.mockReturnValue(db);
    const token: AccessTokenRecord = {
      uid: 'user-1',
      connectionId: 'connection-1',
      clientId: 'https://client.example/mcp.json',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead, MCP_OAUTH_SCOPES.SleepRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 1,
      expiresAtMs: 10_000,
    };

    await expect(
      buildFirestoreMcpOAuthStore().recordAuthorizedRequest(token, 5_000),
    ).rejects.toMatchObject<McpOAuthError>({
      code: 'invalid_grant',
      statusCode: 401,
    });
    expect(transaction.get).toHaveBeenCalledTimes(4);
    expect(transaction.set).not.toHaveBeenCalled();
    expect(transaction.update).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'an active account-deletion tombstone',
      userExists: true,
      tombstoneExists: true,
    },
    {
      name: 'a missing user root',
      userExists: false,
      tombstoneExists: false,
    },
  ])('does not recreate connection state while revoking for $name', async ({
    userExists,
    tombstoneExists,
  }) => {
    const transaction = {
      get: vi.fn(async (ref: FakeDocumentReference) => {
        if (ref.path === 'users/user-1') {
          return fakeSnapshot(userExists);
        }
        if (ref.path === 'userDeletionTombstones/user-1') {
          return fakeSnapshot(tombstoneExists, {
            expireAt: 10_000,
          });
        }
        throw new Error(`Unexpected Firestore read: ${ref.path}`);
      }),
      set: vi.fn(),
      update: vi.fn(),
    };
    const db = {
      collection: vi.fn((name: string) => fakeDocumentReference(name)),
      runTransaction: vi.fn(async (
        handler: (value: typeof transaction) => Promise<unknown>,
      ) => handler(transaction)),
    };
    firestoreMock.mockReturnValue(db);

    await buildFirestoreMcpOAuthStore().revokeConnection(
      'user-1',
      'connection-1',
      5_000,
    );

    expect(transaction.get).toHaveBeenCalledTimes(2);
    expect(transaction.set).not.toHaveBeenCalled();
    expect(transaction.update).not.toHaveBeenCalled();
  });
});
