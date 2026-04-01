import { ChartTypes } from '@sports-alliance/sports-lib';

export const DASHBOARD_RECOVERY_NOW_CHART_TYPE = 'RecoveryNowPie' as const;
export type DashboardRecoveryNowChartType = typeof DASHBOARD_RECOVERY_NOW_CHART_TYPE;
export type DashboardChartType = ChartTypes | DashboardRecoveryNowChartType;

export function isDashboardRecoveryNowChartType(chartType: unknown): chartType is DashboardRecoveryNowChartType {
  return `${chartType}` === DASHBOARD_RECOVERY_NOW_CHART_TYPE;
}
