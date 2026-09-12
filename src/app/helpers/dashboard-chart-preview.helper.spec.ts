import { dashboardHrvWindows } from './dashboard-hrv-context.helper';
import { describe, expect, it } from 'vitest';
import { getDashboardChartCatalog } from './dashboard-chart-catalog.helper';
import { buildDashboardExamplePreview, buildDashboardPreviewSeed, buildDashboardThumbnailPreview, dashboardPreviewHasData, dashboardPreviewMetricKinds } from './dashboard-chart-preview.helper';
import { DashboardChartTileViewModel } from './dashboard-tile-view-model.helper';
import { TileTypes } from '@sports-alliance/sports-lib';

describe('dashboard example previews', () => {
  it('labels the running power example with the running discipline', () => {
    const entry = getDashboardChartCatalog().find(entry => entry.definition.id === 'curated-running-power-curve')!;
    const chart = buildDashboardExamplePreview(entry.tile).tile as DashboardChartTileViewModel;
    expect(chart.powerCurve?.latestSeriesLabel).toBe('Latest running activity');
    expect(chart.powerCurve?.series[1].label).toBe('Latest running activity');
  });
  it('does not reuse a historically paged sleep window for current thumbnails or details', () => {
    const now = Date.now(); const tile = getDashboardChartCatalog()[0].tile;
    const sessions = [{ id: 'saved-night' }] as never;
    const seed = { tiles: [], sleepSessions: sessions, sleepTrendWindow: { startMs: now-14*86400000, endMs: now, range: '14d' as const } };
    expect(buildDashboardPreviewSeed(tile, seed, now).sleepSessions).toBe(sessions);
    expect(buildDashboardPreviewSeed(tile, seed, now+14*86400000).sleepSessions).toEqual([]);
  });
  it('uses the Health source preference for thumbnails and rejects a stale HRV window', () => {
    const tile = getDashboardChartCatalog().find(entry => entry.definition.id === 'curated-hrv')!.tile;
    const context = (buildDashboardExamplePreview(tile).tile as DashboardChartTileViewModel).hrvTrend!;
    context.window = dashboardHrvWindows().visible;
    context.charts.push({ ...context.charts[0], key: 'preferred-source' });
    const seed = { tiles: [], hrvTrend: context, hrvPreferredSource: 'preferred-source' };
    const preview = buildDashboardThumbnailPreview(tile, seed);
    expect(preview.source).toBe('user');
    expect((preview.tile as DashboardChartTileViewModel).hrvTrend?.charts[0].key).toBe('preferred-source');
    expect(buildDashboardPreviewSeed(tile, seed, Date.now() + 14 * 86400000).hrvTrend).toBeNull();
  });
  it('provides renderable, explicitly synthetic data for every catalog entry', () => {
    for (const entry of getDashboardChartCatalog()) {
      const preview = buildDashboardExamplePreview(entry.tile);
      expect(preview.source).toBe('example');
      expect(dashboardPreviewHasData(preview.tile, { tiles: [entry.tile], events: preview.calendarEvents }), entry.definition.id).toBe(true);
      if (entry.tile.type === TileTypes.Chart && entry.definition.category === 'kpi') expect(dashboardPreviewMetricKinds(entry.tile).length).toBeGreaterThan(0);
    }
  });
});
