import {
  ChartDataCategoryTypes,
  DataAscent,
  DataDistance,
  DataDuration,
  DataEnergy,
  DataHeartRateAvg,
  DataPower,
  DataRecoveryTime,
  TileChartSettingsInterface,
  TileSettingsInterface,
  TileTypes,
} from '@sports-alliance/sports-lib';
import {
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_POWER_CURVE_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
  isDashboardKpiChartType,
  type DashboardKpiGroup,
} from './dashboard-special-chart-types';
import {
  DASHBOARD_FORM_LEGACY_TRAINING_STRESS_SCORE_TYPE,
  DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
} from './dashboard-form.helper';
import {
  DASHBOARD_KPI_GROUP_ORDER,
  getDashboardKpiGroupLaneKey,
  resolveDashboardKpiTileGroup,
} from './dashboard-kpi-group.helper';

export type DashboardTileSectionId =
  | 'trainingState'
  | 'performancePower'
  | 'activityOverview'
  | 'routesMaps'
  | 'custom';

export interface DashboardTileSectionDefinition {
  id: DashboardTileSectionId;
  label: string;
  icon: string;
}

export type DashboardTileKpiLaneKey = `kpi:${DashboardKpiGroup}`;
export type DashboardTileLaneKey = DashboardTileKpiLaneKey | `section:${DashboardTileSectionId}`;

export const DASHBOARD_TILE_SECTION_DEFINITIONS: DashboardTileSectionDefinition[] = [
  { id: 'trainingState', label: 'Training State', icon: 'fitness_center' },
  { id: 'performancePower', label: 'Performance & Power', icon: 'speed' },
  { id: 'activityOverview', label: 'Activity Overview', icon: 'insights' },
  { id: 'routesMaps', label: 'Routes & Maps', icon: 'map' },
  { id: 'custom', label: 'Custom Charts', icon: 'dashboard_customize' },
];

export const DASHBOARD_TILE_SECTION_ORDER: DashboardTileSectionId[] =
  DASHBOARD_TILE_SECTION_DEFINITIONS.map(definition => definition.id);

const SPECIAL_CHART_SECTION_BY_TYPE: Record<string, DashboardTileSectionId> = {
  [DASHBOARD_FORM_CHART_TYPE]: 'trainingState',
  [DASHBOARD_POWER_CURVE_CHART_TYPE]: 'performancePower',
  [DASHBOARD_EFFICIENCY_TREND_CHART_TYPE]: 'performancePower',
  [DASHBOARD_RECOVERY_NOW_CHART_TYPE]: 'trainingState',
  [DASHBOARD_SLEEP_TREND_CHART_TYPE]: 'trainingState',
  [DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE]: 'trainingState',
  [DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE]: 'trainingState',
};

const ACTIVITY_OVERVIEW_DATA_TYPES = new Set<string>([
  DataDistance.type,
  DataDuration.type,
  DataAscent.type,
  DataEnergy.type,
]);

const TRAINING_LOAD_DATA_TYPES = new Set<string>([
  DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
  DASHBOARD_FORM_LEGACY_TRAINING_STRESS_SCORE_TYPE,
]);

export function getDashboardTileSectionDefinition(
  sectionId: DashboardTileSectionId,
): DashboardTileSectionDefinition {
  return DASHBOARD_TILE_SECTION_DEFINITIONS.find(definition => definition.id === sectionId)
    || DASHBOARD_TILE_SECTION_DEFINITIONS[DASHBOARD_TILE_SECTION_DEFINITIONS.length - 1];
}

export function resolveDashboardTileSection(tile: TileSettingsInterface | null | undefined): DashboardTileSectionId {
  if (!tile) {
    return 'custom';
  }

  if (tile.type === TileTypes.Map) {
    return 'routesMaps';
  }

  if (tile.type !== TileTypes.Chart) {
    return 'custom';
  }

  const chartTile = tile as TileChartSettingsInterface;
  const specialChartSection = SPECIAL_CHART_SECTION_BY_TYPE[`${chartTile.chartType}`];
  if (specialChartSection) {
    return specialChartSection;
  }

  return resolveCustomDashboardChartSection(chartTile);
}

export function resolveDashboardTileLaneKey(tile: TileSettingsInterface | null | undefined): DashboardTileLaneKey {
  if (
    tile?.type === TileTypes.Chart
    && isDashboardKpiChartType((tile as TileChartSettingsInterface).chartType)
  ) {
    return getDashboardKpiGroupLaneKey(resolveDashboardKpiTileGroup(tile) || 'load');
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
    ...DASHBOARD_KPI_GROUP_ORDER.flatMap(groupId => tilesByLane.get(getDashboardKpiGroupLaneKey(groupId)) || []),
    ...DASHBOARD_TILE_SECTION_ORDER.flatMap(sectionId => tilesByLane.get(`section:${sectionId}`) || []),
  ];
}

function resolveCustomDashboardChartSection(tile: TileChartSettingsInterface): DashboardTileSectionId {
  const dataType = `${tile.dataType || ''}`.trim();
  if (!dataType) {
    return 'custom';
  }

  if (isTrainingLoadDataType(dataType)) {
    return 'trainingState';
  }

  if (isPowerDataType(dataType)) {
    return 'performancePower';
  }

  if (dataType === DataRecoveryTime.type) {
    return 'trainingState';
  }

  if (
    ACTIVITY_OVERVIEW_DATA_TYPES.has(dataType)
    || (
      dataType === DataHeartRateAvg.type
      && tile.dataCategoryType === ChartDataCategoryTypes.ActivityType
    )
  ) {
    return 'activityOverview';
  }

  return 'custom';
}

function isTrainingLoadDataType(dataType: string): boolean {
  if (TRAINING_LOAD_DATA_TYPES.has(dataType)) {
    return true;
  }

  const normalizedDataType = dataType.toLowerCase();
  return normalizedDataType.includes('training stress')
    || normalizedDataType === 'tss';
}

function isPowerDataType(dataType: string): boolean {
  if (dataType === DataPower.type) {
    return true;
  }

  return dataType.toLowerCase().includes('power');
}
