import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const mocks = vi.hoisted(() => ({
  getServiceConnectionMeta: vi.fn(),
  pinServiceConnectionProviderUserIdIfUnset: vi.fn(),
  tokenDocs: new Map<string, any>(),
  tokenRefs: new Map<string, any>(),
  transactionMeta: null as Record<string, unknown> | null,
  runTransaction: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
  firestore: () => {
    const getTokenRef = (id: string) => {
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
    return {
      runTransaction: mocks.runTransaction,
      collection: (collectionName: string) => ({
        doc: () => ({
          collection: (nestedCollectionName: string) => ({
            doc: (id: string) => nestedCollectionName === 'meta' ? metaRef : getTokenRef(id),
            get: vi.fn(async () => ({ docs: [...mocks.tokenDocs.values()] })),
          }),
        }),
        ...(collectionName === 'users' ? {} : {}),
      }),
    };
  },
}));

vi.mock('../service-connection-meta', () => ({
  getServiceConnectionMeta: mocks.getServiceConnectionMeta,
  pinServiceConnectionProviderUserIdIfUnset: mocks.pinServiceConnectionProviderUserIdIfUnset,
}));

import {
  assertWahooActiveAccountGuardCurrent,
  assertWahooOAuthAccountCompatible,
  captureWahooActiveAccountGuard,
  getActiveWahooTokenSnapshot,
} from './account';

function tokenSnapshot(
  id: string,
  dateRefreshed: number,
  overrides: Record<string, unknown> = {},
) {
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
    mocks.runTransaction.mockImplementation(async (callback: any) => callback({
      get: vi.fn(async (target: { get: () => Promise<unknown> }) => target.get()),
    }));
    mocks.getServiceConnectionMeta.mockResolvedValue(null);
    mocks.pinServiceConnectionProviderUserIdIfUnset.mockResolvedValue('pinned');
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

  it('rejects a captured account guard after the same token document is replaced', async () => {
    mocks.transactionMeta = {
      connectionState: 'connected',
      connectionStateGeneration: 'connection-a',
      providerUserId: 'account-a',
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
      tokenCredentialGeneration: 'credential-b',
    }));

    await expect(assertWahooActiveAccountGuardCurrent('user-1', guard)).rejects.toMatchObject({
      code: 'unauthenticated',
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
