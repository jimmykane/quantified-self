import { describe, expect, it } from 'vitest';
import type { DerivedBodyWeightTrendMetricPayload } from '@shared/derived-metrics';
import {
  resolveTrainingBodyWeightMetricPayload,
} from './training-body-weight.helper';

function createPayload(): DerivedBodyWeightTrendMetricPayload {
  const asOfDayMs = Date.UTC(2026, 6, 16);
  const points = Array.from({ length: 28 }, (_, index) => ({
    dayMs: asOfDayMs - ((27 - index) * 24 * 60 * 60 * 1000),
    weightKg: index === 24 || index === 26 || index === 27 ? 70.2 + ((27 - index) * 0.2) : null,
  }));
  return {
    dayBoundary: 'UTC',
    asOfDayMs,
    trendDays: 28,
    comparisonWindowDays: 7,
    minimumComparableDayCount: 3,
    latestWeightKg: 70.2,
    latestWeightDayMs: asOfDayMs,
    median7dKg: 70.3,
    median28dKg: 70.7,
    change7dKg: -0.4,
    change7dPercent: -0.57,
    change28dKg: -1.2,
    change28dPercent: -1.68,
    recordedDayCount7d: 4,
    recordedDayCount28d: 8,
    points,
    series: [{
      sourceKind: 'health-measurement',
      provider: 'QuantifiedSelf',
      sourceKey: 'opaque-manual-source',
      latestWeightKg: 70.2,
      latestWeightDayMs: asOfDayMs,
      median7dKg: 70.3,
      median28dKg: 70.7,
      change7dKg: -0.4,
      change7dPercent: -0.57,
      change28dKg: -1.2,
      change28dPercent: -1.68,
      recordedDayCount7d: 4,
      recordedDayCount28d: 8,
      points,
    }],
  };
}

describe('training body-weight helper', () => {
  it('validates only the fixed UTC snapshot shape', () => {
    const payload = createPayload();

    expect(resolveTrainingBodyWeightMetricPayload(payload)).toEqual(payload);
    expect(resolveTrainingBodyWeightMetricPayload({ ...payload, trendDays: 14 })).toBeNull();
    expect(resolveTrainingBodyWeightMetricPayload({
      ...payload,
      points: payload.points.slice(1),
    })).toBeNull();
    expect(resolveTrainingBodyWeightMetricPayload({
      ...payload,
      latestWeightDayMs: null,
    })).toBeNull();
  });

  it('preserves sparse canonical observations and separate provider/account sources for explicit consumers', () => {
    const payload = createPayload();
    payload.series = [
      { ...payload.series[0], provider: 'GarminAPI', sourceKey: 'account-one' },
      { ...payload.series[0], provider: 'GarminAPI', sourceKey: 'account-two' },
    ];
    expect(resolveTrainingBodyWeightMetricPayload(payload)).toEqual(payload);
    expect(resolveTrainingBodyWeightMetricPayload(payload)?.points[0].weightKg).toBeNull();
    expect(resolveTrainingBodyWeightMetricPayload(payload)?.series).toHaveLength(2);
  });

  it('rejects duplicate source identities and mixed Health/workout fallback sources', () => {
    const payload = createPayload();
    expect(resolveTrainingBodyWeightMetricPayload({
      ...payload, series: [payload.series[0], payload.series[0]],
    })).toBeNull();
    expect(resolveTrainingBodyWeightMetricPayload({
      ...payload, series: [
        payload.series[0],
        { ...payload.series[0], sourceKind: 'workout-profile-context', provider: null, sourceKey: 'workout' },
      ],
    })).toBeNull();
  });

  it('preserves unavailable comparisons while rejecting unpaired deltas', () => {
    const payload = createPayload();
    const unavailable = {
      ...payload, change7dKg: null, change7dPercent: null,
      series: payload.series.map(series => ({ ...series, change7dKg: null, change7dPercent: null })),
    };
    expect(resolveTrainingBodyWeightMetricPayload(unavailable)).toEqual(unavailable);
    expect(resolveTrainingBodyWeightMetricPayload({ ...unavailable, change7dPercent: 1 })).toBeNull();
    expect(resolveTrainingBodyWeightMetricPayload({
      ...unavailable, series: [{ ...unavailable.series[0], change7dPercent: 1 }],
    })).toBeNull();
  });
});
