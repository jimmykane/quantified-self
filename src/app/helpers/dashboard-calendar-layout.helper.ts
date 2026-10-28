import { TileTypes, type TileSettingsInterface, type TileChartSettingsInterface } from '@sports-alliance/sports-lib';
import type { AppDashboardSettingsInterface } from '../models/app-user.interface';
import { DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE } from './dashboard-special-chart-types';

export const DASHBOARD_CALENDAR_DAY_CONTEXT_LAYOUT_VERSION = 1;
export const DASHBOARD_CALENDAR_DAY_CONTEXT_SIZE = { columns: 4, rows: 1 } as const;

/** An explicit version prevents a later user resize from being migrated again. */
export function migrateDashboardCalendarDayContextLayout(
  settings: AppDashboardSettingsInterface | null | undefined,
): { tiles: TileSettingsInterface[]; calendarDayContextLayoutVersion: number } | null {
  if (!settings || (settings.calendarDayContextLayoutVersion ?? 0) >= DASHBOARD_CALENDAR_DAY_CONTEXT_LAYOUT_VERSION) return null;
  const tiles = settings.tiles || [];
  if (!tiles.some(tile => tile.type === TileTypes.Chart
    && `${(tile as TileChartSettingsInterface).chartType}` === DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE)) return null;
  return {
    calendarDayContextLayoutVersion: DASHBOARD_CALENDAR_DAY_CONTEXT_LAYOUT_VERSION,
    tiles: tiles.map(tile => tile.type === TileTypes.Chart
      && `${(tile as TileChartSettingsInterface).chartType}` === DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE
      ? { ...tile, size: { ...DASHBOARD_CALENDAR_DAY_CONTEXT_SIZE } }
      : tile),
  };
}
