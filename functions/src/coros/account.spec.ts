import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getServiceConnectionMeta: vi.fn(),
  setServiceConnectionProviderUserId: vi.fn(),
  tokenCollectionGet: vi.fn(),
  tokenDocumentGet: vi.fn(),
}));

vi.mock('../service-connection-meta', () => ({
  getServiceConnectionMeta: mocks.getServiceConnectionMeta,
  setServiceConnectionProviderUserId: mocks.setServiceConnectionProviderUserId,
}));

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: () => ({
      doc: () => ({
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

import { getActiveCOROSTokenSnapshot, selectActiveCOROSTokenSnapshot } from './account';

type COROSTokenSnapshot = Parameters<typeof selectActiveCOROSTokenSnapshot>[0][number];

function token(id: string, data: Record<string, unknown>) {
  return { id, exists: true, data: () => data } as unknown as COROSTokenSnapshot;
}

describe('COROS active account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServiceConnectionMeta.mockResolvedValue(null);
    mocks.setServiceConnectionProviderUserId.mockResolvedValue(true);
  });

  it('chooses the newest refreshed token, then creation date and document id', () => {
    expect(selectActiveCOROSTokenSnapshot([
      token('open-a', { dateRefreshed: 20, dateCreated: 100 }),
      token('open-b', { dateRefreshed: 30, dateCreated: 1 }),
      token('open-c', { dateRefreshed: 30, dateCreated: 2 }),
      token('open-d', { dateRefreshed: 30, dateCreated: 2 }),
    ])?.id).toBe('open-d');
  });

  it('uses the pinned account and never falls back to another token', async () => {
    mocks.getServiceConnectionMeta.mockResolvedValue({ providerUserId: 'open-pinned' });
    const pinned = token('open-pinned', { openId: 'open-pinned' });
    mocks.tokenDocumentGet.mockResolvedValue(pinned);

    await expect(getActiveCOROSTokenSnapshot('user-1')).resolves.toBe(pinned);
    expect(mocks.tokenCollectionGet).not.toHaveBeenCalled();
  });

  it('fails closed when the pinned token is gone', async () => {
    mocks.getServiceConnectionMeta.mockResolvedValue({ providerUserId: 'open-pinned' });
    mocks.tokenDocumentGet.mockResolvedValue({ id: 'open-pinned', exists: false, data: () => undefined });

    await expect(getActiveCOROSTokenSnapshot('user-1')).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mocks.tokenCollectionGet).not.toHaveBeenCalled();
  });

  it('pins the selected legacy token', async () => {
    const selected = token('open-new', { openId: 'open-new', dateRefreshed: 20 });
    mocks.tokenCollectionGet.mockResolvedValue({ docs: [
      token('open-old', { openId: 'open-old', dateRefreshed: 10 }),
      selected,
    ] });

    await expect(getActiveCOROSTokenSnapshot('user-1')).resolves.toBe(selected);
    expect(mocks.setServiceConnectionProviderUserId).toHaveBeenCalledWith(
      'user-1',
      expect.anything(),
      'open-new',
    );
  });
});
