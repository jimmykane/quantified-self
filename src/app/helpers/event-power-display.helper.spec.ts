import { describe, expect, it } from 'vitest';
import type { TrackChartPanelSeries } from './track-chart-panel.model';
import { buildEventPowerDisplay } from './event-power-display.helper';

function series(values: Array<number | null>, times = values.map((_, i) => i * 1000), xs = values.map((_, i) => i)): TrackChartPanelSeries {
  return { id: 'power', activityID: 'ride', activityName: 'Ride', streamType: 'Power', displayName: 'Power', unit: 'watt', color: '#123456',
    points: values.map((y, i) => ({ x: xs[i], y, time: times[i] })) };
}

describe('event power display', () => {
  it('averages three recorded seconds, including zeros, without mutating input or moving distance positions', () => {
    const source = series([0, 300, 600, 0], [10000, 11000, 12000, 13000], [10, 10, 90, 110]);
    const before = structuredClone(source);
    const display = buildEventPowerDisplay(source);
    expect([...display.lineValues]).toEqual([10, NaN, 10, NaN, 90, 300, 110, 300]);
    expect(display.hasAverage).toBe(true);
    expect(source).toEqual(before);
  });

  it.each([[0, 1000, 3000, 4000, 5000], [0, 1000, 1000, 2000, 3000], [0, 1000, 500, 1500, 2500], [0, 1000, NaN, 3000, 4000]].map(times => ({ times })))(
    'requires complete consecutive seconds across gaps, duplicate or nonmonotonic times: $times', ({ times }) => {
      const display = buildEventPowerDisplay(series([30, 60, 90, 120, 150], times));
      expect(Number.isNaN(display.lineValues[5])).toBe(true);
      expect(Number.isNaN(display.lineValues[7])).toBe(true);
    });

  it('keeps null windows empty and resumes only after three complete readings', () => {
    const display = buildEventPowerDisplay(series([30, null, 90, 120, 150]));
    expect([...display.lineValues]).toEqual([0, NaN, 1, NaN, 2, NaN, 3, NaN, 4, 120]);
    expect(buildEventPowerDisplay(series([null, 3])).hasAverage).toBe(false);
  });

  it('supports packed worker data, clips unused capacity and preserves its original buffers', () => {
    const source = { ...series([]), lineValues: new Float64Array([0, 0, 10, 300, 40, 600, 90, 900]), timeValues: new Float64Array([0, 1000, 2000, 3000]), pointCount: 3 };
    const display = buildEventPowerDisplay(source);
    expect([...display.lineValues]).toEqual([0, NaN, 10, NaN, 40, 300]);
    expect([...source.lineValues]).toEqual([0, 0, 10, 300, 40, 600, 90, 900]);
  });
});
