import { HealthWorkspaceSeries, HealthWorkspaceSeriesPoint, formatHealthValue } from './health-workspace.helper';

export interface HealthChartPointModel {
  x: number;
  y: number;
  value: number | string | boolean;
  timestampMs: number;
}

export interface HealthChartBarModel extends HealthChartPointModel {
  width: number;
  height: number;
  top: number;
}

export interface HealthChartSeriesModel {
  series: HealthWorkspaceSeries;
  color: string;
  linePaths: string[];
  points: HealthChartPointModel[];
  bars: HealthChartBarModel[];
  yMinLabel: string;
  yMaxLabel: string;
  startLabel: string;
  endLabel: string;
  categoryLabels: string[];
  displayedPointCount: number;
  omittedPointCount: number;
  ariaLabel: string;
}

export const HEALTH_CHART_VIEWBOX = Object.freeze({ width: 640, height: 220 });
const PLOT = Object.freeze({ left: 48, right: 16, top: 16, bottom: 34 });
const MAX_DISPLAY_POINTS = 600;
const DAY_MS = 24 * 60 * 60 * 1000;

const PROVIDER_COLORS: Record<string, string> = {
  GarminAPI: '#1976d2',
  SuuntoApp: '#ef6c00',
  COROSAPI: '#c62828',
  WahooAPI: '#6a1b9a',
  QuantifiedSelf: '#2e7d32',
};

export function buildHealthChartModels(
  seriesValues: readonly HealthWorkspaceSeries[],
  startTimeMs: number,
  endTimeMs: number,
): HealthChartSeriesModel[] {
  return seriesValues.map(series => buildSeriesModel(series, startTimeMs, endTimeMs));
}

function buildSeriesModel(
  series: HealthWorkspaceSeries,
  startTimeMs: number,
  endTimeMs: number,
): HealthChartSeriesModel {
  const sortedPoints = [...series.points].sort((left, right) => left.timestampMs - right.timestampMs);
  const displayed = downsamplePoints(sortedPoints, MAX_DISPLAY_POINTS);
  const plotWidth = HEALTH_CHART_VIEWBOX.width - PLOT.left - PLOT.right;
  const plotHeight = HEALTH_CHART_VIEWBOX.height - PLOT.top - PLOT.bottom;
  const safeEndTimeMs = endTimeMs > startTimeMs ? endTimeMs : startTimeMs + 1;
  const x = (timestampMs: number): number => PLOT.left
    + (Math.max(0, Math.min(1, (timestampMs - startTimeMs) / (safeEndTimeMs - startTimeMs))) * plotWidth);

  const categoryLabels = series.chartKind === 'step'
    ? [...new Set(displayed.map(point => categoryValueLabel(point.value)))]
    : [];
  const numericValues = displayed
    .map(point => typeof point.value === 'number' && Number.isFinite(point.value) ? point.value : null)
    .filter((value): value is number => value !== null);
  const bounds = resolveYBounds(numericValues, series.chartKind);
  const y = (point: HealthWorkspaceSeriesPoint): number => {
    const value = series.chartKind === 'step'
      ? Math.max(0, categoryLabels.indexOf(categoryValueLabel(point.value)))
      : typeof point.value === 'number' ? point.value : 0;
    const min = series.chartKind === 'step' ? 0 : bounds.min;
    const max = series.chartKind === 'step' ? Math.max(1, categoryLabels.length - 1) : bounds.max;
    const ratio = max === min ? 0.5 : (value - min) / (max - min);
    return PLOT.top + ((1 - Math.max(0, Math.min(1, ratio))) * plotHeight);
  };

  const points = displayed.map(point => ({
    x: roundCoordinate(x(point.timestampMs)),
    y: roundCoordinate(y(point)),
    value: point.value,
    timestampMs: point.timestampMs,
  }));
  const linePaths = series.chartKind === 'line' || series.chartKind === 'step'
    ? buildLinePaths(displayed, points, series.chartKind)
    : [];
  const zeroPoint = displayed[0]
    ? { ...displayed[0], value: 0 }
    : { timestampMs: startTimeMs, calendarDate: '', value: 0, qualityCode: null };
  const baseline = series.chartKind === 'bar' ? y(zeroPoint) : PLOT.top + plotHeight;
  const barWidth = resolveBarWidth(points, plotWidth);
  const bars = series.chartKind === 'bar'
    ? points.map(point => ({
      ...point,
      width: barWidth,
      height: Math.max(1, Math.abs(baseline - point.y)),
      top: Math.min(point.y, baseline),
    }))
    : [];
  const latest = sortedPoints.at(-1);
  const latestText = latest ? formatHealthValue(latest.value, series.unit) : 'No reading';
  const yMinLabel = series.chartKind === 'step'
    ? categoryLabels[0] || ''
    : formatAxisValue(bounds.min, series.unit);
  const yMaxLabel = series.chartKind === 'step'
    ? categoryLabels.at(-1) || ''
    : formatAxisValue(bounds.max, series.unit);

  return {
    series,
    color: PROVIDER_COLORS[series.provider] || '#546e7a',
    linePaths,
    points,
    bars,
    yMinLabel,
    yMaxLabel,
    startLabel: formatAxisDate(startTimeMs),
    endLabel: formatAxisDate(endTimeMs),
    categoryLabels,
    displayedPointCount: displayed.length,
    omittedPointCount: Math.max(0, sortedPoints.length - displayed.length),
    ariaLabel: `${series.sourceLabel}, ${series.semanticLabel}. ${sortedPoints.length.toLocaleString()} readings. Latest ${latestText}. Values are not combined with other sources.`,
  };
}

function buildLinePaths(
  sourcePoints: readonly HealthWorkspaceSeriesPoint[],
  points: readonly HealthChartPointModel[],
  chartKind: 'line' | 'step',
): string[] {
  if (!points.length) {
    return [];
  }
  const positiveDeltas = sourcePoints.slice(1)
    .map((point, index) => point.timestampMs - sourcePoints[index].timestampMs)
    .filter(delta => delta > 0)
    .sort((left, right) => left - right);
  const medianDelta = positiveDeltas.length ? positiveDeltas[Math.floor((positiveDeltas.length - 1) / 2)] : DAY_MS;
  const gapThreshold = Math.max(medianDelta * 3, chartKind === 'step' ? 1 : 0);
  const paths: string[] = [];
  let current = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const delta = sourcePoints[index].timestampMs - sourcePoints[index - 1].timestampMs;
    if (delta > gapThreshold) {
      paths.push(current);
      current = `M ${point.x} ${point.y}`;
      continue;
    }
    current += chartKind === 'step'
      ? ` H ${point.x} V ${point.y}`
      : ` L ${point.x} ${point.y}`;
  }
  paths.push(current);
  return paths;
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

function resolveYBounds(values: readonly number[], chartKind: HealthWorkspaceSeries['chartKind']): { min: number; max: number } {
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

function resolveBarWidth(points: readonly HealthChartPointModel[], plotWidth: number): number {
  if (points.length <= 1) {
    return Math.min(28, plotWidth / 4);
  }
  const distances = points.slice(1).map((point, index) => Math.max(1, point.x - points[index].x));
  return Math.max(2, Math.min(28, Math.min(...distances) * 0.65));
}

function categoryValueLabel(value: number | string | boolean): string {
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return `${value}`.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Unknown';
}

function formatAxisValue(value: number, unit: string): string {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  if (unit === 'percent') {
    return `${rounded}%`;
  }
  return `${rounded}`;
}

function formatAxisDate(timestampMs: number): string {
  // Workspace bounds represent UTC calendar dates, not browser-local instants.
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(timestampMs));
}

function roundCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}
