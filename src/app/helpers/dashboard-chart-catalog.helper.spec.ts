import { describe, expect, it } from 'vitest';
import { getDashboardChartCatalog, getAvailableDashboardCharts, matchesDashboardPreset } from './dashboard-chart-catalog.helper';

describe('dashboard chart catalog', () => {
  it('gives every existing preset one destination, default size and stable identity', () => {
    const entries = getDashboardChartCatalog();
    expect(entries).toHaveLength(37);
    expect(new Set(entries.map(entry => entry.definition.id)).size).toBe(37);
    for (const entry of entries) {
      expect(entry.tile.size.columns).toBeGreaterThan(0);
      expect(matchesDashboardPreset(entry.tile, entry.tile)).toBe(true);
      expect(getAvailableDashboardCharts(entry.lane, []).some(item => item.definition.id === entry.definition.id)).toBe(true);
      expect(getAvailableDashboardCharts(entry.lane, [entry.tile]).some(item => item.definition.id === entry.definition.id)).toBe(false);
    }
  });
  it('offers HRV beside Sleep and keeps both charts independently available', () => {
    const catalog = getDashboardChartCatalog();
    const hrv = catalog.find(entry => entry.definition.id === 'curated-hrv')!;
    const sleep = catalog.find(entry => entry.definition.id === 'curated-sleep')!;
    expect(hrv.lane).toBe(sleep.lane);
    expect(hrv.lane).toBe('section:trainingState');
    expect(matchesDashboardPreset(sleep.tile, hrv.tile)).toBe(false);
    expect(getAvailableDashboardCharts(hrv.lane, [sleep.tile]).some(entry => entry.definition.id === hrv.definition.id)).toBe(true);
  });

  it('offers every custom preset only in Activity Overview', () => {
    const customEntries = getDashboardChartCatalog().filter(entry => entry.definition.category === 'custom');
    expect(customEntries).toHaveLength(8);
    expect(customEntries.every(entry => entry.lane === 'section:activityOverview')).toBe(true);
    expect(getAvailableDashboardCharts('section:activityOverview', []).filter(entry => entry.definition.category === 'custom')).toHaveLength(8);
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
