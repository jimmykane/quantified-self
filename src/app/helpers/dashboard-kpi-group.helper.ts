import {
  TileChartSettingsInterface,
  TileSettingsInterface,
  TileTypes,
} from '@sports-alliance/sports-lib';
import type { AppDashboardChartTileSettingsInterface } from '../models/app-user.interface';
import {
  getDashboardKpiChartDefinitions,
  isDashboardKpiChartType,
  type DashboardKpiChartType,
  type DashboardKpiGroup,
} from './dashboard-special-chart-types';

export interface DashboardKpiGroupDefinition {
  id: DashboardKpiGroup;
  label: string;
  icon: string;
  description: string;
}

export const DASHBOARD_KPI_GROUP_DEFINITIONS: DashboardKpiGroupDefinition[] = [
  {
    id: 'readiness',
    label: 'Readiness',
    icon: 'self_improvement',
    description: 'Current and projected form KPIs',
  },
  {
    id: 'load',
    label: 'Load',
    icon: 'fitness_center',
    description: 'Fitness, fatigue, and workload control KPIs',
  },
  {
    id: 'trends',
    label: 'Trends',
    icon: 'trending_up',
    description: 'Recent direction and efficiency change KPIs',
  },
  {
    id: 'intensity',
    label: 'Intensity',
    icon: 'speed',
    description: 'Easy, hard, and balance execution KPIs',
  },
];

export const DASHBOARD_KPI_GROUP_ORDER: DashboardKpiGroup[] =
  DASHBOARD_KPI_GROUP_DEFINITIONS.map(definition => definition.id);

const DASHBOARD_KPI_GROUP_IDS = new Set<DashboardKpiGroup>(DASHBOARD_KPI_GROUP_ORDER);

export function normalizeDashboardKpiGroup(
  value: unknown,
  fallback: DashboardKpiGroup = 'load',
): DashboardKpiGroup {
  return DASHBOARD_KPI_GROUP_IDS.has(value as DashboardKpiGroup)
    ? value as DashboardKpiGroup
    : fallback;
}

export function getDashboardKpiGroupDefinition(
  groupId: DashboardKpiGroup,
): DashboardKpiGroupDefinition {
  return DASHBOARD_KPI_GROUP_DEFINITIONS.find(definition => definition.id === groupId)
    || DASHBOARD_KPI_GROUP_DEFINITIONS[0];
}

export function resolveDefaultDashboardKpiGroupForChartType(
  chartType: unknown,
): DashboardKpiGroup {
  const definition = getDashboardKpiChartDefinitions()
    .find(candidate => `${candidate.chartType}` === `${chartType}`);
  return definition?.group || 'load';
}

export function resolveDashboardKpiTileGroup(
  tile: TileSettingsInterface | TileChartSettingsInterface | AppDashboardChartTileSettingsInterface | null | undefined,
): DashboardKpiGroup | null {
  if (!tile || tile.type !== TileTypes.Chart) {
    return null;
  }

  const chartTile = tile as AppDashboardChartTileSettingsInterface;
  if (!isDashboardKpiChartType(chartTile.chartType)) {
    return null;
  }

  return normalizeDashboardKpiGroup(
    chartTile.kpiGroup,
    resolveDefaultDashboardKpiGroupForChartType(chartTile.chartType),
  );
}

export function isDashboardKpiGroup(value: unknown): value is DashboardKpiGroup {
  return DASHBOARD_KPI_GROUP_IDS.has(value as DashboardKpiGroup);
}

export function getDashboardKpiGroupLaneKey(groupId: DashboardKpiGroup): `kpi:${DashboardKpiGroup}` {
  return `kpi:${groupId}`;
}

export function resolveDashboardKpiChartTypeGroup(chartType: DashboardKpiChartType): DashboardKpiGroup {
  return resolveDefaultDashboardKpiGroupForChartType(chartType);
}
