import { describe, expect, it } from 'vitest';
import { calculatePersonalMetricRange, type PersonalMetricRangeObservation } from './personal-metric-range.helper';

const DAY_MS = 24 * 60 * 60 * 1000;
const END_TIME_MS = Date.parse('2026-08-01T23:59:59.999Z');
const OPTIONS = {
  baselineWindowDays: 60,
  baselineMinimumObservationDays: 14,
  currentWindowDays: 7,
  currentMinimumObservationDays: 3,
};

function observations(values: ReadonlyArray<{ daysAgo: number; value: number }>): PersonalMetricRangeObservation[] {
  return values.map(({ daysAgo, value }) => {
    const timestampMs = Date.parse('2026-08-01T00:00:00.000Z') - (daysAgo * DAY_MS);
    return {
      timestampMs,
      calendarDate: new Date(timestampMs).toISOString().slice(0, 10),
      value,
    };
  });
}

describe('personal metric range helper', () => {
  it('stays neutral while the baseline or current window is incomplete', () => {
    expect(calculatePersonalMetricRange(observations(
      Array.from({ length: 13 }, (_, daysAgo) => ({ daysAgo, value: 50 })),
    ), END_TIME_MS, OPTIONS)).toMatchObject({
      tone: 'neutral',
      reason: 'building_baseline',
      observationDayCount: 13,
    });

    expect(calculatePersonalMetricRange(observations([
      ...Array.from({ length: 14 }, (_, index) => ({ daysAgo: index + 7, value: 50 })),
      { daysAgo: 0, value: 51 },
      { daysAgo: 2, value: 52 },
    ]), END_TIME_MS, OPTIONS)).toMatchObject({
      tone: 'neutral',
      reason: 'insufficient_current',
      currentObservationDayCount: 2,
    });
  });

  it('grades both unusually high and unusually low current averages symmetrically', () => {
    const baseline = Array.from({ length: 17 }, (_, index) => ({ daysAgo: index + 7, value: 50 }));
    const high = calculatePersonalMetricRange(observations([
      ...baseline,
      { daysAgo: 0, value: 100 },
      { daysAgo: 2, value: 100 },
      { daysAgo: 4, value: 100 },
    ]), END_TIME_MS, OPTIONS);
    const low = calculatePersonalMetricRange(observations([
      ...baseline,
      { daysAgo: 0, value: 0 },
      { daysAgo: 2, value: 0 },
      { daysAgo: 4, value: 0 },
    ]), END_TIME_MS, OPTIONS);

    expect(high).toMatchObject({ tone: 'negative', reason: 'far_outside_range' });
    expect(low).toMatchObject({ tone: 'negative', reason: 'far_outside_range' });
  });

  it('uses one median value per calendar day', () => {
    const sameDay = observations(Array.from({ length: 14 }, (_, index) => ({ daysAgo: 0, value: 40 + index })));

    expect(calculatePersonalMetricRange(sameDay, END_TIME_MS, OPTIONS)).toMatchObject({
      reason: 'building_baseline',
      observationDayCount: 1,
    });
  });

  it('excludes observations before the configured baseline window', () => {
    const result = calculatePersonalMetricRange(observations([
      ...Array.from({ length: 14 }, (_, daysAgo) => ({ daysAgo, value: 50 + (daysAgo % 2) })),
      { daysAgo: 60, value: 500 },
    ]), END_TIME_MS, OPTIONS);

    expect(result.observationDayCount).toBe(14);
    expect(result.baselineAverage).toBeLessThan(60);
  });
});
