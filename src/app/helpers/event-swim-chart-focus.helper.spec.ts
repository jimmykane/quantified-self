import { describe, expect, it } from 'vitest';
import { type ActivityInterface, type LapInterface, XAxisTypes } from '@sports-alliance/sports-lib/metrics';
import { getSwimLapFocusWindow, resolveSwimChartFocusRange } from './event-swim-chart-focus.helper';
const activity = { startDate: new Date(100000), endDate: new Date(700000) } as ActivityInterface;
const lap = (start: number, end: number) => ({ startDate: new Date(start), endDate: new Date(end) }) as LapInterface;

describe('swim interval chart focus', () => {
  it('uses recorded active or rest windows and contiguous grouped rests without mutating their order', () => {
    const laps = [lap(140000, 150000), lap(130000, 140000)];
    expect(getSwimLapFocusWindow(activity, laps)).toEqual({ startTime: 130000, endTime: 150000 });
    expect(+laps[0].startDate).toBe(140000);
  });
  it('rejects absent, reversed, cross-activity, gapped, overlapping and rejected windows', () => {
    for (const laps of [[], [lap(NaN, 150000)], [lap(150000, 130000)], [lap(0, 150000)], [lap(690000, 710000)],
      [lap(130000, 140000), lap(150000, 160000)], [lap(130000, 150000), lap(140000, 160000)]]) {
      expect(getSwimLapFocusWindow(activity, laps)).toBeNull();
    }
    const rejected = Object.assign(lap(130000, 150000), { timingValidity: { version: 1, reason: 'exceeds-workout-envelope', timerTime: 999999 } });
    expect(getSwimLapFocusWindow(activity, [rejected])).toBeNull();
  });
  it('matches duration and wall-clock axes, clips to chart data and refuses distance or disjoint ranges', () => {
    const focus = { activity, key: '1', label: 'Interval 1', startTime: 130000, endTime: 150000 };
    expect(resolveSwimChartFocusRange(focus, XAxisTypes.Duration, { start: 0, end: 600 })).toEqual({ start: 30, end: 50 });
    expect(resolveSwimChartFocusRange(focus, XAxisTypes.Time, { start: 140000, end: 700000 })).toEqual({ start: 140000, end: 150000 });
    expect(resolveSwimChartFocusRange(focus, XAxisTypes.Distance, { start: 0, end: 600 })).toBeNull();
    expect(resolveSwimChartFocusRange(focus, XAxisTypes.Duration, { start: 100, end: 600 })).toBeNull();
  });
});
