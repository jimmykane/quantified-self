import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const mocks = vi.hoisted(() => ({
  getServiceConnectionMeta: vi.fn(),
  pinServiceConnectionProviderUserIdIfUnset: vi.fn(),
  tokenDocs: new Map<string, any>(),
}));

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: (id: string) => ({
            get: vi.fn(async () => mocks.tokenDocs.get(id) || {
              exists: false,
              id,
              data: () => undefined,
            }),
          }),
          get: vi.fn(async () => ({ docs: [...mocks.tokenDocs.values()] })),
        }),
      }),
    }),
  }),
}));

vi.mock('../service-connection-meta', () => ({
  getServiceConnectionMeta: mocks.getServiceConnectionMeta,
  pinServiceConnectionProviderUserIdIfUnset: mocks.pinServiceConnectionProviderUserIdIfUnset,
}));

import {
  assertWahooOAuthAccountCompatible,
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
});
