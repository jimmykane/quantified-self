import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataRecoveryTime,
  TileChartSettingsInterface,
  TileSettingsInterface,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import {
  AppDashboardAutoTileId,
  AppDashboardAutoTileState,
  AppDashboardSettingsInterface,
} from '../models/app-user.interface';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
  type DashboardCuratedChartType,
  type DashboardKpiChartType,
  getDashboardKpiChartDefinitions,
} from './dashboard-special-chart-types';
import { DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE } from './dashboard-form.helper';

export const DASHBOARD_AUTO_TILE_SLEEP_TREND_ID: AppDashboardAutoTileId = 'sleepTrend';
export const DASHBOARD_AUTO_TILE_SLEEP_TREND_SOURCE = 'sleep-sync';
export const DASHBOARD_AUTO_TILE_CURATED_SOURCE = 'default-curated';
export const DASHBOARD_AUTO_TILE_KPI_SOURCE = 'default-kpi';

export type DashboardDefaultCuratedChartType = Exclude<DashboardCuratedChartType, typeof DASHBOARD_SLEEP_TREND_CHART_TYPE>;

export const DASHBOARD_AUTO_TILE_CURATED_ID_BY_CHART_TYPE: Record<DashboardDefaultCuratedChartType, AppDashboardAutoTileId> = {
  [DASHBOARD_RECOVERY_NOW_CHART_TYPE]: 'curatedRecoveryNow',
  [DASHBOARD_FORM_CHART_TYPE]: 'curatedForm',
  [DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE]: 'curatedFreshnessForecast',
  [DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE]: 'curatedIntensityDistribution',
  [DASHBOARD_EFFICIENCY_TREND_CHART_TYPE]: 'curatedEfficiencyTrend',
};
export const DASHBOARD_AUTO_TILE_RECOVERY_NOW_ID = DASHBOARD_AUTO_TILE_CURATED_ID_BY_CHART_TYPE[DASHBOARD_RECOVERY_NOW_CHART_TYPE];

export const DASHBOARD_AUTO_TILE_KPI_ID_BY_CHART_TYPE: Record<DashboardKpiChartType, AppDashboardAutoTileId> = {
  [DASHBOARD_ACWR_KPI_CHART_TYPE]: 'kpiAcwr',
  [DASHBOARD_RAMP_RATE_KPI_CHART_TYPE]: 'kpiRampRate',
  [DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE]: 'kpiMonotonyStrain',
  [DASHBOARD_FORM_NOW_KPI_CHART_TYPE]: 'kpiFormNow',
  [DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE]: 'kpiFitnessCtl',
  [DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE]: 'kpiFatigueAtl',
  [DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE]: 'kpiFormPlus7d',
  [DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE]: 'kpiEasyPercent',
  [DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE]: 'kpiHardPercent',
  [DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE]: 'kpiEfficiencyDelta4w',
};

export interface DashboardAutoTileDescriptor {
  id: AppDashboardAutoTileId;
  source: string;
}

export function buildDashboardSleepTrendAutoTile(
  order: number,
  size: { columns: number; rows: number } = { columns: 1, rows: 1 },
): TileChartSettingsInterface {
  return {
    name: 'Sleep',
    type: TileTypes.Chart,
    order,
    size,
    chartType: DASHBOARD_SLEEP_TREND_CHART_TYPE as unknown as ChartTypes,
    dataType: 'SleepDuration',
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType: ChartDataCategoryTypes.DateType,
    dataTimeInterval: TimeIntervals.Daily,
  };
}

export function buildDashboardCuratedAutoTile(
  chartType: DashboardDefaultCuratedChartType,
  order: number,
  size: { columns: number; rows: number } = { columns: 1, rows: 1 },
): TileChartSettingsInterface {
  if (chartType === DASHBOARD_RECOVERY_NOW_CHART_TYPE) {
    return {
      name: 'Recovery',
      type: TileTypes.Chart,
      order,
      size,
      chartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE as unknown as ChartTypes,
      dataType: DataRecoveryTime.type,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Auto,
    };
  }

  if (chartType === DASHBOARD_FORM_CHART_TYPE) {
    return {
      name: 'Form',
      type: TileTypes.Chart,
      order,
      size,
      chartType: DASHBOARD_FORM_CHART_TYPE as unknown as ChartTypes,
      dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Daily,
    };
  }

  const chartNameByType: Record<
    Exclude<DashboardDefaultCuratedChartType, typeof DASHBOARD_RECOVERY_NOW_CHART_TYPE | typeof DASHBOARD_FORM_CHART_TYPE>,
    string
  > = {
    [DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE]: 'Freshness Forecast',
    [DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE]: 'Intensity Distribution',
    [DASHBOARD_EFFICIENCY_TREND_CHART_TYPE]: 'Efficiency Trend',
  };

  return {
    name: chartNameByType[chartType],
    type: TileTypes.Chart,
    order,
    size,
    chartType: chartType as unknown as ChartTypes,
    dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType: ChartDataCategoryTypes.DateType,
    dataTimeInterval: TimeIntervals.Weekly,
  };
}

export function buildDashboardKpiAutoTile(
  chartType: DashboardKpiChartType,
  order: number,
  size: { columns: number; rows: number } = { columns: 1, rows: 1 },
): TileChartSettingsInterface {
  const definition = getDashboardKpiChartDefinitions().find(candidate => candidate.chartType === chartType);
  return {
    name: definition?.label || `${chartType}`,
    type: TileTypes.Chart,
    order,
    size,
    chartType: chartType as unknown as ChartTypes,
    dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType: ChartDataCategoryTypes.DateType,
    dataTimeInterval: TimeIntervals.Weekly,
  };
}

export function isDashboardSleepTrendTile(tile: TileSettingsInterface | null | undefined): boolean {
  if (!tile || tile.type !== TileTypes.Chart) {
    return false;
  }

  const chartTile = tile as TileChartSettingsInterface;
  return `${chartTile.chartType}` === DASHBOARD_SLEEP_TREND_CHART_TYPE;
}

export function isDashboardCuratedAutoTile(
  tile: TileSettingsInterface | null | undefined,
  chartType: DashboardDefaultCuratedChartType,
): boolean {
  if (!tile || tile.type !== TileTypes.Chart) {
    return false;
  }

  return `${(tile as TileChartSettingsInterface).chartType}` === chartType;
}

export function isDashboardKpiAutoTile(
  tile: TileSettingsInterface | null | undefined,
  chartType: DashboardKpiChartType,
): boolean {
  if (!tile || tile.type !== TileTypes.Chart) {
    return false;
  }

  return `${(tile as TileChartSettingsInterface).chartType}` === chartType;
}

export function getDashboardAutoTileDescriptorForTile(
  tile: TileSettingsInterface | null | undefined,
): DashboardAutoTileDescriptor | null {
  if (isDashboardSleepTrendTile(tile)) {
    return {
      id: DASHBOARD_AUTO_TILE_SLEEP_TREND_ID,
      source: DASHBOARD_AUTO_TILE_SLEEP_TREND_SOURCE,
    };
  }

  if (!tile || tile.type !== TileTypes.Chart) {
    return null;
  }

  const chartType = `${(tile as TileChartSettingsInterface).chartType}` as DashboardDefaultCuratedChartType | DashboardKpiChartType;
  const curatedId = DASHBOARD_AUTO_TILE_CURATED_ID_BY_CHART_TYPE[chartType as DashboardDefaultCuratedChartType];
  if (curatedId) {
    return { id: curatedId, source: DASHBOARD_AUTO_TILE_CURATED_SOURCE };
  }

  const kpiId = DASHBOARD_AUTO_TILE_KPI_ID_BY_CHART_TYPE[chartType as DashboardKpiChartType];
  return kpiId ? { id: kpiId, source: DASHBOARD_AUTO_TILE_KPI_SOURCE } : null;
}

export function markDashboardAutoTileAdded(
  dashboardSettings: AppDashboardSettingsInterface,
  id: string,
  source: string,
  timestampMs: number,
  lastQualifiedAtMs = timestampMs,
): void {
  const autoTiles = ensureDashboardAutoTiles(dashboardSettings);
  autoTiles[id] = {
    state: 'added',
    addedAt: timestampMs,
    lastQualifiedAt: lastQualifiedAtMs,
    source,
  };
}

export function markDashboardAutoTileDismissed(
  dashboardSettings: AppDashboardSettingsInterface,
  id: string,
  source: string,
  timestampMs: number,
): void {
  const autoTiles = ensureDashboardAutoTiles(dashboardSettings);
  autoTiles[id] = {
    state: 'dismissed',
    dismissedAt: timestampMs,
    source,
  };
}

export function ensureDashboardAutoTiles(
  dashboardSettings: AppDashboardSettingsInterface,
): Record<string, AppDashboardAutoTileState | undefined> {
  dashboardSettings.autoTiles = dashboardSettings.autoTiles || {};
  return dashboardSettings.autoTiles as Record<string, AppDashboardAutoTileState | undefined>;
}
