import { buildDashboardPerformanceTrend, type DashboardPerformanceTrendContext } from './dashboard-performance-trend.helper';
import { buildTrainingPowerSystemsActivityTypeViewModels } from './training-power-systems.helper';
import { buildTrainingDurabilityScopeViewModels } from './training-durability-view.helper';
import {
  isDashboardPerformanceChartType,
  isDashboardPowerCapacityChartType,
  DASHBOARD_DURABILITY_CHART_TYPE,
  DASHBOARD_HEALTH_METRIC_CHART_TYPE,
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE,
  DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE,
  DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE,
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
  DASHBOARD_POWER_CURVE_CHART_TYPE,
  DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  isDashboardAcwrKpiChartType,
  isDashboardActivityCalendarChartType,
  isDashboardAerobicCapacityKpiChartType,
  isDashboardAerobicDurabilityKpiChartType,
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
  isRetiredDashboardReadinessConfidenceKpiChartType,
  isDashboardSleepBackedChartType,
  isDashboardPowerCurveChartType,
  isDashboardTrainingBalanceKpiChartType,
} from './dashboard-special-chart-types';
import type { DerivedTrainingPowerSystemsMetricPayload } from '@shared/derived-metrics';
import type { EventRead } from '@shared/event-read';

import type { DashboardHrvContext } from './dashboard-hrv-context.helper';

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
  buildEventStatAggregation, EventStatAggregationContext,
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
  DashboardTrainingCapacityContext,
} from './dashboard-derived-metrics.helper';
import {
  resolveDashboardFatigueAtlContext,
  resolveDashboardFitnessCtlContext,
  resolveDashboardFormNowContextFromPoints,
  resolveDashboardRampRateContextFromPoints,
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
import type {
  DerivedPowerCurveMetricPayload,
  DerivedPowerCurveRange,
  DerivedTrainingDurabilityMetricPayload,
} from '@shared/derived-metrics';
import {
  buildDashboardAerobicCapacityContext,
  buildDashboardAerobicDurabilityContext,
  type DashboardAerobicCapacityContext,
  type DashboardAerobicDurabilityContext,
} from './dashboard-training-insights.helper';
import {
  DASHBOARD_TILE_EVENT_DEFAULT_RANGE,
  dashboardTileEventRangeDays,
  filterDashboardTileEventsByActivityTypes,
  normalizeDashboardTileEventFilters,
} from './dashboard-tile-event-filters.helper';

import type { SleepSession } from '@shared/sleep';
import type { FirestoreRouteJSON } from '@shared/app-route.interface';
import type {
  AppDashboardChartTileSettingsInterface,
  AppDashboardMapTileSettingsInterface,
} from '../models/app-user.interface';

export interface DashboardChartTileViewModel extends AppDashboardChartTileSettingsInterface {
  timeInterval: TimeIntervals;
  data: AggregatedChartRow[] | EventRead[] | DashboardFormPoint[];
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
  hrvTrend?: DashboardHrvContext | null;
  powerCurve?: DashboardPowerCurveContext | null;
  performanceTrend?: DashboardPerformanceTrendContext | null;
  aerobicCapacity?: DashboardAerobicCapacityContext | null;
  aerobicDurability?: DashboardAerobicDurabilityContext | null;
}

export type DashboardMapTileSettings = Omit<TileMapSettingsInterface, 'mapType'> & AppDashboardMapTileSettingsInterface & {
  mapStyle?: MapStyleName;
};

export interface DashboardMapTileViewModel extends DashboardMapTileSettings {
  events: EventRead[];
  routePreviews: FirestoreRouteJSON[];
}

export type DashboardTileViewModel = DashboardChartTileViewModel | DashboardMapTileViewModel;

const DASHBOARD_CUSTOM_CHART_DAILY_AUTO_MAX_DAYS = 31;
const DASHBOARD_CUSTOM_CHART_WEEKLY_AUTO_MAX_DAYS = 120;

interface BuildDashboardTileViewModelsInput {
  tiles: TileSettingsInterface[];
  events?: EventRead[] | null;
  tileEventsByOrder?: Record<number, EventRead[] | undefined> | null;
  routePreviews?: FirestoreRouteJSON[] | null;
  hrvTrend?: DashboardHrvContext | null;
  hrvPreferredSource?: string | null;
  sleepSessions?: SleepSession[] | null;
  sleepTrendWindow?: DashboardSleepTrendWindow | null;
  preferences?: EventStatAggregationPreferences;
  logger?: EventStatAggregationLogger;
  startOfWeek?: number | null;
  unitSettings?: import('@sports-alliance/sports-lib').UserUnitSettingsInterface | null;
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
    trainingCapacity?: DashboardTrainingCapacityContext | null;
    trainingDurability?: DerivedTrainingDurabilityMetricPayload | null;
    trainingPowerSystems?: DerivedTrainingPowerSystemsMetricPayload | null;
  } | null;
}

function resolveEventStartDateTimeMs(event: EventRead): number | null {
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
  events?: EventRead[] | null,
): EventRead[] {
  const normalizedEvents = [...(events || [])]
    .filter(event => (event as { isMerge?: boolean } | null)?.isMerge !== true)
    .sort((left, right) => {
      const leftTime = resolveEventStartDateTimeMs(left) ?? Number.NEGATIVE_INFINITY;
      const rightTime = resolveEventStartDateTimeMs(right) ?? Number.NEGATIVE_INFINITY;
      return leftTime - rightTime;
    });
  return normalizedEvents;
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
  const fallbackEvents = input.events || [];
  const aggregationContext = new EventStatAggregationContext();
  const tileInputs = new Map<EventRead[], { events: EventRead[]; variants: Map<string, EventRead[]> }>();
  const resolveTileEvents = (tile: TileSettingsInterface) => {
    const source = input.tileEventsByOrder?.[tile.order] || fallbackEvents;
    let cached = tileInputs.get(source);
    if (!cached) {
      cached = { events: normalizeDashboardTileEvents(source), variants: new Map() };
      tileInputs.set(source, cached);
    }
    const { activityTypes } = normalizeDashboardTileEventFilters(tile['eventFilters']);
    const key = JSON.stringify(activityTypes);
    let events = cached.variants.get(key);
    if (!events) {
      events = filterDashboardTileEventsByActivityTypes(cached.events, activityTypes);
      cached.variants.set(key, events);
    }
    return events;
  };
  const derivedFormPoints = Array.isArray(input.derivedMetrics?.formPoints) ? input.derivedMetrics?.formPoints : null;
  const nowMs = Date.now();
  const derivedRecoveryNowContext = input.derivedMetrics?.recoveryNow || null;
  const derivedAcwrContext = input.derivedMetrics?.acwr || null;
  const derivedRampRateContext = resolveDashboardRampRateContextFromPoints(derivedFormPoints, nowMs)
    || input.derivedMetrics?.rampRate
    || null;
  const derivedMonotonyStrainContext = input.derivedMetrics?.monotonyStrain || null;
  const derivedFormNowContext = resolveDashboardFormNowContextFromPoints(derivedFormPoints, nowMs)
    || input.derivedMetrics?.formNow
    || null;
  const derivedFitnessCtlContext = resolveDashboardFitnessCtlContext(derivedFormPoints, nowMs);
  const derivedFatigueAtlContext = resolveDashboardFatigueAtlContext(derivedFormPoints, nowMs);
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
  const aerobicCapacityContext = buildDashboardAerobicCapacityContext(input.derivedMetrics?.trainingCapacity);
  const aerobicDurabilityContext = buildDashboardAerobicDurabilityContext(input.derivedMetrics?.trainingDurability);
  const powerViews = input.tiles.some(tile => isDashboardPowerCapacityChartType(tile['chartType']))
    ? buildTrainingPowerSystemsActivityTypeViewModels(input.derivedMetrics?.trainingPowerSystems || null) : [];
  const durabilityViews = input.tiles.some(tile => tile['chartType'] === DASHBOARD_DURABILITY_CHART_TYPE)
    ? buildTrainingDurabilityScopeViewModels(input.derivedMetrics?.trainingDurability, ['running', 'cycling', 'swimming']) : [];
  return (input.tiles || []).reduce<DashboardTileViewModel[]>((viewModels, tile) => {
    if (tile.type === TileTypes.Map) {
      const mapTile = tile as DashboardMapTileSettings;
      const mapSource = mapTile.mapSource === 'routes' ? 'routes' : 'events';
      const tileEvents = mapSource === 'events'
        ? resolveTileEvents(mapTile)
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
    // Readiness is a fixed part of Dashboard Today. Ignore stale saved copies so
    // users never see the same signal twice while settings are cleaned on save.
    if (isRetiredDashboardReadinessConfidenceKpiChartType(chartTile.chartType)) {
      return viewModels;
    }
    if (isDashboardPerformanceChartType(chartTile.chartType)) {
      viewModels.push({ ...chartTile, timeInterval: TimeIntervals.Weekly, data: [],
        performanceTrend: buildDashboardPerformanceTrend(chartTile.chartType, powerViews, durabilityViews, chartTile.displaySettings?.performanceContext, input.unitSettings),
      });
      return viewModels;
    }
    if (`${chartTile.chartType}` === DASHBOARD_HEALTH_METRIC_CHART_TYPE) {
      viewModels.push({ ...chartTile, timeInterval: TimeIntervals.Daily, data: [] });
      return viewModels;
    }
    const requestedTimeInterval = resolveDashboardCustomChartRequestedTimeInterval(chartTile);
    if (isDashboardActivityCalendarChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Daily,
        data: [],
      });
      return viewModels;
    }
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

    if (isDashboardAerobicCapacityKpiChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Auto,
        data: [],
        aerobicCapacity: aerobicCapacityContext,
      });
      return viewModels;
    }

    if (isDashboardAerobicDurabilityKpiChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        chartType: DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE as unknown as ChartTypes,
        timeInterval: TimeIntervals.Weekly,
        data: [],
        aerobicDurability: aerobicDurabilityContext,
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

    if (isDashboardSleepBackedChartType(chartTile.chartType)) {
      viewModels.push({
        ...chartTile,
        timeInterval: TimeIntervals.Daily,
        data: [],
        sleepTrend: sleepTrendContext,
        hrvTrend: input.hrvTrend ? { ...input.hrvTrend, charts: [...input.hrvTrend.charts].sort((left, right) =>
          Number(right.key === input.hrvPreferredSource || right.model.series.sourceSelectionKey === input.hrvPreferredSource)
          - Number(left.key === input.hrvPreferredSource || left.model.series.sourceSelectionKey === input.hrvPreferredSource)) } : null,
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
      const tileEvents = resolveTileEvents(chartTile);
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

    const tileEvents = resolveTileEvents(chartTile);
    const aggregation = buildEventStatAggregation(tileEvents, {
      dataType: chartTile.dataType,
      valueType: chartTile.dataValueType,
      categoryType: chartTile.dataCategoryType,
      requestedTimeInterval,
      preferences: input.preferences,
    }, input.logger, aggregationContext);
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
