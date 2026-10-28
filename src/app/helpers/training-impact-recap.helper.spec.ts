import { describe, expect, it } from 'vitest';
import { buildDashboardFormPointsFromDailyLoads } from './dashboard-form.helper';
import { buildTrainingImpactRecap } from './training-impact-recap.helper';

describe('training-impact-recap.helper', () => {
  const nowMs = Date.UTC(2026, 8, 30, 12);

  it('builds the trailing seven completed UTC days with exact contribution reconciliation', () => {
    const points = buildDashboardFormPointsFromDailyLoads([
      { dayMs: Date.UTC(2026, 8, 20), load: 84, activityCount: 1 },
      { dayMs: Date.UTC(2026, 8, 24), load: 42, activityCount: 2 },
      { dayMs: Date.UTC(2026, 8, 29), load: 21, activityCount: 1 },
    ]);
    const recap = buildTrainingImpactRecap(points, 7, nowMs);

    expect(recap).not.toBeNull();
    expect(recap?.startDayMs).toBe(Date.UTC(2026, 8, 23));
    expect(recap?.endDayMs).toBe(Date.UTC(2026, 8, 29));
    expect(recap?.totalTrainingStressScore).toBe(63);
    expect(recap?.completedActivityCount).toBe(3);
    expect(recap?.trainingCtlContribution).toBeCloseTo(1.5, 10);
    expect((recap?.trainingCtlContribution || 0) + (recap?.normalCtlDecay || 0))
      .toBeCloseTo(recap?.actualCtlChange || 0, 10);
    expect(recap?.bars).toHaveLength(7);
    expect(Object.values(recap?.outcomeCounts || {}).reduce((sum, count) => sum + count, 0)).toBe(7);
  });

  it('uses zero CTL before first history while retaining valid zero-TSS activity counts', () => {
    const points = buildDashboardFormPointsFromDailyLoads([
      { dayMs: Date.UTC(2026, 8, 27), load: 0, activityCount: 1 },
      { dayMs: Date.UTC(2026, 8, 29), load: 42, activityCount: 1 },
    ]);
    const recap = buildTrainingImpactRecap(points, 7, nowMs);

    expect(recap?.startingCtl).toBe(0);
    expect(recap?.totalTrainingStressScore).toBe(42);
    expect(recap?.completedActivityCount).toBe(2);
    expect(recap?.outcomeCounts.held).toBeGreaterThan(0);
  });

  it('shows pure decay when the selected period has no recent TSS', () => {
    const points = buildDashboardFormPointsFromDailyLoads([
      { dayMs: Date.UTC(2026, 7, 1), load: 420, activityCount: 1 },
    ]);
    const recap = buildTrainingImpactRecap(points, 7, nowMs);

    expect(recap?.totalTrainingStressScore).toBe(0);
    expect(recap?.completedActivityCount).toBe(0);
    expect(recap?.trainingCtlContribution).toBe(0);
    expect(recap?.normalCtlDecay).toBeLessThan(0);
    expect(recap?.actualCtlChange).toBeLessThan(0);
    expect(recap?.outcome).toBe('declined');
    expect(recap?.outcomeCounts).toEqual({ raised: 0, held: 0, declined: 7 });
  });

  it('aggregates 28 completed days into four aligned seven-day bars', () => {
    const points = buildDashboardFormPointsFromDailyLoads([
      { dayMs: Date.UTC(2026, 8, 2), load: 42, activityCount: 1 },
      { dayMs: Date.UTC(2026, 8, 9), load: 84, activityCount: 2 },
      { dayMs: Date.UTC(2026, 8, 16), load: 126, activityCount: 3 },
      { dayMs: Date.UTC(2026, 8, 23), load: 168, activityCount: 4 },
    ]);
    const recap = buildTrainingImpactRecap(points, 28, nowMs);

    expect(recap?.startDayMs).toBe(Date.UTC(2026, 8, 2));
    expect(recap?.bars).toHaveLength(4);
    expect(recap?.bars.every(bar => bar.endDayMs - bar.startDayMs === 6 * 86_400_000)).toBe(true);
    expect(recap?.bars.reduce((sum, bar) => sum + bar.ctlChange, 0))
      .toBeCloseTo(recap?.actualCtlChange || 0, 10);
    expect(recap?.completedActivityCount).toBe(10);
  });

  it('returns no recap only when Form history is genuinely empty', () => {
    expect(buildTrainingImpactRecap([], 7, nowMs)).toBeNull();
  });

  it('shows a held completed period when Form history starts on the current UTC day', () => {
    const todayOnly = buildDashboardFormPointsFromDailyLoads([
      { dayMs: Date.UTC(2026, 8, 30), load: 42, activityCount: 1 },
    ]);
    const recap = buildTrainingImpactRecap(todayOnly, 7, nowMs);

    expect(recap).toMatchObject({
      outcome: 'held',
      totalTrainingStressScore: 0,
      completedActivityCount: 0,
      startingCtl: 0,
      endingCtl: 0,
      actualCtlChange: 0,
      outcomeCounts: { raised: 0, held: 7, declined: 0 },
    });
  });

  it('keeps day counts aligned with a held headline when only floating-point dust remains', () => {
    const points = buildDashboardFormPointsFromDailyLoads([
      { dayMs: Date.UTC(2026, 7, 1), load: 1e-9, activityCount: 1 },
    ]);
    const recap = buildTrainingImpactRecap(points, 7, nowMs);

    expect(recap?.outcome).toBe('held');
    expect(recap?.actualCtlChange).toBe(0);
    expect(recap?.outcomeCounts).toEqual({ raised: 0, held: 7, declined: 0 });
    expect(recap?.bars.every(bar => bar.ctlChange === 0)).toBe(true);
  });
});
