import type { ChartTypes } from '@sports-alliance/sports-lib';
import type { AppDashboardMapTileSource } from '../models/app-user.interface';
import {
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_POWER_CURVE_CHART_TYPE,
} from './dashboard-special-chart-types';

export interface DashboardTileDefaultSize {
  columns: number;
  rows: number;
}

export const DASHBOARD_DEFAULT_TILE_SIZE: DashboardTileDefaultSize = { columns: 1, rows: 1 };
export const DASHBOARD_WIDE_TILE_SIZE: DashboardTileDefaultSize = { columns: 2, rows: 1 };

export function getDefaultDashboardChartTileSizeForChartType(
  chartType: ChartTypes | string | null | undefined,
): DashboardTileDefaultSize {
  const normalizedChartType = `${chartType || ''}`;
  if (
    normalizedChartType === DASHBOARD_FORM_CHART_TYPE
    || normalizedChartType === DASHBOARD_POWER_CURVE_CHART_TYPE
  ) {
    return cloneDashboardTileDefaultSize(DASHBOARD_WIDE_TILE_SIZE);
  }

  return cloneDashboardTileDefaultSize(DASHBOARD_DEFAULT_TILE_SIZE);
}

export function getDefaultDashboardMapTileSizeForSource(
  mapSource: AppDashboardMapTileSource | string | null | undefined,
): DashboardTileDefaultSize {
  return cloneDashboardTileDefaultSize(
    mapSource === 'routes' ? DASHBOARD_WIDE_TILE_SIZE : DASHBOARD_DEFAULT_TILE_SIZE,
  );
}

export function cloneDashboardTileDefaultSize(size: DashboardTileDefaultSize): DashboardTileDefaultSize {
  return {
    columns: size.columns,
    rows: size.rows,
  };
}
