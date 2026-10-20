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

  it('does not average across a missing packed distance position', () => {
    const source = { ...series([]), pointCount: 7,
      lineValues: new Float64Array([0, 1, 1, 2, NaN, 900, 3, 6, 4, 9, 5, 12, 6, 15]),
      timeValues: new Float64Array([0, 1000, 2000, 3000, 4000, 5000, 6000]),
    };
    const display = buildEventPowerDisplay(source);
    expect([...display.lineValues].filter((_, index) => index % 2 === 1)).toEqual([NaN, NaN, NaN, NaN, NaN, 9, 12]);
  });

  it('keeps actual recorded peaks and coasting dips at their source positions at phone and desktop widths', () => {
    const source = series([100, 100, 396, 200, 0, 100, 110]);
    const before = structuredClone(source);
    const display = buildEventPowerDisplay(source);
    for (const width of [7, 70, 320, 1200]) {
      const whiskers = buildEventPowerWhiskers(source, display, { start: 0, end: 6 }, width);
      expect(whiskers).toContainEqual([2, 396, 596 / 3]);
      expect(whiskers).toContainEqual([4, 0, 596 / 3]);
      expect(whiskers.every(point => source.points!.some(original => original.x === point[0] && original.y === point[1]))).toBe(true);
    }
    expect(source).toEqual(before);
  });

  it('retains separate interrupted runs, incomplete-window peaks, repeated distance positions and only the visible range', () => {
    const source = series([500, null, 40, 40, 40, 0], undefined, [0, 0, 10, 10, 20, 30]);
    const display = buildEventPowerDisplay(source);
    const whiskers = buildEventPowerWhiskers(source, display, { start: 0, end: 30 }, 7);
    expect(whiskers).toContainEqual([0, 500, 500]);
    expect(whiskers).toContainEqual([10, 40, 40]);
    expect(whiskers.some(point => point[1] === 0)).toBe(true);
    expect(buildEventPowerWhiskers(source, display, { start: 10, end: 20 }, 7).some(point => point[1] === 500)).toBe(false);
  });

  it('keeps both raw extrema even when an earlier effort keeps the 3s average above the zoomed raw range', () => {
    const source = series([900, 900, 900, 500, 490, 480]);
    const display = buildEventPowerDisplay(source);
    const whiskers = buildEventPowerWhiskers(source, display, { start: 3, end: 5 }, 7);
    expect(whiskers).toContainEqual([3, 500, 2300 / 3]);
    expect(whiskers).toContainEqual([5, 480, 490]);
  });

  it('keeps extrema from packed worker samples without changing the original buffers', () => {
    const source = { ...series([]), lineValues: new Float64Array([0, 100, 10, 396, 40, 0]), timeValues: new Float64Array([0, 1000, 2000]), pointCount: 3 };
    const before = [...source.lineValues];
    const whiskers = buildEventPowerWhiskers(source, buildEventPowerDisplay(source), { start: 0, end: 40 }, 7);
    expect(whiskers.map(point => point[1])).toEqual([396, 0]);
    expect([...source.lineValues]).toEqual(before);
  });

  it.each([200, 396])('renders the recorded cap and exact anchor %s in silent clipped whiskers', anchor => {
    const option = buildEventPowerWhiskerOption('ride', [[10, 396, anchor]], '#123456');
    expect(option).toMatchObject({ type: 'custom', silent: true, clip: true, tooltip: { show: false }, data: [[10, 396, anchor]] });
    const render = option.renderItem!;
    const rendered = render({} as Parameters<typeof render>[0], { value: (i: number) => [10, 396, anchor][i], coord: (point: number[]) => point } as unknown as Parameters<typeof render>[1]) as { type: string; shape: { points: number[][] } };
    expect(rendered.type).toBe('polyline');
    expect(rendered.shape.points).toEqual([[10, anchor], [10, 396], [8, 396], [12, 396]]);
  });
});
