import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ ensure: vi.fn() }));
vi.mock('firebase-admin', () => ({
  firestore: Object.assign(() => ({}), { FieldPath: { documentId: () => '__name__' } }),
  apps: [],
}));
vi.mock('../events/event-tag-catalog', () => ({ ensureEventTagCatalogEntries: mocks.ensure }));

import {
  backfillEventTagCatalog,
  parseEventTagCatalogBackfillOptions,
} from './backfill-event-tag-catalog';

function fakeDb() {
  const events: Record<string, Record<string, Record<string, unknown>>> = {
    alpha: {
      first: { tags: ['Race', 'Recovery'] },
      second: { benchmarkReviewTags: ['Older', 'race'] },
    },
    beta: { third: { tags: ['Swim'] } },
  };
  const users = ['alpha', 'beta'];
  return {
    collection: () => ({
      orderBy: () => ({
        limit: (limit: number) => {
          let cursor = '';
          const query = {
            startAfter: (value: string) => { cursor = value; return query; },
            get: async () => ({ docs: users.filter(uid => uid > cursor).slice(0, limit)
              .map(id => ({ id })) }),
          };
          return query;
        },
      }),
      doc: (uid: string) => ({
        collection: () => ({
          orderBy: (field: string) => ({
            select: () => ({
              stream: async function* () {
                for (const data of Object.values(events[uid] || {})) {
                  if (Object.prototype.hasOwnProperty.call(data, field)) yield { data: () => data };
                }
              },
            }),
          }),
        }),
      }),
    }),
  };
}

describe('event tag catalog backfill', () => {
  beforeEach(() => {
    mocks.ensure.mockReset().mockImplementation(async (_db, _uid, tags: string[]) => ({
      created: tags.length,
      existing: 0,
      skippedUserDeletion: false,
    }));
  });

  it('defaults to dry run and rejects invalid resume options', () => {
    expect(parseEventTagCatalogBackfillOptions([])).toEqual({ execute: false, uid: undefined,
      startAfter: undefined, limitUsers: 100 });
    expect(() => parseEventTagCatalogBackfillOptions(['--limit-users', '0'])).toThrow('--limit-users');
    expect(() => parseEventTagCatalogBackfillOptions(['--uid', 'alpha', '--start-after', 'beta']))
      .toThrow('either --uid or --start-after');
    expect(() => parseEventTagCatalogBackfillOptions(['--uid', '--execute']))
      .toThrow('--uid requires a value');
    expect(() => parseEventTagCatalogBackfillOptions(['--execute', '--execute']))
      .toThrow('Unknown or duplicate');
  });

  it('scans canonical and legacy fields, deduplicates, and resumes after one user', async () => {
    const db = fakeDb();
    const first = await backfillEventTagCatalog(db as never, {
      execute: false, limitUsers: 1,
    });
    expect(first).toMatchObject({ dryRun: true, usersScanned: 1, tagFieldsRead: 2,
      uniqueTags: 3, missingEntries: 3, nextStartAfter: 'alpha', complete: false });
    expect(mocks.ensure).toHaveBeenCalledWith(db, 'alpha', ['Race', 'Recovery', 'Older'], true);

    const second = await backfillEventTagCatalog(db as never, {
      execute: true, limitUsers: 1, startAfter: first.nextStartAfter || undefined,
    });
    expect(second).toMatchObject({ dryRun: false, usersScanned: 1, uniqueTags: 1,
      nextStartAfter: null, complete: true });
    expect(mocks.ensure).toHaveBeenCalledWith(db, 'beta', ['Swim'], false);
  });
});
