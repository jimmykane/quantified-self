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
import {
  HealthWorkspaceSeries,
  HealthWorkspaceSeriesPoint,
  formatHealthAxisValue,
  formatHealthUnit,
  formatHealthValue,
} from './health-workspace.helper';

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
  displayUnit: string;
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
): ChartOption {
  const isCategorical = model.series.chartKind === 'step';
  const isPoint = model.series.chartKind === 'point';
  const isBar = model.series.chartKind === 'bar';
  const pointsByTimestamp = new Map(model.displayedPoints.map(point => [point.timestampMs, point]));
  const seriesColor = resolveHealthMetricColor(model.series.metricId, style.trendLineColor);
  const useStressStateColors = model.series.metricId === HEALTH_METRIC_IDS.StressState && isCategorical;
  const useBodyEnergyColors = isProviderBodyEnergySeries(model.series);
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
              seriesColor,
              style.trendLineColor,
              useBodyEnergyColors,
            ),
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
        show: false,
        seriesIndex: 0,
        dimension: 1,
        pieces: model.categoryLabels.map(value => ({
          value,
          color: resolveHealthValueColor(
            model.series.metricId,
            value,
            seriesColor,
            style.trendLineColor,
          ),
        })),
      }
      : undefined,
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
      itemStyle: {
        color: useStressStateColors || useBodyEnergyColors
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
    }],
  };

  return option as ChartOption;
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
    case 'calm':
    case 'low':
      return AppDataColors.Altitude;
    case 'active':
    case 'passive':
    case 'medium':
      return AppDataColors.Stress;
    case 'stressful':
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

function buildSeriesModel(
  series: HealthWorkspaceSeries,
  startTimeMs: number,
  endTimeMs: number,
  unitSettings: UserUnitSettingsInterface | null,
): HealthChartSeriesModel {
  const sortedPoints = [...series.points].sort((left, right) => left.timestampMs - right.timestampMs);
  const displayedPoints = downsamplePoints(sortedPoints, MAX_DISPLAY_POINTS);
  const categoryLabels = series.chartKind === 'step'
    ? [...new Set(displayedPoints.map(point => categoryValueLabel(point.value)))]
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
    startLabel: formatAxisDate(startTimeMs),
    endLabel: formatAxisDate(endTimeMs),
    categoryLabels,
    displayedPointCount: displayedPoints.length,
    omittedPointCount: Math.max(0, sortedPoints.length - displayedPoints.length),
    displayUnit,
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
