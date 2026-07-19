import { ChartTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE,
  DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE,
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
  DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_POWER_CURVE_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
} from './dashboard-special-chart-types';
import { resolveDashboardChartInfoTooltip } from './dashboard-chart-info.helper';

const SUPPORTED_CHART_TYPES = [
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
  DASHBOARD_POWER_CURVE_CHART_TYPE,
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
  DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE,
  DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE,
  DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE,
] as const;

describe('dashboard-chart-info.helper', () => {
  it('returns info copy for every special derived chart and KPI type', () => {
    for (const chartType of SUPPORTED_CHART_TYPES) {
      const tooltip = resolveDashboardChartInfoTooltip(chartType);
      expect(typeof tooltip).toBe('string');
      expect((tooltip ?? '').trim().length).toBeGreaterThan(20);
    }
  });

  it('returns null for custom chart types', () => {
    expect(resolveDashboardChartInfoTooltip(ChartTypes.ColumnsVertical)).toBeNull();
    expect(resolveDashboardChartInfoTooltip(null)).toBeNull();
    expect(resolveDashboardChartInfoTooltip(undefined)).toBeNull();
  });

  it('documents formula context for form and ACWR cards', () => {
    const formInfo = resolveDashboardChartInfoTooltip(DASHBOARD_FORM_CHART_TYPE);
    const acwrInfo = resolveDashboardChartInfoTooltip(DASHBOARD_ACWR_KPI_CHART_TYPE);
    const fitnessInfo = resolveDashboardChartInfoTooltip(DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE);
    const fatigueInfo = resolveDashboardChartInfoTooltip(DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE);

    expect(formInfo).toContain('CTL');
    expect(formInfo).toContain('ATL');
    expect(formInfo).toContain('same-day');
    expect(formInfo).toContain('previous CTL');
    expect(acwrInfo).toContain('7 days');
    expect(acwrInfo).toContain('28 days');
    expect(fitnessInfo).toContain('42-day');
    expect(fatigueInfo).toContain('7-day');
  });

  it('documents the sleep vitals range averages', () => {
    const sleepInfo = resolveDashboardChartInfoTooltip(DASHBOARD_SLEEP_TREND_CHART_TYPE);

    expect(sleepInfo).toContain('average heart rate');
    expect(sleepInfo).toContain('minimum heart rate');
    expect(sleepInfo).toContain('selected range average');
  });
});
