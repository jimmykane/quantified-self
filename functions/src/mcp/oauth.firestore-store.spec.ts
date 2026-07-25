import { describe, expect, it, vi } from 'vitest';

const {
  documentIdMock,
  firestoreMock,
  timestampFromMillisMock,
} = vi.hoisted(() => ({
  documentIdMock: vi.fn(() => 'document-id'),
  firestoreMock: vi.fn(),
  timestampFromMillisMock: vi.fn((milliseconds: number) => ({ milliseconds })),
}));

vi.mock('firebase-admin', () => ({
  firestore: Object.assign(firestoreMock, {
    FieldPath: {
      documentId: documentIdMock,
    },
    Timestamp: {
      fromMillis: timestampFromMillisMock,
    },
  }),
}));

import {
  AccessTokenRecord,
  buildFirestoreMcpOAuthStore,
  cleanupMcpOAuthStateForUser,
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
  it('paginates UID-owned OAuth cleanup and bounds recursive deletion concurrency', async () => {
    const firstPageDocs = Array.from({ length: 51 }, (_, index) => ({
      ref: fakeDocumentReference(`mcpOAuthAuthorizationRequests/request-${index}`),
    }));
    const secondPageDocs = [firstPageDocs[50]];
    const userConnectionDocs = [{
      ref: fakeDocumentReference('users/user-1/mcpConnections/connection-1'),
    }];
    let activeDeletes = 0;
    let maxActiveDeletes = 0;
    const recursiveDelete = vi.fn(async () => {
      activeDeletes += 1;
      maxActiveDeletes = Math.max(maxActiveDeletes, activeDeletes);
      await Promise.resolve();
      activeDeletes -= 1;
    });
    const createQuery = (pages: Array<Array<{ ref: FakeDocumentReference }>>) => {
      const allDocs = pages.flat();
      const directGet = vi.fn(async () => ({
        docs: allDocs,
        empty: allDocs.length === 0,
      }));
      let pageIndex = 0;
      const get = vi.fn(async () => {
        const docs = pages[pageIndex++] || [];
        return { docs, empty: docs.length === 0 };
      });
      const startAfter = vi.fn(() => ({ get }));
      const limit = vi.fn(() => ({ get, startAfter }));
      const orderBy = vi.fn(() => ({ limit }));
      const where = vi.fn(() => ({ directGet, get: directGet, orderBy }));
      return { limit, orderBy, startAfter, where };
    };
    const authorizationRequestsQuery = createQuery([firstPageDocs, secondPageDocs]);
    const emptyQuery = createQuery([[]]);
    const userConnectionsQuery = createQuery([userConnectionDocs]);
    const db = {
      collection: vi.fn((collectionName: string) => {
        if (collectionName === MCP_OAUTH_COLLECTIONS.authorizationRequests) {
          return { where: authorizationRequestsQuery.where };
        }
        if (collectionName === 'users') {
          return {
            doc: vi.fn(() => ({
              collection: vi.fn(() => ({ orderBy: userConnectionsQuery.orderBy })),
            })),
          };
        }
        return { where: emptyQuery.where };
      }),
      recursiveDelete,
    };
    firestoreMock.mockReturnValue(db);

    await cleanupMcpOAuthStateForUser('user-1');

    expect(documentIdMock).toHaveBeenCalled();
    expect(authorizationRequestsQuery.limit).toHaveBeenCalledWith(51);
    expect(authorizationRequestsQuery.startAfter).toHaveBeenCalledWith(firstPageDocs[49]);
    expect(recursiveDelete).toHaveBeenCalledTimes(52);
    expect(maxActiveDeletes).toBeLessThanOrEqual(10);
  });

  it('caps UID-owned OAuth cleanup work', async () => {
    const pages = Array.from({ length: 5 }, (_, pageIndex) => Array.from(
      { length: 51 },
      (_, documentIndex) => ({
        ref: fakeDocumentReference(
          `mcpOAuthAuthorizationRequests/request-${pageIndex}-${documentIndex}`,
        ),
      }),
    ));
    pages.push([{
      ref: fakeDocumentReference('mcpOAuthAuthorizationRequests/request-over-limit'),
    }]);
    let pageIndex = 0;
    const get = vi.fn(async () => {
      const docs = pages[pageIndex++] || [];
      return { docs, empty: docs.length === 0 };
    });
    const startAfter = vi.fn(() => ({ get }));
    const limit = vi.fn(() => ({ get, startAfter }));
    const authorizationRequestsQuery = { orderBy: vi.fn(() => ({ limit })) };
    const emptyQuery = {
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => ({
          get: vi.fn(async () => ({ docs: [], empty: true })),
          startAfter: vi.fn(),
        })),
      })),
    };
    const db = {
      collection: vi.fn((collectionName: string) => {
        if (collectionName === MCP_OAUTH_COLLECTIONS.authorizationRequests) {
          return { where: vi.fn(() => authorizationRequestsQuery) };
        }
        if (collectionName === 'users') {
          return {
            doc: vi.fn(() => ({
              collection: vi.fn(() => emptyQuery),
            })),
          };
        }
        return { where: vi.fn(() => emptyQuery) };
      }),
      recursiveDelete: vi.fn(async () => undefined),
    };
    firestoreMock.mockReturnValue(db);

    await cleanupMcpOAuthStateForUser('user-1');

    expect(authorizationRequestsQuery.orderBy).toHaveBeenCalledTimes(5);
    expect(db.recursiveDelete).toHaveBeenCalledTimes(250);
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
