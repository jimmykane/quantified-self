import { ChartTypes, TileTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { getDashboardChartCatalog } from './dashboard-chart-catalog.helper';
import { DASHBOARD_ACWR_KPI_CHART_TYPE, DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE } from './dashboard-special-chart-types';
import { hasDashboardTileSettings, resolveDashboardTileCollectionPresentation, resolveDashboardTilePresentation } from './dashboard-tile-presentation.helper';

describe('dashboard tile presentation', () => {
  it('offers settings only for charts and maps that have editable properties', () => {
    for (const entry of getDashboardChartCatalog()) {
      expect(hasDashboardTileSettings(entry.tile), entry.definition.id).toBe(['custom', 'map'].includes(entry.definition.category));
    }
    expect(hasDashboardTileSettings(null)).toBe(false);
    expect(hasDashboardTileSettings({ type: TileTypes.Chart, chartType: 'FutureRenderer' })).toBe(false);
  });
  it.each([
    [ChartTypes.Line, 'chart'],
    [DASHBOARD_ACWR_KPI_CHART_TYPE, 'kpi'],
    [DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE, 'calendar'],
    ['FutureChartRenderer', 'chart'],
  ])('identifies %s independently of its stored Chart type', (chartType, kind) => {
    expect(resolveDashboardTilePresentation({ type: TileTypes.Chart, chartType }).kind).toBe(kind);
  });

  it('uses the map renderer even if stale chart settings remain', () => {
    expect(resolveDashboardTilePresentation({ type: TileTypes.Map, chartType: DASHBOARD_ACWR_KPI_CHART_TYPE }).kind).toBe('map');
  });

  it('falls back safely for missing or future tile renderers and empty collections', () => {
    for (const tile of [null, undefined, {}, { type: 'FutureRenderer' as TileTypes }]) {
      expect(resolveDashboardTilePresentation(tile).kind).toBe('tile');
    }
    expect(resolveDashboardTileCollectionPresentation([]).kind).toBe('tile');
  });

  it.each([
    ['kpi', 'Add KPI'],
    ['section:trainingState', 'Add chart'],
    ['section:performancePower', 'Add chart'],
    ['section:activityOverview', 'Add tile'],
    ['section:routesMaps', 'Add map'],
  ])('derives %s terminology from all supported entries', (lane, action) => {
    const tiles = getDashboardChartCatalog().filter(entry => entry.lane === lane).map(entry => entry.tile);
    expect(resolveDashboardTileCollectionPresentation(tiles).add).toBe(action);
  });
});
