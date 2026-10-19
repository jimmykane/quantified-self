import type { CustomSeriesOption } from 'echarts/charts';
import type { TrackChartPanelSeries } from './track-chart-panel.model';
import {
  getEventChartSeriesPointCount,
  getEventChartSeriesTime,
  getEventChartSeriesX,
  getEventChartSeriesY,
} from './event-echarts-data.helper';

export type EventPowerDisplayMode = 'raw' | '3s';
export interface EventPowerDisplayProjection {
  lineValues: Float64Array;
  hasAverage: boolean;
}
/** A display-only trailing average of three complete canonical one-second readings.
 * Keep source positions and missing windows; never alter the series used for stats. */
export function buildEventPowerDisplay(series: TrackChartPanelSeries): EventPowerDisplayProjection {
  const count = getEventChartSeriesPointCount(series);
  const lineValues = new Float64Array(count * 2).fill(Number.NaN);
  let hasAverage = false;
  for (let index = 0; index < count; index++) {
    lineValues[index * 2] = getEventChartSeriesX(series, index);
    if (index < 2) continue;
    const a = getEventChartSeriesY(series, index - 2);
    const b = getEventChartSeriesY(series, index - 1);
    const c = getEventChartSeriesY(series, index);
    if (a === null || b === null || c === null
      || !Number.isFinite(getEventChartSeriesX(series, index - 2))
      || !Number.isFinite(getEventChartSeriesX(series, index - 1))
      || !Number.isFinite(lineValues[index * 2])
      || getEventChartSeriesTime(series, index) - getEventChartSeriesTime(series, index - 1) !== 1000
      || getEventChartSeriesTime(series, index - 1) - getEventChartSeriesTime(series, index - 2) !== 1000) continue;
    lineValues[index * 2 + 1] = (a + b + c) / 3;
    hasAverage = true;
  }
  return { lineValues, hasAverage };
}

export interface EventPowerWhisker {
  index: number;
  x: number;
  raw: number;
  average: number | null;
}

/** Keep both recorded extrema in each visible interval, at their original positions.
 * Split interrupted recordings so a whisker never implies a bridge across missing data. */
export function buildEventPowerWhiskers(
  series: TrackChartPanelSeries,
  projection: EventPowerDisplayProjection,
  range: { start: number; end: number },
  plotWidth: number,
): EventPowerWhisker[] {
  const count = getEventChartSeriesPointCount(series);
  const buckets = Math.max(1, Math.floor((Number.isFinite(plotWidth) ? plotWidth : 360) / 7));
  const span = range.end - range.start || 1;
  const result: EventPowerWhisker[] = [];
  let minimum: EventPowerWhisker | null = null;
  let maximum: EventPowerWhisker | null = null;
  let previousTime = Number.NaN;
  let bucket = -1;
  const flush = () => {
    if (maximum) result.push(maximum);
    if (minimum && minimum.index !== maximum?.index) result.push(minimum);
    minimum = maximum = null;
  };
  for (let index = 0; index < count; index++) {
    const x = getEventChartSeriesX(series, index);
    const raw = getEventChartSeriesY(series, index);
    const time = getEventChartSeriesTime(series, index);
    if (!Number.isFinite(x) || raw === null || !Number.isFinite(time) || x < range.start || x > range.end) {
      flush();
      previousTime = Number.NaN;
      bucket = -1;
      continue;
    }
    const nextBucket = Math.min(buckets - 1, Math.max(0, Math.floor((x - range.start) / span * buckets)));
    if (nextBucket !== bucket || time - previousTime !== 1000) flush();
    const average = projection.lineValues[index * 2 + 1];
    const point = { index, x, raw, average: Number.isFinite(average) ? average : null };
    if (!minimum || raw < minimum.raw) minimum = point;
    if (!maximum || raw > maximum.raw) maximum = point;
    bucket = nextBucket;
    previousTime = time;
  }
  flush();
  return result;
}

export function buildEventPowerWhiskerOption(id: string, points: EventPowerWhisker[], color: string): CustomSeriesOption {
  return {
    id: `power-whiskers::${id}`, name: 'Recorded peaks and dips', type: 'custom',
    clip: true, silent: true, animation: false, z: 1,
    tooltip: { show: false },
    encode: { x: 0, y: [1, 2], tooltip: [] },
    data: points.map(point => [point.x, point.raw, point.average ?? point.raw]),
    renderItem: (_params, api) => {
      const raw = api.coord([Number(api.value(0)), Number(api.value(1))]);
      const average = api.coord([Number(api.value(0)), Number(api.value(2))]);
      if (![...raw, ...average].every(Number.isFinite)) return;
      const style = { stroke: color, lineWidth: 1, opacity: 0.55 };
      return { type: 'group', children: [
        { type: 'line', shape: { x1: raw[0], x2: raw[0], y1: average[1], y2: raw[1] }, style },
        { type: 'line', shape: { x1: raw[0] - 2, x2: raw[0] + 2, y1: raw[1], y2: raw[1] }, style },
      ] };
    },
  };
}
