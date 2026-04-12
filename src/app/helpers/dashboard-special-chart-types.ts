import { ChartTypes } from '@sports-alliance/sports-lib';

export const DASHBOARD_RECOVERY_NOW_CHART_TYPE = 'RecoveryNowPie' as const;
export const DASHBOARD_FORM_CHART_TYPE = 'Form' as const;
export const DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE = 'FreshnessForecast' as const;
export const DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE = 'IntensityDistribution' as const;
export const DASHBOARD_EFFICIENCY_TREND_CHART_TYPE = 'EfficiencyTrend' as const;
export const DASHBOARD_ACWR_KPI_CHART_TYPE = 'KpiAcwr' as const;
export const DASHBOARD_RAMP_RATE_KPI_CHART_TYPE = 'KpiRampRate' as const;
export const DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE = 'KpiMonotonyStrain' as const;
export const DASHBOARD_FORM_NOW_KPI_CHART_TYPE = 'KpiFormNow' as const;
export const DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE = 'KpiFormPlus7d' as const;
export const DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE = 'KpiEasyPercent' as const;
export const DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE = 'KpiHardPercent' as const;
export const DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE = 'KpiEfficiencyDelta4w' as const;

export type DashboardRecoveryNowChartType = typeof DASHBOARD_RECOVERY_NOW_CHART_TYPE;
export type DashboardFormChartType = typeof DASHBOARD_FORM_CHART_TYPE;
export type DashboardFreshnessForecastChartType = typeof DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE;
export type DashboardIntensityDistributionChartType = typeof DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE;
export type DashboardEfficiencyTrendChartType = typeof DASHBOARD_EFFICIENCY_TREND_CHART_TYPE;
export type DashboardKpiAcwrChartType = typeof DASHBOARD_ACWR_KPI_CHART_TYPE;
export type DashboardKpiRampRateChartType = typeof DASHBOARD_RAMP_RATE_KPI_CHART_TYPE;
export type DashboardKpiMonotonyStrainChartType = typeof DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE;
export type DashboardKpiFormNowChartType = typeof DASHBOARD_FORM_NOW_KPI_CHART_TYPE;
export type DashboardKpiFormPlus7dChartType = typeof DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE;
export type DashboardKpiEasyPercentChartType = typeof DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE;
export type DashboardKpiHardPercentChartType = typeof DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE;
export type DashboardKpiEfficiencyDelta4wChartType = typeof DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE;

export type DashboardCuratedChartType =
  | DashboardRecoveryNowChartType
  | DashboardFormChartType
  | DashboardFreshnessForecastChartType
  | DashboardIntensityDistributionChartType
  | DashboardEfficiencyTrendChartType;

export type DashboardKpiChartType =
  | DashboardKpiAcwrChartType
  | DashboardKpiRampRateChartType
  | DashboardKpiMonotonyStrainChartType
  | DashboardKpiFormNowChartType
  | DashboardKpiFormPlus7dChartType
  | DashboardKpiEasyPercentChartType
  | DashboardKpiHardPercentChartType
  | DashboardKpiEfficiencyDelta4wChartType;

export type DashboardSpecialChartType = DashboardCuratedChartType | DashboardKpiChartType;
export type DashboardChartType = ChartTypes | DashboardSpecialChartType;
export type DashboardChartCategory = 'curated' | 'kpi' | 'custom';
export type DashboardKpiGroup = 'load' | 'readiness' | 'execution';

export interface DashboardCuratedChartDefinition {
  chartType: DashboardCuratedChartType;
  label: string;
}

export interface DashboardKpiChartDefinition {
  chartType: DashboardKpiChartType;
  label: string;
  group: DashboardKpiGroup;
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
    group: 'load',
  },
  {
    chartType: DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
    label: 'Ramp Rate',
    group: 'load',
  },
  {
    chartType: DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
    label: 'Monotony / Strain',
    group: 'load',
  },
  {
    chartType: DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
    label: 'Form Now',
    group: 'readiness',
  },
  {
    chartType: DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
    label: 'Form +7d',
    group: 'readiness',
  },
  {
    chartType: DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
    label: 'Easy %',
    group: 'execution',
  },
  {
    chartType: DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
    label: 'Hard %',
    group: 'execution',
  },
  {
    chartType: DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
    label: 'Efficiency Δ (4w)',
    group: 'execution',
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

export function isDashboardFormNowKpiChartType(chartType: unknown): chartType is DashboardKpiFormNowChartType {
  return `${chartType}` === DASHBOARD_FORM_NOW_KPI_CHART_TYPE;
}

export function isDashboardFormPlus7dKpiChartType(chartType: unknown): chartType is DashboardKpiFormPlus7dChartType {
  return `${chartType}` === DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE;
}

export function isDashboardEasyPercentKpiChartType(chartType: unknown): chartType is DashboardKpiEasyPercentChartType {
  return `${chartType}` === DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE;
}

export function isDashboardHardPercentKpiChartType(chartType: unknown): chartType is DashboardKpiHardPercentChartType {
  return `${chartType}` === DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE;
}

export function isDashboardEfficiencyDelta4wKpiChartType(chartType: unknown): chartType is DashboardKpiEfficiencyDelta4wChartType {
  return `${chartType}` === DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE;
}

export function isDashboardKpiChartType(chartType: unknown): chartType is DashboardKpiChartType {
  return isDashboardAcwrKpiChartType(chartType)
    || isDashboardRampRateKpiChartType(chartType)
    || isDashboardMonotonyStrainKpiChartType(chartType)
    || isDashboardFormNowKpiChartType(chartType)
    || isDashboardFormPlus7dKpiChartType(chartType)
    || isDashboardEasyPercentKpiChartType(chartType)
    || isDashboardHardPercentKpiChartType(chartType)
    || isDashboardEfficiencyDelta4wKpiChartType(chartType);
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
