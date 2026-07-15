import { SwimPaceUnits } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import type { DashboardTrainingSwimPerformanceContext } from './dashboard-derived-metrics.helper';
import {
  buildTrainingSwimPerformanceViewModel,
  formatTrainingSwimPace,
} from './training-swim-performance.helper';

function context(): DashboardTrainingSwimPerformanceContext {
  return {
    asOfDayMs: Date.UTC(2026, 6, 13),
    swolfContext: { stroke: 'freestyle', poolLengthMeters: 25 },
    weeks: [
      {
        weekStartMs: Date.UTC(2026, 6, 6), environment: 'pool', activityCount: 2,
        distanceMeters: 3_000, averagePaceSecondsPer100m: 100, paceActivityCount: 2,
        swolf: 41.5, swolfLengthCount: 120,
      },
      {
        weekStartMs: Date.UTC(2026, 6, 6), environment: 'open-water', activityCount: 1,
        distanceMeters: 2_000, averagePaceSecondsPer100m: 110, paceActivityCount: 1,
        swolf: null, swolfLengthCount: 0,
      },
    ],
  };
}

describe('training-swim-performance.helper', () => {
  it('keeps pool and open-water series separate with comparable SWOLF context', () => {
    const view = buildTrainingSwimPerformanceViewModel(context(), null);

    expect(view.pool).toEqual([expect.objectContaining({ paceSeconds: 100, swolf: 41.5 })]);
    expect(view.openWater).toEqual([expect.objectContaining({ paceSeconds: 110, swolf: null })]);
    expect(view.hasSessions).toBe(true);
    expect(view.hasPace).toBe(true);
    expect(view.swolfContextText).toBe('Freestyle · 25 m pool');
    expect(view.latestSwolfText).toBe('41.5');
  });

  it('formats unit-aware pace without changing the stored per-100-metre value', () => {
    expect(formatTrainingSwimPace(100, false)).toBe('1:40 /100m');
    expect(formatTrainingSwimPace(100, true)).toBe('1:31 /100yd');
    expect(formatTrainingSwimPace(null, false)).toBe('--');

    const yards = buildTrainingSwimPerformanceViewModel(context(), {
      swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard],
    } as any);
    expect(yards.usesYards).toBe(true);
    expect(yards.paceUnit).toBe('/100yd');
  });

  it('distinguishes sessions without explicit pace from an entirely empty window', () => {
    const noPace = context();
    noPace.weeks = noPace.weeks.map(week => ({ ...week, averagePaceSecondsPer100m: null, paceActivityCount: 0 }));
    expect(buildTrainingSwimPerformanceViewModel(noPace, null)).toMatchObject({
      hasSessions: true,
      hasPace: false,
    });
    expect(buildTrainingSwimPerformanceViewModel(null, null)).toMatchObject({
      hasSessions: false,
      hasPace: false,
    });
  });
});
