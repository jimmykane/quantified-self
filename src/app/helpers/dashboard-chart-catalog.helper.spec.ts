import { describe, expect, it } from 'vitest';
import { getDashboardChartCatalog, getAvailableDashboardCharts, matchesDashboardPreset } from './dashboard-chart-catalog.helper';

describe('dashboard chart catalog', () => {
  it('gives every existing preset one destination, default size and stable identity', () => {
    const entries = getDashboardChartCatalog();
    expect(entries).toHaveLength(36);
    expect(new Set(entries.map(entry => entry.definition.id)).size).toBe(36);
    for (const entry of entries) {
      expect(entry.tile.size.columns).toBeGreaterThan(0);
      expect(matchesDashboardPreset(entry.tile, entry.tile)).toBe(true);
      expect(getAvailableDashboardCharts(entry.lane, []).some(item => item.definition.id === entry.definition.id)).toBe(true);
      expect(getAvailableDashboardCharts(entry.lane, [entry.tile]).some(item => item.definition.id === entry.definition.id)).toBe(false);
    }
  });
  it('keeps running and cycling power, and the two map sources, independently available', () => {
    const entries = getDashboardChartCatalog();
    for (const category of ['power', 'map']) {
      const pair = entries.filter(entry => category === 'map' ? entry.definition.category === 'map' : entry.definition.id.includes('power-curve'));
      expect(pair).toHaveLength(2);
      expect(matchesDashboardPreset(pair[0].tile, pair[1].tile)).toBe(false);
    }
  });
});
