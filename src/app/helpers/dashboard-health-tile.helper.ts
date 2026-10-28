import { TileTypes, type TileSettingsInterface } from '@sports-alliance/sports-lib';
import { HEALTH_METRIC_IDS } from '@shared/health';
import { APP_HEALTH_WORKSPACE_RANGES, type AppDashboardChartTileSettingsInterface, type AppDashboardHealthMetricSettings, type AppDashboardSettingsInterface, type AppHealthWorkspaceMetric } from '../models/app-user.interface';
import { buildHealthMetricCatalogGroups } from './health-workspace.helper';
import { DASHBOARD_HEALTH_METRIC_CHART_TYPE, DASHBOARD_HRV_TREND_CHART_TYPE, DASHBOARD_SLEEP_TREND_CHART_TYPE } from './dashboard-special-chart-types';
export const DASHBOARD_HEALTH_GROUPS = buildHealthMetricCatalogGroups();
export const DASHBOARD_HEALTH_METRICS = new Set<AppHealthWorkspaceMetric>(['sleep', ...DASHBOARD_HEALTH_GROUPS.flatMap(group => group.metrics.map(metric => metric.id))]);
export function dashboardHealthMetric(tile: TileSettingsInterface | null | undefined): AppHealthWorkspaceMetric | null {
    if (tile?.type !== TileTypes.Chart)
        return null;
    const chart = tile as AppDashboardChartTileSettingsInterface;
    if (`${chart.chartType}` === DASHBOARD_SLEEP_TREND_CHART_TYPE)
        return 'sleep';
    if (`${chart.chartType}` === DASHBOARD_HRV_TREND_CHART_TYPE)
        return HEALTH_METRIC_IDS.HeartRateVariability;
    const metric = chart.healthMetric?.metric;
    return `${chart.chartType}` === DASHBOARD_HEALTH_METRIC_CHART_TYPE && DASHBOARD_HEALTH_METRICS.has(metric) ? metric : null;
}
/** Legacy placement and ranges are interpreted without a settings write. */
export function dashboardHealthSettings(tile: TileSettingsInterface | null | undefined, dashboard?: Partial<AppDashboardSettingsInterface>): AppDashboardHealthMetricSettings | null {
    const metric = dashboardHealthMetric(tile);
    if (!metric)
        return null;
    const value = (tile as AppDashboardChartTileSettingsInterface).healthMetric;
    const legacyRange = metric === 'sleep' ? dashboard?.sleepTrend?.range
        : metric === HEALTH_METRIC_IDS.HeartRateVariability ? dashboard?.hrvTrend?.range : null;
    const range = value?.range || legacyRange || (metric === 'sleep' || metric === HEALTH_METRIC_IDS.HeartRateVariability ? '14d' : '30d');
    const sourceKey = typeof value?.sourceKey === 'string' && value.sourceKey.length <= 2048 ? value.sourceKey.trim() : '';
    return { metric, range: APP_HEALTH_WORKSPACE_RANGES.includes(range) ? range : '30d', ...(sourceKey ? { sourceKey } : {}) };
}
export function dashboardHealthPresetId(metric: AppHealthWorkspaceMetric): 'curated-sleep' | 'curated-hrv' | `health:${string}` {
    return metric === 'sleep' ? 'curated-sleep' : metric === HEALTH_METRIC_IDS.HeartRateVariability ? 'curated-hrv' : `health:${metric}`;
}
export function isPrivateDashboardHealthTile(tile: TileSettingsInterface): boolean {
    return `${(tile as AppDashboardChartTileSettingsInterface).chartType}` === DASHBOARD_HEALTH_METRIC_CHART_TYPE;
}
