import { describe, expect, it } from 'vitest';
import type { TrackChartPanelSeries } from './track-chart-panel.model';
import { buildEventPowerDisplay, buildEventPowerWhiskers, buildEventPowerWhiskerOption } from './event-power-display.helper';

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

  it('keeps actual recorded peaks and coasting dips at their source positions at phone and desktop widths', () => {
    const source = series([100, 100, 396, 200, 0, 100, 110]);
    const before = structuredClone(source);
    const display = buildEventPowerDisplay(source);
    for (const width of [7, 70, 320, 1200]) {
      const whiskers = buildEventPowerWhiskers(source, display, { start: 0, end: 6 }, width);
      expect(whiskers).toContainEqual({ index: 2, x: 2, raw: 396, average: 596 / 3 });
      expect(whiskers).toContainEqual({ index: 4, x: 4, raw: 0, average: 596 / 3 });
      expect(whiskers.every(point => source.points![point.index].x === point.x && source.points![point.index].y === point.raw)).toBe(true);
    }
    expect(source).toEqual(before);
  });

  it('retains separate interrupted runs, incomplete-window peaks, repeated distance positions and only the visible range', () => {
    const source = series([500, null, 40, 40, 40, 0], undefined, [0, 0, 10, 10, 20, 30]);
    const display = buildEventPowerDisplay(source);
    const whiskers = buildEventPowerWhiskers(source, display, { start: 0, end: 30 }, 7);
    expect(whiskers).toContainEqual({ index: 0, x: 0, raw: 500, average: null });
    expect(whiskers).toContainEqual({ index: 2, x: 10, raw: 40, average: null });
    expect(whiskers.some(point => point.raw === 0)).toBe(true);
    expect(buildEventPowerWhiskers(source, display, { start: 10, end: 20 }, 7).some(point => point.raw === 500)).toBe(false);
  });

  it('keeps both raw extrema even when an earlier effort keeps the 3s average above the zoomed raw range', () => {
    const source = series([900, 900, 900, 500, 490, 480]);
    const display = buildEventPowerDisplay(source);
    const whiskers = buildEventPowerWhiskers(source, display, { start: 3, end: 5 }, 7);
    expect(whiskers).toContainEqual({ index: 3, x: 3, raw: 500, average: 2300 / 3 });
    expect(whiskers).toContainEqual({ index: 5, x: 5, raw: 480, average: 490 });
  });

  it('keeps extrema from packed worker samples without changing the original buffers', () => {
    const source = { ...series([]), lineValues: new Float64Array([0, 100, 10, 396, 40, 0]), timeValues: new Float64Array([0, 1000, 2000]), pointCount: 3 };
    const before = [...source.lineValues];
    const whiskers = buildEventPowerWhiskers(source, buildEventPowerDisplay(source), { start: 0, end: 40 }, 7);
    expect(whiskers.map(point => point.raw)).toEqual([396, 0]);
    expect([...source.lineValues]).toEqual(before);
  });

  it('renders silent clipped whiskers with recorded-value caps when a complete average is unavailable', () => {
    const option = buildEventPowerWhiskerOption('ride', [{ index: 0, x: 10, raw: 396, average: null }], '#123456');
    expect(option).toMatchObject({ type: 'custom', silent: true, clip: true, tooltip: { show: false }, data: [[10, 396, 396]] });
    const render = option.renderItem!;
    const rendered = render({} as Parameters<typeof render>[0], { value: (i: number) => [10, 396, 396][i], coord: (point: number[]) => point } as unknown as Parameters<typeof render>[1]) as { children: Array<{ shape: unknown }> };
    expect(rendered.children[0].shape).toEqual({ x1: 10, x2: 10, y1: 396, y2: 396 });
    expect(rendered.children[1].shape).toEqual({ x1: 8, x2: 12, y1: 396, y2: 396 });
  });
});
