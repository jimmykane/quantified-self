import { ChartTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  getDashboardCuratedChartDefinitions,
  isDashboardCuratedChartType,
  isDashboardFormChartType,
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
    expect(resolveDashboardChartCategory(ChartTypes.ColumnsVertical)).toBe('custom');
  });

  it('returns curated chart definitions for recovery and form', () => {
    const definitions = getDashboardCuratedChartDefinitions();

    expect(definitions).toEqual([
      { chartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE, label: 'Recovery' },
      { chartType: DASHBOARD_FORM_CHART_TYPE, label: 'Form (TSS)' },
    ]);
  });
});
