import { describe, expect, it } from 'vitest';
import { parsePublicReleasesSnapshot } from './public-releases-snapshot';

const post = { id: 'release', title: 'Release', description: 'Published changes', date: '2026-11-04T00:00:00Z', published: true, type: 'minor' };
const snapshot = { version: 1, generatedAt: '2026-11-04T12:00:00Z', posts: [post] };

describe('public releases snapshot', () => {
  it('accepts published posts with JSON-safe dates and a successfully loaded empty feed', () => {
    expect(parsePublicReleasesSnapshot(snapshot).posts).toEqual([post]);
    expect(parsePublicReleasesSnapshot({ ...snapshot, posts: [] }).posts).toEqual([]);
  });

  it.each([
    { ...post, published: false }, { ...post, date: 'invalid' }, { ...post, title: '' },
    { ...post, type: 'unknown' }, { ...post, internal_note: 'must not be transferred' },
    { ...post, image: 7 }, { ...post, id: 'users/private' },
  ])('rejects invalid or non-public transferred fields: %j', invalidPost => {
    expect(() => parsePublicReleasesSnapshot({ ...snapshot, posts: [invalidPost] })).toThrow(/invalid shape/);
  });

  it('rejects duplicate posts and invalid snapshot versions', () => {
    expect(() => parsePublicReleasesSnapshot({ ...snapshot, posts: [post, post] })).toThrow();
    expect(() => parsePublicReleasesSnapshot({ ...snapshot, version: 2 })).toThrow();
    expect(() => parsePublicReleasesSnapshot(null)).toThrow();
  });
});
