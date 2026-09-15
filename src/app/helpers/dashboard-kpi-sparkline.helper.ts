import type { DashboardChartTileViewModel } from './dashboard-tile-view-model.helper';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE,
  DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE,
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE,
  DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
  DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE,
  DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
} from './dashboard-special-chart-types';

export type DashboardKpiContext = { chartType: string } & Partial<Pick<DashboardChartTileViewModel,
  'acwr' | 'rampRate' | 'monotonyStrain' | 'formNow' | 'fitnessCtl' | 'fatigueAtl' | 'formPlus7d'
  | 'easyPercent' | 'hardPercent' | 'efficiencyDelta4w' | 'aerobicCapacity' | 'aerobicDurability'>>;

export interface KpiSparklineStyle { lineColor: string; areaColor: string; areaOpacity: number; }

/** One source for the full tile, selected preview and decorative list sparkline. */
export function resolveDashboardKpiTrend(input: DashboardKpiContext): Array<{ time: number; value: number | null }> {
  switch (input.chartType) {
    case DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE: return input.aerobicCapacity?.trend || [];
    case DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE: return input.aerobicDurability?.trend || [];
    case DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE:
    case DASHBOARD_FORM_NOW_KPI_CHART_TYPE:
    case DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE: return input.formNow?.trend8Weeks || [];
    case DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE:
    case DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE: return input.fitnessCtl?.trend8Weeks || [];
    case DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE:
    case DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE: return input.fatigueAtl?.trend8Weeks || [];
    case DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE: return input.formPlus7d?.trend8Weeks || [];
    case DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE: return input.hardPercent?.trend8Weeks || input.easyPercent?.trend8Weeks || [];
    case DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE: return input.easyPercent?.trend8Weeks || [];
    case DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE: return input.hardPercent?.trend8Weeks || [];
    case DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE: return input.efficiencyDelta4w?.trend8Weeks || [];
    case DASHBOARD_RAMP_RATE_KPI_CHART_TYPE: return input.rampRate?.trend8Weeks || [];
    case DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE: return input.monotonyStrain?.trend8Weeks || [];
    default: return input.acwr?.trend8Weeks || [];
  }
}

export function resolveDashboardKpiTrendDelta(trend: ReadonlyArray<{ value: number | null | undefined }>, pointsAgo: number): number | null {
  const values = trend.filter(point => point.value !== null && point.value !== undefined && Number.isFinite(Number(point.value)))
    .map(point => Number(point.value));
  return values.length < 2 ? null : values.at(-1)! - values[Math.max(0, values.length - 1 - pointsAgo)];
}

export function resolveDashboardKpiSparklineStyle(input: DashboardKpiContext, fallbackColor: string): KpiSparklineStyle {
  const positiveColor = resolveDashboardKpiThemeColor('--mat-sys-primary', '#1b7f38');
  const negativeColor = resolveDashboardKpiThemeColor('--mat-sys-error', '#c62828');
  const neutralColor = resolveDashboardKpiThemeColor('--mat-sys-secondary', '#2c6cb0');
  const readinessColor = resolveDashboardKpiThemeColor('--mat-sys-tertiary', '#7a3db8');
  const hardLoadColor = resolveDashboardKpiThemeColor('--mat-sys-error', '#e65100');
  const monotonyColor = resolveDashboardKpiThemeColor('--mat-sys-secondary', '#7b5e57');

  if (
    input.chartType === DASHBOARD_FORM_NOW_KPI_CHART_TYPE
    || input.chartType === DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE
    || input.chartType === DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE
  ) {
    const readinessValue = input.chartType === DASHBOARD_FORM_NOW_KPI_CHART_TYPE
      ? input.formNow?.value ?? null
      : input.chartType === DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE
        ? input.formPlus7d?.value ?? null
        : input.formNow?.value ?? null;
    return {
      lineColor: resolveDirectionalColor(readinessValue, {
        positiveColor,
        negativeColor,
        neutralColor: readinessColor,
        neutralThreshold: 1,
      }),
      areaColor: readinessColor,
      areaOpacity: 0.16,
    };
  }

  if (
    input.chartType === DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE
    || input.chartType === DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE
  ) {
    return {
      lineColor: positiveColor,
      areaColor: positiveColor,
      areaOpacity: 0.16,
    };
  }

  if (input.chartType === DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE) {
    return {
      lineColor: hardLoadColor,
      areaColor: hardLoadColor,
      areaOpacity: 0.14,
    };
  }

  if (input.chartType === DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE) {
    const deltaValue = input.efficiencyDelta4w?.deltaAbs ?? null;
    return {
      lineColor: resolveDirectionalColor(deltaValue, {
        positiveColor,
        negativeColor,
        neutralColor,
        neutralThreshold: 0.02,
      }),
      areaColor: neutralColor,
      areaOpacity: 0.14,
    };
  }

  if (input.chartType === DASHBOARD_RAMP_RATE_KPI_CHART_TYPE) {
    return {
      lineColor: resolveDirectionalColor(input.rampRate?.rampRate ?? null, {
        positiveColor,
        negativeColor,
        neutralColor,
        neutralThreshold: 0.15,
      }),
      areaColor: neutralColor,
      areaOpacity: 0.14,
    };
  }

  if (input.chartType === DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE) {
    return {
      lineColor: resolveDirectionalColor(input.formNow?.value ?? null, {
        positiveColor,
        negativeColor,
        neutralColor,
        neutralThreshold: 5,
      }),
      areaColor: neutralColor,
      areaOpacity: 0.14,
    };
  }

  if (input.chartType === DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE) {
    const fitnessDelta = resolveDashboardKpiTrendDelta(input.fitnessCtl?.trend8Weeks || [], 4);
    return {
      lineColor: resolveDirectionalColor(fitnessDelta, {
        positiveColor,
        negativeColor,
        neutralColor,
        neutralThreshold: 0.5,
      }),
      areaColor: neutralColor,
      areaOpacity: 0.14,
    };
  }

  if (input.chartType === DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE) {
    const fatigueDelta = resolveDashboardKpiTrendDelta(input.fatigueAtl?.trend8Weeks || [], 1);
    return {
      lineColor: resolveDirectionalColor(fatigueDelta, {
        positiveColor: hardLoadColor,
        negativeColor: positiveColor,
        neutralColor,
        neutralThreshold: 0.5,
      }),
      areaColor: hardLoadColor,
      areaOpacity: 0.12,
    };
  }

  if (
    input.chartType === DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE
    || input.chartType === DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE
  ) {
    return {
      lineColor: neutralColor,
      areaColor: neutralColor,
      areaOpacity: 0.14,
    };
  }

  if (input.chartType === DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE) {
    return {
      lineColor: monotonyColor,
      areaColor: monotonyColor,
      areaOpacity: 0.12,
    };
  }

  if (input.chartType === DASHBOARD_ACWR_KPI_CHART_TYPE) {
    const acwrRatio = input.acwr?.ratio ?? null;
    // Training-risk zones: <0.8 too low stimulus, >1.3 spike risk.
    if (Number.isFinite(acwrRatio as number) && (acwrRatio as number) > 1.3) {
      return {
        lineColor: negativeColor,
        areaColor: negativeColor,
        areaOpacity: 0.14,
      };
    }
    if (Number.isFinite(acwrRatio as number) && (acwrRatio as number) < 0.8) {
      return {
        lineColor: resolveDashboardKpiThemeColor('--mat-sys-tertiary', '#8854d0'),
        areaColor: resolveDashboardKpiThemeColor('--mat-sys-tertiary', '#8854d0'),
        areaOpacity: 0.12,
      };
    }
    return {
      lineColor: positiveColor,
      areaColor: positiveColor,
      areaOpacity: 0.16,
    };
  }

  return {
    lineColor: fallbackColor,
    areaColor: fallbackColor,
    areaOpacity: 0.12,
  };
}

export function resolveDashboardKpiThemeColor(cssVariableName: string, fallbackColor: string): string {
  if (typeof window === 'undefined') {
    return fallbackColor;
  }
  const color = window.getComputedStyle(document.documentElement)
    .getPropertyValue(cssVariableName)
    .trim();
  if (!color || color.startsWith('var(')) {
    return fallbackColor;
  }
  return color;
}

function resolveDirectionalColor(
  value: number | null | undefined,
  options: {
    positiveColor: string;
    negativeColor: string;
    neutralColor: string;
    neutralThreshold: number;
  },
): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return options.neutralColor;
  }
  if (numericValue > options.neutralThreshold) {
    return options.positiveColor;
  }
  if (numericValue < -options.neutralThreshold) {
    return options.negativeColor;
  }
  return options.neutralColor;
}

