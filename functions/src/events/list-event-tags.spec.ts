import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const get = vi.fn();
  const select = vi.fn(() => ({ get }));
  const collection = vi.fn(() => ({ select }));
  const enforceAppCheck = vi.fn();
  return { get, select, collection, enforceAppCheck };
});

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_options: unknown, handler: unknown) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));
vi.mock('firebase-functions/logger', () => ({ error: vi.fn() }));
vi.mock('firebase-admin', () => ({
  firestore: () => ({ collection: hoisted.collection }),
}));
vi.mock('../utils', () => ({
  ALLOWED_CORS_ORIGINS: ['https://example.com'],
  enforceAppCheck: hoisted.enforceAppCheck,
}));

import { listEventTags } from './list-event-tags';

type CallableRequest = Parameters<typeof listEventTags>[0];

describe('listEventTags', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires authentication before reading event documents', async () => {
    await expect(listEventTags({ auth: null } as CallableRequest)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(hoisted.collection).not.toHaveBeenCalled();
  });

  it('reads only the caller\'s tag fields across all dates and normalizes legacy tags', async () => {
    hoisted.get.mockResolvedValue({ docs: [
      { data: () => ({ tags: ['Race', 'Long run'] }) },
      { data: () => ({ tags: ['race', 'Recovery'] }) },
      { data: () => ({ benchmarkReviewTags: ['Older tag'] }) },
      { data: () => ({ tags: [] }) },
    ] });

    const result = await listEventTags({ auth: { uid: 'owner-1' } } as CallableRequest);

    expect(hoisted.enforceAppCheck).toHaveBeenCalledOnce();
    expect(hoisted.collection).toHaveBeenCalledWith('users/owner-1/events');
    expect(hoisted.select).toHaveBeenCalledWith('tags', 'benchmarkReviewTags');
    expect(result).toEqual({ tags: ['Long run', 'Older tag', 'Race', 'Recovery'] });
  });
});
