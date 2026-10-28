import type { EChartsOption } from 'echarts';

export interface MetricHistoryPoint {
  time: number;
  value: number | null;
}

export interface MetricHistoryDisplayPoint extends MetricHistoryPoint {
  /** Already formatted by the metric's owner, including its user-selected units. */
  valueText: string;
}

export interface MetricHistory {
  points: readonly MetricHistoryDisplayPoint[];
  caption: string;
  mode?: 'columns' | 'forecast';
}

/** Presentation only: preserve dates, missing observations and valid zeroes. */
export function normalizeMetricHistoryPoints(points: readonly MetricHistoryPoint[]): MetricHistoryPoint[] {
  const ordered = points.filter(point => Number.isFinite(point.time))
    .map(point => ({ time: point.time, value: typeof point.value === 'number' && Number.isFinite(point.value) ? point.value : null }))
    .sort((left, right) => left.time - right.time);
  const first = ordered.findIndex(point => point.value !== null);
  if (first < 0) return [];
  let last = ordered.length - 1;
  while (ordered[last].value === null) last--;
  return ordered.slice(first, last + 1);
}

/** Shared by Training, Dashboard KPIs and the chart-library thumbnails. */
export function buildMetricHistoryChartOption(points: readonly MetricHistoryPoint[], options: {
  color: string;
  mutedColor: string;
  baselineColor: string;
  mode?: 'columns' | 'forecast';
  silent?: boolean;
  barMaxWidth?: number;
}): EChartsOption {
  const trend = normalizeMetricHistoryPoints(points);
  if (!trend.length) return { animation: false, tooltip: { show: false }, xAxis: [], yAxis: [], series: [] };
  const values = trend.flatMap(point => point.value === null ? [] : [point.value]);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const padding = Math.max((maximum - minimum) * .08, .01);
  const intervals = trend.slice(1).map((point, index) => point.time - trend[index].time).filter(interval => interval > 0);
  const halfInterval = (intervals.length ? Math.min(...intervals) : 7 * 86400000) / 2;
  const forecast = options.mode === 'forecast';
  const data = trend.map(point => [point.time, point.value] as [number, number | null]);
  return {
    animation: false,
    backgroundColor: 'transparent',
    grid: { left: 2, right: 2, top: 4, bottom: 2, containLabel: false },
    xAxis: {
      type: 'time', show: false, boundaryGap: [0, 0],
      // Time-axis columns need half a slot at both ends to avoid clipping the first/last bar.
      min: trend[0].time - (forecast && trend.length > 1 ? 0 : halfInterval),
      max: trend.at(-1)!.time + (forecast && trend.length > 1 ? 0 : halfInterval),
    },
    yAxis: { type: 'value', show: false, min: minimum < 0 ? minimum - padding : 0, max: maximum > 0 ? maximum + padding : minimum < 0 ? 0 : 1 },
    series: [{
      type: forecast ? 'line' : 'bar',
      data,
      silent: options.silent ?? false,
      ...(forecast ? {
        connectNulls: false, showSymbol: trend.length === 1, symbolSize: 4,
        lineStyle: { color: options.color, width: 1.5, type: 'dashed' },
        itemStyle: { color: options.color },
      } : {
        barMaxWidth: options.barMaxWidth ?? 10,
        itemStyle: { color: (params: { dataIndex: number }) => params.dataIndex === trend.length - 1 ? options.color : options.mutedColor },
        emphasis: options.silent ? { disabled: true } : { itemStyle: { color: options.color } },
      }),
      markLine: {
        silent: true, symbol: 'none', label: { show: false },
        lineStyle: { color: options.baselineColor, width: .75, type: 'solid' }, data: [{ yAxis: 0 }],
      },
    }],
  };
}
