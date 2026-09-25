import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const stream = vi.fn();
  const select = vi.fn(() => ({ stream }));
  const orderBy = vi.fn(() => ({ select }));
  const collection = vi.fn(() => ({ orderBy }));
  const enforceAppCheck = vi.fn();
  return { stream, select, orderBy, collection, enforceAppCheck };
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

  it('rejects an invalid App Check request before reading event documents', async () => {
    hoisted.enforceAppCheck.mockImplementationOnce(() => {
      throw new Error('invalid app check');
    });

    await expect(listEventTags({ auth: { uid: 'owner-1' } } as CallableRequest))
      .rejects.toThrow('invalid app check');
    expect(hoisted.collection).not.toHaveBeenCalled();
  });

  it('reads only the caller\'s tag fields across all dates and normalizes legacy tags', async () => {
    hoisted.stream.mockReturnValueOnce((async function* () {
      yield { data: () => ({ tags: ['Race', 'Long run'] }) };
      yield { data: () => ({ tags: ['race', 'Recovery'] }) };
    })());
    hoisted.stream.mockReturnValueOnce((async function* () {
      yield { data: () => ({ benchmarkReviewTags: ['Older tag'] }) };
      yield { data: () => ({ tags: ['Race'], benchmarkReviewTags: ['Legacy ignored'] }) };
    })());

    const result = await listEventTags({ auth: { uid: 'owner-1' } } as CallableRequest);

    expect(hoisted.enforceAppCheck).toHaveBeenCalledOnce();
    expect(hoisted.collection).toHaveBeenCalledWith('users/owner-1/events');
    expect(hoisted.orderBy.mock.calls).toEqual([['tags'], ['benchmarkReviewTags']]);
    expect(hoisted.select).toHaveBeenCalledTimes(2);
    expect(hoisted.select).toHaveBeenCalledWith('tags', 'benchmarkReviewTags');
    expect(hoisted.stream).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ tags: ['Long run', 'Older tag', 'Race', 'Recovery'] });
  });
});
