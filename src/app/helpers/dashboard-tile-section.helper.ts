import {
  TileChartSettingsInterface,
  TileSettingsInterface,
  TileTypes,
} from '@sports-alliance/sports-lib';
import {
  DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE,
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_POWER_CURVE_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
  isDashboardKpiChartType,
} from './dashboard-special-chart-types';

export type DashboardTileSectionId =
  | 'trainingState'
  | 'performancePower'
  | 'activityOverview'
  | 'routesMaps';

export interface DashboardTileSectionDefinition {
  id: DashboardTileSectionId;
  label: string;
  icon: string;
}

export type DashboardTileLaneKey = 'kpi' | `section:${DashboardTileSectionId}`;

export const DASHBOARD_TILE_SECTION_DEFINITIONS: DashboardTileSectionDefinition[] = [
  { id: 'trainingState', label: 'Training State', icon: 'fitness_center' },
  { id: 'performancePower', label: 'Performance & Power', icon: 'speed' },
  { id: 'activityOverview', label: 'Activity Overview', icon: 'insights' },
  { id: 'routesMaps', label: 'Routes & Maps', icon: 'map' },
];

export const DASHBOARD_TILE_SECTION_ORDER: DashboardTileSectionId[] =
  DASHBOARD_TILE_SECTION_DEFINITIONS.map(definition => definition.id);

const SPECIAL_CHART_SECTION_BY_TYPE: Record<string, DashboardTileSectionId> = {
  [DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE]: 'activityOverview',
  [DASHBOARD_FORM_CHART_TYPE]: 'trainingState',
  [DASHBOARD_POWER_CURVE_CHART_TYPE]: 'performancePower',
  [DASHBOARD_EFFICIENCY_TREND_CHART_TYPE]: 'performancePower',
  [DASHBOARD_RECOVERY_NOW_CHART_TYPE]: 'trainingState',
  [DASHBOARD_SLEEP_TREND_CHART_TYPE]: 'trainingState',
  [DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE]: 'trainingState',
  [DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE]: 'trainingState',
};

export function getDashboardTileSectionDefinition(
  sectionId: DashboardTileSectionId,
): DashboardTileSectionDefinition {
  return DASHBOARD_TILE_SECTION_DEFINITIONS.find(definition => definition.id === sectionId)
    || DASHBOARD_TILE_SECTION_DEFINITIONS.find(definition => definition.id === 'activityOverview')!;
}

export function resolveDashboardTileSection(tile: TileSettingsInterface | null | undefined): DashboardTileSectionId {
  if (!tile) {
    return 'activityOverview';
  }

  if (tile.type === TileTypes.Map) {
    return 'routesMaps';
  }

  if (tile.type !== TileTypes.Chart) {
    return 'activityOverview';
  }

  const chartTile = tile as TileChartSettingsInterface;
  const specialChartSection = SPECIAL_CHART_SECTION_BY_TYPE[`${chartTile.chartType}`];
  if (specialChartSection) {
    return specialChartSection;
  }

  // All user-configured activity metrics share one home, regardless of metric type.
  return 'activityOverview';
}

export function resolveDashboardTileLaneKey(tile: TileSettingsInterface | null | undefined): DashboardTileLaneKey {
  if (
    tile?.type === TileTypes.Chart
    && isDashboardKpiChartType((tile as TileChartSettingsInterface).chartType)
  ) {
    return 'kpi';
  }

  return `section:${resolveDashboardTileSection(tile)}`;
}

export function orderDashboardTilesByIntentSections<T extends TileSettingsInterface>(tiles: T[]): T[] {
  const tilesByLane = new Map<DashboardTileLaneKey, T[]>();
  tiles.forEach((tile) => {
    const laneKey = resolveDashboardTileLaneKey(tile);
    tilesByLane.set(laneKey, [...(tilesByLane.get(laneKey) || []), tile]);
  });

  return [
    ...(tilesByLane.get('kpi') || []),
    ...DASHBOARD_TILE_SECTION_ORDER.flatMap(sectionId => tilesByLane.get(`section:${sectionId}`) || []),
  ];
}
