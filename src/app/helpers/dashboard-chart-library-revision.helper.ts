import type { DashboardTileLaneKey } from './dashboard-tile-section.helper';

/** Increase CURRENT only for new chart types, and stamp their introducedIn revision.
 * Keep BASELINE stable so upgrading does not announce the original catalog. */
export const DASHBOARD_CHART_LIBRARY_BASELINE_REVISION = 1;
export const DASHBOARD_CHART_LIBRARY_CURRENT_REVISION = 1;
export type DashboardChartLibrarySeen = Partial<Record<DashboardTileLaneKey, number>>;

export function dashboardChartLibraryRevision(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= DASHBOARD_CHART_LIBRARY_BASELINE_REVISION
    ? value : DASHBOARD_CHART_LIBRARY_BASELINE_REVISION;
}

export function newDashboardChartLibrarySeen(): DashboardChartLibrarySeen {
  return Object.fromEntries(['kpi', 'section:trainingState', 'section:performancePower', 'section:activityOverview', 'section:routesMaps']
    .map(lane => [lane, DASHBOARD_CHART_LIBRARY_CURRENT_REVISION]));
}

/** Full profile saves must not replay an older device's acknowledgements. */
export function mergeDashboardChartLibrarySeen(previous: DashboardChartLibrarySeen = {}, next: DashboardChartLibrarySeen = {}): DashboardChartLibrarySeen {
  return Object.fromEntries([...new Set([...Object.keys(previous ?? {}), ...Object.keys(next ?? {})])]
    .map(lane => [lane, Math.max(dashboardChartLibraryRevision(previous?.[lane]), dashboardChartLibraryRevision(next?.[lane]))]));
}
