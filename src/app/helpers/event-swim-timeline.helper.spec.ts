import { describe, expect, it } from 'vitest';
import type { EventChartSwimLengthMarker } from './event-echarts-data.helper';
import { buildSwimTimelineLanes, buildSwimTimelineSeries } from './event-swim-timeline.helper';

const marker = (start: number, end: number, overrides: Partial<EventChartSwimLengthMarker> = {}): EventChartSwimLengthMarker => ({
  markerType: 'swimLength', timelineStartXValue: start, xValue: end, swimLengthIndex: 1,
  swimLengthType: 'active', isIdle: false, label: 'Length 1', color: '#000000', activityID: 'watch-1',
  activityName: 'Watch 1', tooltipTitle: 'Length 1', tooltipDetails: [], ...overrides,
});

describe('swim/rest timeline', () => {
  it('preserves boundaries and gaps, separates watches, and does not mutate inputs', () => {
    const source = [marker(30, 40, { swimLengthType: 'idle', isIdle: true }), marker(0, 20),
      marker(0, 25, { activityID: 'watch-2', activityName: 'Watch 2' })];
    const copy = structuredClone(source);
    const lanes = buildSwimTimelineLanes(source, false);
    expect(lanes.map(lane => [lane.activityID, lane.lengths.map(length => [length.timelineStartXValue, length.xValue])]))
      .toEqual([['watch-1', [[0, 20], [30, 40]]], ['watch-2', [[0, 25]]]]);
    expect(source).toEqual(copy);
    expect(buildSwimTimelineLanes(source, true)[0].color).not.toBe('#000000');
  });

  it('leaves unknown, absent, reversed and overlapping spans blank, including overlap chains', () => {
    const source = [marker(0, 20), marker(10, 25), marker(24, 30), marker(30, 40),
      marker(40, 50, { swimLengthType: 'unknown' }), marker(60, 55), marker(NaN, 70), marker(80, 80),
      marker(90, 100, { timelineStartXValue: undefined })];
    expect(buildSwimTimelineLanes(source, false)[0].lengths).toEqual([source[3]]);
    expect(buildSwimTimelineLanes(source.slice(4), false)).toEqual([]);
  });

  it('does not paint a known state across an overlapping unknown span', () => {
    expect(buildSwimTimelineLanes([marker(0, 20), marker(10, 30, { swimLengthType: 'unknown' })], false)).toEqual([]);
  });

  it('clips time blocks horizontally under zoom and keeps rest visually distinct from a gap', () => {
    const lanes = buildSwimTimelineLanes([marker(0, 20), marker(20, 30, { isIdle: true, swimLengthType: 'rest' })], false);
    const series = buildSwimTimelineSeries(lanes, true);
    const render = series.renderItem as (params: unknown, api: unknown) => unknown;
    const params = { coordSys: { x: 10, y: 50, width: 100 }, dataIndex: 0 };
    const api = { value: (i: number) => [0, 20, 0][i], coord: ([x]: number[]) => [x * 10 - 100, 0] };
    expect(render(params, api)).toMatchObject({ shape: { x: 10, y: 28, width: 90, height: 14 }, style: { fill: '#000000' } });
    expect(render({ ...params, dataIndex: 1 }, { ...api, value: (i: number) => [20, 30, 0][i] }))
      .toMatchObject({ shape: { x: 100, width: 10 }, style: { fillOpacity: 0, lineDash: [3, 2] } });
    expect(render(params, { ...api, coord: () => [-200, 0] })).toBeUndefined();
    expect(series.encode).toEqual({ x: [0, 1], y: -1, tooltip: [] });
    expect(series.silent).toBe(false);
    expect(buildSwimTimelineSeries(lanes, false).silent).toBe(true);
  });
});
