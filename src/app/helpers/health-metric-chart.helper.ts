import type { EChartsType } from 'echarts/core';
import {
  DashboardEChartsStyleTokens,
  buildDashboardEChartsTooltipChrome,
  renderDashboardEChartsTooltipCard,
} from './dashboard-echarts-style.helper';
import {
  resolveEChartsTooltipSurfaceConfig,
  resolveEChartsTooltipTriggerOn,
} from './echarts-tooltip-interaction.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY } from './echarts-theme.helper';
import { HealthWorkspaceSeries, HealthWorkspaceSeriesPoint, formatHealthValue } from './health-workspace.helper';

type ChartOption = Parameters<EChartsType['setOption']>[0];

export type HealthChartDatum = [timestampMs: number, value: number | string | null];

export interface HealthChartSeriesModel {
  series: HealthWorkspaceSeries;
  data: HealthChartDatum[];
  displayedPoints: HealthWorkspaceSeriesPoint[];
  numericBounds: { min: number; max: number } | null;
  yMinLabel: string;
  yMaxLabel: string;
  startLabel: string;
  endLabel: string;
  categoryLabels: string[];
  displayedPointCount: number;
  omittedPointCount: number;
  ariaLabel: string;
}

const MAX_DISPLAY_POINTS = 600;
const DAY_MS = 24 * 60 * 60 * 1000;

interface HealthTooltipParam {
  value?: unknown;
}

export function buildHealthChartModels(
  seriesValues: readonly HealthWorkspaceSeries[],
  startTimeMs: number,
  endTimeMs: number,
): HealthChartSeriesModel[] {
  return seriesValues.map(series => buildSeriesModel(series, startTimeMs, endTimeMs));
}

export function buildHealthMetricEChartsOption(
  model: HealthChartSeriesModel,
  startTimeMs: number,
  endTimeMs: number,
  style: DashboardEChartsStyleTokens,
  isMobileTooltipViewport: boolean,
): ChartOption {
  const isCategorical = model.series.chartKind === 'step';
  const isPoint = model.series.chartKind === 'point';
  const isBar = model.series.chartKind === 'bar';
  const pointsByTimestamp = new Map(model.displayedPoints.map(point => [point.timestampMs, point]));
  const seriesColor = style.trendLineColor;
  const option = {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: {
      color: style.textColor,
      fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
    },
    grid: {
      left: 6,
      right: 12,
      top: 12,
      bottom: 6,
      outerBoundsMode: 'same',
      outerBoundsContain: 'axisLabel',
    },
    tooltip: {
      trigger: 'axis',
      triggerOn: resolveEChartsTooltipTriggerOn(true, isMobileTooltipViewport),
      renderMode: 'html',
      axisPointer: { type: 'line', snap: true },
      ...resolveEChartsTooltipSurfaceConfig(isMobileTooltipViewport),
      ...buildDashboardEChartsTooltipChrome(style),
      formatter: (params: HealthTooltipParam | HealthTooltipParam[]) => {
        const entries = Array.isArray(params) ? params : [params];
        const datum = entries
          .map(entry => Array.isArray(entry?.value) ? entry.value : null)
          .find(value => value && value.length >= 2 && value[1] !== null);
        const timestampMs = Number(datum?.[0]);
        const point = Number.isFinite(timestampMs) ? pointsByTimestamp.get(timestampMs) : null;
        if (!point) {
          return '';
        }
        return renderDashboardEChartsTooltipCard(style, {
          title: formatTooltipDate(point.timestampMs),
          subtitle: model.series.sourceLabel,
          rows: [{
            label: 'Reading',
            value: formatHealthValue(point.value, model.series.unit),
            markerColor: seriesColor,
          }],
          notes: point.qualityCode ? [`Quality: ${humanize(point.qualityCode)}`] : [],
          stackHeader: true,
        });
      },
    },
    xAxis: {
      type: 'time',
      min: startTimeMs,
      max: endTimeMs,
      boundaryGap: false,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: style.axisColor } },
      splitLine: { show: false },
      axisLabel: {
        color: style.secondaryTextColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
        fontSize: style.axisFontSize,
        formatter: (value: number) => formatAxisDate(value),
      },
    },
    yAxis: isCategorical
      ? {
        type: 'category',
        data: model.categoryLabels,
        axisTick: { show: false },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: style.gridColor } },
        axisLabel: {
          color: style.secondaryTextColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: style.axisFontSize,
        },
      }
      : {
        type: 'value',
        min: model.numericBounds?.min,
        max: model.numericBounds?.max,
        axisTick: { show: false },
        axisLine: { show: false },
        splitNumber: 3,
        splitLine: { lineStyle: { color: style.gridColor } },
        axisLabel: {
          color: style.secondaryTextColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: style.axisFontSize,
          formatter: (value: number) => formatAxisValue(value, model.series.unit),
        },
      },
    series: [{
      name: model.series.sourceLabel,
      type: isBar ? 'bar' : isPoint ? 'scatter' : 'line',
      data: model.data,
      connectNulls: false,
      step: isCategorical ? 'end' : undefined,
      showSymbol: isPoint || model.displayedPointCount <= 60,
      symbol: 'circle',
      symbolSize: isPoint ? 8 : 5,
      barMaxWidth: 28,
      lineStyle: { color: seriesColor, width: 2.25 },
      itemStyle: { color: seriesColor },
      emphasis: { scale: 1.25 },
    }],
  };

  return option as ChartOption;
}

function buildSeriesModel(
  series: HealthWorkspaceSeries,
  startTimeMs: number,
  endTimeMs: number,
): HealthChartSeriesModel {
  const sortedPoints = [...series.points].sort((left, right) => left.timestampMs - right.timestampMs);
  const displayedPoints = downsamplePoints(sortedPoints, MAX_DISPLAY_POINTS);
  const categoryLabels = series.chartKind === 'step'
    ? [...new Set(displayedPoints.map(point => categoryValueLabel(point.value)))]
    : [];
  const numericValues = displayedPoints
    .map(point => typeof point.value === 'number' && Number.isFinite(point.value) ? point.value : null)
    .filter((value): value is number => value !== null);
  const numericBounds = series.chartKind === 'step' ? null : resolveYBounds(numericValues, series.chartKind);
  const latest = sortedPoints.at(-1);
  const latestText = latest ? formatHealthValue(latest.value, series.unit) : 'No reading';
  const readingCountText = `${sortedPoints.length.toLocaleString()} ${sortedPoints.length === 1 ? 'reading' : 'readings'}`;

  return {
    series,
    data: buildChartData(displayedPoints, series.chartKind),
    displayedPoints,
    numericBounds,
    yMinLabel: series.chartKind === 'step'
      ? categoryLabels[0] || ''
      : formatAxisValue(numericBounds?.min ?? 0, series.unit),
    yMaxLabel: series.chartKind === 'step'
      ? categoryLabels.at(-1) || ''
      : formatAxisValue(numericBounds?.max ?? 1, series.unit),
    startLabel: formatAxisDate(startTimeMs),
    endLabel: formatAxisDate(endTimeMs),
    categoryLabels,
    displayedPointCount: displayedPoints.length,
    omittedPointCount: Math.max(0, sortedPoints.length - displayedPoints.length),
    ariaLabel: `${series.sourceLabel}, ${series.semanticLabel}. ${readingCountText}. Latest ${latestText}. Values are not combined with other sources.`,
  };
}

function buildChartData(
  points: readonly HealthWorkspaceSeriesPoint[],
  chartKind: HealthWorkspaceSeries['chartKind'],
): HealthChartDatum[] {
  const data: HealthChartDatum[] = [];
  const gapThreshold = resolveGapThreshold(points, chartKind);
  points.forEach((point, index) => {
    if (
      index > 0
      && (chartKind === 'line' || chartKind === 'step')
      && point.timestampMs - points[index - 1].timestampMs > gapThreshold
    ) {
      const previousTimestampMs = points[index - 1].timestampMs;
      data.push([previousTimestampMs + Math.max(1, Math.floor((point.timestampMs - previousTimestampMs) / 2)), null]);
    }
    data.push([
      point.timestampMs,
      chartKind === 'step'
        ? categoryValueLabel(point.value)
        : typeof point.value === 'number' && Number.isFinite(point.value) ? point.value : null,
    ]);
  });
  return data;
}

function resolveGapThreshold(
  points: readonly HealthWorkspaceSeriesPoint[],
  chartKind: HealthWorkspaceSeries['chartKind'],
): number {
  const positiveDeltas = points.slice(1)
    .map((point, index) => point.timestampMs - points[index].timestampMs)
    .filter(delta => delta > 0)
    .sort((left, right) => left - right);
  const medianDelta = positiveDeltas.length
    ? positiveDeltas[Math.floor((positiveDeltas.length - 1) / 2)]
    : DAY_MS;
  return Math.max(medianDelta * 3, chartKind === 'step' ? 1 : 0);
}

function downsamplePoints(
  points: readonly HealthWorkspaceSeriesPoint[],
  maximum: number,
): HealthWorkspaceSeriesPoint[] {
  if (points.length <= maximum) {
    return [...points];
  }
  const result: HealthWorkspaceSeriesPoint[] = [points[0]];
  const interiorSlots = maximum - 2;
  const bucketSize = (points.length - 2) / interiorSlots;
  for (let index = 0; index < interiorSlots; index += 1) {
    result.push(points[Math.min(points.length - 2, 1 + Math.floor(index * bucketSize))]);
  }
  result.push(points[points.length - 1]);
  return result;
}

function resolveYBounds(
  values: readonly number[],
  chartKind: HealthWorkspaceSeries['chartKind'],
): { min: number; max: number } {
  if (!values.length) {
    return { min: 0, max: 1 };
  }
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (chartKind === 'bar' && min >= 0) {
    min = 0;
  }
  if (chartKind === 'bar' && max <= 0) {
    max = 0;
  }
  if (min === max) {
    const padding = Math.max(1, Math.abs(min) * 0.1);
    min -= chartKind === 'bar' && min >= 0 ? 0 : padding;
    max += padding;
  } else if (chartKind !== 'bar') {
    const padding = (max - min) * 0.08;
    min -= padding;
    max += padding;
  }
  return { min, max };
}

function categoryValueLabel(value: number | string | boolean): string {
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return humanize(`${value}`) || 'Unknown';
}

function formatAxisValue(value: number, unit: string): string {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  if (unit === 'percent') {
    return `${rounded}%`;
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(rounded);
}

function formatAxisDate(timestampMs: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(timestampMs));
}

function formatTooltipDate(timestampMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(timestampMs));
}

function humanize(value: string): string {
  return `${value}`.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
