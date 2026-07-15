import type { EventInterface } from '@sports-alliance/sports-lib';
import {
  ChartDataCategoryTypes,
  ChartTypes,
  DataRecoveryTime,
  TileMapSettingsInterface,
  TileSettingsInterface,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import {
  buildEventStatAggregation,
} from '@shared/event-stat-aggregation';
import type {
  EventStatAggregationLogger,
  EventStatAggregationPreferences,
} from '@shared/event-stat-aggregation.types';
import type { MapStyleName } from '../services/map/map-style.types';
import {
  buildAggregatedChartRows,
  type AggregatedChartRow,
} from './aggregated-chart-row.helper';
import {
  type DashboardFormPoint,
  resolveDashboardFormLatestPoint,
} from './dashboard-form.helper';
import {
  type DashboardRecoveryNowContext,
} from './dashboard-recovery-now.helper';
import type {
  DashboardAcwrContext,
  DashboardEasyPercentContext,
  DashboardEfficiencyDelta4wContext,
  DashboardEfficiencyTrendContext,
  DashboardFatigueAtlContext,
  DashboardFitnessCtlContext,
  DashboardFreshnessForecastContext,
  DashboardFormNowContext,
  DashboardFormPlus7dContext,
  DashboardHardPercentContext,
  DashboardIntensityDistributionContext,
  DashboardMonotonyStrainContext,
  DashboardRampRateContext,
} from './dashboard-derived-metrics.helper';
import {
  resolveDashboardFatigueAtlContext,
  resolveDashboardFitnessCtlContext,
} from './dashboard-derived-metrics.helper';
import {
  buildDashboardSleepTrendContext,
  type DashboardSleepTrendContext,
  type DashboardSleepTrendWindow,
} from './dashboard-sleep-chart.helper';
import {
  buildDashboardPowerCurveContextFromSnapshot,
  type DashboardPowerCurveContext,
} from './dashboard-power-curve.helper';
import {
  DASHBOARD_POWER_CURVE_DEFAULT_RANGE,
  getDashboardPowerCurveScopeDefinition,
  resolveDashboardPowerCurveTileDisplayScope,
} from './dashboard-power-curve-scope.helper';
import type { DerivedPowerCurveMetricPayload, DerivedPowerCurveRange } from '@shared/derived-metrics';
import {
  DASHBOARD_TILE_EVENT_DEFAULT_RANGE,
  dashboardTileEventRangeDays,
  filterDashboardTileEventsByActivityTypes,
  normalizeDashboardTileEventFilters,
} from './dashboard-tile-event-filters.helper';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE,
  DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
  DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
  DASHBOARD_POWER_CURVE_CHART_TYPE,
  DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  isDashboardAcwrKpiChartType,
  isDashboardEasyPercentKpiChartType,
  isDashboardEfficiencyDelta4wKpiChartType,
  isDashboardEfficiencyTrendChartType,
  isDashboardFatigueAtlKpiChartType,
  isDashboardFatigueTrendKpiChartType,
  isDashboardFitnessCtlKpiChartType,
  isDashboardFitnessTrendKpiChartType,
  isDashboardFreshnessForecastChartType,
  isDashboardFormChartType,
  isDashboardFormNowKpiChartType,
  isDashboardFormPlus7dKpiChartType,
  isDashboardHardPercentKpiChartType,
  isDashboardIntensityDistributionChartType,
  isDashboardLoadStatusKpiChartType,
  isDashboardMonotonyStrainKpiChartType,
  isDashboardRampRateKpiChartType,
  isDashboardRecoveryDebtKpiChartType,
  isDashboardRecoveryNowChartType,
  isDashboardSleepTrendChartType,
  isDashboardPowerCurveChartType,
  isDashboardTrainingBalanceKpiChartType,
} from './dashboard-special-chart-types';
import type { SleepSession } from '@shared/sleep';
import type { FirestoreRouteJSON } from '@shared/app-route.interface';
import type {
  AppDashboardChartTileSettingsInterface,
  AppDashboardMapTileSettingsInterface,
} from '../models/app-user.interface';

export interface DashboardChartTileViewModel extends AppDashboardChartTileSettingsInterface {
  timeInterval: TimeIntervals;
  data: AggregatedChartRow[] | EventInterface[] | DashboardFormPoint[];
  recoveryNow?: DashboardRecoveryNowContext;
  absoluteLatestFormPoint?: DashboardFormPoint | null;
  acwr?: DashboardAcwrContext | null;
  rampRate?: DashboardRampRateContext | null;
  monotonyStrain?: DashboardMonotonyStrainContext | null;
  formNow?: DashboardFormNowContext | null;
  fitnessCtl?: DashboardFitnessCtlContext | null;
  fatigueAtl?: DashboardFatigueAtlContext | null;
  formPlus7d?: DashboardFormPlus7dContext | null;
  easyPercent?: DashboardEasyPercentContext | null;
  hardPercent?: DashboardHardPercentContext | null;
  efficiencyDelta4w?: DashboardEfficiencyDelta4wContext | null;
  freshnessForecast?: DashboardFreshnessForecastContext | null;
  intensityDistribution?: DashboardIntensityDistributionContext | null;
  efficiencyTrend?: DashboardEfficiencyTrendContext | null;
  sleepTrend?: DashboardSleepTrendContext | null;
  powerCurve?: DashboardPowerCurveContext | null;
}

export type DashboardMapTileSettings = Omit<TileMapSettingsInterface, 'mapType'> & AppDashboardMapTileSettingsInterface & {
  mapStyle?: MapStyleName;
};

export interface DashboardMapTileViewModel extends DashboardMapTileSettings {
  events: EventInterface[];
  routePreviews: FirestoreRouteJSON[];
}

export type DashboardTileViewModel = DashboardChartTileViewModel | DashboardMapTileViewModel;

const DASHBOARD_CUSTOM_CHART_DAILY_AUTO_MAX_DAYS = 31;
const DASHBOARD_CUSTOM_CHART_WEEKLY_AUTO_MAX_DAYS = 120;

interface BuildDashboardTileViewModelsInput {
  tiles: TileSettingsInterface[];
  events?: EventInterface[] | null;
  tileEventsByOrder?: Record<number, EventInterface[] | undefined> | null;
  routePreviews?: FirestoreRouteJSON[] | null;
  sleepSessions?: SleepSession[] | null;
  sleepTrendWindow?: DashboardSleepTrendWindow | null;
  preferences?: EventStatAggregationPreferences;
  logger?: EventStatAggregationLogger;
  startOfWeek?: number | null;
  derivedMetrics?: {
    formPoints?: DashboardFormPoint[] | null;
    recoveryNow?: DashboardRecoveryNowContext | null;
    acwr?: DashboardAcwrContext | null;
    rampRate?: DashboardRampRateContext | null;
    monotonyStrain?: DashboardMonotonyStrainContext | null;
    formNow?: DashboardFormNowContext | null;
    formPlus7d?: DashboardFormPlus7dContext | null;
    easyPercent?: DashboardEasyPercentContext | null;
    hardPercent?: DashboardHardPercentContext | null;
    efficiencyDelta4w?: DashboardEfficiencyDelta4wContext | null;
    freshnessForecast?: DashboardFreshnessForecastContext | null;
    intensityDistribution?: DashboardIntensityDistributionContext | null;
    efficiencyTrend?: DashboardEfficiencyTrendContext | null;
    powerCurve?: DerivedPowerCurveMetricPayload | null;
  } | null;
}

function resolveEventStartDateTimeMs(event: EventInterface): number | null {
  const startDate = (event as { startDate?: unknown } | null)?.startDate;
  if (startDate instanceof Date) {
    const startTimeMs = startDate.getTime();
    return Number.isFinite(startTimeMs) ? startTimeMs : null;
  }
  if (typeof startDate === 'number' && Number.isFinite(startDate)) {
    return startDate;
  }
  if (startDate && typeof (startDate as { getTime?: () => unknown }).getTime === 'function') {
    const startTimeMs = Number((startDate as { getTime: () => unknown }).getTime());
    return Number.isFinite(startTimeMs) ? startTimeMs : null;
  }
  return null;
}

function normalizeDashboardTileEvents(
  events?: EventInterface[] | null,
): EventInterface[] {
  const normalizedEvents = [...(events || [])]
    .filter(event => (event as { isMerge?: boolean } | null)?.isMerge !== true)
    .sort((left, right) => {
      const leftTime = resolveEventStartDateTimeMs(left) ?? Number.NEGATIVE_INFINITY;
      const rightTime = resolveEventStartDateTimeMs(right) ?? Number.NEGATIVE_INFINITY;
      return leftTime - rightTime;
    });
  return normalizedEvents;
}

function resolveEventsForTile(
  input: BuildDashboardTileViewModelsInput,
  tile: TileSettingsInterface,
  fallbackEvents: EventInterface[],
): EventInterface[] {
  const rawTileEvents = input.tileEventsByOrder?.[tile.order] || fallbackEvents;
  const normalizedTileEvents = normalizeDashboardTileEvents(rawTileEvents);
  const tileWithFilters = tile as TileSettingsInterface & {
    eventFilters?: unknown;
  };
  const filters = normalizeDashboardTileEventFilters(tileWithFilters.eventFilters);
  return filterDashboardTileEventsByActivityTypes(normalizedTileEvents, filters.activityTypes);
}

function resolveDashboardPowerCurveLatestSeriesLabel(
  tile: AppDashboardChartTileSettingsInterface,
): string {
  const displayScope = resolveDashboardPowerCurveTileDisplayScope(tile);
  if (displayScope) {
    return getDashboardPowerCurveScopeDefinition(displayScope).latestSeriesLabel;
  }

  return 'Latest power activity';
}

function resolveDashboardCustomChartRequestedTimeInterval(
  chartTile: AppDashboardChartTileSettingsInterface,
): TimeIntervals {
  const requestedTimeInterval = chartTile.dataTimeInterval || TimeIntervals.Auto;
  if (requestedTimeInterval !== TimeIntervals.Auto) {
    return requestedTimeInterval;
  }

  if (chartTile.dataCategoryType !== ChartDataCategoryTypes.DateType) {
    return requestedTimeInterval;
  }

  if (!chartTile.eventFilters) {
    return requestedTimeInterval;
  }

  const filters = normalizeDashboardTileEventFilters(chartTile.eventFilters);
  const rangeDays = dashboardTileEventRangeDays(filters.range || DASHBOARD_TILE_EVENT_DEFAULT_RANGE);
  if (
    rangeDays !== null
    && rangeDays > DASHBOARD_CUSTOM_CHART_DAILY_AUTO_MAX_DAYS
    && rangeDays <= DASHBOARD_CUSTOM_CHART_WEEKLY_AUTO_MAX_DAYS
  ) {
    return TimeIntervals.Weekly;
  }

  return requestedTimeInterval;
}

export function buildDashboardTileViewModels(
  input: BuildDashboardTileViewModelsInput,
): DashboardTileViewModel[] {
  const normalizedEvents = normalizeDashboardTileEvents(input.events);
  const derivedFormPoints = Array.isArray(input.derivedMetrics?.formPoints) ? input.derivedMetrics?.formPoints : null;
  const derivedRecoveryNowContext = input.derivedMetrics?.recoveryNow || null;
  const derivedAcwrContext = input.derivedMetrics?.acwr || null;
  const derivedRampRateContext = input.derivedMetrics?.rampRate || null;
  const derivedMonotonyStrainContext = input.derivedMetrics?.monotonyStrain || null;
  const derivedFormNowContext = input.derivedMetrics?.formNow || null;
  const derivedFitnessCtlContext = resolveDashboardFitnessCtlContext(derivedFormPoints);
  const derivedFatigueAtlContext = resolveDashboardFatigueAtlContext(derivedFormPoints);
  const derivedFormPlus7dContext = input.derivedMetrics?.formPlus7d || null;
  const derivedEasyPercentContext = input.derivedMetrics?.easyPercent || null;
  const derivedHardPercentContext = input.derivedMetrics?.hardPercent || null;
  const derivedEfficiencyDelta4wContext = input.derivedMetrics?.efficiencyDelta4w || null;
  const derivedFreshnessForecastContext = input.derivedMetrics?.freshnessForecast || null;
  const derivedIntensityDistributionContext = input.derivedMetrics?.intensityDistribution || null;
  const derivedEfficiencyTrendContext = input.derivedMetrics?.efficiencyTrend || null;
  const derivedPowerCurvePayload = input.derivedMetrics?.powerCurve || null;
  const sleepTrendContext = buildDashboardSleepTrendContext(input.sleepSessions || [], {
    sleepWindow: input.sleepTrendWindow || null,
  });

  return (input.tiles || []).reduce<DashboardTileViewModel[]>((viewModels, tile) => {
    if (tile.type === TileTypes.Map) {
      const mapTile = tile as DashboardMapTileSettings;
      const mapSource = mapTile.mapSource === 'routes' ? 'routes' : 'events';
      const tileEvents = mapSource === 'events'
        ? resolveEventsForTile(input, mapTile, normalizedEvents)
        : [];
      viewModels.push({
        ...mapTile,
        mapSource,
        events: tileEvents,
        routePreviews: mapSource === 'routes' ? [...(input.routePreviews || [])] : [],
      });
      return viewModels;
    }

    if (tile.type !== TileTypes.Chart) {
      throw new Error(`Not implemented for ${tile.type}`);
    }

    const chartTile = tile as AppDashboardChartTileSettingsInterface;
    const requestedTimeInterval = resolveDashboardCustomChartRequestedTimeInterval(chartTile);
    if (isDashboardFormChartType(chartTile.chartType)) {
      const fullFormPoints = derivedFormPoints || [];
      viewModels.push({
        ...chartTile,
        timeInterval: TimeIntervals.Weekly,
        // Curated Form/TSS always renders from full derived history.
        // The chart itself handles viewport navigation (scroll/zoom) without date-range clipping.
        data: fullFormPoints,
        absoluteLatestFormPoint: resolveDashboardFormLatestPoint(fullFormPoints),
      });
      return viewModels;
    }

    if (isDashboardAcwrKpiChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_ACWR_KPI_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Weekly,
        data: [],
        acwr: derivedAcwrContext,
      });
      return viewModels;
    }

    if (isDashboardRampRateKpiChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_RAMP_RATE_KPI_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Weekly,
        data: [],
        rampRate: derivedRampRateContext,
      });
      return viewModels;
    }

    if (isDashboardMonotonyStrainKpiChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Weekly,
        data: [],
        monotonyStrain: derivedMonotonyStrainContext,
      });
      return viewModels;
    }

    if (isDashboardLoadStatusKpiChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Weekly,
        data: [],
        formNow: derivedFormNowContext,
        rampRate: derivedRampRateContext,
        fitnessCtl: derivedFitnessCtlContext,
        fatigueAtl: derivedFatigueAtlContext,
      });
      return viewModels;
    }

    if (isDashboardFormNowKpiChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_FORM_NOW_KPI_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Weekly,
        data: [],
        formNow: derivedFormNowContext,
      });
      return viewModels;
    }

    if (isDashboardFitnessCtlKpiChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Weekly,
        data: [],
        fitnessCtl: derivedFitnessCtlContext,
      });
      return viewModels;
    }

    if (isDashboardFatigueAtlKpiChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Weekly,
        data: [],
        fatigueAtl: derivedFatigueAtlContext,
      });
      return viewModels;
    }

    if (isDashboardFitnessTrendKpiChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Weekly,
        data: [],
        fitnessCtl: derivedFitnessCtlContext,
      });
      return viewModels;
    }

    if (isDashboardFatigueTrendKpiChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Weekly,
        data: [],
        fatigueAtl: derivedFatigueAtlContext,
      });
      return viewModels;
    }

    if (isDashboardRecoveryDebtKpiChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Weekly,
        data: [],
        formNow: derivedFormNowContext,
        formPlus7d: derivedFormPlus7dContext,
        freshnessForecast: derivedFreshnessForecastContext,
      });
      return viewModels;
    }

    if (isDashboardFormPlus7dKpiChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Weekly,
        data: [],
        formPlus7d: derivedFormPlus7dContext,
      });
      return viewModels;
    }

    if (isDashboardTrainingBalanceKpiChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Weekly,
        data: [],
        easyPercent: derivedEasyPercentContext,
        hardPercent: derivedHardPercentContext,
        intensityDistribution: derivedIntensityDistributionContext,
      });
      return viewModels;
    }

    if (isDashboardEasyPercentKpiChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Weekly,
        data: [],
        easyPercent: derivedEasyPercentContext,
      });
      return viewModels;
    }

    if (isDashboardHardPercentKpiChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Weekly,
        data: [],
        hardPercent: derivedHardPercentContext,
      });
      return viewModels;
    }

    if (isDashboardEfficiencyDelta4wKpiChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Weekly,
        data: [],
        efficiencyDelta4w: derivedEfficiencyDelta4wContext,
      });
      return viewModels;
    }

    if (isDashboardFreshnessForecastChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Daily,
        data: [],
        freshnessForecast: derivedFreshnessForecastContext,
      });
      return viewModels;
    }

    if (isDashboardIntensityDistributionChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Weekly,
        data: [],
        intensityDistribution: derivedIntensityDistributionContext,
      });
      return viewModels;
    }

    if (isDashboardEfficiencyTrendChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_EFFICIENCY_TREND_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Weekly,
        data: [],
        efficiencyTrend: derivedEfficiencyTrendContext,
      });
      return viewModels;
    }

    if (isDashboardSleepTrendChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_SLEEP_TREND_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Daily,
        data: [],
        sleepTrend: sleepTrendContext,
      });
      return viewModels;
    }

    if (isDashboardPowerCurveChartType(chartTile.chartType)) {
      const displayScope = resolveDashboardPowerCurveTileDisplayScope(chartTile) || 'cycling';
      const filters = normalizeDashboardTileEventFilters(
        chartTile.eventFilters,
        DASHBOARD_POWER_CURVE_DEFAULT_RANGE,
        [],
      );
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_POWER_CURVE_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Auto,
        data: [],
        powerCurve: buildDashboardPowerCurveContextFromSnapshot(derivedPowerCurvePayload, {
          scope: displayScope,
          range: filters.range as DerivedPowerCurveRange,
          startOfWeek: input.startOfWeek,
          latestSeriesLabel: resolveDashboardPowerCurveLatestSeriesLabel(chartTile),
          compareMode: chartTile.displaySettings?.powerCurveCompareMode,
        }),
      });
      return viewModels;
    }

    if (chartTile.chartType === ChartTypes.IntensityZones) {
      const tileEvents = resolveEventsForTile(input, chartTile, normalizedEvents);
      viewModels.push({
        ...chartTile,
        timeInterval: TimeIntervals.Auto,
        data: tileEvents,
      });
      return viewModels;
    }

    const isLegacyRecoveryPieTile = chartTile.chartType === ChartTypes.Pie
      && chartTile.dataType === DataRecoveryTime.type;
    const isCuratedRecoveryTile = isDashboardRecoveryNowChartType(chartTile.chartType)
      || isLegacyRecoveryPieTile;
    const effectiveChartType = isLegacyRecoveryPieTile
      ? (DASHBOARD_RECOVERY_NOW_CHART_TYPE as unknown as ChartTypes)
      : chartTile.chartType;
    if (isCuratedRecoveryTile) {
      const recoveryNowContextForTile = derivedRecoveryNowContext;
      viewModels.push({
        ...chartTile,
        chartType: effectiveChartType,
        timeInterval: chartTile.dataTimeInterval || TimeIntervals.Auto,
        data: [],
        ...(recoveryNowContextForTile ? { recoveryNow: recoveryNowContextForTile } : {}),
      });
      return viewModels;
    }

    const tileEvents = resolveEventsForTile(input, chartTile, normalizedEvents);
    const aggregation = buildEventStatAggregation(tileEvents, {
      dataType: chartTile.dataType,
      valueType: chartTile.dataValueType,
      categoryType: chartTile.dataCategoryType,
      requestedTimeInterval,
      preferences: input.preferences,
    }, input.logger);
    const chartRowsForTile = buildAggregatedChartRows(aggregation);

    viewModels.push({
      ...chartTile,
      chartType: effectiveChartType,
      timeInterval: aggregation.resolvedTimeInterval,
      data: chartRowsForTile,
    });
    return viewModels;
  }, []);
}

export function isDashboardChartTileViewModel(tile: DashboardTileViewModel | TileSettingsInterface): tile is DashboardChartTileViewModel {
  return tile.type === TileTypes.Chart;
}
