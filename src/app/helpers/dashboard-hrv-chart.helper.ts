import { SLEEP_PROVIDERS } from '@shared/sleep';
import type { DashboardSleepTrendContext, DashboardSleepTrendPoint } from './dashboard-sleep-chart.helper';
import { AppColors } from '../services/color/app.colors';

const SOURCE_COLORS: Record<string, string> = {
  [SLEEP_PROVIDERS.GarminAPI]: AppColors.Green,
  [SLEEP_PROVIDERS.SuuntoApp]: AppColors.Blue,
  [SLEEP_PROVIDERS.COROSAPI]: AppColors.Purple,
};

/** Overnight HRV only. Sources remain separate and missing nights are never filled with zero. */
export function buildDashboardHrvTrendModel(context: DashboardSleepTrendContext | null | undefined) {
  const points = context?.points || [];
  const dates = [...new Set(points.map(point => point.sleepDate))].sort();
  const valid = points.filter(point => !point.isPlaceholder && !point.isNap && point.provider
    && Number.isFinite(point.averageHrvMs) && point.averageHrvMs! > 0);
  const latest = valid.reduce<DashboardSleepTrendPoint | null>((previous, point) =>
    !previous || point.endTimeMs > previous.endTimeMs ? point : previous, null);
  const series = [...new Set(valid.map(point => point.provider!))].sort().map(provider => {
    const source = valid.filter(point => point.provider === provider);
    const byDate = new Map<string, DashboardSleepTrendPoint>();
    for (const point of source) {
      const current = byDate.get(point.sleepDate);
      if (!current || point.endTimeMs > current.endTimeMs) byDate.set(point.sleepDate, point);
    }
    const values = dates.map(date => byDate.get(date)?.averageHrvMs ?? null);
    const recorded = values.filter((value): value is number => value !== null);
    return { provider, label: source[0].providerLabel, color: SOURCE_COLORS[provider], values,
      average: recorded.reduce((sum, value) => sum + value, 0) / recorded.length };
  });
  return { dates, series, latest, hasData: valid.length > 0 };
}
