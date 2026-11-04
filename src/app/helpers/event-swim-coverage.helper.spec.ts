import { describe, expect, it } from 'vitest';
import { normalizeSwimLength } from './event-swim-length.helper';
import { getSwimCoverage } from './event-swim-coverage.helper';

const length = (overrides: Record<string, unknown> = {}) => normalizeSwimLength({
  index: 1, lapIndex: 2, type: 'active', startDate: 0, endDate: 30000,
  strokes: 12, timerTime: 30, distance: 25, poolLength: 25, ...overrides,
})!;

describe('swim data coverage', () => {
  it('stays hidden for complete recordings and usable zero values, ignores rest and unknown states', () => {
    expect(getSwimCoverage([length(), length({ strokes: 0, distance: 0, timerTime: 0 }),
      length({ type: 'rest', strokes: null, distance: null, timerTime: null }),
      length({ type: 'unknown', strokes: null })])).toBeNull();
    expect(getSwimCoverage([])).toBeNull();
  });
  it('reports an incomplete or conflicting length collection even when every available field is usable', () => {
    expect(getSwimCoverage([length()], 2)).toMatchObject({ total: 1, incomplete: 0, recordedActiveCount: 2, countMismatch: true });
    expect(getSwimCoverage([length(), length({ index: 2 })], 1)?.countMismatch).toBe(true);
    expect(getSwimCoverage([length()], 1)).toBeNull();
    for (const count of [null, undefined, '2', -1, NaN, 1.5]) expect(getSwimCoverage([length()], count)).toBeNull();
  });
  it('counts each incomplete length once and identifies recorded lengths and laps per missing field', () => {
    const result = getSwimCoverage([length({ index: 6, strokes: null }),
      length({ index: 7, strokes: -1, distance: null, poolLength: null, timerTime: null, elapsedTime: null }), length()]);
    expect(result).toMatchObject({ total: 3, incomplete: 2 });
    expect(result!.fields.map(field => [field.key, field.available, field.affected])).toEqual([
      ['strokes', 1, [{ index: 6, lapIndex: 2 }, { index: 7, lapIndex: 2 }]],
      ['distance', 2, [{ index: 7, lapIndex: 2 }]], ['duration', 2, [{ index: 7, lapIndex: 2 }]],
    ]);
  });
  it('honors pool and elapsed-time fallbacks but retains invalid distance and rejected timer evidence', () => {
    expect(getSwimCoverage([length({ distance: null, timerTime: null, elapsedTime: 30 })])).toBeNull();
    const result = getSwimCoverage([length({ distance: NaN, timerTime: -1, elapsedTime: 30 })]);
    expect(result!.fields.map(field => field.key)).toEqual(['distance', 'duration']);
  });
});
