import { describe, expect, it } from 'vitest';
import type { ReadinessHrvPersonalRange } from '@shared/readiness';
import type { DashboardFormPoint } from './dashboard-form.helper';
import type { DashboardSleepTrendContext } from './dashboard-sleep-chart.helper';
import {
  buildDashboardTodayLoadBars,
  buildDashboardTodayHrvRangeIndicator,
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
    expect(bars.at(-1)).toMatchObject({ heightPercent: 100, current: true, zero: false, tone: 'negative' });
    expect(bars.slice(0, -1).every(bar => !bar.current && bar.tone === 'neutral')).toBe(true);
  });

  it('extends load history through today and distinguishes zero-load days from activity', () => {
    const points: DashboardFormPoint[] = [0, 1, 2].map(index => ({
      time: Date.UTC(2026, 8, 1 + index),
      trainingStressScore: index === 2 ? 30 : 0,
      ctl: 0,
      atl: 0,
      formSameDay: 0,
      formPriorDay: 0,
    }));

    expect(buildDashboardTodayLoadBars(points, 'Starting', Date.UTC(2026, 8, 5, 12)))
      .toEqual([
        { key: `${Date.UTC(2026, 8, 1)}`, heightPercent: 0, current: false, zero: true, tone: 'neutral' },
        { key: `${Date.UTC(2026, 8, 2)}`, heightPercent: 0, current: false, zero: true, tone: 'neutral' },
        { key: `${Date.UTC(2026, 8, 3)}`, heightPercent: 100, current: false, zero: false, tone: 'neutral' },
        { key: `${Date.UTC(2026, 8, 4)}`, heightPercent: 0, current: false, zero: true, tone: 'neutral' },
        { key: `${Date.UTC(2026, 8, 5)}`, heightPercent: 0, current: true, zero: true, tone: 'neutral' },
      ]);
  });

  it('builds a padded HRV domain around the current average and personal range', () => {
    const range = {
      tone: 'negative',
      reason: 'outside_range',
      observationDayCount: 20,
      requiredObservationDayCount: 14,
      currentObservationDayCount: 7,
      requiredCurrentObservationDayCount: 3,
      baselineAverage: 39,
      currentAverage: 30,
      normalRange: { min: 33, max: 45 },
      latestMs: 29,
      latestAtMs: Date.UTC(2026, 8, 15),
    } satisfies ReadinessHrvPersonalRange;
    const indicator = buildDashboardTodayHrvRangeIndicator(range);

    expect(indicator).toEqual({ value: 30, min: 26.25, max: 48.75, rangeMin: 33, rangeMax: 45 });
    expect(buildDashboardTodayHrvRangeIndicator(null)).toBeNull();
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
