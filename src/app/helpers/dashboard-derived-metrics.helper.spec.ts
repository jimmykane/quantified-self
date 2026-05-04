import { describe, expect, it } from 'vitest';
import {
  resolveDashboardEasyPercentContext,
  resolveDashboardEfficiencyDelta4wContext,
  resolveDashboardAcwrContext,
  resolveDashboardEfficiencyTrendContext,
  resolveDashboardFatigueAtlContext,
  resolveDashboardFitnessCtlContext,
  resolveDashboardFreshnessForecastContext,
  resolveDashboardFormNowContext,
  resolveDashboardFormPlus7dContext,
  resolveDashboardHardPercentContext,
  resolveDashboardIntensityDistributionContext,
  resolveDashboardMonotonyStrainContext,
  resolveDashboardRampRateContext,
} from './dashboard-derived-metrics.helper';

describe('dashboard-derived-metrics.helper', () => {
  it('normalizes ACWR payload context', () => {
    const context = resolveDashboardAcwrContext({
      latestDayMs: Date.UTC(2026, 0, 1),
      acuteLoad7: 180,
      chronicLoad28: 150,
      ratio: 1.2,
      trend8Weeks: [{ weekStartMs: Date.UTC(2025, 11, 1), ratio: 1.1 }],
    });

    expect(context).toEqual({
      latestDayMs: Date.UTC(2026, 0, 1),
      acuteLoad7: 180,
      chronicLoad28: 150,
      ratio: 1.2,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: 1.1 }],
    });
  });

  it('normalizes ramp rate and monotony/strain payload contexts', () => {
    const ramp = resolveDashboardRampRateContext({
      latestDayMs: Date.UTC(2026, 0, 1),
      ctlToday: 60,
      ctl7DaysAgo: 56,
      rampRate: 4,
      trend8Weeks: [{ weekStartMs: Date.UTC(2025, 11, 1), rampRate: 2 }],
    });
    const monotony = resolveDashboardMonotonyStrainContext({
      latestDayMs: Date.UTC(2026, 0, 1),
      weeklyLoad7: 320,
      monotony: 1.7,
      strain: 544,
      trend8Weeks: [{ weekStartMs: Date.UTC(2025, 11, 1), strain: 490 }],
    });

    expect(ramp?.rampRate).toBe(4);
    expect(ramp?.trend8Weeks[0]).toEqual({ time: Date.UTC(2025, 11, 1), value: 2 });
    expect(monotony?.strain).toBe(544);
    expect(monotony?.trend8Weeks[0]).toEqual({ time: Date.UTC(2025, 11, 1), value: 490 });
  });

  it('normalizes freshness, intensity, and efficiency payload contexts', () => {
    const freshness = resolveDashboardFreshnessForecastContext({
      generatedAtMs: Date.UTC(2026, 0, 10),
      points: [{
        dayMs: Date.UTC(2026, 0, 10),
        trainingStressScore: 0,
        ctl: 58,
        atl: 54,
        formSameDay: 4,
        formPriorDay: 3,
        isForecast: false,
      }],
    });
    const intensity = resolveDashboardIntensityDistributionContext({
      weeks: [{
        weekStartMs: Date.UTC(2026, 0, 5),
        easySeconds: 3600,
        moderateSeconds: 1800,
        hardSeconds: 900,
        source: 'power',
      }],
      latestWeekStartMs: Date.UTC(2026, 0, 5),
      latestEasyPercent: 57,
      latestModeratePercent: 29,
      latestHardPercent: 14,
    });
    const efficiency = resolveDashboardEfficiencyTrendContext({
      points: [{
        weekStartMs: Date.UTC(2026, 0, 5),
        value: 1.92,
        sampleCount: 3,
        totalDurationSeconds: 9200,
      }],
      latestWeekStartMs: Date.UTC(2026, 0, 5),
      latestValue: 1.92,
    });

    expect(freshness?.points).toHaveLength(1);
    expect(intensity?.weeks[0].source).toBe('power');
    expect(efficiency?.latestValue).toBe(1.92);
  });

  it('normalizes readiness and execution KPI payload contexts', () => {
    const formNow = resolveDashboardFormNowContext({
      latestDayMs: Date.UTC(2026, 0, 10),
      value: -3.2,
      trend8Weeks: [{ weekStartMs: Date.UTC(2025, 11, 1), value: -1.3 }],
    });
    const formPlus7d = resolveDashboardFormPlus7dContext({
      latestDayMs: Date.UTC(2026, 0, 10),
      projectedDayMs: Date.UTC(2026, 0, 17),
      value: 2.9,
      trend8Weeks: [{ weekStartMs: Date.UTC(2025, 11, 1), value: 1.1 }],
    });
    const easyPercent = resolveDashboardEasyPercentContext({
      latestWeekStartMs: Date.UTC(2026, 0, 5),
      value: 66,
      trend8Weeks: [{ weekStartMs: Date.UTC(2025, 11, 1), value: 62 }],
    });
    const hardPercent = resolveDashboardHardPercentContext({
      latestWeekStartMs: Date.UTC(2026, 0, 5),
      value: 14,
      trend8Weeks: [{ weekStartMs: Date.UTC(2025, 11, 1), value: 12 }],
    });

    expect(formNow?.value).toBe(-3.2);
    expect(formNow?.trend8Weeks[0]).toEqual({ time: Date.UTC(2025, 11, 1), value: -1.3 });
    expect(formPlus7d?.projectedDayMs).toBe(Date.UTC(2026, 0, 17));
    expect(easyPercent?.value).toBe(66);
    expect(hardPercent?.value).toBe(14);
  });

  it('derives Fitness CTL and Fatigue ATL KPI contexts from official Form points through today', () => {
    const fitness = resolveDashboardFitnessCtlContext([
      {
        time: Date.UTC(2026, 0, 5),
        trainingStressScore: 42,
        ctl: 10,
        atl: 14,
        formSameDay: -4,
        formPriorDay: -3,
      },
      {
        time: Date.UTC(2026, 0, 6),
        trainingStressScore: 84,
        ctl: 12,
        atl: 20,
        formSameDay: -8,
        formPriorDay: -4,
      },
    ], Date.UTC(2026, 0, 8, 12));
    const fatigue = resolveDashboardFatigueAtlContext([
      {
        time: Date.UTC(2026, 0, 5),
        trainingStressScore: 42,
        ctl: 10,
        atl: 14,
        formSameDay: -4,
        formPriorDay: -3,
      },
      {
        time: Date.UTC(2026, 0, 6),
        trainingStressScore: 84,
        ctl: 12,
        atl: 20,
        formSameDay: -8,
        formPriorDay: -4,
      },
    ], Date.UTC(2026, 0, 8, 12));

    expect(fitness?.latestDayMs).toBe(Date.UTC(2026, 0, 8));
    expect(fitness?.value).toBeCloseTo(11.4354, 4);
    expect(fitness?.trend8Weeks).toEqual([
      { time: Date.UTC(2026, 0, 5), value: 11.4354 },
    ]);
    expect(fatigue?.latestDayMs).toBe(Date.UTC(2026, 0, 8));
    expect(fatigue?.value).toBeCloseTo(14.6939, 4);
    expect(fatigue?.trend8Weeks).toEqual([
      { time: Date.UTC(2026, 0, 5), value: 14.6939 },
    ]);
  });

  it('normalizes efficiency delta payload context', () => {
    const context = resolveDashboardEfficiencyDelta4wContext({
      latestWeekStartMs: Date.UTC(2026, 0, 5),
      latestValue: 1.92,
      baselineValue: 1.84,
      baselineWeekCount: 4,
      deltaAbs: 0.08,
      deltaPct: 4.35,
      trend8Weeks: [{ weekStartMs: Date.UTC(2025, 11, 1), value: 1.7 }],
    });

    expect(context?.deltaAbs).toBe(0.08);
    expect(context?.deltaPct).toBe(4.35);
    expect(context?.baselineWeekCount).toBe(4);
    expect(context?.trend8Weeks[0]).toEqual({ time: Date.UTC(2025, 11, 1), value: 1.7 });
  });
});
