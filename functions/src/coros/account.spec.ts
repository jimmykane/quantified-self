import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';

const mocks = vi.hoisted(() => ({
  getServiceConnectionMeta: vi.fn(),
  pinServiceConnectionProviderUserIdIfUnset: vi.fn(),
  tokenCollectionGet: vi.fn(),
  tokenDocumentGet: vi.fn(),
  tokenRootGet: vi.fn(),
}));

vi.mock('../service-connection-meta', () => ({
  getServiceConnectionMeta: mocks.getServiceConnectionMeta,
  pinServiceConnectionProviderUserIdIfUnset: mocks.pinServiceConnectionProviderUserIdIfUnset,
}));

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: () => ({
      doc: () => ({
        get: mocks.tokenRootGet,
        collection: () => ({
          get: mocks.tokenCollectionGet,
          doc: () => ({ get: mocks.tokenDocumentGet }),
        }),
      }),
    }),
  }),
}));

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class HttpsError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  },
}));

import {
  assertActiveCOROSAccountInTransaction,
  getActiveCOROSTokenSnapshot,
  normalizeCOROSOpenId,
  selectActiveCOROSTokenSnapshot,
} from './account';

type COROSTokenSnapshot = Parameters<typeof selectActiveCOROSTokenSnapshot>[0][number];

function token(id: string, data: Record<string, unknown>) {
  return { id, exists: true, data: () => data } as unknown as COROSTokenSnapshot;
}

describe('COROS active account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServiceConnectionMeta.mockResolvedValue(null);
    mocks.pinServiceConnectionProviderUserIdIfUnset.mockResolvedValue('pinned');
    mocks.tokenRootGet.mockResolvedValue({ exists: true, data: () => ({}) });
  });

  it('chooses the newest refreshed token, then creation date and document id', () => {
    expect(selectActiveCOROSTokenSnapshot([
      token('open-a', { dateRefreshed: 20, dateCreated: 100 }),
      token('open-b', { dateRefreshed: 30, dateCreated: 1 }),
      token('open-c', { dateRefreshed: 30, dateCreated: 2 }),
      token('open-d', { dateRefreshed: 30, dateCreated: 2 }),
    ])?.id).toBe('open-d');
  });

  it('accepts only bounded COROS identifiers without control characters', () => {
    expect(normalizeCOROSOpenId(' open-1 ')).toBe('open-1');
    expect(normalizeCOROSOpenId('open\r\ninjected')).toBeNull();
    expect(normalizeCOROSOpenId('open/nested')).toBeNull();
    expect(normalizeCOROSOpenId('x'.repeat(201))).toBeNull();
    expect(normalizeCOROSOpenId({ openId: 'open-1' })).toBeNull();
  });

  it('uses the pinned account and never falls back to another token', async () => {
    mocks.getServiceConnectionMeta.mockResolvedValue({ providerUserId: 'open-pinned' });
    const pinned = token('open-pinned', { openId: 'open-pinned' });
    mocks.tokenDocumentGet.mockResolvedValue(pinned);

    await expect(getActiveCOROSTokenSnapshot('user-1')).resolves.toBe(pinned);
    expect(mocks.tokenCollectionGet).not.toHaveBeenCalled();
  });

  it('fails closed before token access when the connection requires reconnect', async () => {
    mocks.getServiceConnectionMeta.mockResolvedValue({
      connectionState: 'reconnect_required',
      providerUserId: 'open-pinned',
    });

    await expect(getActiveCOROSTokenSnapshot('user-1')).rejects.toMatchObject({
      code: 'unauthenticated',
      message: 'Reconnect COROS before sending data.',
    });
    expect(mocks.tokenDocumentGet).not.toHaveBeenCalled();
    expect(mocks.tokenCollectionGet).not.toHaveBeenCalled();
    expect(mocks.pinServiceConnectionProviderUserIdIfUnset).not.toHaveBeenCalled();
  });

  it('defers active-account lookup while disconnect is pending', async () => {
    mocks.getServiceConnectionMeta.mockResolvedValue({
      connectionState: 'disconnect_pending',
      providerUserId: 'open-pinned',
    });

    await expect(getActiveCOROSTokenSnapshot('user-1', 'open-pinned')).rejects.toMatchObject({
      name: 'TokenUseSkippedForPendingDisconnectError',
      code: 'failed-precondition',
    });
    expect(mocks.tokenDocumentGet).not.toHaveBeenCalled();
    expect(mocks.tokenCollectionGet).not.toHaveBeenCalled();
  });

  it('fails closed when the pinned token is gone', async () => {
    mocks.getServiceConnectionMeta.mockResolvedValue({ providerUserId: 'open-pinned' });
    mocks.tokenDocumentGet.mockResolvedValue({ id: 'open-pinned', exists: false, data: () => undefined });

    await expect(getActiveCOROSTokenSnapshot('user-1')).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mocks.tokenCollectionGet).not.toHaveBeenCalled();
  });

  it('fails closed when a token child is orphaned under a deleted root', async () => {
    mocks.getServiceConnectionMeta.mockResolvedValue({ providerUserId: 'open-pinned' });
    mocks.tokenRootGet.mockResolvedValue({ exists: false, data: () => undefined });
    mocks.tokenDocumentGet.mockResolvedValue(token('open-pinned', { openId: 'open-pinned' }));

    await expect(getActiveCOROSTokenSnapshot('user-1')).rejects.toMatchObject({
      code: 'unauthenticated',
      message: 'Connect COROS before sending data.',
    });
    expect(mocks.tokenDocumentGet).not.toHaveBeenCalled();
  });

  it('fails closed when a recreated token root does not own the child credential generation', async () => {
    mocks.getServiceConnectionMeta.mockResolvedValue({ providerUserId: 'open-pinned' });
    mocks.tokenRootGet.mockResolvedValue({
      exists: true,
      data: () => ({ activeOAuthCredentialGeneration: 'root-generation-new' }),
    });
    mocks.tokenDocumentGet.mockResolvedValue(token('open-pinned', {
      openId: 'open-pinned',
      tokenCredentialGeneration: 'token-generation-old',
    }));

    await expect(getActiveCOROSTokenSnapshot('user-1')).rejects.toMatchObject({
      code: 'unauthenticated',
      message: 'Reconnect COROS before sending data.',
    });
  });

  it('fails closed when pinned metadata is malformed', async () => {
    mocks.getServiceConnectionMeta.mockResolvedValue({ providerUserId: 'open-id\r\ninjected' });

    await expect(getActiveCOROSTokenSnapshot('user-1')).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mocks.tokenDocumentGet).not.toHaveBeenCalled();
    expect(mocks.tokenCollectionGet).not.toHaveBeenCalled();
  });

  it('fails closed when the expected active account changed', async () => {
    mocks.getServiceConnectionMeta.mockResolvedValue({ providerUserId: 'open-new' });
    mocks.tokenDocumentGet.mockResolvedValue(token('open-new', { openId: 'open-new' }));

    await expect(getActiveCOROSTokenSnapshot('user-1', 'open-old'))
      .rejects.toMatchObject({ code: 'unauthenticated', message: expect.stringContaining('changed') });
  });

  it('pins the selected legacy token', async () => {
    const selected = token('open-new', { openId: 'open-new', dateRefreshed: 20 });
    mocks.tokenCollectionGet.mockResolvedValue({ docs: [
      token('open-old', { openId: 'open-old', dateRefreshed: 10 }),
      selected,
    ] });

    await expect(getActiveCOROSTokenSnapshot('user-1')).resolves.toBe(selected);
    expect(mocks.pinServiceConnectionProviderUserIdIfUnset).toHaveBeenCalledWith(
      'user-1',
      expect.anything(),
      'open-new',
    );
  });

  it('does not pin a legacy account that differs from the expected operation account', async () => {
    mocks.tokenCollectionGet.mockResolvedValue({ docs: [
      token('open-new', { openId: 'open-new', dateRefreshed: 20 }),
    ] });

    await expect(getActiveCOROSTokenSnapshot('user-1', 'open-old'))
      .rejects.toMatchObject({ code: 'unauthenticated', message: expect.stringContaining('changed') });
    expect(mocks.pinServiceConnectionProviderUserIdIfUnset).not.toHaveBeenCalled();
  });

  it('does not overwrite an account pinned by a concurrent reconnect', async () => {
    mocks.tokenCollectionGet.mockResolvedValue({ docs: [
      token('open-old', { openId: 'open-old', dateRefreshed: 20 }),
    ] });
    mocks.pinServiceConnectionProviderUserIdIfUnset.mockResolvedValue('conflict');

    await expect(getActiveCOROSTokenSnapshot('user-1'))
      .rejects.toMatchObject({ code: 'unauthenticated', message: expect.stringContaining('changed') });
  });

  it('rejects a legacy token with an unsafe openId', async () => {
    mocks.tokenCollectionGet.mockResolvedValue({ docs: [
      token('open-unsafe', { openId: 'open-unsafe\nvalue', dateRefreshed: 20 }),
    ] });

    await expect(getActiveCOROSTokenSnapshot('user-1')).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mocks.pinServiceConnectionProviderUserIdIfUnset).not.toHaveBeenCalled();
  });

  it('revalidates the pinned account and token inside a downstream write transaction', async () => {
    const transaction = {
      get: vi.fn()
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({ connectionState: 'connected', providerUserId: 'open-pinned' }),
        })
        .mockResolvedValueOnce({ exists: true, data: () => ({}) })
        .mockResolvedValueOnce(token('open-pinned', { openId: 'open-pinned' })),
    };

    await expect(assertActiveCOROSAccountInTransaction(
      'user-1',
      'open-pinned',
      transaction as unknown as admin.firestore.Transaction,
    )).resolves.toBeUndefined();
    expect(transaction.get).toHaveBeenCalledTimes(3);
  });

  it('rejects a transactional write after the COROS account becomes unavailable', async () => {
    const transaction = {
      get: vi.fn()
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({ connectionState: 'disconnect_pending', providerUserId: 'open-pinned' }),
        })
        .mockResolvedValueOnce({ exists: true, data: () => ({}) })
        .mockResolvedValueOnce(token('open-pinned', { openId: 'open-pinned' })),
    };

    await expect(assertActiveCOROSAccountInTransaction(
      'user-1',
      'open-pinned',
      transaction as unknown as admin.firestore.Transaction,
    )).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a transactional write when the COROS token root was deleted', async () => {
    const transaction = {
      get: vi.fn()
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({ connectionState: 'connected', providerUserId: 'open-pinned' }),
        })
        .mockResolvedValueOnce({ exists: false, data: () => undefined })
        .mockResolvedValueOnce(token('open-pinned', { openId: 'open-pinned' })),
    };

    await expect(assertActiveCOROSAccountInTransaction(
      'user-1',
      'open-pinned',
      transaction as unknown as admin.firestore.Transaction,
    )).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a transactional write after the token root credential generation changes', async () => {
    const transaction = {
      get: vi.fn()
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({ connectionState: 'connected', providerUserId: 'open-pinned' }),
        })
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({ activeOAuthCredentialGeneration: 'root-generation-new' }),
        })
        .mockResolvedValueOnce(token('open-pinned', {
          openId: 'open-pinned',
          tokenCredentialGeneration: 'token-generation-old',
        })),
    };

    await expect(assertActiveCOROSAccountInTransaction(
      'user-1',
      'open-pinned',
      transaction as unknown as admin.firestore.Transaction,
    )).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
