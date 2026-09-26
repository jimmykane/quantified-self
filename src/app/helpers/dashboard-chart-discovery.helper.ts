import type { TileSettingsInterface } from '@sports-alliance/sports-lib';
import type { AppDashboardSettingsInterface } from '../models/app-user.interface';
import { getDashboardChartCatalog, matchesDashboardPreset, type DashboardChartCatalogEntry } from './dashboard-chart-catalog.helper';
import { DASHBOARD_MANAGER_PRESET_IDS as P, type DashboardManagerPresetId } from './dashboard-manager-presets.helper';
import { getDashboardAutoTileDescriptorForTile, markDashboardAutoTileAdded, markDashboardAutoTileDismissed } from './dashboard-auto-tile.helper';
import type { DashboardTileLaneKey } from './dashboard-tile-section.helper';
import { dashboardChartLibraryRevision } from './dashboard-chart-library-revision.helper';

const PRIORITY: Record<DashboardTileLaneKey, readonly DashboardManagerPresetId[]> = {
  'section:calendar': [P.CURATED_ACTIVITY_CALENDAR],
  'section:trainingState': [P.CURATED_FORM, P.CURATED_INTENSITY_DISTRIBUTION],
  'section:health': [P.CURATED_SLEEP, P.CURATED_HRV, 'health:resting_heart_rate', 'health:steps', 'health:body_weight'],
  'section:performancePower': [P.CURATED_POWER_CURVE, P.CURATED_RUNNING_POWER_CURVE],
  'section:activityOverview': [P.CUSTOM_WEEKLY_TRAINING_TIME, P.CUSTOM_DURATION_PIE],
  'section:routesMaps': [P.MAP_ROUTES_PREVIEW, P.MAP_DEFAULT_CLUSTERED],
  kpi: [P.KPI_ACWR, P.KPI_TRAINING_BALANCE],
};
const stateKey = (entry: DashboardChartCatalogEntry) => `preset:${entry.definition.id}`;

export function isDashboardChartSuggestionDismissed(entry: DashboardChartCatalogEntry, settings: AppDashboardSettingsInterface): boolean {
  const state = settings.autoTiles?.[stateKey(entry)];
  if (state) return state.state === 'dismissed';
  const legacy = getDashboardAutoTileDescriptorForTile(entry.tile);
  return !!legacy && settings.autoTiles?.[legacy.id]?.state === 'dismissed';
}

/** Caller supplies availability from the same real preview used by the list. */
export function dashboardChartSuggestions<T extends DashboardChartCatalogEntry>(
  entries: readonly T[], lane: DashboardTileLaneKey, settings: AppDashboardSettingsInterface,
  ready: (entry: T) => boolean,
): T[] {
  return PRIORITY[lane].flatMap(id => {
    const entry = entries.find(candidate => candidate.definition.id === id);
    return entry && ready(entry) && !isDashboardChartSuggestionDismissed(entry, settings)
      && !settings.tiles?.some(tile => matchesDashboardPreset(tile, entry.tile)) ? [entry] : [];
  }).slice(0, 2);
}

export function unseenDashboardCharts<T extends DashboardChartCatalogEntry>(entries: readonly T[], lane: DashboardTileLaneKey, seen: unknown, tiles: readonly TileSettingsInterface[]): T[] {
  return entries.filter(entry => entry.lane === lane && entry.definition.introducedIn > dashboardChartLibraryRevision(seen)
    && !tiles.some(tile => matchesDashboardPreset(tile, entry.tile)));
}

export function syncDashboardChartSuggestionStates(settings: AppDashboardSettingsInterface, before: readonly TileSettingsInterface[], after: readonly TileSettingsInterface[], nowMs: number): void {
  for (const entry of getDashboardChartCatalog()) {
    const had = before.some(tile => matchesDashboardPreset(tile, entry.tile));
    const has = after.some(tile => matchesDashboardPreset(tile, entry.tile));
    if (has && (!had || isDashboardChartSuggestionDismissed(entry, settings))) {
      markDashboardAutoTileAdded(settings, stateKey(entry), 'chart-library', nowMs);
    } else if (had && !has) {
      markDashboardAutoTileDismissed(settings, stateKey(entry), 'chart-library', nowMs);
    }
  }
}

export function dismissAllDashboardChartSuggestions(settings: AppDashboardSettingsInterface, nowMs: number): void {
  for (const entry of getDashboardChartCatalog()) markDashboardAutoTileDismissed(settings, stateKey(entry), 'chart-library', nowMs);
}
