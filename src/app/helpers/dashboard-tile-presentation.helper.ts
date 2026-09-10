import { TileTypes } from '@sports-alliance/sports-lib';
import { DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE, isDashboardKpiChartType } from './dashboard-special-chart-types';

export type DashboardTileKind = 'chart' | 'kpi' | 'map' | 'calendar' | 'tile';

/** UI terminology, independent of persisted renderer types (KPIs and calendars use Chart). */
function presentation(kind: DashboardTileKind, label: string, singular: string, plural: string) {
  return {
    kind, label, singular, plural,
    add: `Add ${singular}`,
    edit: `Edit ${singular}`,
    remove: `Remove ${singular}`,
    settings: `${label} settings`,
    properties: `${label} properties`,
    preview: `${label} preview`,
    actions: `${label} actions`,
    back: `Back to ${singular}`,
  } as const;
}

export const DASHBOARD_TILE_PRESENTATIONS = {
  chart: presentation('chart', 'Chart', 'chart', 'charts'),
  kpi: presentation('kpi', 'KPI', 'KPI', 'KPIs'),
  map: presentation('map', 'Map', 'map', 'maps'),
  calendar: presentation('calendar', 'Calendar', 'calendar', 'calendars'),
  tile: presentation('tile', 'Tile', 'tile', 'tiles'),
} as const;

export type DashboardTilePresentation = typeof DASHBOARD_TILE_PRESENTATIONS[DashboardTileKind];
type TilePresentationInput = { type?: TileTypes; chartType?: string };

export function resolveDashboardTilePresentation(tile: TilePresentationInput | null | undefined): DashboardTilePresentation {
  if (tile?.type === TileTypes.Map) return DASHBOARD_TILE_PRESENTATIONS.map;
  if (tile?.type !== TileTypes.Chart) return DASHBOARD_TILE_PRESENTATIONS.tile;
  if (isDashboardKpiChartType(tile.chartType)) return DASHBOARD_TILE_PRESENTATIONS.kpi;
  if (tile.chartType === DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE) return DASHBOARD_TILE_PRESENTATIONS.calendar;
  return DASHBOARD_TILE_PRESENTATIONS.chart;
}

/** Use the full section catalog so availability and search never change the section's terminology. */
export function resolveDashboardTileCollectionPresentation(tiles: readonly TilePresentationInput[]): DashboardTilePresentation {
  const kinds = new Set(tiles.map(tile => resolveDashboardTilePresentation(tile).kind));
  return kinds.size === 1 ? DASHBOARD_TILE_PRESENTATIONS[kinds.values().next().value!] : DASHBOARD_TILE_PRESENTATIONS.tile;
}
