import { DistanceUnits, SwimPaceUnits } from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings } from '@shared/unit-aware-display';
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
    expect(view.conclusionText).toContain('shown separately');
    expect(view.evidenceText).toContain('1 pool week and 1 open-water week');
    expect(view.nextStepText).toContain('matching stroke and pool length');
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

  it.each([
    { paceUnits: [SwimPaceUnits.MinutesPer100Yard, SwimPaceUnits.MinutesPer100Meter], distanceUnits: DistanceUnits.Kilometers,
      pool: '25 yd', distances: ['500 yd', '2.000 yd'] },
    { paceUnits: [SwimPaceUnits.MinutesPer100Meter, SwimPaceUnits.MinutesPer100Yard], distanceUnits: DistanceUnits.Miles,
      pool: '22.86 m', distances: ['457.2 m', '1.829 m'] },
    { paceUnits: [], distanceUnits: DistanceUnits.Miles,
      pool: '22.86 m', distances: ['457.2 m', '1.829 m'] },
  ])('uses the first swim preference for pool context and both weekly distances: $paceUnits', example => {
    const source = context();
    source.swolfContext.poolLengthMeters = 22.86;
    source.weeks[0].distanceMeters = 457.2;
    source.weeks[1].distanceMeters = 1828.8;
    const before = structuredClone(source);
    const view = buildTrainingSwimPerformanceViewModel(source, {
      ...getDefaultUserUnitSettings(),
      swimPaceUnits: example.paceUnits,
      distanceUnits: example.distanceUnits,
    });

    expect(view.swolfContextText).toBe(`Freestyle · ${example.pool} pool`);
    expect([view.pool[0].distanceText, view.openWater[0].distanceText]).toEqual(example.distances);
    expect([view.pool[0].distanceMeters, view.openWater[0].distanceMeters]).toEqual([457.2, 1828.8]);
    expect(view.latestSwolfText).toBe('41.5');
    expect(source).toEqual(before);
  });

  it('converts an actual metre pool without relabelling it as a nominal yard pool', () => {
    const view = buildTrainingSwimPerformanceViewModel(context(), {
      ...getDefaultUserUnitSettings(), swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard],
    });
    expect(view.swolfContextText).toBe('Freestyle · 27.34 yd pool');
  });

  it('keeps zero distance distinct from missing or invalid distance', () => {
    for (const distanceMeters of [0, null, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const source = context();
      source.weeks[0].distanceMeters = distanceMeters;
      const view = buildTrainingSwimPerformanceViewModel(source, null);
      expect(view.pool[0].distanceText).toBe(distanceMeters === 0 ? '0 m' : '--');
    }
  });
});
