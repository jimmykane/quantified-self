import { describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import type { EventInterface } from '@sports-alliance/sports-lib';
vi.mock('firebase-admin', () => ({ storage: () => ({ bucket: () => ({ name: 'test-project' }) }) }));
import { loadRetainedActivitySources, retainedSourceRevision } from './retained-activity-source';

const source = { path: 'users/owner/events/event/original.fit.gz', bucket: 'test-project', generation: '123' };
const event = { originalFiles: [source] };
const parsed = { getActivities: () => [] } as unknown as EventInterface;

describe('bounded legacy source inspection', () => {
  it('loads the referenced generation and decompresses only inside the bounded private parse', async () => {
    const loadSource = vi.fn(async () => gzipSync(Buffer.from('synthetic')));
    const parseSource = vi.fn(async () => parsed);
    await loadRetainedActivitySources('owner', 'event', event, { loadSource, parseSource });
    expect(loadSource).toHaveBeenCalledWith(source, 30 * 1024 * 1024);
    expect(parseSource.mock.calls[0][0]).toEqual(Buffer.from('synthetic'));
    expect(retainedSourceRevision(event)).not.toBe(retainedSourceRevision({ originalFiles: [{ ...source, generation: '124' }] }));
  });
  it.each([
    { ...source, path: 'users/other/events/event/original.fit' },
    { ...source, path: 'users/owner/events/event/../original.fit' },
    { ...source, path: 'users/owner/events/event/%2e%2e/file.fit' },
    { ...source, path: 'users/owner/events/event/bad\nname.fit' },
    { ...source, path: 'users/owner/events/event/bad\\name.fit' },
    { ...source, bucket: 'other-project' }, { ...source, generation: '../bad' },
  ])('rejects foreign/malformed source metadata before fetching: %j', invalid => {
    const loadSource = vi.fn();
    return expect(loadRetainedActivitySources('owner', 'event', { originalFiles: [invalid] }, { loadSource }))
      .rejects.toMatchObject({ code: 'ACTIVITY_IDENTITY_CONFLICT' }).then(() => expect(loadSource).not.toHaveBeenCalled());
  });
  it('keeps transient Storage failures retryable while missing originals need review', async () => {
    const transient = Object.assign(new Error('Unavailable'), { code: 503 });
    await expect(loadRetainedActivitySources('owner', 'event', event, { loadSource: async () => { throw transient; } }))
      .rejects.toBe(transient);
    await expect(loadRetainedActivitySources('owner', 'event', event,
      { loadSource: async () => { throw Object.assign(new Error('Missing'), { code: 404 }); } }))
      .rejects.toMatchObject({ code: 'ACTIVITY_IDENTITY_CONFLICT' });
  });
  it('bounds file counts and rejects oversized source/decompression inputs', async () => {
    const loadSource = vi.fn();
    await expect(loadRetainedActivitySources('owner', 'event', { originalFiles: Array(5).fill(source) }, { loadSource })).rejects.toThrow();
    expect(loadSource).not.toHaveBeenCalled();
    await expect(loadRetainedActivitySources('owner', 'event', event,
      { loadSource: async () => Buffer.alloc(30 * 1024 * 1024 + 1) })).rejects.toThrow();
    const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024 + 1));
    await expect(loadRetainedActivitySources('owner', 'event', event, { loadSource: async () => bomb })).rejects.toThrow();
  });
});
