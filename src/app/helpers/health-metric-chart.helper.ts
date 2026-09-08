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
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import {
  HEALTH_METRIC_IDS,
  HEALTH_PROVIDERS,
  HEALTH_UNITS,
  HealthMetricId,
  getHealthMetricDefinition,
} from '@shared/health';
import { AppDataColors } from '../services/color/app.data.colors';
import { AppColors } from '../services/color/app.colors';
import {
  HealthHrvPersonalRangeStatus,
  HealthHrvPersonalRangeTone,
  HealthWorkspaceSeries,
  HealthWorkspaceSeriesPoint,
  formatHealthAxisValue,
  formatHealthUnit,
  formatHealthValue,
} from './health-workspace.helper';

type ChartOption = Parameters<EChartsType['setOption']>[0];

export type HealthChartDatum = [
  timestampMs: number,
  value: number | string | null,
  visualValue?: number | null,
];

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
  displayUnit: string;
  ariaLabel: string;
}

export interface HealthChartStatusOverlay {
  normalRangeColor: string;
  statusColor: string;
  pointStatuses?: readonly HealthChartPointStatus[];
}

interface HealthChartPointStatus {
  timestampMs: number;
  color: string;
  label: string;
  normalRange: { min: number; max: number } | null;
}

export function healthHrvPersonalRangeToneColor(tone: HealthHrvPersonalRangeTone): string {
  switch (tone) {
    case 'positive': return AppDataColors.Altitude;
    case 'caution': return AppDataColors['Body Energy Moderate'];
    case 'negative': return AppDataColors['Heart Rate_0'];
    case 'neutral': return AppColors.MediumGray;
  }
}

export function buildHealthHrvChartStatusOverlay(
  status: HealthHrvPersonalRangeStatus | null | undefined,
): HealthChartStatusOverlay | null {
  if (!status) {
    return null;
  }
  return {
    normalRangeColor: AppDataColors.Altitude,
    statusColor: healthHrvPersonalRangeToneColor(status.tone),
    pointStatuses: status.pointStatuses.map(pointStatus => ({
      timestampMs: pointStatus.timestampMs,
      color: healthHrvPersonalRangeToneColor(pointStatus.tone),
      label: pointStatus.label,
      normalRange: pointStatus.normalRange,
    })),
  };
}

export function healthHrvChartStatusDescription(
  status: HealthHrvPersonalRangeStatus | null | undefined,
): string | null {
  return status ? `${status.label}. ${status.detailText}.` : null;
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
  unitSettings: UserUnitSettingsInterface | null = null,
): HealthChartSeriesModel[] {
  return seriesValues.map(series => buildSeriesModel(series, startTimeMs, endTimeMs, unitSettings));
}

export function buildHealthMetricEChartsOption(
  model: HealthChartSeriesModel,
  startTimeMs: number,
  endTimeMs: number,
  style: DashboardEChartsStyleTokens,
  isMobileTooltipViewport: boolean,
  unitSettings: UserUnitSettingsInterface | null = null,
  compact = false,
  statusOverlay: HealthChartStatusOverlay | null = null,
): ChartOption {
  const isCategorical = model.series.chartKind === 'step';
  const isPoint = model.series.chartKind === 'point';
  const isBar = model.series.chartKind === 'bar';
  const pointsByTimestamp = new Map(model.displayedPoints.map(point => [point.timestampMs, point]));
  const seriesColor = resolveHealthMetricColor(model.series.metricId, style.trendLineColor);
  const useStressStateColors = model.series.metricId === HEALTH_METRIC_IDS.StressState && isCategorical;
  const hrvPointStatuses = model.series.metricId === HEALTH_METRIC_IDS.HeartRateVariability
    ? new Map(statusOverlay?.pointStatuses?.map(point => [point.timestampMs, point]) || [])
    : new Map<number, HealthChartPointStatus>();
  const useHrvPointColors = hrvPointStatuses.size > 0;
  const useBodyEnergyColors = isProviderBodyEnergySeries(model.series);
  const chartData = useStressStateColors
    ? stressStateChartData(model.data, model.categoryLabels)
    : model.data;
  // Use the same point-in-time ranges as the point colors, aligned with the
  // displayed data so missing history and chart gaps stay unshaded.
  const rangeData: Array<[number, number | null, number | null]> = chartData.map(([timestampMs, value]) => {
    const range = typeof value === 'number' && timestampMs >= startTimeMs && timestampMs <= endTimeMs
      ? hrvPointStatuses.get(timestampMs)?.normalRange : null;
    return range ? [timestampMs, range.min, range.max] : [timestampMs, null, null];
  });
  const numericBounds = rangeData.reduce((bounds, [, min, max]) =>
    bounds && min !== null && max !== null
      ? { min: Math.min(bounds.min, min), max: Math.max(bounds.max, max) }
      : bounds, model.numericBounds);
  const latestNumericPoint = [...model.displayedPoints].reverse().find(point =>
    typeof point.value === 'number' && Number.isFinite(point.value));
  const showTimeOnXAxis = endTimeMs - startTimeMs < DAY_MS;
  const option = {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: {
      color: style.textColor,
      fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
    },
    grid: {
      left: compact ? 2 : 6,
      right: compact ? 2 : 12,
      top: compact ? 3 : 12,
      bottom: compact ? 3 : 6,
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
        const pointStatus = hrvPointStatuses.get(point.timestampMs);
        return renderDashboardEChartsTooltipCard(style, {
          title: formatTooltipDate(point.timestampMs, point.timezoneOffsetSeconds),
          subtitle: model.series.sourceLabel,
          rows: [{
            label: 'Reading',
            value: formatHealthValue(
              model.series.metricId,
              point.value,
              model.series.unit,
              model.series.nativeOnly,
              unitSettings,
            ),
            markerColor: resolveHealthValueColor(
              model.series.metricId,
              point.value,
              pointStatus?.color || seriesColor,
              style.trendLineColor,
              useBodyEnergyColors,
            ),
          }, ...(pointStatus?.normalRange ? [{
            label: 'Range on this date',
            value: `${formatHealthValue(model.series.metricId, pointStatus.normalRange.min,
              model.series.unit, model.series.nativeOnly, unitSettings)}–${formatHealthValue(
              model.series.metricId, pointStatus.normalRange.max, model.series.unit, model.series.nativeOnly, unitSettings)}`,
          }] : [])],
          notes: [
            ...(pointStatus ? [`Personal range: ${pointStatus.label}`] : []),
            ...(point.qualityCode ? [`Quality: ${humanize(point.qualityCode)}`] : []),
          ],
          stackHeader: true,
        });
      },
    },
    xAxis: {
      type: 'time',
      show: !compact,
      min: startTimeMs,
      max: endTimeMs,
      boundaryGap: false,
      splitNumber: style.isCompactLayout ? 3 : 6,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: style.axisColor } },
      splitLine: { show: false },
      axisLabel: {
        // Time axes can emit extra calendar-boundary ticks. Resolve collisions
        // against the actual rendered panel width, including subsequent resizes.
        hideOverlap: true,
        color: style.secondaryTextColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
        fontSize: style.axisFontSize,
        formatter: (value: number) => {
          const timezoneOffsetSeconds = nearestTimezoneOffsetSeconds(model.displayedPoints, value);
          return showTimeOnXAxis
            ? formatAxisTime(value, timezoneOffsetSeconds)
            : formatAxisDate(value, timezoneOffsetSeconds);
        },
      },
    },
    yAxis: isCategorical
      ? {
        type: 'category',
        show: !compact,
        data: model.categoryLabels,
        axisTick: { show: false },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: style.gridColor } },
        axisLabel: {
          color: useStressStateColors
            ? (value: string) => resolveHealthValueColor(
              model.series.metricId,
              value,
              seriesColor,
              style.secondaryTextColor,
            )
            : style.secondaryTextColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: style.axisFontSize,
        },
      }
      : {
        type: 'value',
        show: !compact,
        min: numericBounds?.min,
        max: numericBounds?.max,
        axisTick: { show: false },
        axisLine: { show: false },
        splitNumber: 3,
        splitLine: { lineStyle: { color: style.gridColor } },
        axisLabel: {
          color: style.secondaryTextColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: style.axisFontSize,
          formatter: (value: number) => formatHealthAxisValue(
            model.series.metricId,
            value,
            model.series.unit,
            model.series.nativeOnly,
            unitSettings,
          ),
        },
      },
    visualMap: useStressStateColors
      ? {
        type: 'piecewise',
        show: false,
        seriesIndex: 0,
        dimension: 2,
        pieces: model.categoryLabels.map((value, index) => ({
          value: index,
          color: resolveHealthValueColor(
            model.series.metricId,
            value,
            seriesColor,
            style.trendLineColor,
          ),
        })),
        outOfRange: { color: style.secondaryTextColor },
      }
      : undefined,
    series: [{
      name: model.series.sourceLabel,
      type: isBar ? 'bar' : isPoint ? 'scatter' : 'line',
      data: chartData,
      dimensions: useStressStateColors
        ? ['timestamp', 'value', 'visualValue']
        : undefined,
      encode: useStressStateColors
        ? { x: 0, y: 1 }
        : undefined,
      connectNulls: false,
      step: isCategorical ? 'end' : undefined,
      showSymbol: useHrvPointColors
        ? true
        : compact
        ? model.displayedPointCount <= 2
        : isPoint || model.displayedPointCount <= 60,
      symbol: 'circle',
      symbolSize: compact ? 4 : isPoint ? 8 : 5,
      barMaxWidth: 28,
      z: useHrvPointColors ? 3 : undefined,
      lineStyle: {
        ...(!useStressStateColors ? { color: useHrvPointColors ? 'transparent' : seriesColor } : {}),
        width: 1.5,
      },
      itemStyle: useStressStateColors
        ? undefined
        : useHrvPointColors
          ? {
            color: (params: { value?: unknown }) => hrvPointStatuses.get(
              chartTimestamp(params.value),
            )?.color || seriesColor,
          }
        : {
          color: useBodyEnergyColors
          ? (params: { value?: unknown }) => resolveHealthValueColor(
            model.series.metricId,
            chartValue(params.value),
            seriesColor,
            style.trendLineColor,
            useBodyEnergyColors,
          )
          : seriesColor,
        },
      emphasis: { scale: 1.25 },
      markPoint: latestNumericPoint && statusOverlay
        ? {
          silent: true,
          symbol: 'circle',
          symbolSize: compact ? 7 : 9,
          label: { show: false },
          itemStyle: {
            color: hrvPointStatuses.get(latestNumericPoint.timestampMs)?.color || statusOverlay.statusColor,
          },
          data: [{ coord: [latestNumericPoint.timestampMs, latestNumericPoint.value] }],
        }
        : undefined,
    }, ...(useHrvPointColors
      ? buildPointStatusLineSeries(model.data, hrvPointStatuses, seriesColor)
      : []), ...buildPersonalRangeBandSeries(rangeData, statusOverlay?.normalRangeColor)],
  };

  return option as ChartOption;
}

function buildPersonalRangeBandSeries(
  data: readonly [number, number | null, number | null][],
  color: string | undefined,
): object[] {
  if (!color || !data.some(([, min, max]) => min !== null && max !== null)) return [];
  // Native ECharts stacked-area band: invisible lower boundary + range width.
  // https://echarts.apache.org/examples/en/editor.html?c=confidence-band
  const common = {
    type: 'line',
    stack: 'hrv-personal-range',
    stackStrategy: 'all',
    symbol: 'none',
    connectNulls: false,
    lineStyle: { opacity: 0 },
    silent: true,
    tooltip: { show: false },
    emphasis: { disabled: true },
    z: 0,
  };
  return [{
    ...common,
    id: 'hrv-personal-range-lower',
    data: data.map(([timestamp, min]) => [timestamp, min]),
  }, {
    ...common,
    id: 'hrv-personal-range-band',
    data: data.map(([timestamp, min, max]) => [timestamp, min !== null && max !== null ? max - min : null]),
    areaStyle: { color, opacity: 0.1 },
  }];
}

function resolveHealthMetricColor(metricId: HealthMetricId, fallback: string): string {
  switch (metricId) {
    case HEALTH_METRIC_IDS.HeartRate:
    case HEALTH_METRIC_IDS.RestingHeartRate:
    case HEALTH_METRIC_IDS.PulseRate:
    case HEALTH_METRIC_IDS.BloodPressureSystolic:
    case HEALTH_METRIC_IDS.BloodPressureDiastolic:
      return AppDataColors['Heart Rate'];
    case HEALTH_METRIC_IDS.HeartRateVariability:
    case HEALTH_METRIC_IDS.RecoveryScore:
    case HEALTH_METRIC_IDS.SleepScore:
      return AppDataColors['Recovery Time'];
    case HEALTH_METRIC_IDS.BloodOxygenSaturation:
      return AppDataColors['Blood Oxygen'];
    case HEALTH_METRIC_IDS.RespirationRate:
      return AppDataColors.Respiration;
    case HEALTH_METRIC_IDS.Steps:
    case HEALTH_METRIC_IDS.WheelchairPushes:
    case HEALTH_METRIC_IDS.Distance:
    case HEALTH_METRIC_IDS.WheelchairPushDistance:
      return AppDataColors.Distance;
    case HEALTH_METRIC_IDS.FloorsClimbed:
    case HEALTH_METRIC_IDS.Altitude:
    case HEALTH_METRIC_IDS.Vo2Max:
    case HEALTH_METRIC_IDS.FitnessAge:
      return AppDataColors.Altitude;
    case HEALTH_METRIC_IDS.ActiveDuration:
    case HEALTH_METRIC_IDS.ModerateIntensityDuration:
    case HEALTH_METRIC_IDS.VigorousIntensityDuration:
    case HEALTH_METRIC_IDS.StressDuration:
    case HEALTH_METRIC_IDS.SleepDuration:
      return AppDataColors.Duration;
    case HEALTH_METRIC_IDS.ActiveEnergy:
    case HEALTH_METRIC_IDS.BasalEnergy:
    case HEALTH_METRIC_IDS.TotalEnergy:
    case HEALTH_METRIC_IDS.BodyEnergy:
    case HEALTH_METRIC_IDS.BodyEnergyChange:
      return AppDataColors.Energy;
    case HEALTH_METRIC_IDS.StressLevel:
    case HEALTH_METRIC_IDS.StressState:
      return AppDataColors.Stress;
    case HEALTH_METRIC_IDS.BodyWeight:
    case HEALTH_METRIC_IDS.BodyMassIndex:
    case HEALTH_METRIC_IDS.BodyFat:
    case HEALTH_METRIC_IDS.BodyWater:
    case HEALTH_METRIC_IDS.MuscleMass:
    case HEALTH_METRIC_IDS.BoneMass:
      return AppDataColors['Body Composition'];
    case HEALTH_METRIC_IDS.SkinTemperatureDeviation:
      return AppDataColors.Temperature;
    default:
      return fallback;
  }
}

function resolveHealthValueColor(
  metricId: HealthMetricId,
  value: unknown,
  seriesColor: string,
  neutralColor: string,
  isProviderBodyEnergy = false,
): string {
  if (isProviderBodyEnergy) {
    return resolveBodyEnergyColor(value, seriesColor);
  }
  if (metricId !== HEALTH_METRIC_IDS.StressState || typeof value !== 'string') {
    return seriesColor;
  }
  switch (value.trim().toLowerCase()) {
    case 'relaxing':
    case 'recovering':
    case 'calm':
    case 'low':
      return AppDataColors.Altitude;
    case 'active':
      return AppDataColors.Distance;
    case 'passive':
    case 'inactive':
      return AppColors.MediumGray;
    case 'medium':
      return AppDataColors.Stress;
    case 'stressful':
    case 'stressed':
    case 'high':
      return AppDataColors['Heart Rate_0'];
    default:
      return neutralColor;
  }
}

function isProviderBodyEnergySeries(series: HealthWorkspaceSeries): boolean {
  if (series.metricId !== HEALTH_METRIC_IDS.BodyEnergy) {
    return false;
  }
  return (series.provider === HEALTH_PROVIDERS.SuuntoApp && series.semanticVariant === 'recovery_balance')
    || (series.provider === HEALTH_PROVIDERS.GarminAPI && series.semanticVariant === 'garmin_body_battery');
}

function resolveBodyEnergyColor(value: unknown, fallback: string): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  if (numericValue >= 75) {
    return AppDataColors['Body Energy High'];
  }
  if (numericValue >= 50) {
    return AppDataColors['Body Energy Moderate'];
  }
  if (numericValue >= 25) {
    return AppDataColors['Body Energy Reduced'];
  }
  return AppDataColors['Body Energy Low'];
}

function chartValue(value: unknown): unknown {
  return Array.isArray(value) ? value[1] : value;
}

function stressStateChartData(
  data: readonly HealthChartDatum[],
  categoryLabels: readonly string[],
): HealthChartDatum[] {
  const categoryIndexes = new Map(categoryLabels.map((value, index) => [value, index]));
  return data.map(([timestampMs, value]) => [
    timestampMs,
    value,
    typeof value === 'string' ? categoryIndexes.get(value) ?? null : null,
  ]);
}

function buildPointStatusLineSeries(
  data: readonly HealthChartDatum[],
  pointStatuses: ReadonlyMap<number, { color: string }>,
  fallbackColor: string,
): object[] {
  const series: object[] = [];
  let previous: HealthChartDatum | null = null;
  for (const current of data) {
    if (typeof current[1] !== 'number' || !Number.isFinite(current[1])) {
      previous = null;
      continue;
    }
    if (previous) {
      series.push({
        type: 'line',
        data: [previous, current],
        connectNulls: false,
        showSymbol: false,
        silent: true,
        tooltip: { show: false },
        lineStyle: {
          color: pointStatuses.get(current[0])?.color || fallbackColor,
          width: 1.5,
        },
        emphasis: { disabled: true },
        z: 2,
      });
    }
    previous = current;
  }
  return series;
}

function chartTimestamp(value: unknown): number {
  if (!Array.isArray(value)) {
    return Number.NaN;
  }
  const timestampMs = Number(value[0]);
  return Number.isFinite(timestampMs) ? timestampMs : Number.NaN;
}

function buildSeriesModel(
  series: HealthWorkspaceSeries,
  startTimeMs: number,
  endTimeMs: number,
  unitSettings: UserUnitSettingsInterface | null,
): HealthChartSeriesModel {
  const sortedPoints = [...series.points].sort((left, right) => left.timestampMs - right.timestampMs);
  const displayedPoints = downsamplePoints(sortedPoints, MAX_DISPLAY_POINTS);
  const categoryLabels = series.chartKind === 'step'
    ? orderedCategoryLabels(
      [...new Set(displayedPoints.map(point => categoryValueLabel(point.value)))],
      series.metricId,
    )
    : [];
  const numericValues = displayedPoints
    .map(point => typeof point.value === 'number' && Number.isFinite(point.value) ? point.value : null)
    .filter((value): value is number => value !== null);
  const numericBounds = series.chartKind === 'step'
    ? null
    : resolveYBounds(
      numericValues,
      series.chartKind,
      getHealthMetricDefinition(series.metricId).canonicalUnit === HEALTH_UNITS.Percent ? 100 : null,
    );
  const latest = sortedPoints.at(-1);
  const latestText = latest
    ? formatHealthValue(series.metricId, latest.value, series.unit, series.nativeOnly, unitSettings)
    : 'No reading';
  const displayUnit = latest
    ? formatHealthUnit(series.metricId, latest.value, series.unit, series.nativeOnly, unitSettings)
    : '';
  const readingCountText = `${sortedPoints.length.toLocaleString()} ${sortedPoints.length === 1 ? 'reading' : 'readings'}`;

  return {
    series,
    data: buildChartData(displayedPoints, series.chartKind),
    displayedPoints,
    numericBounds,
    yMinLabel: series.chartKind === 'step'
      ? categoryLabels[0] || ''
      : formatHealthAxisValue(series.metricId, numericBounds?.min ?? 0, series.unit, series.nativeOnly, unitSettings),
    yMaxLabel: series.chartKind === 'step'
      ? categoryLabels.at(-1) || ''
      : formatHealthAxisValue(series.metricId, numericBounds?.max ?? 1, series.unit, series.nativeOnly, unitSettings),
    startLabel: formatAxisDate(startTimeMs, nearestTimezoneOffsetSeconds(displayedPoints, startTimeMs)),
    endLabel: formatAxisDate(endTimeMs, nearestTimezoneOffsetSeconds(displayedPoints, endTimeMs)),
    categoryLabels,
    displayedPointCount: displayedPoints.length,
    omittedPointCount: Math.max(0, sortedPoints.length - displayedPoints.length),
    displayUnit,
    ariaLabel: `${series.sourceLabel}, ${series.semanticLabel}. ${readingCountText}. Latest ${latestText}. Values are not combined with other sources.`,
  };
}

function orderedCategoryLabels(labels: readonly string[], metricId: HealthMetricId): string[] {
  if (metricId !== HEALTH_METRIC_IDS.StressState) {
    return [...labels];
  }
  const providerOrder = ['relaxing', 'active', 'passive', 'stressful'];
  const present = new Set(labels);
  return [
    ...providerOrder.filter(label => present.has(label)),
    ...labels.filter(label => !providerOrder.includes(label)),
  ];
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
  maximum: number | null = null,
): { min: number; max: number } {
  if (!values.length) {
    return { min: 0, max: maximum ?? 1 };
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
  if (maximum !== null) {
    max = maximum;
  }
  return { min, max };
}

function categoryValueLabel(value: number | string | boolean): string {
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return humanize(`${value}`) || 'Unknown';
}

function formatAxisDate(timestampMs: number, timezoneOffsetSeconds?: number | null): string {
  const localTimestampMs = timestampInFixedOffset(timestampMs, timezoneOffsetSeconds);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(localTimestampMs));
}

function formatAxisTime(timestampMs: number, timezoneOffsetSeconds?: number | null): string {
  const localTimestampMs = timestampInFixedOffset(timestampMs, timezoneOffsetSeconds);
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
    .format(new Date(localTimestampMs));
}

function formatTooltipDate(timestampMs: number, timezoneOffsetSeconds?: number | null): string {
  const normalizedOffsetSeconds = normalizeTimezoneOffsetSeconds(timezoneOffsetSeconds);
  const dateTime = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(timestampMs + (normalizedOffsetSeconds * 1_000)));
  return `${dateTime} ${formatFixedTimezoneOffset(normalizedOffsetSeconds)}`;
}

export function nearestTimezoneOffsetSeconds(
  points: readonly HealthWorkspaceSeriesPoint[],
  timestampMs: number,
): number | null {
  let nearest: HealthWorkspaceSeriesPoint | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distance = Math.abs(point.timestampMs - timestampMs);
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }
  return nearest?.timezoneOffsetSeconds ?? null;
}

function timestampInFixedOffset(timestampMs: number, timezoneOffsetSeconds?: number | null): number {
  return timestampMs + (normalizeTimezoneOffsetSeconds(timezoneOffsetSeconds) * 1_000);
}

function normalizeTimezoneOffsetSeconds(timezoneOffsetSeconds?: number | null): number {
  const value = Number(timezoneOffsetSeconds);
  return Number.isFinite(value) && Math.abs(value) <= 18 * 60 * 60 ? value : 0;
}

function formatFixedTimezoneOffset(timezoneOffsetSeconds: number): string {
  if (timezoneOffsetSeconds === 0) {
    return 'UTC';
  }
  const absoluteMinutes = Math.abs(timezoneOffsetSeconds) / 60;
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = Math.floor(absoluteMinutes % 60);
  const suffix = minutes > 0 ? `:${minutes.toString().padStart(2, '0')}` : '';
  return `UTC${timezoneOffsetSeconds > 0 ? '+' : '-'}${hours}${suffix}`;
}

function humanize(value: string): string {
  return `${value}`.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
