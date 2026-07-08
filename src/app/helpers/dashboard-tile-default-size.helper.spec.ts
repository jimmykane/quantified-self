import { ChartTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_POWER_CURVE_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
} from './dashboard-special-chart-types';
import {
  cloneDashboardTileDefaultSize,
  DASHBOARD_DEFAULT_TILE_SIZE,
  DASHBOARD_WIDE_TILE_SIZE,
  getDefaultDashboardChartTileSizeForChartType,
  getDefaultDashboardMapTileSizeForSource,
} from './dashboard-tile-default-size.helper';

describe('dashboard-tile-default-size.helper', () => {
  it('defaults Form/TSS and Power Curve to wide one-row chart tiles', () => {
    expect(getDefaultDashboardChartTileSizeForChartType(DASHBOARD_FORM_CHART_TYPE)).toEqual(DASHBOARD_WIDE_TILE_SIZE);
    expect(getDefaultDashboardChartTileSizeForChartType(DASHBOARD_POWER_CURVE_CHART_TYPE)).toEqual(DASHBOARD_WIDE_TILE_SIZE);
  });

  it('keeps simple, KPI, and sleep chart defaults compact', () => {
    expect(getDefaultDashboardChartTileSizeForChartType(ChartTypes.ColumnsHorizontal)).toEqual(DASHBOARD_DEFAULT_TILE_SIZE);
    expect(getDefaultDashboardChartTileSizeForChartType(DASHBOARD_SLEEP_TREND_CHART_TYPE)).toEqual(DASHBOARD_DEFAULT_TILE_SIZE);
    expect(getDefaultDashboardChartTileSizeForChartType(null)).toEqual(DASHBOARD_DEFAULT_TILE_SIZE);
  });

  it('defaults route maps to wide one-row tiles and event maps to compact tiles', () => {
    expect(getDefaultDashboardMapTileSizeForSource('routes')).toEqual(DASHBOARD_WIDE_TILE_SIZE);
    expect(getDefaultDashboardMapTileSizeForSource('events')).toEqual(DASHBOARD_DEFAULT_TILE_SIZE);
    expect(getDefaultDashboardMapTileSizeForSource(null)).toEqual(DASHBOARD_DEFAULT_TILE_SIZE);
  });

  it('returns cloned size objects so callers cannot mutate shared constants', () => {
    const size = cloneDashboardTileDefaultSize(DASHBOARD_WIDE_TILE_SIZE);
    size.columns = 9;

    expect(DASHBOARD_WIDE_TILE_SIZE).toEqual({ columns: 2, rows: 1 });
    expect(getDefaultDashboardChartTileSizeForChartType(DASHBOARD_FORM_CHART_TYPE)).toEqual({ columns: 2, rows: 1 });
  });
});
