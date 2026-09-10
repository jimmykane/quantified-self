import { describe, expect, it } from 'vitest';
import { SLEEP_PROVIDERS, type SleepProvider } from '@shared/sleep';
import { buildDashboardHrvTrendModel } from './dashboard-hrv-chart.helper';
import type { DashboardSleepTrendPoint } from './dashboard-sleep-chart.helper';

const point = (sleepDate: string, averageHrvMs: number | null, provider: SleepProvider = SLEEP_PROVIDERS.GarminAPI): DashboardSleepTrendPoint => ({
  sleepDate, averageHrvMs, provider, providerLabel: provider, endTimeMs: Date.parse(sleepDate),
} as DashboardSleepTrendPoint);

describe('overnight HRV model', () => {
  it('keeps source histories and averages separate, with gaps for missing readings', () => {
    const points = [point('2026-09-01', 40), point('2026-09-02', null), point('2026-09-03', 60),
      point('2026-09-01', 100, SLEEP_PROVIDERS.SuuntoApp)];
    const model = buildDashboardHrvTrendModel({ points, latestPoint: null });
    expect(model.dates).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(model.series.find(series => series.provider === SLEEP_PROVIDERS.GarminAPI)).toMatchObject({ values: [40, null, 60], average: 50 });
    expect(model.series.find(series => series.provider === SLEEP_PROVIDERS.SuuntoApp)).toMatchObject({ values: [100, null, null], average: 100 });
    expect(model.latest?.averageHrvMs).toBe(60);
  });
  it('ignores naps, placeholders and invalid readings instead of reporting a false HRV value', () => {
    const points = [point('2026-09-01', 0), point('2026-09-02', -10), point('2026-09-03', NaN),
      { ...point('2026-09-04', 70), isNap: true }, { ...point('2026-09-05', 80), isPlaceholder: true }];
    expect(buildDashboardHrvTrendModel({ points, latestPoint: points.at(-1)! })).toMatchObject({ hasData: false, latest: null, series: [] });
  });
  it('uses the latest recorded HRV even if a newer night has no HRV', () => {
    const recorded = point('2026-09-01', 42);
    const missing = point('2026-09-02', null);
    expect(buildDashboardHrvTrendModel({ points: [recorded, missing], latestPoint: missing }).latest).toBe(recorded);
  });
});
