import { ChartTypes } from '@sports-alliance/sports-lib';

export const DASHBOARD_RECOVERY_NOW_CHART_TYPE = 'RecoveryNowPie' as const;
export const DASHBOARD_FORM_CHART_TYPE = 'Form' as const;
export const DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE = 'FreshnessForecast' as const;
export const DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE = 'IntensityDistribution' as const;
export const DASHBOARD_EFFICIENCY_TREND_CHART_TYPE = 'EfficiencyTrend' as const;
export const DASHBOARD_ACWR_KPI_CHART_TYPE = 'KpiAcwr' as const;
export const DASHBOARD_RAMP_RATE_KPI_CHART_TYPE = 'KpiRampRate' as const;
export const DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE = 'KpiMonotonyStrain' as const;

export type DashboardRecoveryNowChartType = typeof DASHBOARD_RECOVERY_NOW_CHART_TYPE;
export type DashboardFormChartType = typeof DASHBOARD_FORM_CHART_TYPE;
export type DashboardFreshnessForecastChartType = typeof DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE;
export type DashboardIntensityDistributionChartType = typeof DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE;
export type DashboardEfficiencyTrendChartType = typeof DASHBOARD_EFFICIENCY_TREND_CHART_TYPE;
export type DashboardKpiAcwrChartType = typeof DASHBOARD_ACWR_KPI_CHART_TYPE;
export type DashboardKpiRampRateChartType = typeof DASHBOARD_RAMP_RATE_KPI_CHART_TYPE;
export type DashboardKpiMonotonyStrainChartType = typeof DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE;

export type DashboardCuratedChartType =
  | DashboardRecoveryNowChartType
  | DashboardFormChartType
  | DashboardFreshnessForecastChartType
  | DashboardIntensityDistributionChartType
  | DashboardEfficiencyTrendChartType;

export type DashboardKpiChartType =
  | DashboardKpiAcwrChartType
  | DashboardKpiRampRateChartType
  | DashboardKpiMonotonyStrainChartType;

export type DashboardSpecialChartType = DashboardCuratedChartType | DashboardKpiChartType;
export type DashboardChartType = ChartTypes | DashboardSpecialChartType;
export type DashboardChartCategory = 'curated' | 'kpi' | 'custom';

export interface DashboardCuratedChartDefinition {
  chartType: DashboardCuratedChartType;
  label: string;
}

export interface DashboardKpiChartDefinition {
  chartType: DashboardKpiChartType;
  label: string;
}

const DASHBOARD_CURATED_CHART_DEFINITIONS: DashboardCuratedChartDefinition[] = [
  {
    chartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE,
    label: 'Recovery',
  },
  {
    chartType: DASHBOARD_FORM_CHART_TYPE,
    label: 'Form (TSS)',
  },
  {
    chartType: DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
    label: 'Freshness Forecast',
  },
  {
    chartType: DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
    label: 'Intensity Distribution',
  },
  {
    chartType: DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
    label: 'Efficiency Trend',
  },
];

const DASHBOARD_KPI_CHART_DEFINITIONS: DashboardKpiChartDefinition[] = [
  {
    chartType: DASHBOARD_ACWR_KPI_CHART_TYPE,
    label: 'ACWR',
  },
  {
    chartType: DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
    label: 'Ramp Rate',
  },
  {
    chartType: DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
    label: 'Monotony / Strain',
  },
];

export function isDashboardRecoveryNowChartType(chartType: unknown): chartType is DashboardRecoveryNowChartType {
  return `${chartType}` === DASHBOARD_RECOVERY_NOW_CHART_TYPE;
}

export function isDashboardFormChartType(chartType: unknown): chartType is DashboardFormChartType {
  return `${chartType}` === DASHBOARD_FORM_CHART_TYPE;
}

export function isDashboardFreshnessForecastChartType(chartType: unknown): chartType is DashboardFreshnessForecastChartType {
  return `${chartType}` === DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE;
}

export function isDashboardIntensityDistributionChartType(chartType: unknown): chartType is DashboardIntensityDistributionChartType {
  return `${chartType}` === DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE;
}

export function isDashboardEfficiencyTrendChartType(chartType: unknown): chartType is DashboardEfficiencyTrendChartType {
  return `${chartType}` === DASHBOARD_EFFICIENCY_TREND_CHART_TYPE;
}

export function isDashboardCuratedChartType(chartType: unknown): chartType is DashboardCuratedChartType {
  return isDashboardRecoveryNowChartType(chartType)
    || isDashboardFormChartType(chartType)
    || isDashboardFreshnessForecastChartType(chartType)
    || isDashboardIntensityDistributionChartType(chartType)
    || isDashboardEfficiencyTrendChartType(chartType);
}

export function isDashboardAcwrKpiChartType(chartType: unknown): chartType is DashboardKpiAcwrChartType {
  return `${chartType}` === DASHBOARD_ACWR_KPI_CHART_TYPE;
}

export function isDashboardRampRateKpiChartType(chartType: unknown): chartType is DashboardKpiRampRateChartType {
  return `${chartType}` === DASHBOARD_RAMP_RATE_KPI_CHART_TYPE;
}

export function isDashboardMonotonyStrainKpiChartType(chartType: unknown): chartType is DashboardKpiMonotonyStrainChartType {
  return `${chartType}` === DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE;
}

export function isDashboardKpiChartType(chartType: unknown): chartType is DashboardKpiChartType {
  return isDashboardAcwrKpiChartType(chartType)
    || isDashboardRampRateKpiChartType(chartType)
    || isDashboardMonotonyStrainKpiChartType(chartType);
}

export function isDashboardSpecialChartType(chartType: unknown): chartType is DashboardSpecialChartType {
  return isDashboardCuratedChartType(chartType) || isDashboardKpiChartType(chartType);
}

export function resolveDashboardChartCategory(chartType: unknown): DashboardChartCategory {
  if (isDashboardCuratedChartType(chartType)) {
    return 'curated';
  }
  if (isDashboardKpiChartType(chartType)) {
    return 'kpi';
  }
  return 'custom';
}

export function getDashboardCuratedChartDefinitions(): DashboardCuratedChartDefinition[] {
  return [...DASHBOARD_CURATED_CHART_DEFINITIONS];
}

export function getDashboardKpiChartDefinitions(): DashboardKpiChartDefinition[] {
  return [...DASHBOARD_KPI_CHART_DEFINITIONS];
}
