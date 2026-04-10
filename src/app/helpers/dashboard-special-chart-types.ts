import { ChartTypes } from '@sports-alliance/sports-lib';

export const DASHBOARD_RECOVERY_NOW_CHART_TYPE = 'RecoveryNowPie' as const;
export const DASHBOARD_FORM_CHART_TYPE = 'Form' as const;
export type DashboardRecoveryNowChartType = typeof DASHBOARD_RECOVERY_NOW_CHART_TYPE;
export type DashboardFormChartType = typeof DASHBOARD_FORM_CHART_TYPE;
export type DashboardCuratedChartType = DashboardRecoveryNowChartType | DashboardFormChartType;
export type DashboardChartType = ChartTypes | DashboardCuratedChartType;
export type DashboardChartCategory = 'curated' | 'custom';

export interface DashboardCuratedChartDefinition {
  chartType: DashboardCuratedChartType;
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
];

export function isDashboardRecoveryNowChartType(chartType: unknown): chartType is DashboardRecoveryNowChartType {
  return `${chartType}` === DASHBOARD_RECOVERY_NOW_CHART_TYPE;
}

export function isDashboardFormChartType(chartType: unknown): chartType is DashboardFormChartType {
  return `${chartType}` === DASHBOARD_FORM_CHART_TYPE;
}

export function isDashboardCuratedChartType(chartType: unknown): chartType is DashboardCuratedChartType {
  return isDashboardRecoveryNowChartType(chartType) || isDashboardFormChartType(chartType);
}

export function resolveDashboardChartCategory(chartType: unknown): DashboardChartCategory {
  return isDashboardCuratedChartType(chartType) ? 'curated' : 'custom';
}

export function getDashboardCuratedChartDefinitions(): DashboardCuratedChartDefinition[] {
  return [...DASHBOARD_CURATED_CHART_DEFINITIONS];
}
