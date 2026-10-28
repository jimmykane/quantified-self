import { AppUserUtilities } from '../utils/app.user.utilities';
import { describe, it, expect } from 'vitest';
import { dashboardHealthMetric, dashboardHealthSettings, DASHBOARD_HEALTH_METRICS } from './dashboard-health-tile.helper';
import { getDashboardChartCatalog, getAvailableDashboardCharts } from './dashboard-chart-catalog.helper';
import { resolveDashboardTileSection } from './dashboard-tile-section.helper';
import { buildHealthMetricCatalogGroups } from './health-workspace.helper';
import type { AppDashboardChartTileSettingsInterface } from '../models/app-user.interface';

const catalog = getDashboardChartCatalog();
describe('dashboard Health tiles', () => {
  it('covers exactly the selectable Health catalog plus Sleep, without duplicating HRV', () => {
    const metrics = catalog.map(entry => dashboardHealthMetric(entry.tile)).filter(Boolean);
    expect(new Set(metrics)).toEqual(new Set(['sleep', ...buildHealthMetricCatalogGroups().flatMap(group => group.metrics.map(metric => metric.id))]));
    expect(metrics.length).toBe(DASHBOARD_HEALTH_METRICS.size);
    expect(metrics).not.toContain('distance');
    expect(metrics).not.toContain('active_duration');
    expect(metrics).not.toContain('altitude');
  });
  it.each(['curated-sleep', 'curated-hrv'])('keeps legacy %s placement and range while preventing duplicates across sections', id => {
    const tile = structuredClone(catalog.find(entry => entry.definition.id === id)!.tile) as AppDashboardChartTileSettingsInterface;
    delete tile.healthSection;
    delete tile.healthMetric;
    expect(resolveDashboardTileSection(tile)).toBe('trainingState');
    const settings = dashboardHealthSettings(tile, { sleepTrend: { range: '90d' }, hrvTrend: { range: '1y' } });
    expect(settings?.range).toBe(id === 'curated-sleep' ? '90d' : '1y');
    expect(getAvailableDashboardCharts('section:health', [tile]).some(entry => entry.definition.id === id)).toBe(false);
    tile.healthSection = 'health';
    expect(resolveDashboardTileSection(tile)).toBe('health');
  });
  it('validates saved ranges and source keys without changing metric identity', () => {
    const tile = structuredClone(catalog.find(entry => entry.definition.id === 'health:body_weight')!.tile) as AppDashboardChartTileSettingsInterface;
    tile.healthMetric = { metric: 'body_weight', range: 'invalid' as never, sourceKey: '  source  ' };
    expect(dashboardHealthSettings(tile)).toEqual({ metric: 'body_weight', range: '30d', sourceKey: 'source' });
    tile.healthMetric.range = 'today';
    expect(dashboardHealthSettings(tile)?.range).toBe('today');
  });
  it('normalizes persisted Health choices without adding tiles or relocating legacy charts', () => {
    const first = structuredClone(catalog.find(entry => entry.definition.id === 'curated-hrv')!.tile) as AppDashboardChartTileSettingsInterface;
    delete first.healthMetric; delete first.healthSection; first.order = 0;
    const duplicate = { ...structuredClone(first), order: 1, healthSection: 'health' };
    const invalid = { ...structuredClone(catalog.find(entry => entry.definition.id === 'health:steps')!.tile), order: 2, healthMetric: { metric: 'unknown', range: '30d' } };
    const settings = AppUserUtilities.fillMissingAppSettings({ settings: { dashboardSettings: { tiles: [first, duplicate, invalid], hrvTrend: { range: '1y' } } } } as never);
    expect(settings.dashboardSettings.tiles).toHaveLength(1);
    const saved = settings.dashboardSettings.tiles[0];
    expect(dashboardHealthSettings(saved)?.range).toBe('1y');
    expect(resolveDashboardTileSection(saved)).toBe('trainingState');
    const empty = AppUserUtilities.fillMissingAppSettings({ settings: { dashboardSettings: { tiles: [] } } } as never);
    expect(empty.dashboardSettings.tiles).toEqual([]);
  });
  it('marks only added chart types as new', () => {
    expect(catalog.filter(entry => entry.definition.category === 'health').every(entry => entry.definition.introducedIn === 2)).toBe(true);
    expect(catalog.find(entry => entry.definition.id === 'curated-hrv')!.definition.introducedIn).toBe(1);
  });
});
