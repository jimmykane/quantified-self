import { describe, expect, it } from 'vitest';
import {
  buildReadinessEvaluation,
  buildReadinessSignals,
  calculateReadinessScore,
  combineReadinessOvernightHeartRateRatios,
  type ReadinessSleepEvidencePoint,
} from '@shared/readiness';

function sleepPoint(
  id: string,
  sleepDate: string,
  endTimeMs: number,
  averageHeartRateBpm: number | null,
  minimumHeartRateBpm: number | null,
): ReadinessSleepEvidencePoint {
  return {
    id,
    sleepDate,
    provider: 'GarminAPI',
    startTimeMs: endTimeMs - (8 * 60 * 60 * 1000),
    endTimeMs,
    totalSeconds: 8 * 60 * 60,
    score: null,
    averageHrvMs: null,
    averageHeartRateBpm,
    minimumHeartRateBpm,
  };
}

describe('readiness', () => {
  it('blends average and minimum sleep heart rate into one bounded driver', () => {
    const baseline = [1, 2, 3].map(index => sleepPoint(
      `baseline-${index}`,
      `2026-01-0${index}`,
      index * 1000,
      60,
      50,
    ));
    const context = buildReadinessSignals({
      sleepPoints: [
        ...baseline,
        sleepPoint('latest', '2026-01-04', 4000, 54, 48),
      ],
      nowMs: 5000,
    });

    expect(context).toMatchObject({
      averageHeartRateRatio: 0.9,
      minimumHeartRateRatio: 0.96,
      availableSignalCount: 2,
    });
    expect(context?.overnightHeartRateRatio).toBeCloseTo(0.918);
  });

  it('uses minimum heart rate as a fallback without adding a fifth signal', () => {
    const baseline = [1, 2, 3].map(index => sleepPoint(
      `baseline-${index}`,
      `2026-01-0${index}`,
      index * 1000,
      null,
      50,
    ));
    const context = buildReadinessSignals({
      sleepPoints: [
        ...baseline,
        sleepPoint('latest', '2026-01-04', 4000, null, 45),
      ],
      nowMs: 5000,
    });

    expect(context).toMatchObject({
      averageHeartRateRatio: null,
      minimumHeartRateRatio: 0.9,
      overnightHeartRateRatio: 0.9,
      availableSignalCount: 2,
      totalSignalCount: 4,
    });
  });

  it('caps extreme overnight heart-rate evidence before scoring it', () => {
    const baseline = [1, 2, 3].map(index => sleepPoint(
      `baseline-${index}`,
      `2026-01-0${index}`,
      index * 1000,
      60,
      null,
    ));
    const context = buildReadinessSignals({
      sleepPoints: [
        ...baseline,
        sleepPoint('latest', '2026-01-04', 4000, 20, null),
      ],
      nowMs: 5000,
    });
    const score = calculateReadinessScore({
      overnightHeartRateRatio: context?.overnightHeartRateRatio,
    });

    expect(context?.overnightHeartRateRatio).toBe(0.8);
    expect(score).toEqual({ score: 70, availableSignalCount: 1, availableWeight: 15 });
  });

  it('uses deterministic source weights and single-measure fallbacks', () => {
    expect(combineReadinessOvernightHeartRateRatios(0.9, 0.96)).toBeCloseTo(0.918);
    expect(combineReadinessOvernightHeartRateRatios(0.9, null)).toBe(0.9);
    expect(combineReadinessOvernightHeartRateRatios(null, 0.96)).toBe(0.96);
    expect(combineReadinessOvernightHeartRateRatios(null, null)).toBeNull();
  });

  it('returns the exact selected latest and baseline evidence without changing the public signals', () => {
    const baseline = [1, 2, 3, 4].map(index => ({
      ...sleepPoint(
        `baseline-${index}`,
        `2026-01-0${index}`,
        index * 1000,
        60 + index,
        50 + index,
      ),
      averageHrvMs: 40 + (index * 10),
    }));
    const latest = {
      ...sleepPoint('latest', '2026-01-05', 5000, 55, 48),
      averageHrvMs: 70,
      score: 82,
    };
    const input = {
      form: -4,
      rampRate: 1,
      sleepPoints: [...baseline, latest],
      nowMs: 6000,
    };

    const evaluation = buildReadinessEvaluation(input);

    expect(evaluation?.signals).toEqual(buildReadinessSignals(input));
    expect(evaluation?.latestSleep).toBe(latest);
    expect(evaluation?.baselineSleep.map(point => point.id)).toEqual([
      'baseline-1',
      'baseline-2',
      'baseline-3',
      'baseline-4',
    ]);
    expect(evaluation?.hrv).toEqual({
      latestValue: 70,
      baselineMedian: 65,
      baselineValueCount: 4,
      ratio: 70 / 65,
    });
    expect(evaluation?.averageHeartRate).toEqual({
      latestValue: 55,
      baselineMedian: 62.5,
      baselineValueCount: 4,
      ratio: 55 / 62.5,
    });
  });
});
