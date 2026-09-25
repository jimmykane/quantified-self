import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deletionGuard: vi.fn(),
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: mocks.deletionGuard,
}));

import {
  ensureEventTagCatalogEntries,
  eventTagCatalogKey,
  newlyAssignedEventTags,
  storedEventTagNames,
} from './event-tag-catalog';

function fakeFirestore() {
  const documents = new Map<string, { name: string }>();
  const create = vi.fn((ref: { path: string }, data: { name: string }) => {
    documents.set(ref.path, data);
  });
  const transaction = {
    get: vi.fn(async (ref: { path: string }) => ({ exists: documents.has(ref.path) })),
    create,
  };
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        collection: (child: string) => ({
          doc: (key: string) => ({ path: `${name}/${id}/${child}/${key}` }),
        }),
      }),
    }),
    runTransaction: async <T>(callback: (value: typeof transaction) => Promise<T>) => callback(transaction),
  };
  return { db, documents, create };
}

describe('event tag catalog projection', () => {
  beforeEach(() => {
    mocks.deletionGuard.mockReset().mockResolvedValue({ shouldSkip: false });
  });

  it('uses one case-insensitive key and creates each label only once on retry', async () => {
    const { db, documents, create } = fakeFirestore();
    expect(eventTagCatalogKey('Race')).toBe(eventTagCatalogKey('race'));
    expect(eventTagCatalogKey(' Race ')).toBe(eventTagCatalogKey('Race'));
    expect(eventTagCatalogKey('Race')).toMatch(/^[a-f0-9]{64}$/);

    await expect(ensureEventTagCatalogEntries(db as never, 'owner', [' Race ', 'race', 'Long run']))
      .resolves.toEqual({ created: 2, existing: 0, skippedUserDeletion: false });
    await expect(ensureEventTagCatalogEntries(db as never, 'owner', ['RACE', 'Long run']))
      .resolves.toEqual({ created: 0, existing: 2, skippedUserDeletion: false });

    expect(create).toHaveBeenCalledTimes(2);
    expect(documents.get(`users/owner/eventTagCatalog/${eventTagCatalogKey('Race')}`))
      .toEqual({ name: 'Race' });
  });

  it('recognizes newly assigned legacy tags and retains entries after removal', async () => {
    expect(newlyAssignedEventTags(undefined, { benchmarkReviewTags: [' Older '] })).toEqual(['Older']);
    expect(newlyAssignedEventTags({ tags: ['Race'] }, { tags: ['race', 'Recovery'] }))
      .toEqual(['Recovery']);
    expect(storedEventTagNames({ tags: ['Race'], benchmarkReviewTags: ['Older', 'race'] }))
      .toEqual(['Race', 'Older']);
    expect(newlyAssignedEventTags(undefined, { tags: [], benchmarkReviewTags: ['Older'] }))
      .toEqual(['Older']);
    expect(newlyAssignedEventTags({ tags: ['Race'] }, { tags: [] })).toEqual([]);

    const { db, documents } = fakeFirestore();
    await ensureEventTagCatalogEntries(db as never, 'owner', ['Race']);
    expect(documents.size).toBe(1);
  });

  it('never creates entries for a deleted account and leaves dry runs unchanged', async () => {
    const { db, create } = fakeFirestore();
    await expect(ensureEventTagCatalogEntries(db as never, 'owner', ['Race'], true))
      .resolves.toEqual({ created: 1, existing: 0, skippedUserDeletion: false });
    expect(create).not.toHaveBeenCalled();

    mocks.deletionGuard.mockResolvedValue({ shouldSkip: true });
    await expect(ensureEventTagCatalogEntries(db as never, 'owner', ['Race']))
      .resolves.toEqual({ created: 0, existing: 0, skippedUserDeletion: true });
    expect(create).not.toHaveBeenCalled();
  });
});
