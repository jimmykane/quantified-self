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
  }),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    delete: fieldValueDeleteMock,
  },
}));

import {
  AccessTokenRecord,
  buildMcpAuthorizationStartRateLimitBucketId,
  buildFirestoreMcpOAuthStore,
  buildMcpLogicalConnectionId,
  buildMcpRevocationRateLimitBucketId,
  cleanupMcpOAuthStateForUser,
  McpOAuthCleanupIncompleteError,
  McpOAuthError,
  MCP_OAUTH_COLLECTIONS,
  MCP_OAUTH_SCOPES,
} from './oauth.service';

const TEST_CLIENT_ID = 'https://client.example/mcp.json';
const TEST_LOGICAL_CONNECTION_ID = buildMcpLogicalConnectionId(TEST_CLIENT_ID);

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
        if (ref.path === 'users/user-1/mcpConnections/connection-1') {
          return fakeSnapshot(false);
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
        pendingAuthorizationCodeHash: 'code-hash',
        pendingAuthorizationApprovedAtMs: 5_000,
        pendingAuthorizationExpiresAtMs: 8_000,
        expireAt: { milliseconds: 8_000 },
      }),
    );
  });

  it('does not change the live grant while recording a replacement authorization code', async () => {
    const transaction = {
      get: vi.fn(async (ref: FakeDocumentReference) => {
        if (ref.path === 'users/user-1') {
          return fakeSnapshot(true);
        }
        if (ref.path === 'userDeletionTombstones/user-1') {
          return fakeSnapshot(false);
        }
        if (ref.path === 'mcpOAuthAuthorizationRequests/request-2') {
          return fakeSnapshot(true, {
            status: 'pending',
            expiresAtMs: 10_000,
          });
        }
        if (ref.path === `users/user-1/mcpConnections/${TEST_LOGICAL_CONNECTION_ID}`) {
          return fakeSnapshot(true, {
            connectionId: TEST_LOGICAL_CONNECTION_ID,
            clientId: TEST_CLIENT_ID,
            clientName: 'Current Client Name',
            scopes: [MCP_OAUTH_SCOPES.MetricsRead, MCP_OAUTH_SCOPES.SleepRead],
            grantId: 'current-family',
            status: 'active',
            lastUsedAtMs: 4_000,
            revokedAtMs: null,
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
      requestId: 'request-2',
      grantedScopes: [MCP_OAUTH_SCOPES.MetricsRead],
      codeHash: 'replacement-code-hash',
      codeRecord: {
        uid: 'user-1',
        connectionId: TEST_LOGICAL_CONNECTION_ID,
        clientId: TEST_CLIENT_ID,
        clientName: 'Replacement Client Name',
        redirectUri: 'https://client.example/oauth/callback',
        redirectHost: 'client.example',
        codeChallenge: 'challenge',
        scopes: [MCP_OAUTH_SCOPES.MetricsRead],
        audience: 'https://quantified-self.io/mcp',
        createdAtMs: 5_000,
        expiresAtMs: 8_000,
      },
      connection: {
        connectionId: TEST_LOGICAL_CONNECTION_ID,
        clientId: TEST_CLIENT_ID,
        clientName: 'Replacement Client Name',
        redirectHost: 'client.example',
        scopes: [MCP_OAUTH_SCOPES.MetricsRead],
        createdAtMs: 5_000,
        lastUsedAtMs: null,
        revokedAtMs: null,
        status: 'pending',
      },
      nowMs: 5_000,
    });

    expect(transaction.set).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `users/user-1/mcpConnections/${TEST_LOGICAL_CONNECTION_ID}`,
      }),
      {
        pendingAuthorizationCodeHash: 'replacement-code-hash',
        pendingAuthorizationApprovedAtMs: 5_000,
        pendingAuthorizationExpiresAtMs: 8_000,
      },
      { merge: true },
    );
    expect(transaction.set.mock.calls[0]?.[1]).not.toHaveProperty('scopes');
    expect(transaction.set.mock.calls[0]?.[1]).not.toHaveProperty('clientName');
    expect(transaction.set.mock.calls[0]?.[1]).not.toHaveProperty('expireAt');
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
        if (ref.path === `users/user-1/mcpConnections/${TEST_LOGICAL_CONNECTION_ID}`) {
          return fakeSnapshot(true, {
            connectionId: TEST_LOGICAL_CONNECTION_ID,
            clientId: TEST_CLIENT_ID,
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
        connectionId: TEST_LOGICAL_CONNECTION_ID,
      },
      5_000,
    );

    expect(transaction.set).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `users/user-1/mcpConnections/${TEST_LOGICAL_CONNECTION_ID}`,
      }),
      {
        status: 'revoked',
        revokedAtMs: 5_000,
        expireAt: { deleteField: true },
        supersedesLegacy: true,
        pendingAuthorizationCodeHash: { deleteField: true },
        pendingAuthorizationApprovedAtMs: { deleteField: true },
        pendingAuthorizationExpiresAtMs: { deleteField: true },
      },
      { merge: true },
    );
    expect(transaction.get).toHaveBeenCalledTimes(3);
  });

  it('preserves the first terminal time while idempotently clearing pending authorization', async () => {
    const transaction = {
      get: vi.fn(async (ref: FakeDocumentReference) => {
        if (ref.path === 'users/user-1') {
          return fakeSnapshot(true);
        }
        if (ref.path === 'userDeletionTombstones/user-1') {
          return fakeSnapshot(false);
        }
        if (ref.path === `users/user-1/mcpConnections/${TEST_LOGICAL_CONNECTION_ID}`) {
          return fakeSnapshot(true, {
            connectionId: TEST_LOGICAL_CONNECTION_ID,
            clientId: TEST_CLIENT_ID,
            status: 'revoked',
            revokedAtMs: 4_000,
            pendingAuthorizationCodeHash: 'pending-code',
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
        connectionId: TEST_LOGICAL_CONNECTION_ID,
      },
      5_000,
    );

    expect(transaction.get).toHaveBeenCalledTimes(3);
    expect(transaction.set).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `users/user-1/mcpConnections/${TEST_LOGICAL_CONNECTION_ID}`,
      }),
      {
        status: 'revoked',
        revokedAtMs: 4_000,
        expireAt: { deleteField: true },
        supersedesLegacy: true,
        pendingAuthorizationCodeHash: { deleteField: true },
        pendingAuthorizationApprovedAtMs: { deleteField: true },
        pendingAuthorizationExpiresAtMs: { deleteField: true },
      },
      { merge: true },
    );
    expect(transaction.update).not.toHaveBeenCalled();
  });

  it('creates a canonical tombstone when an already-revoked legacy duplicate is disconnected', async () => {
    const transaction = {
      get: vi.fn(async (ref: FakeDocumentReference) => {
        if (ref.path === 'users/user-1') {
          return fakeSnapshot(true);
        }
        if (ref.path === 'userDeletionTombstones/user-1') {
          return fakeSnapshot(false);
        }
        if (ref.path === 'users/user-1/mcpConnections/legacy-connection') {
          return fakeSnapshot(true, {
            connectionId: 'legacy-connection',
            clientId: TEST_CLIENT_ID,
            clientName: 'Example MCP Client',
            redirectHost: 'client.example',
            scopes: [MCP_OAUTH_SCOPES.MetricsRead],
            createdAtMs: 1_000,
            lastUsedAtMs: 2_000,
            status: 'revoked',
            revokedAtMs: 4_000,
          });
        }
        if (ref.path === `users/user-1/mcpConnections/${TEST_LOGICAL_CONNECTION_ID}`) {
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
      kind: 'owner',
      uid: 'user-1',
      connectionId: 'legacy-connection',
    }, 5_000);

    expect(transaction.set).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'users/user-1/mcpConnections/legacy-connection',
      }),
      expect.objectContaining({
        status: 'revoked',
        revokedAtMs: 4_000,
      }),
      { merge: true },
    );
    expect(transaction.set).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `users/user-1/mcpConnections/${TEST_LOGICAL_CONNECTION_ID}`,
      }),
      expect.objectContaining({
        connectionId: TEST_LOGICAL_CONNECTION_ID,
        clientId: TEST_CLIENT_ID,
        status: 'revoked',
        revokedAtMs: 5_000,
        supersedesLegacy: true,
        pendingAuthorizationCodeHash: { deleteField: true },
        pendingAuthorizationApprovedAtMs: { deleteField: true },
        pendingAuthorizationExpiresAtMs: { deleteField: true },
      }),
      { merge: true },
    );
    expect(transaction.get).toHaveBeenCalledTimes(4);
  });

  it('atomically activates a pending connection and removes its TTL on code exchange', async () => {
    const transaction = {
      get: vi.fn(async (ref: FakeDocumentReference) => {
        if (ref.path === 'mcpOAuthAuthorizationCodes/code-hash') {
          return fakeSnapshot(true, {
            uid: 'user-1',
            connectionId: TEST_LOGICAL_CONNECTION_ID,
            clientId: TEST_CLIENT_ID,
            clientName: 'Example MCP Client',
            redirectUri: 'https://client.example/oauth/callback',
            redirectHost: 'client.example',
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
        if (ref.path === `users/user-1/mcpConnections/${TEST_LOGICAL_CONNECTION_ID}`) {
          return fakeSnapshot(true, {
            connectionId: TEST_LOGICAL_CONNECTION_ID,
            clientId: TEST_CLIENT_ID,
            clientName: 'Example MCP Client',
            redirectHost: 'client.example',
            status: 'pending',
            lastUsedAtMs: null,
            revokedAtMs: null,
            pendingAuthorizationCodeHash: 'code-hash',
            pendingAuthorizationExpiresAtMs: 8_000,
          });
        }
        throw new Error(`Unexpected Firestore read: ${ref.path}`);
      }),
      create: vi.fn(),
      delete: vi.fn(),
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

    await buildFirestoreMcpOAuthStore().exchangeAuthorizationCode({
      codeHash: 'code-hash',
      clientId: TEST_CLIENT_ID,
      redirectUri: 'https://client.example/oauth/callback',
      audience: 'https://quantified-self.io/mcp',
      codeChallenge: 'challenge',
      accessTokenHash: 'access-hash',
      accessTokenRecord: {
        uid: '',
        connectionId: '',
        clientId: TEST_CLIENT_ID,
        scopes: [],
        audience: 'https://quantified-self.io/mcp',
        createdAtMs: 5_000,
        expiresAtMs: 10_000,
      },
      refreshTokenHash: 'refresh-hash',
      refreshTokenRecord: {
        uid: '',
        connectionId: '',
        clientId: TEST_CLIENT_ID,
        scopes: [],
        audience: 'https://quantified-self.io/mcp',
        familyId: 'family-1',
        createdAtMs: 5_000,
        expiresAtMs: 20_000,
      },
      nowMs: 5_000,
    });

    expect(transaction.set).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `users/user-1/mcpConnections/${TEST_LOGICAL_CONNECTION_ID}`,
      }),
      {
        connectionId: TEST_LOGICAL_CONNECTION_ID,
        clientId: TEST_CLIENT_ID,
        clientName: 'Example MCP Client',
        redirectHost: 'client.example',
        scopes: [MCP_OAUTH_SCOPES.MetricsRead],
        audience: 'https://quantified-self.io/mcp',
        grantId: 'family-1',
        supersedesLegacy: true,
        createdAtMs: 5_000,
        status: 'active',
        lastUsedAtMs: 5_000,
        revokedAtMs: null,
        expireAt: { deleteField: true },
        pendingAuthorizationCodeHash: { deleteField: true },
        pendingAuthorizationApprovedAtMs: { deleteField: true },
        pendingAuthorizationExpiresAtMs: { deleteField: true },
      },
      { merge: true },
    );
    expect(transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'mcpOAuthAccessTokens/access-hash' }),
      expect.objectContaining({ grantId: 'family-1' }),
    );
  });

  it('revokes only a replayed current refresh grant without clearing pending reauthorization', async () => {
    for (const scenario of [
      {
        name: 'current grant',
        connectionGrantId: 'family-1' as string | undefined,
        expectRevoked: true,
      },
      {
        name: 'replacement grant',
        connectionGrantId: 'family-2' as string | undefined,
        expectRevoked: false,
      },
      {
        name: 'missing canonical generation',
        connectionGrantId: undefined,
        expectRevoked: false,
      },
    ]) {
      const transaction = {
        get: vi.fn(async (ref: FakeDocumentReference) => {
          if (ref.path === 'mcpOAuthRefreshTokens/replayed-refresh-hash') {
            return fakeSnapshot(true, {
              uid: 'user-1',
              connectionId: TEST_LOGICAL_CONNECTION_ID,
              clientId: TEST_CLIENT_ID,
              scopes: [MCP_OAUTH_SCOPES.MetricsRead],
              audience: 'https://quantified-self.io/mcp',
              familyId: 'family-1',
              createdAtMs: 1_000,
              expiresAtMs: 10_000,
              active: false,
            });
          }
          if (ref.path === 'users/user-1') {
            return fakeSnapshot(true);
          }
          if (ref.path === 'userDeletionTombstones/user-1') {
            return fakeSnapshot(false);
          }
          if (ref.path === `users/user-1/mcpConnections/${TEST_LOGICAL_CONNECTION_ID}`) {
            return fakeSnapshot(true, {
              connectionId: TEST_LOGICAL_CONNECTION_ID,
              clientId: TEST_CLIENT_ID,
              scopes: [MCP_OAUTH_SCOPES.MetricsRead],
              grantId: scenario.connectionGrantId,
              status: 'active',
              lastUsedAtMs: 4_000,
              revokedAtMs: null,
              pendingAuthorizationCodeHash: 'replacement-code',
              pendingAuthorizationExpiresAtMs: 8_000,
            });
          }
          throw new Error(`Unexpected Firestore read for ${scenario.name}: ${ref.path}`);
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

      await expect(buildFirestoreMcpOAuthStore().exchangeRefreshToken({
        refreshTokenHash: 'replayed-refresh-hash',
        clientId: TEST_CLIENT_ID,
        audience: 'https://quantified-self.io/mcp',
        requestedScopes: null,
        nextAccessTokenHash: 'unused-access-hash',
        nextAccessTokenRecord: {
          uid: '',
          connectionId: '',
          clientId: TEST_CLIENT_ID,
          scopes: [],
          audience: 'https://quantified-self.io/mcp',
          createdAtMs: 5_000,
          expiresAtMs: 10_000,
        },
        nextRefreshTokenHash: 'unused-refresh-hash',
        nextRefreshTokenRecord: {
          uid: '',
          connectionId: '',
          clientId: TEST_CLIENT_ID,
          scopes: [],
          audience: 'https://quantified-self.io/mcp',
          familyId: '',
          createdAtMs: 5_000,
          expiresAtMs: 20_000,
        },
        nowMs: 5_000,
      })).rejects.toMatchObject<McpOAuthError>({
        code: 'invalid_grant',
      });

      if (scenario.expectRevoked) {
        expect(transaction.set).toHaveBeenCalledWith(
          expect.objectContaining({
            path: `users/user-1/mcpConnections/${TEST_LOGICAL_CONNECTION_ID}`,
          }),
          {
            status: 'revoked',
            revokedAtMs: 5_000,
            expireAt: { deleteField: true },
          },
          { merge: true },
        );
        expect(transaction.set.mock.calls[0]?.[1]).not.toHaveProperty(
          'pendingAuthorizationCodeHash',
        );
      } else {
        expect(transaction.set).not.toHaveBeenCalled();
      }
      expect(transaction.create).not.toHaveBeenCalled();
      expect(transaction.update).not.toHaveBeenCalled();
    }
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

  it('preserves pending reauthorization and ignores revocation from an older grant', async () => {
    for (const scenario of [
      {
        name: 'current grant',
        connectionGrantId: 'family-1',
        expectRevoked: true,
      },
      {
        name: 'older grant',
        connectionGrantId: 'family-2',
        expectRevoked: false,
      },
    ]) {
      const transaction = {
        get: vi.fn(async (ref: FakeDocumentReference) => {
          if (ref.path === 'mcpOAuthAccessTokens/submitted-token-hash') {
            return fakeSnapshot(true, {
              uid: 'user-1',
              connectionId: TEST_LOGICAL_CONNECTION_ID,
              clientId: TEST_CLIENT_ID,
              grantId: 'family-1',
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
          if (ref.path === `users/user-1/mcpConnections/${TEST_LOGICAL_CONNECTION_ID}`) {
            return fakeSnapshot(true, {
              connectionId: TEST_LOGICAL_CONNECTION_ID,
              clientId: TEST_CLIENT_ID,
              grantId: scenario.connectionGrantId,
              status: 'active',
              revokedAtMs: null,
              pendingAuthorizationCodeHash: 'replacement-code',
              pendingAuthorizationExpiresAtMs: 8_000,
            });
          }
          throw new Error(`Unexpected Firestore read for ${scenario.name}: ${ref.path}`);
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
        clientId: TEST_CLIENT_ID,
      }, 5_000);

      if (scenario.expectRevoked) {
        expect(transaction.set).toHaveBeenCalledWith(
          expect.objectContaining({
            path: `users/user-1/mcpConnections/${TEST_LOGICAL_CONNECTION_ID}`,
          }),
          {
            status: 'revoked',
            revokedAtMs: 5_000,
            expireAt: { deleteField: true },
          },
          { merge: true },
        );
        expect(transaction.set.mock.calls[0]?.[1]).not.toHaveProperty(
          'pendingAuthorizationCodeHash',
        );
      } else {
        expect(transaction.set).not.toHaveBeenCalled();
      }
    }
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

  it('rejects superseded legacy access and canonical access without a grant generation', async () => {
    for (const scenario of [
      {
        name: 'superseded legacy connection',
        tokenConnectionId: 'legacy-connection',
        connection: {
          connectionId: 'legacy-connection',
          clientId: TEST_CLIENT_ID,
          status: 'active',
          scopes: [MCP_OAUTH_SCOPES.MetricsRead],
          revokedAtMs: null,
        },
        logicalConnection: {
          connectionId: TEST_LOGICAL_CONNECTION_ID,
          clientId: TEST_CLIENT_ID,
          status: 'revoked',
          supersedesLegacy: true,
          revokedAtMs: 4_000,
        },
      },
      {
        name: 'canonical connection without generation',
        tokenConnectionId: TEST_LOGICAL_CONNECTION_ID,
        connection: {
          connectionId: TEST_LOGICAL_CONNECTION_ID,
          clientId: TEST_CLIENT_ID,
          status: 'active',
          scopes: [MCP_OAUTH_SCOPES.MetricsRead],
          supersedesLegacy: true,
          revokedAtMs: null,
        },
        logicalConnection: null,
      },
    ]) {
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
          if (
            ref.path
            === `users/user-1/mcpConnections/${scenario.tokenConnectionId}`
          ) {
            return fakeSnapshot(true, scenario.connection);
          }
          if (
            scenario.logicalConnection
            && ref.path
              === `users/user-1/mcpConnections/${TEST_LOGICAL_CONNECTION_ID}`
          ) {
            return fakeSnapshot(true, scenario.logicalConnection);
          }
          throw new Error(`Unexpected Firestore read for ${scenario.name}: ${ref.path}`);
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
        connectionId: scenario.tokenConnectionId,
        clientId: TEST_CLIENT_ID,
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
      expect(transaction.set).not.toHaveBeenCalled();
      expect(transaction.update).not.toHaveBeenCalled();
    }
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
            connectionId: 'connection-1',
            clientId: TEST_CLIENT_ID,
            status: 'active',
            scopes: [MCP_OAUTH_SCOPES.MetricsRead],
            revokedAtMs: null,
          });
        }
        if (ref.path === `users/user-1/mcpConnections/${TEST_LOGICAL_CONNECTION_ID}`) {
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
    expect(transaction.get).toHaveBeenCalledTimes(5);
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
            connectionId: 'connection-1',
            clientId: TEST_CLIENT_ID,
            status: 'pending',
            scopes: [MCP_OAUTH_SCOPES.MetricsRead],
            lastUsedAtMs: 4_000,
            revokedAtMs: null,
          });
        }
        if (ref.path === `users/user-1/mcpConnections/${TEST_LOGICAL_CONNECTION_ID}`) {
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
