import { describe, expect, it } from 'vitest';
import type { SeriesOption } from 'echarts';
import { getDashboardChartCatalog } from './dashboard-chart-catalog.helper';
import { buildDashboardExamplePreview, buildDashboardThumbnailPreview } from './dashboard-chart-preview.helper';
import { buildDashboardChartThumbnailOption } from './dashboard-chart-thumbnail.helper';

describe('chart list thumbnail shapes', () => {
  const catalog = getDashboardChartCatalog();
  it.each(catalog.map(entry => [entry.definition.id, entry] as const))('renders a bounded, non-interactive example for %s', (_id, entry) => {
    const preview = buildDashboardThumbnailPreview(entry.tile, { tiles: [] });
    expect(preview.source).toBe('example');
    for (const dark of [false, true]) {
      const option = buildDashboardChartThumbnailOption(preview, dark);
      expect(option.animation).toBe(false);
      expect(option.tooltip).toMatchObject({ show: false });
      const series = option.series as SeriesOption[];
      expect(series.length).toBeGreaterThan(0);
      expect(series.every(item => item.silent)).toBe(true);
      expect(series.some(item => Array.isArray(item.data) && item.data.length > 0)).toBe(true);
      expect(series.every(item => !Array.isArray(item.data) || item.data.length <= 48)).toBe(true);
    }
  });
  it('uses the loaded KPI trend instead of an unrelated synthetic shape', () => {
    const tile = catalog.find(entry => entry.definition.id === 'kpi-acwr')!.tile;
    const trend8Weeks = [{ time: 1, value: 1.4 }, { time: 2, value: null }, { time: 3, value: .8 }];
    const preview = buildDashboardThumbnailPreview(tile, { tiles: [], derivedMetrics: {
      acwr: { ratio: .8, acuteLoad7: 80, chronicLoad28: 100, latestDayMs: 3, trend8Weeks },
    } });
    expect(preview.source).toBe('user');
    const series = buildDashboardChartThumbnailOption(preview, false).series as SeriesOption[];
    expect(series[0].data).toEqual([[1, 1.4], [2, null], [3, .8]]);
  });
  it.each([false, true])('uses the tile’s semantic colors in theme dark=%s', dark => {
    const acwr = buildDashboardExamplePreview(catalog.find(entry => entry.definition.id === 'kpi-acwr')!.tile);
    const chart = acwr.tile as import('./dashboard-tile-view-model.helper').DashboardChartTileViewModel;
    const color = () => (buildDashboardChartThumbnailOption(acwr, dark).series as import('echarts').LineSeriesOption[])[0].lineStyle!.color;
    chart.acwr!.ratio = 1.5; expect(color()).toBe('#c62828');
    chart.acwr!.ratio = 1; expect(color()).toBe('#1b7f38');
    chart.acwr!.ratio = .7; expect(color()).toBe('#8854d0');
    const form = buildDashboardExamplePreview(catalog.find(entry => entry.definition.id === 'kpi-form-now')!.tile);
    (form.tile as typeof chart).formNow!.value = -20;
    expect((buildDashboardChartThumbnailOption(form, dark).series as import('echarts').LineSeriesOption[])[0].lineStyle!.color).toBe('#c62828');
  });
  it('uses the same Training Balance percentage trend as the KPI instead of intensity bars', () => {
    const preview = buildDashboardExamplePreview(catalog.find(entry => entry.definition.id === 'kpi-training-balance')!.tile);
    const tile = preview.tile as import('./dashboard-tile-view-model.helper').DashboardChartTileViewModel;
    const series = buildDashboardChartThumbnailOption(preview, false).series as SeriesOption[];
    expect(series.map(item => item.type)).toEqual(['line']);
    expect(series[0].data).toEqual(tile.hardPercent!.trend8Weeks.map(point => [point.time, point.value]));
  });
  it('reuses Health’s range band and colored points in the HRV thumbnail', () => {
    const entry = catalog.find(entry => entry.definition.id === 'curated-hrv')!;
    const preview = buildDashboardExamplePreview(entry.tile);
    const option = buildDashboardChartThumbnailOption(preview, false);
    const series = option.series as SeriesOption[];
    expect(series.some(item => item.id === 'hrv-personal-range-band')).toBe(true);
    expect(series[0].itemStyle?.color).toBeTypeOf('function');
    expect(option.xAxis).toMatchObject({ type: 'time', show: false });
  });
  it('keeps distinct chart formats for forecasts, intensity, power, pies, bars and routes', () => {
    const types = (id: string) => (buildDashboardChartThumbnailOption(buildDashboardExamplePreview(catalog.find(entry => entry.definition.id === id)!.tile), false).series as SeriesOption[]).map(series => series.type);
    expect(types('curated-freshness-forecast')).toEqual(['line', 'line', 'line']);
    expect(types('curated-intensity-distribution')).toEqual(['bar', 'bar', 'bar']);
    expect(types('curated-power-curve').every(type => type === 'line')).toBe(true);
    expect(types('custom-duration-pie')).toEqual(['pie']);
    expect(types('custom-distance-columns')).toEqual(['bar']);
    expect(types('map-routes-preview')).toEqual(['line']);
  });
  it.each([{ trend8Weeks: [] }, { trend8Weeks: [{ time: 1, value: null }] }])('keeps real headline data without inventing a trend: %j', ({ trend8Weeks }) => {
    const tile = catalog.find(entry => entry.definition.id === 'kpi-acwr')!.tile;
    const preview = buildDashboardThumbnailPreview(tile, { tiles: [], derivedMetrics: {
      acwr: { ratio: .8, acuteLoad7: 80, chronicLoad28: 100, latestDayMs: 3, trend8Weeks },
    } });
    expect(preview.source).toBe('user');
    const series = buildDashboardChartThumbnailOption(preview, false).series as SeriesOption[];
    expect(series[0].data).toEqual(trend8Weeks.map(point => [point.time, point.value]));
  });
});
