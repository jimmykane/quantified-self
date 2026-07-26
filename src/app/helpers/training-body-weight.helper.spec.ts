import { describe, expect, it } from 'vitest';
import type { DerivedBodyWeightTrendMetricPayload } from '@shared/derived-metrics';
import {
  buildTrainingBodyWeightViewModel,
  resolveTrainingBodyWeightMetricPayload,
} from './training-body-weight.helper';

function createPayload(): DerivedBodyWeightTrendMetricPayload {
  const asOfDayMs = Date.UTC(2026, 6, 16);
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
    points: Array.from({ length: 28 }, (_, index) => ({
      dayMs: asOfDayMs - ((27 - index) * 24 * 60 * 60 * 1000),
      weightKg: index === 24 || index === 26 || index === 27 ? 70.2 + ((27 - index) * 0.2) : null,
    })),
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

  it('builds a neutral, gap-preserving chart and comparison labels', () => {
    const payload = createPayload();
    const model = buildTrainingBodyWeightViewModel(payload, 'ready', null, 'en-US');

    expect(model).toMatchObject({
      state: 'ready',
      isUpdating: false,
      latestWeightText: '70.2 kg',
      median7dText: '70.3 kg',
      median28dText: '70.7 kg',
      change7dText: '−0.4 kg (−0.6%)',
      coverageText: '8/28 days recorded',
    });
    expect(model.chartPoints).toHaveLength(28);
    expect(model.chartPoints[0].y).toBeNull();
    expect(model.chartSegments).toHaveLength(2);
    expect(model.sourceText).toContain('does not change Readiness');
  });

  it('does not claim a comparison when its source windows are sparse', () => {
    const payload = {
      ...createPayload(),
      change7dKg: null,
      change7dPercent: null,
      change28dKg: null,
      change28dPercent: null,
    };

    const model = buildTrainingBodyWeightViewModel(payload, 'ready', null);

    expect(model.change7dText).toBe('Not enough comparison data');
    expect(model.change28dText).toBe('Not enough comparison data');
  });
});
