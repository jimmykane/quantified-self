import { describe, expect, it } from 'vitest';
import { retainedSourceReferences, retainedSourceRevision } from './retained-activity-source';

const source = { path: 'users/owner/events/event/original.fit', bucket: 'test-project', generation: '123' };

describe('retained source revision', () => {
  it('prefers the original-file array and falls back to the single original', () => {
    expect(retainedSourceReferences({ originalFiles: [source], originalFile: { path: 'old.fit' } })).toEqual([source]);
    expect(retainedSourceReferences({ originalFiles: [], originalFile: source })).toEqual([source]);
    expect(retainedSourceReferences({})).toEqual([]);
  });
  it.each(['path', 'bucket', 'generation'])('detects a changed %s without reading the original', field => {
    expect(retainedSourceRevision({ originalFile: source }))
      .not.toBe(retainedSourceRevision({ originalFile: { ...source, [field]: 'changed' } }));
  });
  it('ignores display metadata without changing the retained references', () => {
    const event = { originalFiles: [{ ...source, originalFilename: 'workout.fit' }], name: 'Workout' };
    const before = structuredClone(event);
    expect(retainedSourceRevision(event)).toBe(retainedSourceRevision({ originalFile: source }));
    expect(event).toEqual(before);
  });
});
