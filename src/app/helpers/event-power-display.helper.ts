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
  let previousTime = Number.NaN;
  const readings: number[] = [];
  for (let index = 0; index < count; index++) {
    const x = getEventChartSeriesX(series, index);
    const value = getEventChartSeriesY(series, index);
    const time = getEventChartSeriesTime(series, index);
    lineValues[index * 2] = x;
    if (time - previousTime !== 1000) readings.length = 0;
    previousTime = time;
    if (value === null || !Number.isFinite(x) || !Number.isFinite(time)) {
      readings.length = 0;
      continue;
    }
    readings.push(value);
    if (readings.length > 3) readings.shift();
    if (readings.length === 3) {
      lineValues[index * 2 + 1] = (readings[0] + readings[1] + readings[2]) / 3;
      hasAverage = true;
    }
  }
  return { lineValues, hasAverage };
}

/** ECharts coordinates; an unavailable average anchors the cap at the recorded value. */
export type EventPowerWhisker = [x: number, recorded: number, anchor: number];

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
    if (minimum && minimum !== maximum) result.push(minimum);
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
    const nextBucket = Math.min(buckets - 1, Math.floor((x - range.start) / span * buckets));
    if (nextBucket !== bucket || time - previousTime !== 1000) flush();
    const average = projection.lineValues[index * 2 + 1];
    const point: EventPowerWhisker = [x, raw, Number.isFinite(average) ? average : raw];
    if (!minimum || raw < minimum[1]) minimum = point;
    if (!maximum || raw > maximum[1]) maximum = point;
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
    data: points,
    renderItem: (_params, api) => {
      const raw = api.coord([api.value(0) as number, api.value(1) as number]);
      const anchor = api.coord([api.value(0) as number, api.value(2) as number]);
      if (![...raw, ...anchor].every(Number.isFinite)) return;
      return {
        type: 'polyline',
        shape: { points: [[raw[0], anchor[1]], raw, [raw[0] - 2, raw[1]], [raw[0] + 2, raw[1]]] },
        style: { stroke: color, fill: 'none', lineWidth: 1, opacity: 0.55 },
      };
    },
  };
}
