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
