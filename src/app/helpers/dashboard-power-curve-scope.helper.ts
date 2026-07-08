import {
  ActivityTypeGroups,
  ActivityTypes,
  type ActivityTypeGroup,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TileChartSettingsInterface,
  TileSettingsInterface,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { getActivityTypesForGroup } from '@shared/activity-type-group.metadata';
import {
  AppDashboardAutoTileId,
  AppDashboardChartTileSettingsInterface,
  AppDashboardTileEventFiltersInterface,
} from '../models/app-user.interface';
import { DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE } from './dashboard-form.helper';
import { DASHBOARD_POWER_CURVE_CHART_TYPE } from './dashboard-special-chart-types';
import { normalizeDashboardTileEventFilters } from './dashboard-tile-event-filters.helper';
import { getDefaultDashboardChartTileDisplaySettingsForChartType } from './dashboard-chart-display-settings.helper';
import { getDefaultDashboardChartTileSizeForChartType } from './dashboard-tile-default-size.helper';

export type DashboardPowerCurveScope = 'cycling' | 'running';

export interface DashboardPowerCurveScopeDefinition {
  scope: DashboardPowerCurveScope;
  autoTileId: AppDashboardAutoTileId;
  source: string;
  label: string;
  latestSeriesLabel: string;
  activityGroups: ActivityTypeGroup[];
}

export const DASHBOARD_POWER_CURVE_CYCLING_AUTO_TILE_ID: AppDashboardAutoTileId = 'powerCurve';
export const DASHBOARD_POWER_CURVE_RUNNING_AUTO_TILE_ID: AppDashboardAutoTileId = 'runningPowerCurve';
export const DASHBOARD_POWER_CURVE_CYCLING_SOURCE = 'power-curve';
export const DASHBOARD_POWER_CURVE_RUNNING_SOURCE = 'running-power-curve';
export const DASHBOARD_POWER_CURVE_DEFAULT_RANGE = '1y' as const;

const DASHBOARD_POWER_CURVE_SCOPE_DEFINITIONS: Record<DashboardPowerCurveScope, DashboardPowerCurveScopeDefinition> = {
  cycling: {
    scope: 'cycling',
    autoTileId: DASHBOARD_POWER_CURVE_CYCLING_AUTO_TILE_ID,
    source: DASHBOARD_POWER_CURVE_CYCLING_SOURCE,
    label: 'Cycling Power Curve',
    latestSeriesLabel: 'Latest cycling activity',
    activityGroups: [ActivityTypeGroups.CyclingGroup, ActivityTypeGroups.MountainBikingGroup],
  },
  running: {
    scope: 'running',
    autoTileId: DASHBOARD_POWER_CURVE_RUNNING_AUTO_TILE_ID,
    source: DASHBOARD_POWER_CURVE_RUNNING_SOURCE,
    label: 'Running Power Curve',
    latestSeriesLabel: 'Latest running activity',
    activityGroups: [ActivityTypeGroups.RunningGroup, ActivityTypeGroups.TrailRunningGroup],
  },
};

export function getDashboardPowerCurveScopeDefinitions(): DashboardPowerCurveScopeDefinition[] {
  return [
    DASHBOARD_POWER_CURVE_SCOPE_DEFINITIONS.cycling,
    DASHBOARD_POWER_CURVE_SCOPE_DEFINITIONS.running,
  ];
}

export function getDashboardPowerCurveScopeDefinition(scope: DashboardPowerCurveScope): DashboardPowerCurveScopeDefinition {
  return DASHBOARD_POWER_CURVE_SCOPE_DEFINITIONS[scope];
}

export function getDashboardPowerCurveActivityTypes(scope: DashboardPowerCurveScope): ActivityTypes[] {
  const definition = getDashboardPowerCurveScopeDefinition(scope);
  const activityTypes = new Set<ActivityTypes>();
  definition.activityGroups.forEach((activityGroup) => {
    getActivityTypesForGroup(activityGroup).forEach(activityType => activityTypes.add(activityType));
  });
  return [...activityTypes];
}

export function getDashboardPowerCurveEventFiltersForScope(
  scope: DashboardPowerCurveScope,
): AppDashboardTileEventFiltersInterface {
  return {
    range: DASHBOARD_POWER_CURVE_DEFAULT_RANGE,
    activityTypes: getDashboardPowerCurveActivityTypes(scope),
  };
}

export function buildDashboardPowerCurveAutoTileForScope(
  scope: DashboardPowerCurveScope,
  order: number,
  size: { columns: number; rows: number } = getDefaultDashboardChartTileSizeForChartType(DASHBOARD_POWER_CURVE_CHART_TYPE),
): AppDashboardChartTileSettingsInterface {
  const definition = getDashboardPowerCurveScopeDefinition(scope);
  const displaySettings = getDefaultDashboardChartTileDisplaySettingsForChartType(DASHBOARD_POWER_CURVE_CHART_TYPE);
  return {
    name: definition.label,
    type: TileTypes.Chart,
    order,
    size,
    chartType: DASHBOARD_POWER_CURVE_CHART_TYPE as unknown as ChartTypes,
    dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType: ChartDataCategoryTypes.DateType,
    dataTimeInterval: TimeIntervals.Weekly,
    eventFilters: getDashboardPowerCurveEventFiltersForScope(scope),
    ...(displaySettings ? { displaySettings } : {}),
  };
}

export function isDashboardPowerCurveTile(tile: TileSettingsInterface | null | undefined): tile is TileChartSettingsInterface {
  return !!tile
    && tile.type === TileTypes.Chart
    && `${(tile as TileChartSettingsInterface).chartType}` === DASHBOARD_POWER_CURVE_CHART_TYPE;
}

export function isDashboardPowerCurveTileForScope(
  tile: TileSettingsInterface | null | undefined,
  scope: DashboardPowerCurveScope,
): boolean {
  return resolveDashboardPowerCurveTileScope(tile) === scope;
}

export function resolveDashboardPowerCurveTileScope(
  tile: TileSettingsInterface | null | undefined,
): DashboardPowerCurveScope | null {
  if (!isDashboardPowerCurveTile(tile)) {
    return null;
  }

  const normalizedFilters = normalizeDashboardTileEventFilters(
    (tile as AppDashboardChartTileSettingsInterface).eventFilters,
    DASHBOARD_POWER_CURVE_DEFAULT_RANGE,
    [],
  );
  const filterScope = resolvePowerCurveScopeFromActivityTypes(normalizedFilters.activityTypes);
  if (filterScope) {
    return filterScope;
  }
  if (normalizedFilters.activityTypes.length > 0) {
    return null;
  }

  const tileName = `${(tile as AppDashboardChartTileSettingsInterface).name || ''}`.trim().toLowerCase();
  if (tileName.includes('running')) {
    return 'running';
  }
  if (tileName.includes('cycling')) {
    return 'cycling';
  }

  return 'cycling';
}

export function isLegacyDefaultDashboardPowerCurveTile(
  tile: TileSettingsInterface | null | undefined,
): boolean {
  if (!isDashboardPowerCurveTile(tile)) {
    return false;
  }

  const chartTile = tile as AppDashboardChartTileSettingsInterface;
  const normalizedFilters = normalizeDashboardTileEventFilters(chartTile.eventFilters, DASHBOARD_POWER_CURVE_DEFAULT_RANGE, []);
  const tileName = `${chartTile.name || ''}`.trim();
  return (!tileName || tileName === 'Power Curve')
    && normalizedFilters.range === DASHBOARD_POWER_CURVE_DEFAULT_RANGE
    && normalizedFilters.activityTypes.length === 0;
}

function resolvePowerCurveScopeFromActivityTypes(activityTypes: ActivityTypes[]): DashboardPowerCurveScope | null {
  if (!activityTypes.length) {
    return null;
  }

  const matchingScopes = getDashboardPowerCurveScopeDefinitions()
    .filter(definition => activityTypesEveryBelongsToScope(activityTypes, definition.scope))
    .map(definition => definition.scope);
  return matchingScopes.length === 1 ? matchingScopes[0] : null;
}

function activityTypesEveryBelongsToScope(
  activityTypes: ActivityTypes[],
  scope: DashboardPowerCurveScope,
): boolean {
  const scopeActivityTypes = new Set(getDashboardPowerCurveActivityTypes(scope));
  return activityTypes.every(activityType => scopeActivityTypes.has(activityType));
}
