import { describe, expect, it } from 'vitest';
import type * as admin from 'firebase-admin';
import {
  createTokenRefreshCoordinator,
  getTokenCredentialSnapshot,
  TOKEN_REFRESH_LEASE_MS,
} from './token-refresh-coordinator';

type StoredToken = Record<string, unknown> | null;

interface InMemorySnapshot {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}

interface InMemoryTransaction {
  get: (ref: admin.firestore.DocumentReference) => Promise<InMemorySnapshot>;
  update: (ref: admin.firestore.DocumentReference, update: Record<string, unknown>) => void;
}

interface InMemoryFirestore {
  runTransaction: <T>(callback: (transaction: InMemoryTransaction) => T | Promise<T>) => Promise<T>;
  collection: (collectionName: string) => {
    doc: (id: string) => admin.firestore.DocumentReference;
  };
}

function isDeleteTransform(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && (value as { constructor?: { name?: unknown } }).constructor?.name === 'DeleteTransform';
}

function createInMemoryCoordinator(initialToken: StoredToken) {
  let storedToken = initialToken ? { ...initialToken } : null;
  let deletionInProgress = false;
  let transactionTail = Promise.resolve();
  const userRef = { id: 'user-1', path: 'users/user-1' } as unknown as admin.firestore.DocumentReference;
  const tombstoneRef = { id: 'user-1', path: 'userDeletionTombstones/user-1' } as unknown as admin.firestore.DocumentReference;
  const ref = {
    path: 'testTokens/user-1/tokens/token-1',
    parent: { parent: userRef },
  } as unknown as admin.firestore.DocumentReference;
  const db: InMemoryFirestore = {
    collection: (collectionName: string) => ({
      doc: (id: string) => {
        if (collectionName === 'users' && id === 'user-1') return userRef;
        if (collectionName === 'userDeletionTombstones' && id === 'user-1') return tombstoneRef;
        throw new Error(`Unexpected document lookup: ${collectionName}/${id}`);
      },
    }),
    runTransaction: <T>(callback: (transaction: InMemoryTransaction) => T | Promise<T>) => {
      const execution = transactionTail.then(() => callback({
        get: async (requestedRef) => {
          if (requestedRef === userRef) {
            return { exists: true, data: () => ({}) };
          }
          if (requestedRef === tombstoneRef) {
            return {
              exists: deletionInProgress,
              data: () => deletionInProgress ? { expireAt: Date.now() + 60_000 } : undefined,
            };
          }
          return {
            exists: storedToken !== null,
            data: () => storedToken ? { ...storedToken } : undefined,
          };
        },
        update: (_ref: unknown, update: Record<string, unknown>) => {
          if (!storedToken) throw new Error('missing token');
          for (const [key, value] of Object.entries(update)) {
            if (isDeleteTransform(value)) {
              delete storedToken[key];
            } else {
              storedToken[key] = value;
            }
          }
        },
      }));
      transactionTail = execution.then(() => undefined, () => undefined);
      return execution;
    },
  };

  return {
    coordinator: createTokenRefreshCoordinator(
      db as unknown as Pick<admin.firestore.Firestore, 'runTransaction' | 'collection'>,
    ),
    ref,
    getStoredToken: () => storedToken ? { ...storedToken } : null,
    setStoredToken: (nextToken: StoredToken) => {
      storedToken = nextToken ? { ...nextToken } : null;
    },
    beginDeletion: () => {
      deletionInProgress = true;
    },
  };
}

function token(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: 100,
    dateCreated: 10,
    dateRefreshed: 10,
    tokenCredentialGeneration: 'generation-1',
    ...overrides,
  };
}

describe('token refresh coordinator', () => {
  it('gives concurrent activity and route workers exactly one refresh owner', async () => {
    const store = createInMemoryCoordinator(token());
    const credential = getTokenCredentialSnapshot(store.getStoredToken()!);

    const [first, second] = await Promise.all([
      store.coordinator.claim(store.ref, credential, 1_000),
      store.coordinator.claim(store.ref, credential, 1_000),
    ]);

    expect([first.kind, second.kind].sort()).toEqual(['busy', 'owner']);
    const owner = first.kind === 'owner' ? first : second as Extract<typeof second, { kind: 'owner' }>;
    expect(store.getStoredToken()).toEqual(expect.objectContaining({
      tokenRefreshLeaseOwner: owner.leaseOwner,
      tokenRefreshLeaseExpiresAt: 1_000 + TOKEN_REFRESH_LEASE_MS,
    }));
  });

  it('rejects a stale refresh result after reauthorization replaces the credential generation', async () => {
    const store = createInMemoryCoordinator(token());
    const credential = getTokenCredentialSnapshot(store.getStoredToken()!);
    const claim = await store.coordinator.claim(store.ref, credential, 1_000);
    expect(claim.kind).toBe('owner');
    if (claim.kind !== 'owner') return;

    store.setStoredToken(token({
      accessToken: 'reauthorized-access',
      refreshToken: 'reauthorized-refresh',
      dateCreated: 20,
      dateRefreshed: 20,
      tokenCredentialGeneration: 'generation-2',
    }));

    const result = await store.coordinator.persist(store.ref, claim.leaseOwner, claim.credential, {
      accessToken: 'stale-successor',
      refreshToken: 'stale-refresh-successor',
    });

    expect(result.kind).toBe('superseded');
    expect(store.getStoredToken()).toEqual(expect.objectContaining({
      accessToken: 'reauthorized-access',
      refreshToken: 'reauthorized-refresh',
      tokenCredentialGeneration: 'generation-2',
    }));
  });

  it('does not recreate a disconnected token when an old refresh finishes', async () => {
    const store = createInMemoryCoordinator(token());
    const credential = getTokenCredentialSnapshot(store.getStoredToken()!);
    const claim = await store.coordinator.claim(store.ref, credential, 1_000);
    expect(claim.kind).toBe('owner');
    if (claim.kind !== 'owner') return;

    store.setStoredToken(null);

    const result = await store.coordinator.persist(store.ref, claim.leaseOwner, claim.credential, {
      accessToken: 'stale-successor',
      refreshToken: 'stale-refresh-successor',
    });

    expect(result).toEqual({ kind: 'superseded', snapshot: null });
    expect(store.getStoredToken()).toBeNull();
  });

  it('does not claim, persist, or release a token after account deletion begins', async () => {
    const store = createInMemoryCoordinator(token());
    const credential = getTokenCredentialSnapshot(store.getStoredToken()!);
    const claim = await store.coordinator.claim(store.ref, credential, 1_000);
    expect(claim.kind).toBe('owner');
    if (claim.kind !== 'owner') return;

    store.beginDeletion();

    await expect(store.coordinator.persist(store.ref, claim.leaseOwner, claim.credential, {
      accessToken: 'rotated-access',
      refreshToken: 'rotated-refresh',
    })).resolves.toEqual({ kind: 'skipped_user_deletion' });
    await store.coordinator.release(store.ref, claim.leaseOwner, claim.credential);

    expect(store.getStoredToken()).toEqual(expect.objectContaining({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      tokenRefreshLeaseOwner: claim.leaseOwner,
    }));

    await expect(store.coordinator.claim(store.ref, claim.credential, 2_000))
      .resolves.toEqual({ kind: 'skipped_user_deletion' });
  });

  it('allows crash recovery only after the previous refresh lease expires', async () => {
    const store = createInMemoryCoordinator(token({
      tokenRefreshLeaseOwner: 'crashed-worker',
      tokenRefreshLeaseExpiresAt: 10_000,
    }));
    const credential = getTokenCredentialSnapshot(store.getStoredToken()!);

    const busy = await store.coordinator.claim(store.ref, credential, 9_999);
    const recovered = await store.coordinator.claim(store.ref, credential, 10_000);

    expect(busy.kind).toBe('busy');
    expect(recovered.kind).toBe('owner');
  });
});
