import { describe, expect, it } from 'vitest';
import { validateActivityAscentEdit } from './activity-ascent.service';

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
