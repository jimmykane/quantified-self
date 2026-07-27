import { describe, expect, it, vi } from 'vitest';

const {
  fieldValueDeleteMock,
  firestoreMock,
  timestampFromMillisMock,
} = vi.hoisted(() => ({
  fieldValueDeleteMock: vi.fn(() => ({ deleteField: true })),
  firestoreMock: vi.fn(),
  timestampFromMillisMock: vi.fn((milliseconds: number) => ({ milliseconds })),
}));

vi.mock('firebase-admin', () => ({
  firestore: Object.assign(firestoreMock, {
    Timestamp: {
      fromMillis: timestampFromMillisMock,
    },
    FieldValue: {
      delete: fieldValueDeleteMock,
    },
  }),
}));

import {
  AccessTokenRecord,
  buildMcpAuthorizationStartRateLimitBucketId,
  buildMcpRevocationRateLimitBucketId,
  buildFirestoreMcpOAuthStore,
  cleanupMcpOAuthStateForUser,
  McpOAuthCleanupIncompleteError,
  McpOAuthError,
  MCP_OAUTH_COLLECTIONS,
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
  it('stores an approved connection as pending with the authorization-code expiry', async () => {
    const transaction = {
      get: vi.fn(async (ref: FakeDocumentReference) => {
        if (ref.path === 'users/user-1') {
          return fakeSnapshot(true);
        }
        if (ref.path === 'userDeletionTombstones/user-1') {
          return fakeSnapshot(false);
        }
        if (ref.path === 'mcpOAuthAuthorizationRequests/request-1') {
          return fakeSnapshot(true, {
            status: 'pending',
            expiresAtMs: 10_000,
          });
        }
        throw new Error(`Unexpected Firestore read: ${ref.path}`);
      }),
      create: vi.fn(),
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

    await buildFirestoreMcpOAuthStore().approveAuthorization({
      uid: 'user-1',
      requestId: 'request-1',
      grantedScopes: [MCP_OAUTH_SCOPES.MetricsRead],
      codeHash: 'code-hash',
      codeRecord: {
        uid: 'user-1',
        connectionId: 'connection-1',
        clientId: 'https://client.example/mcp.json',
        redirectUri: 'https://client.example/oauth/callback',
        codeChallenge: 'challenge',
        scopes: [MCP_OAUTH_SCOPES.MetricsRead],
        audience: 'https://quantified-self.io/mcp',
        createdAtMs: 5_000,
        expiresAtMs: 8_000,
      },
      connection: {
        connectionId: 'connection-1',
        clientId: 'https://client.example/mcp.json',
        clientName: 'Example MCP Client',
        redirectHost: 'client.example',
        scopes: [MCP_OAUTH_SCOPES.MetricsRead],
        createdAtMs: 5_000,
        lastUsedAtMs: null,
        revokedAtMs: null,
        status: 'pending',
      },
      nowMs: 5_000,
    });

    expect(transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'users/user-1/mcpConnections/connection-1',
      }),
      expect.objectContaining({
        status: 'pending',
        expireAt: { milliseconds: 8_000 },
      }),
    );
  });

  it('marks an existing connection revoked and removes any pending TTL', async () => {
    const transaction = {
      get: vi.fn(async (ref: FakeDocumentReference) => {
        if (ref.path === 'users/user-1') {
          return fakeSnapshot(true);
        }
        if (ref.path === 'userDeletionTombstones/user-1') {
          return fakeSnapshot(false);
        }
        if (ref.path === 'users/user-1/mcpConnections/connection-1') {
          return fakeSnapshot(true, {
            status: 'active',
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

    await buildFirestoreMcpOAuthStore().revokeConnection(
      {
        kind: 'owner',
        uid: 'user-1',
        connectionId: 'connection-1',
      },
      5_000,
    );

    expect(transaction.set).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'users/user-1/mcpConnections/connection-1',
      }),
      {
        status: 'revoked',
        revokedAtMs: 5_000,
        expireAt: { deleteField: true },
      },
      { merge: true },
    );
    expect(transaction.get).toHaveBeenCalledTimes(3);
  });

  it('preserves the first terminal state when a concurrent revocation already won', async () => {
    const transaction = {
      get: vi.fn(async (ref: FakeDocumentReference) => {
        if (ref.path === 'users/user-1') {
          return fakeSnapshot(true);
        }
        if (ref.path === 'userDeletionTombstones/user-1') {
          return fakeSnapshot(false);
        }
        if (ref.path === 'users/user-1/mcpConnections/connection-1') {
          return fakeSnapshot(true, {
            status: 'revoked',
            revokedAtMs: 4_000,
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
      {
        kind: 'owner',
        uid: 'user-1',
        connectionId: 'connection-1',
      },
      5_000,
    );

    expect(transaction.get).toHaveBeenCalledTimes(3);
    expect(transaction.set).not.toHaveBeenCalled();
    expect(transaction.update).not.toHaveBeenCalled();
  });

  it('atomically activates a pending connection and removes its TTL on code exchange', async () => {
    const transaction = {
      get: vi.fn(async (ref: FakeDocumentReference) => {
        if (ref.path === 'mcpOAuthAuthorizationCodes/code-hash') {
          return fakeSnapshot(true, {
            uid: 'user-1',
            connectionId: 'connection-1',
            clientId: 'https://client.example/mcp.json',
            redirectUri: 'https://client.example/oauth/callback',
            codeChallenge: 'challenge',
            scopes: [MCP_OAUTH_SCOPES.MetricsRead],
            audience: 'https://quantified-self.io/mcp',
            expiresAtMs: 8_000,
          });
        }
        if (ref.path === 'users/user-1') {
          return fakeSnapshot(true);
        }
        if (ref.path === 'userDeletionTombstones/user-1') {
          return fakeSnapshot(false);
        }
        if (ref.path === 'users/user-1/mcpConnections/connection-1') {
          return fakeSnapshot(true, {
            status: 'pending',
            lastUsedAtMs: null,
            revokedAtMs: null,
          });
        }
        throw new Error(`Unexpected Firestore read: ${ref.path}`);
      }),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    };
    const db = {
      collection: vi.fn((name: string) => fakeDocumentReference(name)),
      runTransaction: vi.fn(async (
        handler: (value: typeof transaction) => Promise<unknown>,
      ) => handler(transaction)),
    };
    firestoreMock.mockReturnValue(db);

    await buildFirestoreMcpOAuthStore().exchangeAuthorizationCode({
      codeHash: 'code-hash',
      clientId: 'https://client.example/mcp.json',
      redirectUri: 'https://client.example/oauth/callback',
      audience: 'https://quantified-self.io/mcp',
      codeChallenge: 'challenge',
      accessTokenHash: 'access-hash',
      accessTokenRecord: {
        uid: '',
        connectionId: '',
        clientId: 'https://client.example/mcp.json',
        scopes: [],
        audience: 'https://quantified-self.io/mcp',
        createdAtMs: 5_000,
        expiresAtMs: 10_000,
      },
      refreshTokenHash: 'refresh-hash',
      refreshTokenRecord: {
        uid: '',
        connectionId: '',
        clientId: 'https://client.example/mcp.json',
        scopes: [],
        audience: 'https://quantified-self.io/mcp',
        familyId: 'family-1',
        createdAtMs: 5_000,
        expiresAtMs: 20_000,
      },
      nowMs: 5_000,
    });

    expect(transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'users/user-1/mcpConnections/connection-1',
      }),
      {
        status: 'active',
        lastUsedAtMs: 5_000,
        expireAt: { deleteField: true },
      },
    );
  });

  function buildAuthorizationStartRateLimitFirestore() {
    const documents = new Map<string, Record<string, unknown>>();
    const transaction = {
      get: vi.fn(async (ref: FakeDocumentReference) => {
        const data = documents.get(ref.path);
        return fakeSnapshot(Boolean(data), data);
      }),
      set: vi.fn((
        ref: FakeDocumentReference,
        data: Record<string, unknown>,
      ) => {
        documents.set(ref.path, data);
      }),
    };
    const db = {
      collection: vi.fn((name: string) => fakeDocumentReference(name)),
      runTransaction: vi.fn(async (
        handler: (value: typeof transaction) => Promise<unknown>,
      ) => handler(transaction)),
    };
    firestoreMock.mockReturnValue(db);
    return {
      documents,
      transaction,
    };
  }

  it('bounds authorization starts by client before metadata retrieval', async () => {
    const rateLimits = buildAuthorizationStartRateLimitFirestore();
    const store = buildFirestoreMcpOAuthStore();
    const input = {
      clientId: 'https://client.example/mcp.json',
      requesterKey: '203.0.113.10',
      nowMs: 61_000,
    };

    for (let count = 0; count < 10; count++) {
      await store.consumeAuthorizationStartRateLimit(input);
    }
    await expect(store.consumeAuthorizationStartRateLimit(input)).rejects.toMatchObject<
      McpOAuthError
    >({
      code: 'temporarily_unavailable',
      statusCode: 429,
    });

    const clientBucketId = buildMcpAuthorizationStartRateLimitBucketId(
      'authorization_start_client',
      input.clientId,
      60_000,
    );
    expect(rateLimits.documents.get(
      `${MCP_OAUTH_COLLECTIONS.rateLimits}/${clientBucketId}`,
    )).toEqual(expect.objectContaining({
      rateLimitType: 'authorization_start_client',
      windowStartMs: 60_000,
      count: 10,
    }));
    expect(JSON.stringify([...rateLimits.documents])).not.toContain(input.clientId);
    expect(JSON.stringify([...rateLimits.documents])).not.toContain(input.requesterKey);
  });

  it('bounds authorization starts across rotating client IDs from one requester', async () => {
    buildAuthorizationStartRateLimitFirestore();
    const store = buildFirestoreMcpOAuthStore();
    const requesterKey = '203.0.113.10';

    for (let count = 0; count < 30; count++) {
      await store.consumeAuthorizationStartRateLimit({
        clientId: `https://client-${count}.example/mcp.json`,
        requesterKey,
        nowMs: 61_000,
      });
    }
    await expect(store.consumeAuthorizationStartRateLimit({
      clientId: 'https://client-over-limit.example/mcp.json',
      requesterKey,
      nowMs: 61_000,
    })).rejects.toMatchObject<McpOAuthError>({
      code: 'temporarily_unavailable',
      statusCode: 429,
    });
  });

  it('bounds public token revocation by both client and requester without storing raw keys', async () => {
    const rateLimits = buildAuthorizationStartRateLimitFirestore();
    const store = buildFirestoreMcpOAuthStore();
    const clientId = 'https://client.example/mcp.json';
    const requesterKey = '203.0.113.10';

    for (let count = 0; count < 30; count++) {
      await store.consumeRevocationRateLimit({
        clientId,
        requesterKey,
        nowMs: 61_000,
      });
    }
    await expect(store.consumeRevocationRateLimit({
      clientId,
      requesterKey,
      nowMs: 61_000,
    })).rejects.toMatchObject<McpOAuthError>({
      code: 'temporarily_unavailable',
      statusCode: 429,
    });

    const clientBucketId = buildMcpRevocationRateLimitBucketId(
      'revocation_client',
      clientId,
      60_000,
    );
    expect(rateLimits.documents.get(
      `${MCP_OAUTH_COLLECTIONS.rateLimits}/${clientBucketId}`,
    )).toEqual(expect.objectContaining({
      rateLimitType: 'revocation_client',
      windowStartMs: 60_000,
      count: 30,
    }));
    expect(JSON.stringify([...rateLimits.documents])).not.toContain(clientId);
    expect(JSON.stringify([...rateLimits.documents])).not.toContain(requesterKey);
  });

  it('bounds token revocation across rotating client IDs from one requester', async () => {
    buildAuthorizationStartRateLimitFirestore();
    const store = buildFirestoreMcpOAuthStore();
    const requesterKey = '203.0.113.10';

    for (let count = 0; count < 60; count++) {
      await store.consumeRevocationRateLimit({
        clientId: `https://client-${count}.example/mcp.json`,
        requesterKey,
        nowMs: 61_000,
      });
    }
    await expect(store.consumeRevocationRateLimit({
      clientId: 'https://client-over-limit.example/mcp.json',
      requesterKey,
      nowMs: 61_000,
    })).rejects.toMatchObject<McpOAuthError>({
      code: 'temporarily_unavailable',
      statusCode: 429,
    });
  });

  it('resolves only a hashed token document and revokes its client-bound connection', async () => {
    const transaction = {
      get: vi.fn(async (ref: FakeDocumentReference) => {
        if (ref.path === 'mcpOAuthAccessTokens/submitted-token-hash') {
          return fakeSnapshot(true, {
            uid: 'user-1',
            connectionId: 'connection-1',
            clientId: 'https://client.example/mcp.json',
            expiresAtMs: 10_000,
          });
        }
        if (ref.path === 'mcpOAuthRefreshTokens/submitted-token-hash') {
          return fakeSnapshot(false);
        }
        if (ref.path === 'users/user-1') {
          return fakeSnapshot(true);
        }
        if (ref.path === 'userDeletionTombstones/user-1') {
          return fakeSnapshot(false);
        }
        if (ref.path === 'users/user-1/mcpConnections/connection-1') {
          return fakeSnapshot(true, {
            clientId: 'https://client.example/mcp.json',
            status: 'active',
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

    await buildFirestoreMcpOAuthStore().revokeConnection({
      kind: 'token',
      tokenHash: 'submitted-token-hash',
      tokenTypeHint: 'access_token',
      clientId: 'https://client.example/mcp.json',
    }, 5_000);

    expect(transaction.get.mock.calls.map(([ref]) => ref.path)).toEqual([
      'mcpOAuthAccessTokens/submitted-token-hash',
      'mcpOAuthRefreshTokens/submitted-token-hash',
      'users/user-1',
      'userDeletionTombstones/user-1',
      'users/user-1/mcpConnections/connection-1',
    ]);
    expect(transaction.set).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'users/user-1/mcpConnections/connection-1',
      }),
      {
        status: 'revoked',
        revokedAtMs: 5_000,
        expireAt: { deleteField: true },
      },
      { merge: true },
    );
  });

  it('does not revoke a token owned by a different public client', async () => {
    const transaction = {
      get: vi.fn(async (ref: FakeDocumentReference) => {
        if (ref.path === 'mcpOAuthAccessTokens/submitted-token-hash') {
          return fakeSnapshot(true, {
            uid: 'user-1',
            connectionId: 'connection-1',
            clientId: 'https://owner.example/mcp.json',
            expiresAtMs: 10_000,
          });
        }
        if (ref.path === 'mcpOAuthRefreshTokens/submitted-token-hash') {
          return fakeSnapshot(false);
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

    await buildFirestoreMcpOAuthStore().revokeConnection({
      kind: 'token',
      tokenHash: 'submitted-token-hash',
      tokenTypeHint: 'access_token',
      clientId: 'https://other.example/mcp.json',
    }, 5_000);

    expect(transaction.get).toHaveBeenCalledTimes(2);
    expect(transaction.set).not.toHaveBeenCalled();
    expect(transaction.update).not.toHaveBeenCalled();
  });

  it('does not revoke when the token and connection client bindings disagree', async () => {
    const transaction = {
      get: vi.fn(async (ref: FakeDocumentReference) => {
        if (ref.path === 'mcpOAuthAccessTokens/submitted-token-hash') {
          return fakeSnapshot(true, {
            uid: 'user-1',
            connectionId: 'connection-1',
            clientId: 'https://client.example/mcp.json',
            expiresAtMs: 10_000,
          });
        }
        if (ref.path === 'mcpOAuthRefreshTokens/submitted-token-hash') {
          return fakeSnapshot(false);
        }
        if (ref.path === 'users/user-1') {
          return fakeSnapshot(true);
        }
        if (ref.path === 'userDeletionTombstones/user-1') {
          return fakeSnapshot(false);
        }
        if (ref.path === 'users/user-1/mcpConnections/connection-1') {
          return fakeSnapshot(true, {
            clientId: 'https://different-client.example/mcp.json',
            status: 'active',
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

    await buildFirestoreMcpOAuthStore().revokeConnection({
      kind: 'token',
      tokenHash: 'submitted-token-hash',
      tokenTypeHint: 'access_token',
      clientId: 'https://client.example/mcp.json',
    }, 5_000);

    expect(transaction.get).toHaveBeenCalledTimes(5);
    expect(transaction.set).not.toHaveBeenCalled();
    expect(transaction.update).not.toHaveBeenCalled();
  });

  function buildCleanupFirestore(
    initialDocuments: Partial<Record<string, string[]>>,
  ) {
    const documents = new Map<string, Array<{ ref: FakeDocumentReference }>>(
      Object.entries(initialDocuments).map(([collectionName, paths]) => [
        collectionName,
        (paths || []).map(path => ({ ref: fakeDocumentReference(path) })),
      ]),
    );
    const limitCalls: number[] = [];
    const queryFor = (collectionName: string) => {
      const query = {
        where: vi.fn(() => query),
        limit: vi.fn((limit: number) => {
          limitCalls.push(limit);
          return {
            get: vi.fn(async () => {
              const docs = documents.get(collectionName) || [];
              return {
                docs: docs.slice(0, limit),
                empty: docs.length === 0,
              };
            }),
          };
        }),
      };
      return query;
    };
    let activeDeletes = 0;
    let maxActiveDeletes = 0;
    const recursiveDelete = vi.fn(async (ref: FakeDocumentReference) => {
      activeDeletes += 1;
      maxActiveDeletes = Math.max(maxActiveDeletes, activeDeletes);
      await Promise.resolve();
      for (const [collectionName, docs] of documents.entries()) {
        const index = docs.findIndex(doc => doc.ref.path === ref.path);
        if (index >= 0) {
          docs.splice(index, 1);
          documents.set(collectionName, docs);
          break;
        }
      }
      activeDeletes -= 1;
    });
    const queries = new Map<string, ReturnType<typeof queryFor>>();
    const getQuery = (collectionName: string) => {
      const existing = queries.get(collectionName);
      if (existing) {
        return existing;
      }
      const query = queryFor(collectionName);
      queries.set(collectionName, query);
      return query;
    };
    const db = {
      collection: vi.fn((collectionName: string) => {
        if (collectionName === 'users') {
          return {
            doc: vi.fn(() => ({
              collection: vi.fn(() => getQuery(MCP_OAUTH_COLLECTIONS.userConnections)),
            })),
          };
        }
        return getQuery(collectionName);
      }),
      recursiveDelete,
    };
    firestoreMock.mockReturnValue(db);

    return {
      documents,
      limitCalls,
      maxActiveDeletes: () => maxActiveDeletes,
      recursiveDelete,
    };
  }

  it('pages OAuth state cleanup and bounds recursive-delete concurrency', async () => {
    const authorizationRequests = Array.from(
      { length: 121 },
      (_, index) => `${MCP_OAUTH_COLLECTIONS.authorizationRequests}/request-${index}`,
    );
    const connections = Array.from(
      { length: 3 },
      (_, index) => `users/user-1/${MCP_OAUTH_COLLECTIONS.userConnections}/connection-${index}`,
    );
    const cleanup = buildCleanupFirestore({
      [MCP_OAUTH_COLLECTIONS.authorizationRequests]: authorizationRequests,
      [MCP_OAUTH_COLLECTIONS.userConnections]: connections,
    });

    await cleanupMcpOAuthStateForUser('user-1');

    expect(cleanup.recursiveDelete).toHaveBeenCalledTimes(124);
    expect(cleanup.maxActiveDeletes()).toBeLessThanOrEqual(10);
    expect(Math.max(...cleanup.limitCalls)).toBe(51);
    expect([...cleanup.documents.values()].flat()).toEqual([]);
  });

  it('fails retryably at the total cleanup budget and completes idempotently on retry', async () => {
    const authorizationRequests = Array.from(
      { length: 251 },
      (_, index) => `${MCP_OAUTH_COLLECTIONS.authorizationRequests}/request-${index}`,
    );
    const cleanup = buildCleanupFirestore({
      [MCP_OAUTH_COLLECTIONS.authorizationRequests]: authorizationRequests,
    });

    await expect(cleanupMcpOAuthStateForUser('user-1')).rejects.toMatchObject<
      McpOAuthCleanupIncompleteError
    >({
      name: 'McpOAuthCleanupIncompleteError',
      deletedCount: 250,
    });
    expect(cleanup.recursiveDelete).toHaveBeenCalledTimes(250);

    await expect(cleanupMcpOAuthStateForUser('user-1')).resolves.toBeUndefined();
    expect(cleanup.recursiveDelete).toHaveBeenCalledTimes(251);
    expect([...cleanup.documents.values()].flat()).toEqual([]);
  });

  it('does not request a retry when exactly the total cleanup budget completes all state', async () => {
    const authorizationRequests = Array.from(
      { length: 250 },
      (_, index) => `${MCP_OAUTH_COLLECTIONS.authorizationRequests}/request-${index}`,
    );
    const cleanup = buildCleanupFirestore({
      [MCP_OAUTH_COLLECTIONS.authorizationRequests]: authorizationRequests,
    });

    await expect(cleanupMcpOAuthStateForUser('user-1')).resolves.toBeUndefined();
    expect(cleanup.recursiveDelete).toHaveBeenCalledTimes(250);
    expect([...cleanup.documents.values()].flat()).toEqual([]);
  });

  it('settles a bounded delete chunk and completes idempotently after a deletion failure', async () => {
    const authorizationRequests = Array.from(
      { length: 12 },
      (_, index) => `${MCP_OAUTH_COLLECTIONS.authorizationRequests}/request-${index}`,
    );
    const cleanup = buildCleanupFirestore({
      [MCP_OAUTH_COLLECTIONS.authorizationRequests]: authorizationRequests,
    });
    cleanup.recursiveDelete.mockRejectedValueOnce(new Error('recursive delete failed'));

    await expect(cleanupMcpOAuthStateForUser('user-1')).rejects.toThrow(
      'recursive delete failed',
    );
    expect(cleanup.recursiveDelete).toHaveBeenCalledTimes(10);

    await expect(cleanupMcpOAuthStateForUser('user-1')).resolves.toBeUndefined();
    expect([...cleanup.documents.values()].flat()).toEqual([]);
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
            status: 'active',
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

  it('repairs a stale pending TTL when recording authorized activity', async () => {
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
            status: 'pending',
            scopes: [MCP_OAUTH_SCOPES.MetricsRead],
            lastUsedAtMs: 4_000,
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
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 4_000,
      expiresAtMs: 10_000,
    };

    await buildFirestoreMcpOAuthStore().recordAuthorizedRequest(token, 5_000);

    expect(transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'users/user-1/mcpConnections/connection-1',
      }),
      {
        status: 'active',
        lastUsedAtMs: 5_000,
        expireAt: { deleteField: true },
      },
    );
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
      {
        kind: 'owner',
        uid: 'user-1',
        connectionId: 'connection-1',
      },
      5_000,
    );

    expect(transaction.get).toHaveBeenCalledTimes(2);
    expect(transaction.set).not.toHaveBeenCalled();
    expect(transaction.update).not.toHaveBeenCalled();
  });
});
