import { ChartTypes } from '@sports-alliance/sports-lib';

export const DASHBOARD_RECOVERY_NOW_CHART_TYPE = 'RecoveryNowPie' as const;
export const DASHBOARD_FORM_CHART_TYPE = 'Form' as const;
export const DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE = 'FreshnessForecast' as const;
export const DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE = 'IntensityDistribution' as const;
export const DASHBOARD_EFFICIENCY_TREND_CHART_TYPE = 'EfficiencyTrend' as const;
export const DASHBOARD_SLEEP_TREND_CHART_TYPE = 'SleepTrend' as const;
export const DASHBOARD_POWER_CURVE_CHART_TYPE = 'PowerCurve' as const;
export const DASHBOARD_ACWR_KPI_CHART_TYPE = 'KpiAcwr' as const;
export const DASHBOARD_RAMP_RATE_KPI_CHART_TYPE = 'KpiRampRate' as const;
export const DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE = 'KpiMonotonyStrain' as const;
export const DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE = 'KpiLoadStatus' as const;
export const DASHBOARD_FORM_NOW_KPI_CHART_TYPE = 'KpiFormNow' as const;
export const DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE = 'KpiFitnessCtl' as const;
export const DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE = 'KpiFatigueAtl' as const;
export const DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE = 'KpiFitnessTrend' as const;
export const DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE = 'KpiFatigueTrend' as const;
export const DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE = 'KpiRecoveryDebt' as const;
export const DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE = 'KpiFormPlus7d' as const;
export const DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE = 'KpiTrainingBalance' as const;
export const DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE = 'KpiEasyPercent' as const;
export const DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE = 'KpiHardPercent' as const;
export const DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE = 'KpiEfficiencyDelta4w' as const;
export const DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE = 'KpiAerobicCapacity' as const;
export const DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE = 'KpiAerobicDurability' as const;
// Retired before release. Keep the raw value narrowly recognizable so local
// preview settings can be cleaned without treating it as an active KPI type.
export const RETIRED_DASHBOARD_READINESS_CONFIDENCE_KPI_CHART_TYPE = 'KpiReadinessConfidence' as const;

export type DashboardRecoveryNowChartType = typeof DASHBOARD_RECOVERY_NOW_CHART_TYPE;
export type DashboardFormChartType = typeof DASHBOARD_FORM_CHART_TYPE;
export type DashboardFreshnessForecastChartType = typeof DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE;
export type DashboardIntensityDistributionChartType = typeof DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE;
export type DashboardEfficiencyTrendChartType = typeof DASHBOARD_EFFICIENCY_TREND_CHART_TYPE;
export type DashboardSleepTrendChartType = typeof DASHBOARD_SLEEP_TREND_CHART_TYPE;
export type DashboardPowerCurveChartType = typeof DASHBOARD_POWER_CURVE_CHART_TYPE;
export type DashboardKpiAcwrChartType = typeof DASHBOARD_ACWR_KPI_CHART_TYPE;
export type DashboardKpiRampRateChartType = typeof DASHBOARD_RAMP_RATE_KPI_CHART_TYPE;
export type DashboardKpiMonotonyStrainChartType = typeof DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE;
export type DashboardKpiLoadStatusChartType = typeof DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE;
export type DashboardKpiFormNowChartType = typeof DASHBOARD_FORM_NOW_KPI_CHART_TYPE;
export type DashboardKpiFitnessCtlChartType = typeof DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE;
export type DashboardKpiFatigueAtlChartType = typeof DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE;
export type DashboardKpiFitnessTrendChartType = typeof DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE;
export type DashboardKpiFatigueTrendChartType = typeof DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE;
export type DashboardKpiRecoveryDebtChartType = typeof DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE;
export type DashboardKpiFormPlus7dChartType = typeof DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE;
export type DashboardKpiTrainingBalanceChartType = typeof DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE;
export type DashboardKpiEasyPercentChartType = typeof DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE;
export type DashboardKpiHardPercentChartType = typeof DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE;
export type DashboardKpiEfficiencyDelta4wChartType = typeof DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE;
export type DashboardKpiAerobicCapacityChartType = typeof DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE;
export type DashboardKpiAerobicDurabilityChartType = typeof DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE;

export type DashboardCuratedChartType =
  | DashboardRecoveryNowChartType
  | DashboardFormChartType
  | DashboardFreshnessForecastChartType
  | DashboardIntensityDistributionChartType
  | DashboardEfficiencyTrendChartType
  | DashboardSleepTrendChartType
  | DashboardPowerCurveChartType;

export type DashboardRecommendedCuratedChartType =
  | DashboardFormChartType
  | DashboardIntensityDistributionChartType;

export type DashboardKpiChartType =
  | DashboardKpiAcwrChartType
  | DashboardKpiRampRateChartType
  | DashboardKpiMonotonyStrainChartType
  | DashboardKpiLoadStatusChartType
  | DashboardKpiFormNowChartType
  | DashboardKpiFitnessCtlChartType
  | DashboardKpiFatigueAtlChartType
  | DashboardKpiFitnessTrendChartType
  | DashboardKpiFatigueTrendChartType
  | DashboardKpiRecoveryDebtChartType
  | DashboardKpiFormPlus7dChartType
  | DashboardKpiTrainingBalanceChartType
  | DashboardKpiEasyPercentChartType
  | DashboardKpiHardPercentChartType
  | DashboardKpiEfficiencyDelta4wChartType
  | DashboardKpiAerobicCapacityChartType
  | DashboardKpiAerobicDurabilityChartType;

export type DashboardSpecialChartType = DashboardCuratedChartType | DashboardKpiChartType;
export type DashboardChartType = ChartTypes | DashboardSpecialChartType;
export type DashboardChartCategory = 'curated' | 'kpi' | 'custom';
export type DashboardKpiGroup = 'load' | 'readiness' | 'execution';

export interface DashboardCuratedChartDefinition {
  chartType: DashboardCuratedChartType;
  label: string;
}

export interface DashboardRecommendedCuratedChartDefinition extends DashboardCuratedChartDefinition {
  chartType: DashboardRecommendedCuratedChartType;
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
  {
    chartType: DASHBOARD_SLEEP_TREND_CHART_TYPE,
    label: 'Sleep',
  },
  {
    chartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
    label: 'Power Curve',
  },
];

const DASHBOARD_DEFAULT_CURATED_CHART_TYPES: DashboardRecommendedCuratedChartType[] = [
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
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
    chartType: DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
    label: 'Load Status',
    group: 'readiness',
  },
  {
    chartType: DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
    label: 'Form Now',
    group: 'readiness',
  },
  {
    chartType: DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
    label: 'Fitness (CTL)',
    group: 'readiness',
  },
  {
    chartType: DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE,
    label: 'Fatigue (ATL)',
    group: 'readiness',
  },
  {
    chartType: DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE,
    label: 'Fitness Trend',
    group: 'load',
  },
  {
    chartType: DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE,
    label: 'Fatigue Trend',
    group: 'load',
  },
  {
    chartType: DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE,
    label: 'Recovery Debt',
    group: 'readiness',
  },
  {
    chartType: DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
    label: 'Form +7d',
    group: 'readiness',
  },
  {
    chartType: DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
    label: 'Training Balance',
    group: 'execution',
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
  {
    chartType: DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE,
    label: 'Aerobic Capacity',
    group: 'execution',
  },
  {
    chartType: DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE,
    label: 'Aerobic Durability',
    group: 'execution',
  },
];

const DASHBOARD_DEFAULT_KPI_CHART_TYPES: DashboardKpiChartType[] = [
  DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE,
  DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE,
  DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
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

export function isDashboardSleepTrendChartType(chartType: unknown): chartType is DashboardSleepTrendChartType {
  return `${chartType}` === DASHBOARD_SLEEP_TREND_CHART_TYPE;
}

export function isDashboardPowerCurveChartType(chartType: unknown): chartType is DashboardPowerCurveChartType {
  return `${chartType}` === DASHBOARD_POWER_CURVE_CHART_TYPE;
}

export function isDashboardAerobicCapacityKpiChartType(chartType: unknown): chartType is DashboardKpiAerobicCapacityChartType {
  return `${chartType}` === DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE;
}

export function isDashboardAerobicDurabilityKpiChartType(chartType: unknown): chartType is DashboardKpiAerobicDurabilityChartType {
  return `${chartType}` === DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE;
}

export function isRetiredDashboardReadinessConfidenceKpiChartType(
  chartType: unknown,
): chartType is typeof RETIRED_DASHBOARD_READINESS_CONFIDENCE_KPI_CHART_TYPE {
  return `${chartType}` === RETIRED_DASHBOARD_READINESS_CONFIDENCE_KPI_CHART_TYPE;
}

export function isDashboardCuratedChartType(chartType: unknown): chartType is DashboardCuratedChartType {
  return isDashboardRecoveryNowChartType(chartType)
    || isDashboardFormChartType(chartType)
    || isDashboardFreshnessForecastChartType(chartType)
    || isDashboardIntensityDistributionChartType(chartType)
    || isDashboardEfficiencyTrendChartType(chartType)
    || isDashboardSleepTrendChartType(chartType)
    || isDashboardPowerCurveChartType(chartType);
}

export function isDashboardEventBackedSpecialChartType(_chartType: unknown): _chartType is never {
  return false;
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

export function isDashboardLoadStatusKpiChartType(chartType: unknown): chartType is DashboardKpiLoadStatusChartType {
  return `${chartType}` === DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE;
}

export function isDashboardFormNowKpiChartType(chartType: unknown): chartType is DashboardKpiFormNowChartType {
  return `${chartType}` === DASHBOARD_FORM_NOW_KPI_CHART_TYPE;
}

export function isDashboardFitnessCtlKpiChartType(chartType: unknown): chartType is DashboardKpiFitnessCtlChartType {
  return `${chartType}` === DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE;
}

export function isDashboardFatigueAtlKpiChartType(chartType: unknown): chartType is DashboardKpiFatigueAtlChartType {
  return `${chartType}` === DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE;
}

export function isDashboardFitnessTrendKpiChartType(chartType: unknown): chartType is DashboardKpiFitnessTrendChartType {
  return `${chartType}` === DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE;
}

export function isDashboardFatigueTrendKpiChartType(chartType: unknown): chartType is DashboardKpiFatigueTrendChartType {
  return `${chartType}` === DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE;
}

export function isDashboardRecoveryDebtKpiChartType(chartType: unknown): chartType is DashboardKpiRecoveryDebtChartType {
  return `${chartType}` === DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE;
}

export function isDashboardFormPlus7dKpiChartType(chartType: unknown): chartType is DashboardKpiFormPlus7dChartType {
  return `${chartType}` === DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE;
}

export function isDashboardTrainingBalanceKpiChartType(chartType: unknown): chartType is DashboardKpiTrainingBalanceChartType {
  return `${chartType}` === DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE;
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
    || isDashboardLoadStatusKpiChartType(chartType)
    || isDashboardFormNowKpiChartType(chartType)
    || isDashboardFitnessCtlKpiChartType(chartType)
    || isDashboardFatigueAtlKpiChartType(chartType)
    || isDashboardFitnessTrendKpiChartType(chartType)
    || isDashboardFatigueTrendKpiChartType(chartType)
    || isDashboardRecoveryDebtKpiChartType(chartType)
    || isDashboardFormPlus7dKpiChartType(chartType)
    || isDashboardTrainingBalanceKpiChartType(chartType)
    || isDashboardEasyPercentKpiChartType(chartType)
    || isDashboardHardPercentKpiChartType(chartType)
    || isDashboardEfficiencyDelta4wKpiChartType(chartType)
    || isDashboardAerobicCapacityKpiChartType(chartType)
    || isDashboardAerobicDurabilityKpiChartType(chartType);
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

export function getDefaultDashboardCuratedChartDefinitions(): DashboardRecommendedCuratedChartDefinition[] {
  return DASHBOARD_DEFAULT_CURATED_CHART_TYPES.map((chartType) => {
    const definition = DASHBOARD_CURATED_CHART_DEFINITIONS.find(candidate => candidate.chartType === chartType);
    if (!definition) {
      throw new Error(`Missing dashboard curated chart definition for ${chartType}`);
    }
    return definition as DashboardRecommendedCuratedChartDefinition;
  });
}

export function getDashboardKpiChartDefinitions(): DashboardKpiChartDefinition[] {
  return [...DASHBOARD_KPI_CHART_DEFINITIONS];
}

export function getDefaultDashboardKpiChartDefinitions(): DashboardKpiChartDefinition[] {
  return DASHBOARD_DEFAULT_KPI_CHART_TYPES
    .map(chartType => DASHBOARD_KPI_CHART_DEFINITIONS.find(definition => definition.chartType === chartType))
    .filter((definition): definition is DashboardKpiChartDefinition => !!definition);
}
