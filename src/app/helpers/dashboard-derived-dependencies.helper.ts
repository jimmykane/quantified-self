import type { TileSettingsInterface } from '@sports-alliance/sports-lib';
import { DERIVED_METRIC_KINDS as M, type DerivedMetricKind } from '@shared/derived-metrics';
import * as K from './dashboard-special-chart-types';

// Dashboard rendering and picker previews share the same snapshot dependencies.
const metricKinds: Partial<Record<string, readonly DerivedMetricKind[]>> = {
  [K.DASHBOARD_RECOVERY_NOW_CHART_TYPE]: [M.RecoveryNow],
  [K.DASHBOARD_FORM_CHART_TYPE]: [M.Form],
  [K.DASHBOARD_ACWR_KPI_CHART_TYPE]: [M.Acwr],
  [K.DASHBOARD_RAMP_RATE_KPI_CHART_TYPE]: [M.RampRate],
  [K.DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE]: [M.MonotonyStrain],
  [K.DASHBOARD_FORM_NOW_KPI_CHART_TYPE]: [M.FormNow, M.Form, M.RampRate],
  [K.DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE]: [M.FormNow, M.Form, M.RampRate],
  [K.DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE]: [M.Form],
  [K.DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE]: [M.Form],
  [K.DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE]: [M.Form],
  [K.DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE]: [M.Form],
  [K.DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE]: [M.FormNow, M.FreshnessForecast, M.FormPlus7d],
  [K.DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE]: [M.FormPlus7d],
  [K.DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE]: [M.EasyPercent],
  [K.DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE]: [M.HardPercent],
  [K.DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE]: [M.IntensityDistribution, M.EasyPercent, M.HardPercent],
  [K.DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE]: [M.EfficiencyDelta4w],
  [K.DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE]: [M.FreshnessForecast],
  [K.DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE]: [M.IntensityDistribution],
  [K.DASHBOARD_EFFICIENCY_TREND_CHART_TYPE]: [M.EfficiencyTrend],
  [K.DASHBOARD_POWER_CURVE_CHART_TYPE]: [M.PowerCurve],
  [K.DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE]: [M.TrainingCapacity],
  [K.DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE]: [M.TrainingDurability],
  [K.DASHBOARD_DURABILITY_CHART_TYPE]: [M.TrainingDurability],
};

export function dashboardTileMetricKinds(tile: TileSettingsInterface): DerivedMetricKind[] {
  if (K.isDashboardPowerCapacityChartType(tile['chartType'])) return [M.TrainingPowerSystems];
  return [...(metricKinds[tile['chartType']] || [])];
}
