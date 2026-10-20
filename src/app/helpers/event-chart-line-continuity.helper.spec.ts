import { describe, expect, it } from 'vitest';
import { buildEventLineSegments, resolveEventLineContinuity } from './event-chart-line-continuity.helper';

describe('event chart line continuity', () => {
  it('defaults missing or malformed preferences to Continuous', () => {
    for (const value of [undefined, null, {}, { mode: 'unknown' }, { mode: 'custom', maxGapSeconds: 0 },
      { mode: 'custom', maxGapSeconds: '10' }, { mode: 'custom', maxGapSeconds: Infinity }]) {
      expect(resolveEventLineContinuity(value)).toEqual({ mode: 'continuous', maxGapSeconds: 10 });
    }
  });

  it('preserves valid settings and limits', () => {
    expect(resolveEventLineContinuity({ mode: 'custom', maxGapSeconds: 86400 }))
      .toEqual({ mode: 'custom', maxGapSeconds: 86400 });
    expect(resolveEventLineContinuity({ mode: 'detect' })).toEqual({ mode: 'detect', maxGapSeconds: 10 });
  });

  it('connects available readings continuously without changing timestamps or values', () => {
    const times = Float64Array.from([0, 1000, 2000, 600000, 700000]);
    const values = Float64Array.from([100, NaN, 102, 110, 112]);
    const before = [times.slice(), values.slice()];
    expect([...buildEventLineSegments(times, values, resolveEventLineContinuity(undefined))]).toEqual([1, 0, 1, 1, 1]);
    expect(times).toEqual(before[0]);
    expect(values).toEqual(before[1]);
  });

  it.each(['continuous', 'detect', 'custom'] as const)('preserves invalid and reversed time boundaries in %s', mode => {
    expect([...buildEventLineSegments([0, 1000, NaN, 3000, 2000, 2000, 4000], [1, 1, 1, 1, 1, 1, 1],
      { mode, maxGapSeconds: 10 })]).toEqual([1, 1, 0, 2, 3, 4, 4]);
  });

  it('uses the exact custom limit, including null grid rows and a valid zero reading', () => {
    expect([...buildEventLineSegments([0, 1000, 5000, 10001], [0, NaN, 1, 1],
      { mode: 'custom', maxGapSeconds: 5 })]).toEqual([1, 0, 1, 2]);
  });

  it.each([1, 2, 5, 10, 30, 60])('detects steady %s-second sampling and preserves deleted readings', seconds => {
    const times = Array.from({ length: 100 }, (_, i) => i * seconds * 1000);
    const values = times.map(() => 100);
    const normal = buildEventLineSegments(times, values, { mode: 'detect', maxGapSeconds: 10 });
    expect(new Set(normal)).toEqual(new Set([1]));
    values[50] = NaN;
    values[51] = NaN;
    const interrupted = buildEventLineSegments(times, values, { mode: 'detect', maxGapSeconds: 10 });
    expect(interrupted[49]).not.toEqual(interrupted[52]);
    expect(interrupted[50]).toBe(0);
  });

  it('learns a sustained cadence change without learning from a viewport slice', () => {
    const times = [0];
    for (let i = 0; i < 100; i++) times.push(times.at(-1) + (i < 50 ? 1000 : 5000));
    expect(new Set(buildEventLineSegments(times, times.map(() => 1),
      { mode: 'detect', maxGapSeconds: 10 }))).toEqual(new Set([1]));
  });

  it('keeps uncertain short sparse streams broken in Detect mode', () => {
    expect([...buildEventLineSegments([0, 5000, 10000], [1, 2, 3],
      { mode: 'detect', maxGapSeconds: 10 })]).toEqual([1, 2, 3]);
  });

  it('documents the unavoidable missing-reading ambiguity', () => {
    const times = Array.from({ length: 50 }, (_, i) => i * 10000);
    // These can be true10s recordings or1s recordings with nine lost readings.
    expect(new Set(buildEventLineSegments(times, times.map(() => 1),
      { mode: 'detect', maxGapSeconds: 10 }))).toEqual(new Set([1]));
  });
});
