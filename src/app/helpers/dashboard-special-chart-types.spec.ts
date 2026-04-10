import { ChartTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  getDashboardCuratedChartDefinitions,
  getDashboardKpiChartDefinitions,
  isDashboardCuratedChartType,
  isDashboardFormChartType,
  isDashboardKpiChartType,
  isDashboardRecoveryNowChartType,
  resolveDashboardChartCategory,
} from './dashboard-special-chart-types';

describe('dashboard-special-chart-types', () => {
  it('identifies recovery and form chart types as curated', () => {
    expect(isDashboardRecoveryNowChartType(DASHBOARD_RECOVERY_NOW_CHART_TYPE)).toBe(true);
    expect(isDashboardFormChartType(DASHBOARD_FORM_CHART_TYPE)).toBe(true);
    expect(isDashboardCuratedChartType(DASHBOARD_RECOVERY_NOW_CHART_TYPE)).toBe(true);
    expect(isDashboardCuratedChartType(DASHBOARD_FORM_CHART_TYPE)).toBe(true);
  });

  it('classifies curated and custom chart types into categories', () => {
    expect(resolveDashboardChartCategory(DASHBOARD_RECOVERY_NOW_CHART_TYPE)).toBe('curated');
    expect(resolveDashboardChartCategory(DASHBOARD_FORM_CHART_TYPE)).toBe('curated');
    expect(resolveDashboardChartCategory(DASHBOARD_ACWR_KPI_CHART_TYPE)).toBe('kpi');
    expect(resolveDashboardChartCategory(ChartTypes.ColumnsVertical)).toBe('custom');
  });

  it('returns curated chart definitions', () => {
    const definitions = getDashboardCuratedChartDefinitions();

    expect(definitions.map(definition => definition.chartType)).toEqual([
      DASHBOARD_RECOVERY_NOW_CHART_TYPE,
      DASHBOARD_FORM_CHART_TYPE,
      DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
      DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
      DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
    ]);
  });

  it('returns KPI chart definitions and guards', () => {
    const definitions = getDashboardKpiChartDefinitions();

    expect(definitions.map(definition => definition.chartType)).toEqual([
      DASHBOARD_ACWR_KPI_CHART_TYPE,
      DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
      DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
    ]);
    expect(isDashboardKpiChartType(DASHBOARD_ACWR_KPI_CHART_TYPE)).toBe(true);
    expect(isDashboardKpiChartType(DASHBOARD_RAMP_RATE_KPI_CHART_TYPE)).toBe(true);
    expect(isDashboardKpiChartType(DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE)).toBe(true);
  });
});
