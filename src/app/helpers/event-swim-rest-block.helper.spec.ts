import { describe, expect, it } from 'vitest';
import {
  DataActiveLap, DataActiveLengths, DataDistance, DataDuration, DataHeartRateAvg, DataHeartRateMax,
  DataInterface, DataSpeedAvg, LapInterface, LapTypes,
} from '@sports-alliance/sports-lib';
import { groupSwimRestLaps, getSwimRestBlockMetric } from './event-swim-rest-block.helper';
import { normalizeSwimLength } from './event-swim-length.helper';
import { isRestSwimLap } from './event-swim-analytics.helper';

function lap(start: number, duration: number, options: {
  active?: boolean; activeLengths?: number; distance?: number; type?: LapTypes; hr?: number; maxHr?: number; end?: number;
} = {}): LapInterface {
  const stats: Record<string, DataInterface> = {};
  if (options.active !== undefined) stats[DataActiveLap.type] = new DataActiveLap(options.active);
  if (options.activeLengths !== undefined) stats[DataActiveLengths.type] = new DataActiveLengths(options.activeLengths);
  if (options.hr !== undefined) stats[DataHeartRateAvg.type] = new DataHeartRateAvg(options.hr);
  if (options.maxHr !== undefined) stats[DataHeartRateMax.type] = new DataHeartRateMax(options.maxHr);
  return { startDate: new Date(start * 1000), endDate: new Date((options.end ?? start + duration) * 1000),
    type: options.type ?? LapTypes.Manual, getDistance: () => new DataDistance(options.distance ?? 0),
    getDuration: () => new DataDuration(duration), getStat: type => stats[type] } as LapInterface;
}
const rest = (start: number, duration: number, options: Parameters<typeof lap>[2] = {}) => lap(start, duration, { active: false, ...options });

describe('swim rest display blocks', () => {
  it('groups five contiguous rests without mutating their objects or times', () => {
    const durations = [33.76, .51, 69.91, 8.14, 21.51];
    let time = 10;
    const rests = durations.map(duration => { const row = rest(time, duration); time += duration; return row; });
    const active = lap(0, 10, { active: true, distance: 25 });
    const next = lap(time, 30, { active: true, distance: 25 });
    expect(groupSwimRestLaps([active, ...rests, next], new Map())).toEqual([[active], rests, [next]]);
    expect(getSwimRestBlockMetric(rests, DataDuration.type)?.stat.getValue()).toBeCloseTo(133.83, 10);
    expect(getSwimRestBlockMetric(rests, DataDistance.type)?.stat.getValue()).toBe(0);
    expect(rests.map(row => row.getDuration().getValue())).toEqual(durations);
  });
  it('does not bridge an active lap hidden by a lap-type filter', () => {
    const rows = [rest(0, 10), lap(10, 10, { active: true, distance: 25, type: LapTypes.Interval }), rest(20, 10)];
    expect(groupSwimRestLaps(rows, new Map())).toEqual(rows.map(row => [row]));
  });
  it.each([
    ['gap', rest(11, 10)], ['overlap', rest(9, 10)], ['lap-type boundary', rest(10, 10, { type: LapTypes.Interval })],
    ['active', rest(10, 10, { active: true })], ['nonzero distance', rest(10, 10, { distance: 25 })],
    ['unknown state', lap(10, 10)], ['invalid date', rest(NaN, 10)], ['zero span', rest(10, 0)],
  ])('keeps %s separate', (_name, second) => {
    const first = rest(0, 10);
    expect(groupSwimRestLaps([first, second], new Map())).toEqual([[first], [second]]);
  });
  it('keeps a zero-stroke active drill active despite an inferred inactive flag', () => {
    const drill = rest(10, 10);
    const length = normalizeSwimLength({ index: 1, lapIndex: 2, startDate: 10000, endDate: 20000, type: 'active', strokes: 0 })!;
    const first = rest(0, 10);
    expect(isRestSwimLap(drill, [length])).toBe(false);
    expect(groupSwimRestLaps([first, drill], new Map([[drill, [length]]]))).toEqual([[first], [drill]]);
  });
  it.each([false, true])('keeps recorded active-length counts out of rest blocks with partial idle details: %s', partialIdle => {
    const rows = [rest(0, 10), rest(10, 10, { activeLengths: 1 }), rest(20, 10)];
    const idle = normalizeSwimLength({ index: 1, lapIndex: 2, startDate: 10000, endDate: 20000, type: 'idle' })!;
    const lengths = partialIdle ? [idle] : [];
    expect(isRestSwimLap(rows[1], lengths)).toBe(false);
    expect(groupSwimRestLaps(rows, new Map([[rows[1], lengths]]))).toEqual(rows.map(row => [row]));
  });
  it.each([0, -1, 1.5, NaN, Infinity])('does not infer active swimming from invalid or zero length count %s', activeLengths => {
    const rows = [rest(0, 10), rest(10, 10, { activeLengths })];
    expect(groupSwimRestLaps(rows, new Map())).toEqual([rows]);
  });
  it('uses duration-weighted HR and the largest maximum rather than averaging maxima', () => {
    const rows = [rest(0, 10, { hr: 100, maxHr: 110 }), rest(10, 30, { hr: 140, maxHr: 150 })];
    expect(getSwimRestBlockMetric(rows, DataHeartRateAvg.type)?.stat.getValue()).toBe(130);
    expect(getSwimRestBlockMetric(rows, DataHeartRateMax.type)?.stat.getValue()).toBe(150);
  });
  it('reports partial HR coverage and leaves missing or unsupported metrics unavailable', () => {
    const rows = [rest(0, 10, { hr: 100 }), rest(10, 30)];
    expect(getSwimRestBlockMetric(rows, DataHeartRateAvg.type)?.availableCount).toBe(1);
    expect(getSwimRestBlockMetric(rows, DataHeartRateAvg.type)?.stat.getValue()).toBe(100);
    expect(getSwimRestBlockMetric(rows, DataHeartRateMax.type)).toBeNull();
    expect(getSwimRestBlockMetric(rows, DataSpeedAvg.type)).toBeNull();
    expect(getSwimRestBlockMetric([], DataDuration.type)).toBeNull();
  });
});
