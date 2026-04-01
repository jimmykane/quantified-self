import { ChartTypes } from '@sports-alliance/sports-lib';

export const DASHBOARD_RECOVERY_NOW_CHART_TYPE = 'RecoveryNowPie' as const;
export const DASHBOARD_FORM_CHART_TYPE = 'Form' as const;
export type DashboardRecoveryNowChartType = typeof DASHBOARD_RECOVERY_NOW_CHART_TYPE;
export type DashboardFormChartType = typeof DASHBOARD_FORM_CHART_TYPE;
export type DashboardChartType = ChartTypes | DashboardRecoveryNowChartType | DashboardFormChartType;

export function isDashboardRecoveryNowChartType(chartType: unknown): chartType is DashboardRecoveryNowChartType {
  return `${chartType}` === DASHBOARD_RECOVERY_NOW_CHART_TYPE;
}

export function isDashboardFormChartType(chartType: unknown): chartType is DashboardFormChartType {
  return `${chartType}` === DASHBOARD_FORM_CHART_TYPE;
}
