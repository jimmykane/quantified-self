import { getDateTimeFormatter } from './date-time-format.helper';
import { getNumberFormatter } from './number-format.helper';
import { healthChartReadingLabel } from './chart-source.helper';
import { addComparisonDays, comparisonDateCarrier, type NoteComparisonWindow } from './timeline-note-comparison.helper';
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
  HEALTH_HRV_PERSONAL_RANGE_SEMANTIC_VARIANTS,
  HealthWorkspaceSeries,
  HealthWorkspaceSeriesPoint,
  formatHealthAxisValue,
  formatHealthUnit,
  formatHealthValue,
  localCalendarDate,
} from './health-workspace.helper';

type ChartOption = Parameters<EChartsType['setOption']>[0];

export type HealthChartDatum = [
  timestampMs: number,
  value: number | string | null,
];

type StressStateBlockValue = [
  startTimeMs: number,
  endTimeMs: number,
  categoryIndex: number,
  state: string,
];

interface StressStateBlockDatum {
  value: StressStateBlockValue;
  itemStyle: { color: string };
}

interface StressStateRenderParams {
  coordSys?: { x: number; y: number; width: number; height: number };
}

interface StressStateRenderApi {
  value(dimension: number): unknown;
  coord(value: [number, number]): [number, number];
  size(value: [number, number]): [number, number];
  visual(visualType: 'color' | 'opacity'): unknown;
}

export interface HealthChartSeriesModel {
  series: HealthWorkspaceSeries;
  /** Presentation only; never changes the source series/selection identity. */
  plotKind: HealthWorkspaceSeries['chartKind'];
  readingLabel: string;
  recordedDateText: string | null;
  latestText: string;
  evidenceText: string;
  twoReadingComparisonText: string | null;
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

export interface HealthChartModelOptions {
  /** A gated comparison must not announce a separate ungated two-reading difference. */
  includeTwoReadingComparison?: boolean;
}

export interface HealthChartStatusOverlay {
  rangePoints?: readonly { timestampMs: number; normalRange: { min: number; max: number } | null }[];
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
    rangePoints: status.rangePoints,
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
// Match the app's light KPI strokes, including hover and coloured HRV segments.
const HEALTH_TREND_LINE_WIDTH = 1;

interface HealthTooltipParam {
  value?: unknown;
}

export function buildHealthChartModels(
  seriesValues: readonly HealthWorkspaceSeries[],
  startTimeMs: number,
  endTimeMs: number,
  unitSettings: UserUnitSettingsInterface | null = null,
  options: HealthChartModelOptions = {},
): HealthChartSeriesModel[] {
  return seriesValues.map(series => buildSeriesModel(series, startTimeMs, endTimeMs, unitSettings, options));
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
  comparison: NoteComparisonWindow | null = null,
): ChartOption {
  const isCategorical = model.plotKind === 'step';
  const isPoint = model.plotKind === 'point';
  const isBar = model.plotKind === 'bar';
  const pointsByTimestamp = new Map(model.displayedPoints.map(point => [point.timestampMs, point]));
  const seriesColor = resolveHealthMetricColor(model.series.metricId, style.trendLineColor);
  const useStressStateColors = model.series.metricId === HEALTH_METRIC_IDS.StressState && isCategorical;
  const hrvPointStatuses = model.series.metricId === HEALTH_METRIC_IDS.HeartRateVariability
    ? new Map(statusOverlay?.pointStatuses?.map(point => [point.timestampMs, point]) || [])
    : new Map<number, HealthChartPointStatus>();
  const useHrvPointColors = hrvPointStatuses.size > 0;
  const useBodyEnergyColors = isProviderBodyEnergySeries(model.series);
  const stressStateBlocks = useStressStateColors
    ? buildStressStateBlockData(
      model.data,
      model.categoryLabels,
      startTimeMs,
      endTimeMs,
      seriesColor,
      style.trendLineColor,
    )
    : [];
  const latestNumericPoint = [...model.displayedPoints].reverse().find(point =>
    typeof point.value === 'number' && Number.isFinite(point.value));
  const isNightlyHrv = model.series.metricId === HEALTH_METRIC_IDS.HeartRateVariability
    && HEALTH_HRV_PERSONAL_RANGE_SEMANTIC_VARIANTS.some(variant => variant === model.series.semanticVariant);
  // Nightly values arrive in the morning. Remove unused hours after the final
  // day's reading, but retain the selected days when its last night is missing.
  const plotEndTimeMs = isNightlyHrv && latestNumericPoint
    && localCalendarDate(startTimeMs) !== localCalendarDate(endTimeMs)
    && latestNumericPoint.timestampMs > startTimeMs && latestNumericPoint.timestampMs <= endTimeMs
    && localCalendarDate(latestNumericPoint.timestampMs) === localCalendarDate(endTimeMs)
    ? latestNumericPoint.timestampMs : endTimeMs;
  // Baselines have their own daily timeline; missing readings stay missing.
  const rangeData: Array<[number, number | null, number | null]> = statusOverlay?.rangePoints
    && model.series.metricId === HEALTH_METRIC_IDS.HeartRateVariability
    ? statusOverlay.rangePoints.filter(point => point.timestampMs >= startTimeMs && point.timestampMs <= plotEndTimeMs)
      .map(({ timestampMs, normalRange }) => [timestampMs, normalRange?.min ?? null, normalRange?.max ?? null])
    : model.data.map(([timestampMs, value]) => {
    const range = typeof value === 'number' && timestampMs >= startTimeMs && timestampMs <= plotEndTimeMs
      ? hrvPointStatuses.get(timestampMs)?.normalRange : null;
    return range ? [timestampMs, range.min, range.max] : [timestampMs, null, null];
  });
  const numericBounds = rangeData.reduce((bounds, [, min, max]) =>
    bounds && min !== null && max !== null
      ? { min: Math.min(bounds.min, min), max: Math.max(bounds.max, max) }
      : bounds, model.numericBounds);
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
          title: comparison ? getDateTimeFormatter(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(point.timestampMs)
            : formatTooltipDate(point.timestampMs, point.timezoneOffsetSeconds),
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
            ...(comparison ? ['Daily median of recorded values; recorded calendar date.'] : []),
            ...(pointStatus ? [`Personal range: ${pointStatus.label}`] : []),
            ...(point.qualityCode ? [`Quality: ${humanize(point.qualityCode)}`] : []),
          ],
          stackHeader: true,
        });
      },
    },
    xAxis: {
      type: 'time',
      show: true,
      min: startTimeMs,
      max: plotEndTimeMs,
      boundaryGap: false,
      splitNumber: compact || style.isCompactLayout ? 3 : 6,
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
        show: true,
        data: model.categoryLabels,
        axisTick: { show: false },
        axisLine: { show: false },
        splitLine: { show: useStressStateColors, lineStyle: { color: style.gridColor } },
        axisLabel: {
          hideOverlap: compact,
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
        show: true,
        min: numericBounds?.min,
        max: numericBounds?.max,
        axisTick: { show: false },
        axisLine: { show: false },
        splitNumber: 3,
        splitLine: { lineStyle: { color: style.gridColor } },
        axisLabel: {
          hideOverlap: compact,
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
    series: [useStressStateColors ? {
      name: model.series.sourceLabel,
      type: 'custom',
      dimensions: ['startTime', 'endTime', 'categoryIndex', 'state'],
      encode: { x: [0, 1], y: 2, tooltip: [0, 3] },
      data: stressStateBlocks,
      renderItem: (params: StressStateRenderParams, api: StressStateRenderApi) =>
        renderStressStateBlock(params, api, compact),
      emphasis: { itemStyle: { opacity: 0.82 } },
      z: 2,
    } : {
      name: model.series.sourceLabel,
      type: isBar ? 'bar' : isPoint ? 'scatter' : 'line',
      data: model.data,
      connectNulls: false,
      step: isCategorical ? 'end' : undefined,
      showSymbol: isPoint || model.data.some(([, value]) => value === null) || useHrvPointColors
        ? true
        : compact
        ? model.displayedPointCount <= 2
        : isPoint || model.displayedPointCount <= 60,
      symbol: 'circle',
      symbolSize: compact ? 4 : isPoint ? 8 : 5,
      barMaxWidth: 28,
      z: useHrvPointColors ? 3 : undefined,
      lineStyle: {
        color: useHrvPointColors ? 'transparent' : seriesColor,
        width: HEALTH_TREND_LINE_WIDTH,
      },
      itemStyle: useHrvPointColors
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
      emphasis: { scale: 1.25, lineStyle: { width: HEALTH_TREND_LINE_WIDTH } },
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
    }, ...(useHrvPointColors && !isPoint
      ? buildPointStatusLineSeries(model.data, hrvPointStatuses, seriesColor)
      : []), ...buildPersonalRangeBandSeries(rangeData, statusOverlay?.normalRangeColor)],
  };

  if (comparison) {
    // Explicit opt-in daily comparison. Keep the source model/identity, shared formatting and renderer;
    // insert null days before splitting phases so no line bridges missing days or the excluded change day.
    const first = option.series[0];
    const byDate = new Map(model.displayedPoints.map(point => [point.calendarDate, point.value]));
    const endDate = comparison.after.endDate < comparison.today ? comparison.after.endDate : addComparisonDays(comparison.today, -1);
    const dates: string[] = [];
    for (let date = comparison.before.startDate; date <= endDate; date = addComparisonDays(date, 1)) dates.push(date);
    const phases = [{ name: 'Before', color: style.secondaryTextColor, before: true },
      { name: 'After', color: seriesColor, before: false }];
    Object.assign(option, { legend: { data: ['Before', 'After'], bottom: 0, textStyle: { color: style.textColor, fontSize: style.axisFontSize } } });
    option.grid.bottom = 32;
    option.series = phases.map(phase => ({ ...first, name: phase.name,
      type: isPoint ? 'scatter' : 'line', connectNulls: false, showSymbol: true,
      data: dates.map(date => [comparisonDateCarrier(date),
        (phase.before ? date < comparison.anchor : date > comparison.anchor) ? byDate.get(date) ?? null : null]),
      lineStyle: { width: HEALTH_TREND_LINE_WIDTH, color: phase.color }, itemStyle: { color: phase.color },
      markPoint: undefined,
      markLine: phase.before ? undefined : { silent: true, symbol: ['none', 'none'],
        label: { formatter: 'Note starts', color: style.secondaryTextColor, fontSize: style.axisFontSize, position: 'insideEndTop' },
        lineStyle: { color: style.secondaryTextColor, width: 1, type: 'dashed' }, data: [{ xAxis: comparisonDateCarrier(comparison.anchor) }] },
    })) as typeof option.series;
  }
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
    step: 'end',
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
    case 'rest':
    case 'restful awake':
    case 'low':
      return AppDataColors.Altitude;
    case 'active':
    case 'activity':
      return AppDataColors.Distance;
    case 'passive':
    case 'inactive':
      return AppColors.MediumGray;
    case 'medium':
      return AppDataColors.Stress;
    case 'stressful':
    case 'stressful awake':
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

function buildStressStateBlockData(
  data: readonly HealthChartDatum[],
  categoryLabels: readonly string[],
  startTimeMs: number,
  endTimeMs: number,
  seriesColor: string,
  neutralColor: string,
): StressStateBlockDatum[] {
  const categoryIndexes = new Map(categoryLabels.map((value, index) => [value, index]));
  const positiveDeltas = data.slice(1)
    .map((datum, index) => datum[0] - data[index][0])
    .filter(delta => delta > 0)
    .sort((left, right) => left - right);
  const fallbackDurationMs = positiveDeltas.length
    ? positiveDeltas[Math.floor((positiveDeltas.length - 1) / 2)]
    : Math.max(1, Math.floor((endTimeMs - startTimeMs) / 100));
  const maximumBlockDurationMs = fallbackDurationMs * 3;

  const blocks: StressStateBlockDatum[] = [];
  let previousWasGap = true;
  data.forEach((datum, index) => {
    const [timestampMs, value] = datum;
    if (typeof value !== 'string') {
      previousWasGap = true;
      return;
    }
    const categoryIndex = categoryIndexes.get(value);
    if (categoryIndex === undefined) {
      previousWasGap = true;
      return;
    }
    const nextTimestampMs = data[index + 1]?.[0] ?? timestampMs + fallbackDurationMs;
    const endTime = Math.min(
      endTimeMs,
      Math.max(timestampMs, Math.min(nextTimestampMs, timestampMs + maximumBlockDurationMs)),
    );
    const previous = blocks.at(-1);
    if (!previousWasGap && previous?.value[3] === value && previous.value[1] === timestampMs) {
      previous.value[1] = endTime;
      return;
    }
    blocks.push({
      value: [
        timestampMs,
        endTime,
        categoryIndex,
        value,
      ],
      itemStyle: {
        color: resolveHealthValueColor(
          HEALTH_METRIC_IDS.StressState,
          value,
          seriesColor,
          neutralColor,
        ),
      },
    });
    previousWasGap = false;
  });
  return blocks;
}

function renderStressStateBlock(
  params: StressStateRenderParams,
  api: StressStateRenderApi,
  compact: boolean,
): object | null {
  const coordSys = params.coordSys;
  const startTimeMs = Number(api.value(0));
  const endTimeMs = Number(api.value(1));
  const categoryIndex = Number(api.value(2));
  if (!coordSys || !Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs)
    || !Number.isFinite(categoryIndex)) {
    return null;
  }

  const start = api.coord([startTimeMs, categoryIndex]);
  const end = api.coord([endTimeMs, categoryIndex]);
  const categoryBandHeight = Math.abs(api.size([0, 1])[1]);
  const height = Math.max(4, Math.min(compact ? 8 : 12, categoryBandHeight * 0.42));
  const left = Math.max(coordSys.x, Math.min(start[0], end[0]));
  const right = Math.min(coordSys.x + coordSys.width, Math.max(start[0], end[0]));
  const width = Math.max(2, right - left);
  const x = Math.max(coordSys.x, Math.min(left, coordSys.x + coordSys.width - width));
  const top = Math.max(coordSys.y, Math.min(
    coordSys.y + coordSys.height - height,
    start[1] - height / 2,
  ));

  return {
    type: 'rect',
    shape: {
      x,
      y: top,
      width,
      height,
      r: Math.min(2, height / 2),
    },
    style: {
      fill: api.visual('color'),
      opacity: api.visual('opacity'),
    },
    transition: ['shape'],
  };
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
          width: HEALTH_TREND_LINE_WIDTH,
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
  options: HealthChartModelOptions,
): HealthChartSeriesModel {
  const sortedPoints = [...series.points].sort((left, right) => left.timestampMs - right.timestampMs);
  const displayedPoints = downsamplePoints(sortedPoints, MAX_DISPLAY_POINTS);
  const gapThreshold = resolveGapThreshold(displayedPoints, series.chartKind, series.metricId);
  const numericTimestamps = new Set(sortedPoints.filter(point => typeof point.value === 'number' && Number.isFinite(point.value))
    .map(point => point.timestampMs));
  const hasConnectedReadings = displayedPoints.some((point, index) => index > 0
    && point.timestampMs > displayedPoints[index - 1].timestampMs
    && point.timestampMs - displayedPoints[index - 1].timestampMs <= gapThreshold);
  const plotKind = series.chartKind === 'line' && (numericTimestamps.size <= 2 || !hasConnectedReadings)
    ? 'point' : series.chartKind;
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
  const readingCountText = `${getNumberFormatter().format(sortedPoints.length)} ${sortedPoints.length === 1 ? 'reading' : 'readings'}`;
  const evidenceText = `${readingCountText} recorded${plotKind === 'point' ? ' · No trend inferred' : ''}`;
  const recordedDateText = latest ? formatRecordedDate(latest.calendarDate) : null;
  const twoReadingComparisonText = options.includeTwoReadingComparison === false ? null
    : buildTwoReadingComparison(series, sortedPoints, plotKind, unitSettings);

  return {
    series,
    plotKind,
    readingLabel: healthChartReadingLabel(series),
    recordedDateText,
    latestText,
    evidenceText,
    twoReadingComparisonText,
    data: buildChartData(displayedPoints, plotKind, gapThreshold),
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
    ariaLabel: `${series.sourceLabel}, ${series.semanticLabel}. ${evidenceText}. Latest ${latestText}${recordedDateText ? `, recorded ${recordedDateText}` : ''}.${twoReadingComparisonText ? ` ${twoReadingComparisonText}.` : ''} Values are not combined with other sources.`,
  };
}

function formatRecordedDate(calendarDate: string): string | null {
  const timestampMs = /^\d{4}-\d{2}-\d{2}$/.test(calendarDate) ? Date.parse(`${calendarDate}T12:00:00.000Z`) : NaN;
  return Number.isFinite(timestampMs) && new Date(timestampMs).toISOString().slice(0, 10) === calendarDate
    ? getDateTimeFormatter(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(timestampMs) : null;
}

function buildTwoReadingComparison(
  series: HealthWorkspaceSeries,
  points: readonly HealthWorkspaceSeriesPoint[],
  plotKind: HealthWorkspaceSeries['chartKind'],
  unitSettings: UserUnitSettingsInterface | null,
): string | null {
  if (series.nativeOnly || plotKind !== 'point' || points.length !== 2) return null;
  const [first, last] = points;
  if (typeof first.value !== 'number' || typeof last.value !== 'number'
    || !Number.isFinite(first.value) || !Number.isFinite(last.value)
    || !Number.isFinite(first.timestampMs) || !Number.isFinite(last.timestampMs)
    || first.timestampMs >= last.timestampMs) return null;
  let firstDate = formatRecordedDate(first.calendarDate), lastDate = formatRecordedDate(last.calendarDate);
  if (!firstDate || !lastDate) return null;
  if (first.calendarDate === last.calendarDate) {
    firstDate = formatTooltipDate(first.timestampMs, first.timezoneOffsetSeconds);
    lastDate = formatTooltipDate(last.timestampMs, last.timezoneOffsetSeconds);
  }
  const difference = last.value - first.value;
  const formatted = formatHealthValue(series.metricId, Math.abs(difference), series.unit, false, unitSettings);
  // A difference between two comparable records is not a slope or a trend.
  return `Recorded change: ${difference > 0 ? '+' : difference < 0 ? '−' : ''}${formatted} · ${firstDate} → ${lastDate}`;
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
  gapThreshold: number,
): HealthChartDatum[] {
  const data: HealthChartDatum[] = [];
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
  metricId: HealthMetricId,
): number {
  const positiveDeltas = points.slice(1)
    .map((point, index) => point.timestampMs - points[index].timestampMs)
    .filter(delta => delta > 0)
    .sort((left, right) => left - right);
  const medianDelta = positiveDeltas.length
    ? positiveDeltas[Math.floor((positiveDeltas.length - 1) / 2)]
    : DAY_MS;
  // Preserve the existing categorical cadence. The sparse policy is numeric only.
  if (chartKind === 'step') return Math.max(medianDelta * 3, 1);
  // Presentation continuity limits, not physiological thresholds. Occasional
  // measurements may have a regular weekly/monthly cadence; daily signals must
  // still expose missing days. Neither can infer a trend from only two readings.
  let maximumDays = 3;
  switch (metricId) {
    case HEALTH_METRIC_IDS.BodyWeight:
    case HEALTH_METRIC_IDS.BodyMassIndex:
    case HEALTH_METRIC_IDS.BodyFat:
    case HEALTH_METRIC_IDS.BodyWater:
    case HEALTH_METRIC_IDS.MuscleMass:
    case HEALTH_METRIC_IDS.BoneMass:
    case HEALTH_METRIC_IDS.BloodPressureSystolic:
    case HEALTH_METRIC_IDS.BloodPressureDiastolic:
      maximumDays = 14;
      break;
    case HEALTH_METRIC_IDS.Vo2Max:
    case HEALTH_METRIC_IDS.FitnessAge:
      maximumDays = 35;
      break;
  }
  return Math.min(medianDelta * 3, maximumDays * DAY_MS);
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
  return getDateTimeFormatter(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(localTimestampMs));
}

function formatAxisTime(timestampMs: number, timezoneOffsetSeconds?: number | null): string {
  const localTimestampMs = timestampInFixedOffset(timestampMs, timezoneOffsetSeconds);
  return getDateTimeFormatter(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
    .format(new Date(localTimestampMs));
}

function formatTooltipDate(timestampMs: number, timezoneOffsetSeconds?: number | null): string {
  const normalizedOffsetSeconds = normalizeTimezoneOffsetSeconds(timezoneOffsetSeconds);
  const dateTime = getDateTimeFormatter(undefined, {
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
