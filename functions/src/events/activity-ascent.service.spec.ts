import { describe, expect, it } from 'vitest';
import { validateActivityAscentEdit, validateActivityElevationEdit } from './activity-ascent.service';

describe('activity ascent edit validation', () => {
  const request = { activityId: 'activity', ascent: 0, expectedSourceFingerprint: 'a'.repeat(64), expectedCorrection: null };
  it('accepts zero and an explicit reset without importing arbitrary fields', () => {
    expect(validateActivityAscentEdit('event', request)).toEqual(request);
    expect(validateActivityAscentEdit('event', { ...request, ascent: null })).toEqual({ ...request, ascent: null });
  });
  it.each([-1, NaN, Infinity, '75', 1000001, undefined])('rejects invalid ascent %s', ascent => {
    expect(() => validateActivityAscentEdit('event', { ...request, ascent })).toThrow();
  });
  it.each([
    { activityId: 'other/activity' }, { expectedSourceFingerprint: '' }, { expectedCorrection: undefined },
    { stats: { Distance: 100 } }, { expectedCorrection: { value: 75, sourceValue: 100, extra: true } },
  ])('rejects malformed or expanded edit contracts', patch => {
    expect(() => validateActivityAscentEdit('event', { ...request, ...patch })).toThrow();
  });
  it('rejects event path traversal', () => {
    expect(() => validateActivityAscentEdit('event/activities/other', request)).toThrow();
  });
});

describe('activity elevation edit validation', () => {
  const request = { activityId: 'leg', metric: 'descent', value: 0,
    expectedSourceFingerprint: 'a'.repeat(64), expectedCorrection: null };
  it.each(['ascent', 'descent'])('accepts a bounded %s correction and explicit reset', metric => {
    expect(validateActivityElevationEdit('event', { ...request, metric })).toEqual({ ...request, metric });
    expect(validateActivityElevationEdit('event', { ...request, metric, value: null }).value).toBeNull();
  });
  it.each([{ metric: 'Distance' }, { metric: undefined }, { value: -1 }, { value: Infinity }, { value: '10' },
    { value: 1000001 }, { expectedCorrection: undefined }, { stats: {} }, { ascent: 100 }, { activityId: 'a/b' }])('rejects expanded or invalid elevation edits: %s', patch => {
      expect(() => validateActivityElevationEdit('event', { ...request, ...patch })).toThrow();
    });
});
