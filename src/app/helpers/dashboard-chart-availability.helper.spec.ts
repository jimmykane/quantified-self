import { describe, expect, it } from 'vitest';
import { DataStartPosition } from '@sports-alliance/sports-lib';
import { getDashboardChartCatalog } from './dashboard-chart-catalog.helper';
import { buildDashboardThumbnailPreview, buildDashboardExampleEvents, buildDashboardExamplePreview, type DashboardPreviewInput } from './dashboard-chart-preview.helper';
import { resolveDashboardChartAvailability } from './dashboard-chart-availability.helper';
import { buildDashboardTileViewModels, type DashboardChartTileViewModel } from './dashboard-tile-view-model.helper';
import { dashboardHrvWindows } from './dashboard-hrv-context.helper';

const tile = (id: string) => getDashboardChartCatalog().find(entry => entry.definition.id === id)!.tile;
const preview = (id: string, input: Partial<DashboardPreviewInput> = {}) => buildDashboardThumbnailPreview(tile(id), { tiles: [], ...input });

describe('chart availability', () => {
  it('requires coordinates for maps and real route geometry for saved routes', () => {
    const events = buildDashboardExampleEvents(Date.now());
    const input = { previewEventsByRange: { '90d': events } };
    expect(preview('map-default-clustered', input).availability?.state).toBe('ready');
    events.forEach(event => event.removeStat(DataStartPosition.type));
    expect(preview('map-default-clustered', input).availability?.state).toBe('no-data');
    expect(preview('map-routes-preview', { routePreviews: [{ id: 'empty-route' }] as never }).availability?.state).toBe('no-data');
    expect(preview('custom-weekly-training-time', input).availability?.state).toBe('ready');
    expect(preview('curated-form', input).availability?.state).toBe('no-data');
  });

  it('does not treat empty or null-valued derived contexts as usable and accepts a real zero', () => {
    expect(preview('kpi-acwr', { derivedMetrics: { acwr: { ratio: null } as never } }).availability?.state).toBe('no-data');
    expect(preview('kpi-acwr', { derivedMetrics: { acwr: { ratio: 0 } as never } }).availability?.state).toBe('ready');
    expect(preview('curated-intensity-distribution', { derivedMetrics: { intensityDistribution: { weeks: [] } as never } }).availability?.state).toBe('no-data');
    expect(preview('curated-efficiency-trend', { derivedMetrics: { efficiencyTrend: { points: [{ weekStartMs: Date.now(), value: 1.5, sampleCount: 0 }] } as never } }).availability?.state).toBe('no-data');
  });

  it('requires actual scoped power curves, not activity or average-power evidence', () => {
    expect(preview('curated-power-curve', { previewEventsByRange: { '1y': buildDashboardExampleEvents(Date.now()) } }).availability?.state).toBe('no-data');
    const snapshot = { scopes: { cycling: { ranges: { '1y': { sourceEventCount: 1, matchedEventCount: 1, bestPoints: [60, 300, 0], latestActivity: null, best30dPoints: [], best90dPoints: [] } } } } };
    expect(preview('curated-power-curve', { derivedMetrics: { powerCurve: snapshot as never } }).availability?.state).toBe('ready');
    expect(preview('curated-running-power-curve', { derivedMetrics: { powerCurve: snapshot as never } }).availability?.state).toBe('no-data');
  });

  it('accepts recorded HRV before a personal range is built', () => {
    const hrv = (buildDashboardExamplePreview(tile('curated-hrv')).tile as DashboardChartTileViewModel).hrvTrend!;
    hrv.window = dashboardHrvWindows().visible;
    hrv.charts = hrv.charts.map(chart => ({ ...chart, status: null, model: { ...chart.model, series: { ...chart.model.series, points: chart.model.series.points.slice(0, 1) } } }));
    expect(preview('curated-hrv', { hrvTrend: hrv }).availability?.state).toBe('ready');
    expect(preview('curated-sleep', { hrvTrend: hrv }).availability?.state).toBe('no-data');
  });

  it('accepts partial sleep without requiring stages, scores, or overnight vitals', () => {
    const now = Date.now();
    const sessions = [{ id: 'partial-night', source: { provider: 'SuuntoApp' }, startTimeMs: now - 6 * 3600000,
      endTimeMs: now, durationSeconds: 6 * 3600, sleepDate: new Date(now).toISOString().slice(0, 10),
      stages: [], stageDurationsSeconds: {}, vitals: {} }] as never;
    expect(preview('curated-sleep', { sleepSessions: sessions,
      sleepTrendWindow: { startMs: now - 14 * 86400000, endMs: now, range: '14d' },
    }).availability?.state).toBe('ready');
    expect(preview('curated-hrv', { sleepSessions: sessions }).availability?.state).toBe('no-data');
  });

  it('distinguishes missing comparison history, updates, loading, and errors', () => {
    expect(preview('kpi-efficiency-delta-4w', { derivedMetrics: { efficiencyDelta4w: { latestValue: 2, deltaPct: null, baselineWeekCount: 0 } as never } }).availability?.state).toBe('history');
    expect(preview('kpi-acwr', { previewStates: { 'derived:acwr': 'loading' } }).availability?.state).toBe('loading');
    const input: DashboardPreviewInput = { tiles: [tile('kpi-acwr')], derivedMetrics: { acwr: { ratio: 1 } as never } };
    const vm = buildDashboardTileViewModels(input)[0];
    expect(resolveDashboardChartAvailability(vm, input, [], ['stale'])).toMatchObject({ state: 'updating', hasData: true });
    expect(resolveDashboardChartAvailability(vm, input, [], ['failed'])).toMatchObject({ state: 'error', hasData: true });
    expect(preview('kpi-acwr', { previewMetricStatuses: { acwr: 'missing' } }).availability?.state).toBe('updating');
  });
});
