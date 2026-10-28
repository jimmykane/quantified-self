import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import type { firestore } from 'firebase-admin';
import type { TokenCredentialSnapshot } from '../token-refresh-coordinator';

interface MockTokenSnapshot {
  exists: boolean;
  id: string;
  ref: { path: string };
  data: () => Record<string, unknown>;
}

interface MockTokenReference {
  id: string;
  path: string;
  get: ReturnType<typeof vi.fn>;
}

interface MockTransaction {
  get: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  getServiceConnectionMeta: vi.fn(),
  pinServiceConnectionProviderUserIdIfUnset: vi.fn(),
  tokenDocs: new Map<string, MockTokenSnapshot>(),
  tokenRefs: new Map<string, MockTokenReference>(),
  transactionMeta: null as Record<string, unknown> | null,
  tokenRootData: {} as Record<string, unknown>,
  runTransaction: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
  firestore: () => {
    const getTokenRef = (id: string): MockTokenReference => {
      if (!mocks.tokenRefs.has(id)) {
        mocks.tokenRefs.set(id, {
          id,
          path: `wahooAPIAccessTokens/user-1/tokens/${id}`,
          get: vi.fn(async () => mocks.tokenDocs.get(id) || {
            exists: false,
            id,
            data: () => undefined,
          }),
        });
      }
      return mocks.tokenRefs.get(id);
    };
    const metaRef = {
      id: 'wahooAPI',
      path: 'users/user-1/meta/wahooAPI',
      get: vi.fn(async () => ({
        exists: mocks.transactionMeta !== null,
        data: () => mocks.transactionMeta || undefined,
      })),
    };
    const tokenRootRef = {
      id: 'user-1',
      path: 'wahooAPIAccessTokens/user-1',
      get: vi.fn(async () => ({
        exists: true,
        data: () => mocks.tokenRootData,
      })),
      collection: () => ({
        doc: (id: string) => getTokenRef(id),
        get: vi.fn(async () => ({ docs: [...mocks.tokenDocs.values()] })),
      }),
    };
    return {
      runTransaction: mocks.runTransaction,
      collection: (collectionName: string) => collectionName === 'users' ? ({
        doc: () => ({
          collection: (nestedCollectionName: string) => ({
            doc: (id: string) => nestedCollectionName === 'meta' ? metaRef : getTokenRef(id),
            get: vi.fn(async () => ({ docs: [...mocks.tokenDocs.values()] })),
          }),
        }),
      }) : ({ doc: () => tokenRootRef }),
    };
  },
}));

vi.mock('../service-connection-meta', () => ({
  getServiceConnectionMeta: mocks.getServiceConnectionMeta,
  pinServiceConnectionProviderUserIdIfUnset: mocks.pinServiceConnectionProviderUserIdIfUnset,
}));

import {
  areWahooActiveAccountGuardsEqual,
  assertWahooActiveAccountGuardCurrent,
  assertWahooActiveAccountGuardCurrentInTransaction,
  assertWahooOAuthAccountCompatible,
  captureWahooActiveAccountGuard,
  getActiveWahooTokenSnapshot,
  type WahooActiveAccountGuard,
} from './account';

const credential: TokenCredentialSnapshot = {
  accessToken: 'access-a',
  refreshToken: 'refresh-a',
  expiresAt: 300,
  dateCreated: 100,
  dateRefreshed: 200,
  credentialGeneration: 'credential-a',
};

function accountGuard(): WahooActiveAccountGuard {
  return {
    providerUserId: 'account-a',
    connectionStateGeneration: 'connection-a',
    activeCredentialGeneration: 'credential-a',
    credential: { ...credential },
  };
}

describe('Wahoo active account guard equality', () => {
  it('compares snapshots by value, including legacy account-only guards', () => {
    expect(areWahooActiveAccountGuardsEqual(accountGuard(), accountGuard())).toBe(true);
    const legacy = { ...accountGuard(), connectionStateGeneration: null, activeCredentialGeneration: null, credential: null };
    expect(areWahooActiveAccountGuardsEqual(legacy, { ...legacy })).toBe(true);
  });

  it.each(['providerUserId', 'connectionStateGeneration', 'activeCredentialGeneration'] as const)(
    'rejects a changed %s in either direction', field => {
      const changed = { ...accountGuard(), [field]: 'replacement' };
      expect(areWahooActiveAccountGuardsEqual(accountGuard(), changed)).toBe(false);
      expect(areWahooActiveAccountGuardsEqual(changed, accountGuard())).toBe(false);
    },
  );

  it.each([
    ['accessToken', 'access-b'],
    ['refreshToken', 'refresh-b'],
    ['expiresAt', 301],
    ['dateCreated', 101],
    ['dateRefreshed', 201],
    ['credentialGeneration', 'credential-b'],
  ] as const)('rejects a change to credential %s', (field, value) => {
    const changed = accountGuard();
    changed.credential = { ...credential, [field]: value };
    expect(areWahooActiveAccountGuardsEqual(accountGuard(), changed)).toBe(false);
  });

  it('does not treat a missing credential snapshot as equal to a captured credential', () => {
    const accountOnly = { ...accountGuard(), credential: null };
    expect(areWahooActiveAccountGuardsEqual(accountOnly, accountGuard())).toBe(false);
    expect(areWahooActiveAccountGuardsEqual(accountGuard(), accountOnly)).toBe(false);
  });
});

function tokenSnapshot(
  id: string,
  dateRefreshed: number,
  overrides: Record<string, unknown> = {},
): MockTokenSnapshot {
  const data = {
    wahooUserID: id,
    dateCreated: dateRefreshed - 1,
    dateRefreshed,
    ...overrides,
  };
  return {
    exists: true,
    id,
    ref: { path: `wahooAPIAccessTokens/user-1/tokens/${id}` },
    data: () => data,
  };
}

describe('Wahoo active account resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tokenDocs.clear();
    mocks.tokenRefs.clear();
    mocks.transactionMeta = null;
    mocks.tokenRootData = {};
    mocks.runTransaction.mockImplementation(async (callback: (transaction: MockTransaction) => unknown) => callback({
      get: vi.fn(async (target: { get: () => Promise<unknown> }) => target.get()),
    }));
    mocks.getServiceConnectionMeta.mockResolvedValue(null);
    mocks.pinServiceConnectionProviderUserIdIfUnset.mockResolvedValue('pinned');
  });

  describe.each(['provider I/O', 'caller-owned transaction'] as const)('%s checkpoint', checkpoint => {
    let guard: WahooActiveAccountGuard;
    const assertCurrent = () => checkpoint === 'provider I/O'
      ? assertWahooActiveAccountGuardCurrent('user-1', guard)
      : assertWahooActiveAccountGuardCurrentInTransaction({
        get: vi.fn(async (target: { get: () => Promise<unknown> }) => target.get()),
      } as unknown as firestore.Transaction, 'user-1', guard);

    beforeEach(async () => {
      mocks.transactionMeta = {
        connectionState: 'connected',
        connectionStateGeneration: 'connection-a',
        providerUserId: 'account-a',
      };
      mocks.tokenRootData = { activeOAuthCredentialGeneration: 'credential-a' };
      mocks.tokenDocs.set('account-a', tokenSnapshot('account-a', 200, {
        ...credential,
        tokenCredentialGeneration: 'credential-a',
      }));
      guard = await captureWahooActiveAccountGuard('user-1', 'account-a', 'access-a');
      mocks.runTransaction.mockClear();
    });

    it('preserves the read transaction boundary for an unchanged guard', async () => {
      await expect(assertCurrent()).resolves.toBeUndefined();
      expect(mocks.runTransaction).toHaveBeenCalledTimes(checkpoint === 'provider I/O' ? 1 : 0);
    });

    it.each(['providerUserId', 'connectionStateGeneration'] as const)('rejects changed %s', async field => {
      mocks.transactionMeta[field] = 'replacement';
      await expect(assertCurrent()).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('treats a changed credential snapshot as retryable even when the access token is unchanged', async () => {
      mocks.tokenDocs.set('account-a', tokenSnapshot('account-a', 201, {
        ...credential,
        refreshToken: 'refresh-b',
        tokenCredentialGeneration: 'credential-a',
      }));
      await expect(assertCurrent()).rejects.toMatchObject({ name: 'WahooCredentialSupersededError', code: 'unavailable' });
    });

    it('preserves account-only captures across a refresh within the same OAuth generation', async () => {
      guard = await captureWahooActiveAccountGuard('user-1', 'account-a');
      mocks.tokenDocs.set('account-a', tokenSnapshot('account-a', 201, {
        accessToken: 'access-b', refreshToken: 'refresh-b', tokenCredentialGeneration: 'credential-a',
      }));
      await expect(assertCurrent()).resolves.toBeUndefined();
    });

    it('rejects a replaced active credential generation for an account-only guard', async () => {
      guard = await captureWahooActiveAccountGuard('user-1', 'account-a');
      mocks.tokenRootData = { activeOAuthCredentialGeneration: 'credential-b' };
      mocks.tokenDocs.set('account-a', tokenSnapshot('account-a', 201, {
        ...credential, tokenCredentialGeneration: 'credential-b',
      }));
      await expect(assertCurrent()).rejects.toMatchObject({ name: 'WahooCredentialSupersededError', code: 'unavailable' });
    });

    it('preserves reconnect-required errors before comparing guards', async () => {
      mocks.transactionMeta.connectionState = 'reconnect_required';
      await expect(assertCurrent()).rejects.toMatchObject({ name: 'WahooReconnectRequiredError' });
    });

    it('preserves authoritative pending-disconnect errors before comparing guards', async () => {
      mocks.tokenRootData.disconnectState = 'disconnect_pending';
      mocks.tokenRootData.disconnectGeneration = 'disconnect-a';
      await expect(assertCurrent()).rejects.toMatchObject({ name: 'TokenUseSkippedForPendingDisconnectError' });
    });
  });

  it('uses only the pinned Wahoo token even when another token exists', async () => {
    mocks.getServiceConnectionMeta.mockResolvedValue({
      connectionState: 'connected',
      providerUserId: 'account-a',
    });
    mocks.tokenDocs.set('account-a', tokenSnapshot('account-a', 100));
    mocks.tokenDocs.set('account-b', tokenSnapshot('account-b', 200));

    await expect(getActiveWahooTokenSnapshot('user-1')).resolves.toMatchObject({ id: 'account-a' });
    expect(mocks.pinServiceConnectionProviderUserIdIfUnset).not.toHaveBeenCalled();
  });

  it('deterministically pins one legacy account before returning it', async () => {
    mocks.tokenDocs.set('account-a', tokenSnapshot('account-a', 100));
    mocks.tokenDocs.set('account-b', tokenSnapshot('account-b', 200));

    await expect(getActiveWahooTokenSnapshot('user-1')).resolves.toMatchObject({ id: 'account-b' });
    expect(mocks.pinServiceConnectionProviderUserIdIfUnset).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.WahooAPI,
      'account-b',
      {
        expectedProviderToken: {
          documentRef: { path: 'wahooAPIAccessTokens/user-1/tokens/account-b' },
          providerUserIdField: 'wahooUserID',
        },
      },
    );
  });

  it('fails closed when the pinned token is missing instead of selecting another account', async () => {
    mocks.getServiceConnectionMeta.mockResolvedValue({
      connectionState: 'connected',
      providerUserId: 'account-a',
    });
    mocks.tokenDocs.set('account-b', tokenSnapshot('account-b', 200));

    await expect(getActiveWahooTokenSnapshot('user-1')).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('rejects OAuth recovery through a different Wahoo account', async () => {
    mocks.getServiceConnectionMeta.mockResolvedValue({
      connectionState: 'reconnect_required',
      providerUserId: 'account-a',
    });

    await expect(assertWahooOAuthAccountCompatible('user-1', 'account-b')).rejects.toMatchObject({
      name: 'WahooOAuthAccountMismatchError',
      expectedProviderUserId: 'account-a',
      receivedProviderUserId: 'account-b',
    });
  });

  it('accepts OAuth recovery through the retained Wahoo account', async () => {
    mocks.getServiceConnectionMeta.mockResolvedValue({
      connectionState: 'reconnect_required',
      providerUserId: 'account-a',
    });

    await expect(assertWahooOAuthAccountCompatible('user-1', 'account-a')).resolves.toBeUndefined();
  });

  it('derives a missing legacy pin from retained tokens before accepting OAuth recovery', async () => {
    mocks.getServiceConnectionMeta.mockResolvedValue({ connectionState: 'reconnect_required' });
    mocks.tokenDocs.set('account-a', tokenSnapshot('account-a', 100));
    mocks.tokenDocs.set('account-b', tokenSnapshot('account-b', 200));

    await expect(assertWahooOAuthAccountCompatible('user-1', 'account-a')).rejects.toMatchObject({
      name: 'WahooOAuthAccountMismatchError',
      expectedProviderUserId: 'account-b',
      receivedProviderUserId: 'account-a',
    });
    await expect(assertWahooOAuthAccountCompatible('user-1', 'account-b')).resolves.toBeUndefined();
  });

  it('returns a retryable supersession when a healthy refresh rotates the selected credential', async () => {
    mocks.transactionMeta = {
      connectionState: 'connected',
      connectionStateGeneration: 'connection-a',
      providerUserId: 'account-a',
    };
    mocks.tokenRootData = {
      activeOAuthCredentialGeneration: 'credential-a',
    };
    mocks.tokenDocs.set('account-a', tokenSnapshot('account-a', 100, {
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
      expiresAt: 123,
      tokenCredentialGeneration: 'credential-a',
    }));
    const guard = await captureWahooActiveAccountGuard('user-1', 'account-a', 'access-a');

    mocks.tokenDocs.set('account-a', tokenSnapshot('account-a', 200, {
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
      expiresAt: 456,
      tokenCredentialGeneration: 'credential-a',
    }));

    await expect(assertWahooActiveAccountGuardCurrent('user-1', guard)).rejects.toMatchObject({
      name: 'WahooCredentialSupersededError',
      code: 'unavailable',
    });
  });

  it('rejects a captured account guard after the connection generation changes', async () => {
    mocks.transactionMeta = {
      connectionState: 'connected',
      connectionStateGeneration: 'connection-a',
      providerUserId: 'account-a',
    };
    mocks.tokenDocs.set('account-a', tokenSnapshot('account-a', 100));
    const guard = await captureWahooActiveAccountGuard('user-1', 'account-a');

    mocks.transactionMeta = {
      connectionState: 'connected',
      connectionStateGeneration: 'connection-b',
      providerUserId: 'account-a',
    };

    await expect(assertWahooActiveAccountGuardCurrent('user-1', guard)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('rejects provider work when authoritative pending-disconnect state has not reached metadata yet', async () => {
    mocks.transactionMeta = {
      connectionState: 'connected',
      connectionStateGeneration: 'connection-a',
      providerUserId: 'account-a',
    };
    mocks.tokenRootData = {
      disconnectState: 'disconnect_pending',
      disconnectGeneration: 'disconnect-a',
    };
    mocks.tokenDocs.set('account-a', tokenSnapshot('account-a', 100));

    await expect(captureWahooActiveAccountGuard('user-1', 'account-a')).rejects.toMatchObject({
      name: 'TokenUseSkippedForPendingDisconnectError',
    });
  });

  it('rejects malformed pinned account metadata even when the value is falsy', async () => {
    mocks.transactionMeta = {
      connectionState: 'connected',
      connectionStateGeneration: 'connection-a',
      providerUserId: 0,
    };
    mocks.tokenDocs.set('account-a', tokenSnapshot('account-a', 100));

    await expect(captureWahooActiveAccountGuard('user-1', 'account-a')).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
});
