import { describe, expect, it } from 'vitest';

import { applyEventTagChanges, getEventTags, normalizeEventTags, preserveEventTagsOnRewrite } from '@shared/event-tags';

describe('event tags helper', () => {
  it('normalizes whitespace, length, duplicates, and the tag count', () => {
    expect(normalizeEventTags([
      ' route ', 'Route', 'long   effort', '123456789012345678901234567890123456',
      'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
    ])).toEqual([
      'route', 'long effort', '12345678901234567890123456789012',
      'a', 'b', 'c', 'd', 'e', 'f', 'g',
    ]);
  });

  it('matches the Firestore length boundary without splitting surrogate pairs', () => {
    const splitAtBoundary = `${'x'.repeat(31)}🏃tail`;
    const fitsAtBoundary = `${'x'.repeat(30)}🏃tail`;
    const splitAfterSpace = `${'x'.repeat(31)} y`;
    const splitSurrogateAfterSpace = `${'x'.repeat(30)} 🏃tail`;

    expect(normalizeEventTags([splitAtBoundary])).toEqual(['x'.repeat(31)]);
    expect(normalizeEventTags([fitsAtBoundary])).toEqual([`${'x'.repeat(30)}🏃`]);
    expect(normalizeEventTags(['🏃'.repeat(17)])).toEqual(['🏃'.repeat(16)]);
    expect(normalizeEventTags([splitAfterSpace])).toEqual(['x'.repeat(31)]);
    expect(normalizeEventTags([splitSurrogateAfterSpace])).toEqual(['x'.repeat(30)]);
  });

  it('prefers an explicitly empty tags array over legacy comparison tags', () => {
    expect(getEventTags({ tags: [], benchmarkReviewTags: ['legacy'] } as never)).toEqual([]);
    expect(getEventTags({ benchmarkReviewTags: [' legacy '] } as never)).toEqual(['legacy']);
  });

  it('removes before adding and preserves unrelated tag order', () => {
    expect(applyEventTagChanges(['Route', 'Race', '2026'], {
      remove: ['race', 'missing'],
      add: [' Long   run ', 'route'],
    })).toEqual(['Route', '2026', 'Long run']);
  });

  it('rejects a result above the event tag limit', () => {
    expect(() => applyEventTagChanges(
      Array.from({ length: 10 }, (_value, index) => `tag-${index}`),
      { add: ['overflow'], remove: [] },
    )).toThrow('up to 10 tags');
  });

  it('preserves the latest stored tags on event rewrites', () => {
    expect(preserveEventTagsOnRewrite({ name: 'Reparsed' }, { tags: [' Race '] })).toEqual({
      name: 'Reparsed',
      tags: ['Race'],
    });
    expect(preserveEventTagsOnRewrite({ tags: ['Stale'] }, { tags: ['Latest'] })).toEqual({ tags: ['Latest'] });
    expect(preserveEventTagsOnRewrite(
      { benchmarkReviewTags: ['Stale'], name: 'Legacy rewrite' },
      { benchmarkReviewTags: ['Latest'] },
    )).toEqual({ name: 'Legacy rewrite', tags: ['Latest'] });
    expect(preserveEventTagsOnRewrite({ tags: ['New'] }, null)).toEqual({ tags: ['New'] });
    expect(preserveEventTagsOnRewrite({ benchmarkReviewTags: ['Legacy'] }, null)).toEqual({ tags: ['Legacy'] });
    expect(preserveEventTagsOnRewrite({
      name: 'Malformed import',
      tags: { injected: true },
      benchmarkReviewTags: 'not-a-list',
    }, null)).toEqual({ name: 'Malformed import' });
    expect(preserveEventTagsOnRewrite({ name: 'New' }, null)).toEqual({ name: 'New' });
  });
});
