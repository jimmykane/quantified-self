import { TileChartSettingsInterface, TileSettingsInterface, TileTypes } from '@sports-alliance/sports-lib';
import { buildDashboardManagerPresetTile, getDashboardManagerPresetDefinitions, DashboardManagerPresetDefinition } from './dashboard-manager-presets.helper';
import { DashboardTileLaneKey, resolveDashboardTileLaneKey } from './dashboard-tile-section.helper';
import { getDashboardAutoTileDescriptorForTile, isDashboardSleepTrendTile } from './dashboard-auto-tile.helper';
import { getDefaultDashboardChartTileSizeForChartType, getDefaultDashboardMapTileSizeForSource } from './dashboard-tile-default-size.helper';

export interface DashboardChartCatalogEntry {
  definition: DashboardManagerPresetDefinition;
  tile: TileSettingsInterface;
  lane: DashboardTileLaneKey;
}

/** The same identity is used by discovery counts and bulk add. Layout and filters
 * do not turn an existing template into another available preset. */
export function matchesDashboardPreset(tile: TileSettingsInterface, preset: TileSettingsInterface): boolean {
  if (preset.type === TileTypes.Map) {
    return tile.type === TileTypes.Map && (tile['mapSource'] || 'events') === (preset['mapSource'] || 'events');
  }
  if (tile.type !== TileTypes.Chart) return false;
  if (isDashboardSleepTrendTile(preset)) return isDashboardSleepTrendTile(tile);
  const descriptor = getDashboardAutoTileDescriptorForTile(preset);
  if (descriptor) return getDashboardAutoTileDescriptorForTile(tile)?.id === descriptor.id;
  const current = tile as TileChartSettingsInterface;
  const candidate = preset as TileChartSettingsInterface;
  return ['chartType', 'dataType', 'dataValueType', 'dataCategoryType', 'dataTimeInterval']
    .every(key => current[key] === candidate[key]);
}

export function getDashboardChartCatalog(): DashboardChartCatalogEntry[] {
  return getDashboardManagerPresetDefinitions().map(definition => {
    const tile = buildDashboardManagerPresetTile({ presetId: definition.id, order: 0, size: { columns: 1, rows: 1 } });
    tile.size = tile.type === TileTypes.Map
      ? getDefaultDashboardMapTileSizeForSource(tile['mapSource'] || 'events')
      : getDefaultDashboardChartTileSizeForChartType((tile as TileChartSettingsInterface).chartType);
    return { definition, tile, lane: resolveDashboardTileLaneKey(tile) };
  });
}

export function getAvailableDashboardCharts(lane: DashboardTileLaneKey, tiles: TileSettingsInterface[]): DashboardChartCatalogEntry[] {
  return getDashboardChartCatalog().filter(entry => entry.lane === lane && !tiles.some(tile => matchesDashboardPreset(tile, entry.tile)));
}
