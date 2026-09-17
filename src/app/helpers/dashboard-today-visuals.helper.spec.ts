import { describe, expect, it } from 'vitest';
import type { DashboardFormPoint } from './dashboard-form.helper';
import type { DashboardSleepTrendContext } from './dashboard-sleep-chart.helper';
import {
  buildDashboardTodayLoadBars,
  buildDashboardTodayOvernightHeartRateBars,
  resolveDashboardTodayTrainingStateScale,
} from './dashboard-today-visuals.helper';

describe('dashboard Today visuals', () => {
  it('uses the latest seven real daily load values and highlights the current overload day', () => {
    const points = Array.from({ length: 9 }, (_, index): DashboardFormPoint => ({
      time: Date.UTC(2026, 8, 1 + index),
      trainingStressScore: index * 10,
      ctl: 50,
      atl: 50,
      formSameDay: 0,
      formPriorDay: 0,
    }));

    const bars = buildDashboardTodayLoadBars(points, 'Overload', Date.UTC(2026, 8, 9, 12));

    expect(bars).toHaveLength(7);
    expect(bars[0].key).toBe(`${Date.UTC(2026, 8, 3)}`);
    expect(bars.at(-1)).toMatchObject({ heightPercent: 100, current: true, tone: 'negative' });
    expect(bars.slice(0, -1).every(bar => !bar.current && bar.tone === 'neutral')).toBe(true);
  });

  it('keeps zero-load days visible instead of inventing activity', () => {
    const points: DashboardFormPoint[] = [0, 1, 2].map(index => ({
      time: Date.UTC(2026, 8, 1 + index),
      trainingStressScore: 0,
      ctl: 0,
      atl: 0,
      formSameDay: 0,
      formPriorDay: 0,
    }));

    expect(buildDashboardTodayLoadBars(points, 'Starting', Date.UTC(2026, 8, 3, 12)))
      .toEqual([
        { key: `${Date.UTC(2026, 8, 1)}`, heightPercent: 12, current: false, tone: 'neutral' },
        { key: `${Date.UTC(2026, 8, 2)}`, heightPercent: 12, current: false, tone: 'neutral' },
        { key: `${Date.UTC(2026, 8, 3)}`, heightPercent: 12, current: true, tone: 'neutral' },
      ]);
  });

  it('keeps overnight heart-rate history on the latest provider account and excludes naps and future readings', () => {
    const point = (id: string, day: number, value: number, sourceKey: string, extra = {}) => ({
      id,
      sleepDate: `2026-09-${day.toString().padStart(2, '0')}`,
      provider: 'SuuntoApp' as const,
      providerLabel: 'Suunto',
      categoryLabel: id,
      sourceKey,
      startTimeMs: Date.UTC(2026, 8, day, 0),
      endTimeMs: Date.UTC(2026, 8, day, 7),
      totalSeconds: 28_800,
      deepSeconds: 0,
      lightSeconds: 0,
      remSeconds: 0,
      awakeSeconds: 0,
      unknownSeconds: 0,
      score: null,
      averageHeartRateBpm: value,
      minimumHeartRateBpm: value - 5,
      averageHrvMs: null,
      maxSpo2Percent: null,
      isNap: false,
      napSeconds: 0,
      napCount: 0,
      napAverageHrvMs: null,
      napAverageHeartRateBpm: null,
      napStartTimeMs: null,
      napEndTimeMs: null,
      ...extra,
    });
    const trend: DashboardSleepTrendContext = {
      latestPoint: null,
      points: [
        point('other-account', 12, 90, 'account-b'),
        point('night-1', 13, 50, 'account-a'),
        point('nap', 14, 70, 'account-a', { isNap: true }),
        point('night-2', 15, 55, 'account-a'),
        point('future', 18, 60, 'account-a'),
      ],
    };

    const bars = buildDashboardTodayOvernightHeartRateBars(
      trend,
      'negative',
      Date.UTC(2026, 8, 16, 12),
    );

    expect(bars.map(bar => bar.key)).toEqual(['night-1', 'night-2']);
    expect(bars.at(-1)).toMatchObject({ heightPercent: 100, current: true, tone: 'negative' });
  });

  it('maps the shared training states onto the six-step visual scale', () => {
    expect(resolveDashboardTodayTrainingStateScale('Detraining')).toMatchObject({ position: 0, tone: 'neutral' });
    expect(resolveDashboardTodayTrainingStateScale('Balanced')).toMatchObject({ position: 2, tone: 'positive' });
    expect(resolveDashboardTodayTrainingStateScale('Overload')).toMatchObject({ position: 5, tone: 'negative' });
    expect(resolveDashboardTodayTrainingStateScale('Awaiting data').position).toBeNull();
  });
});
