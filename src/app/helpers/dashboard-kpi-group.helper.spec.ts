import { TileTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
} from './dashboard-special-chart-types';
import {
  DASHBOARD_KPI_GROUP_ORDER,
  normalizeDashboardKpiGroup,
  resolveDashboardKpiTileGroup,
  resolveDefaultDashboardKpiGroupForChartType,
} from './dashboard-kpi-group.helper';

describe('dashboard-kpi-group.helper', () => {
  it('keeps the reader-facing KPI group order stable', () => {
    expect(DASHBOARD_KPI_GROUP_ORDER).toEqual(['readiness', 'load', 'trends', 'intensity']);
  });

  it('resolves default groups from KPI chart type', () => {
    expect(resolveDefaultDashboardKpiGroupForChartType(DASHBOARD_FORM_NOW_KPI_CHART_TYPE)).toBe('readiness');
    expect(resolveDefaultDashboardKpiGroupForChartType(DASHBOARD_ACWR_KPI_CHART_TYPE)).toBe('load');
    expect(resolveDefaultDashboardKpiGroupForChartType(DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE)).toBe('trends');
    expect(resolveDefaultDashboardKpiGroupForChartType(DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE)).toBe('intensity');
  });

  it('uses a valid saved KPI group before falling back to chart type defaults', () => {
    expect(resolveDashboardKpiTileGroup({
      type: TileTypes.Chart,
      chartType: DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
      kpiGroup: 'intensity',
    } as any)).toBe('intensity');

    expect(resolveDashboardKpiTileGroup({
      type: TileTypes.Chart,
      chartType: DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
      kpiGroup: 'legacy',
    } as any)).toBe('readiness');
  });

  it('normalizes unknown group values to a fallback', () => {
    expect(normalizeDashboardKpiGroup('trends')).toBe('trends');
    expect(normalizeDashboardKpiGroup('old', 'readiness')).toBe('readiness');
  });
});
