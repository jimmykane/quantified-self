import { TimeIntervals } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  buildDashboardFormRenderPoints,
  buildDashboardFormPoints,
  buildDashboardFormPointsFromDailyLoads,
  extendDashboardFormPointsWithZeroLoadUntil,
  resolveDashboardFormLatestPoint,
  resolveDashboardFormRenderTimeInterval,
  resolveDashboardFormStatus,
  resolveDashboardFormTrainingStressScore,
  resolveDashboardFormValue,
  DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
} from './dashboard-form.helper';

function buildEvent(startTimeMs: number, stats: Record<string, unknown>): any {
  return {
    startDate: new Date(startTimeMs),
    getStat: (type: string) => (
      Object.prototype.hasOwnProperty.call(stats, type)
        ? { getValue: () => stats[type] }
        : null
    ),
  };
}

describe('dashboard-form.helper', () => {
  it('should resolve training stress score from current and legacy stat types', () => {
    const preferredEvent = buildEvent(Date.UTC(2024, 0, 1), {
      [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 44.5,
      ['Power Training Stress Score']: 12,
    });
    const legacyOnlyEvent = buildEvent(Date.UTC(2024, 0, 1), {
      ['Power Training Stress Score']: 13.7,
    });

    expect(resolveDashboardFormTrainingStressScore(preferredEvent)).toBe(44.5);
    expect(resolveDashboardFormTrainingStressScore(legacyOnlyEvent)).toBe(13.7);
  });

  it('should return null training stress score when no finite stat value exists', () => {
    const invalidEvent = buildEvent(Date.UTC(2024, 0, 1), {
      [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: NaN,
    });
    const emptyEvent = buildEvent(Date.UTC(2024, 0, 1), {});

    expect(resolveDashboardFormTrainingStressScore(invalidEvent)).toBeNull();
    expect(resolveDashboardFormTrainingStressScore(emptyEvent)).toBeNull();
  });

  it('should include legacy-only stress stats when building daily points', () => {
    const points = buildDashboardFormPoints([
      buildEvent(Date.UTC(2024, 0, 1, 10, 0, 0), {
        [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 10,
      }),
      buildEvent(Date.UTC(2024, 0, 3, 16, 0, 0), {
        ['Power Training Stress Score']: 20,
      }),
    ]);

    expect(points).toHaveLength(3);
    expect(points.map(point => point.trainingStressScore)).toEqual([10, 0, 20]);
  });

  it('should build form points from UTC daily-load series with contiguous zero-filled days', () => {
    const points = buildDashboardFormPointsFromDailyLoads([
      [Date.UTC(2024, 0, 1), 30],
      [Date.UTC(2024, 0, 3), 10],
    ]);

    expect(points).toHaveLength(3);
    expect(points.map(point => point.time)).toEqual([
      Date.UTC(2024, 0, 1),
      Date.UTC(2024, 0, 2),
      Date.UTC(2024, 0, 3),
    ]);
    expect(points.map(point => point.trainingStressScore)).toEqual([30, 0, 10]);
  });

  it('should parse object-based daily loads used by Firestore snapshots', () => {
    const points = buildDashboardFormPointsFromDailyLoads([
      { dayMs: Date.UTC(2024, 0, 1), load: 30 },
      { dayMs: Date.UTC(2024, 0, 3), load: 10 },
    ]);

    expect(points).toHaveLength(3);
    expect(points.map(point => point.time)).toEqual([
      Date.UTC(2024, 0, 1),
      Date.UTC(2024, 0, 2),
      Date.UTC(2024, 0, 3),
    ]);
    expect(points.map(point => point.trainingStressScore)).toEqual([30, 0, 10]);
  });

  it('should bucket training stress by runtime local calendar day boundaries', () => {
    const firstStartTimeMs = Date.parse('2024-01-01T23:30:00.000Z');
    const secondStartTimeMs = Date.parse('2024-01-02T00:30:00.000Z');
    const points = buildDashboardFormPoints([
      buildEvent(firstStartTimeMs, {
        [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 10,
      }),
      buildEvent(secondStartTimeMs, {
        [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 20,
      }),
    ]);

    const expectedDailyScores = new Map<number, number>();
    [firstStartTimeMs, secondStartTimeMs].forEach((timeMs, index) => {
      const date = new Date(timeMs);
      const localDayStartMs = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      const stressScore = index === 0 ? 10 : 20;
      expectedDailyScores.set(localDayStartMs, (expectedDailyScores.get(localDayStartMs) || 0) + stressScore);
    });

    const expectedBucketTimes = [...expectedDailyScores.keys()].sort((left, right) => left - right);
    expect(points).toHaveLength(expectedBucketTimes.length);
    points.forEach((point, index) => {
      const expectedTime = expectedBucketTimes[index];
      expect(point.time).toBe(expectedTime);
      expect(point.trainingStressScore).toBe(expectedDailyScores.get(expectedTime));
    });
  });

  it('should return no points when no events include training stress score stats', () => {
    const points = buildDashboardFormPoints([
      buildEvent(Date.UTC(2024, 0, 1), {}),
      buildEvent(Date.UTC(2024, 0, 2), {
        [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: NaN,
      }),
      buildEvent(Date.UTC(2024, 0, 3), {
        [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: '',
      }),
    ]);

    expect(points).toEqual([]);
  });

  it('should compute CTL/ATL and same-day/prior-day form values', () => {
    const points = buildDashboardFormPoints([
      buildEvent(Date.UTC(2024, 0, 1), {
        [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 10,
      }),
      buildEvent(Date.UTC(2024, 0, 2), {
        [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 0,
      }),
    ]);

    expect(points).toHaveLength(2);

    expect(points[0].ctl).toBeCloseTo(0.238095, 5);
    expect(points[0].atl).toBeCloseTo(1.428571, 5);
    expect(points[0].formSameDay).toBeCloseTo(-1.190476, 5);
    expect(points[0].formPriorDay).toBeNull();

    expect(points[1].ctl).toBeCloseTo(0.232426, 5);
    expect(points[1].atl).toBeCloseTo(1.22449, 5);
    expect(points[1].formSameDay).toBeCloseTo(-0.992063, 5);
    expect(points[1].formPriorDay).toBeCloseTo(-1.190476, 5);
  });

  it('should resolve form render interval to fixed weekly granularity', () => {
    const shortRangePoints = buildDashboardFormPoints([
      buildEvent(Date.UTC(2024, 0, 1), {
        [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 10,
      }),
      buildEvent(Date.UTC(2024, 0, 20), {
        [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 20,
      }),
    ]);
    const longSameYearPoints = buildDashboardFormPoints([
      buildEvent(Date.UTC(2024, 0, 1), {
        [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 10,
      }),
      buildEvent(Date.UTC(2024, 3, 15), {
        [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 20,
      }),
    ]);
    const crossYearPoints = buildDashboardFormPoints([
      buildEvent(Date.UTC(2024, 10, 1), {
        [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 10,
      }),
      buildEvent(Date.UTC(2025, 1, 10), {
        [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 20,
      }),
    ]);

    expect(resolveDashboardFormRenderTimeInterval(shortRangePoints)).toBe(TimeIntervals.Weekly);
    expect(resolveDashboardFormRenderTimeInterval(longSameYearPoints)).toBe(TimeIntervals.Weekly);
    expect(resolveDashboardFormRenderTimeInterval(crossYearPoints)).toBe(TimeIntervals.Weekly);
  });

  it('should aggregate render points by monthly and yearly buckets while preserving latest CTL/ATL/form in bucket', () => {
    const points = buildDashboardFormPointsFromDailyLoads([
      { dayMs: Date.UTC(2024, 0, 1), load: 10 },
      { dayMs: Date.UTC(2024, 0, 20), load: 20 },
      { dayMs: Date.UTC(2024, 1, 10), load: 30 },
      { dayMs: Date.UTC(2025, 0, 10), load: 40 },
    ]);

    const monthly = buildDashboardFormRenderPoints(points, TimeIntervals.Monthly);
    const yearly = buildDashboardFormRenderPoints(points, TimeIntervals.Yearly);

    expect(monthly).toHaveLength(13);

    const january2024 = monthly.find(point => point.time === Date.UTC(2024, 0, 1));
    const february2024 = monthly.find(point => point.time === Date.UTC(2024, 1, 1));
    const january2025 = monthly.find(point => point.time === Date.UTC(2025, 0, 1));

    expect(january2024?.trainingStressScore).toBe(30);
    expect(february2024?.trainingStressScore).toBe(30);
    expect(january2025?.trainingStressScore).toBe(40);

    const january2024End = points.find(point => point.time === Date.UTC(2024, 0, 31));
    const february2024End = points.find(point => point.time === Date.UTC(2024, 1, 29));
    const january2025End = points.find(point => point.time === Date.UTC(2025, 0, 10));

    expect(january2024?.ctl).toBeCloseTo(january2024End?.ctl || 0, 8);
    expect(february2024?.ctl).toBeCloseTo(february2024End?.ctl || 0, 8);
    expect(january2025?.ctl).toBeCloseTo(january2025End?.ctl || 0, 8);

    expect(yearly).toHaveLength(2);
    expect(yearly.map(point => point.trainingStressScore)).toEqual([60, 40]);

    const year2024End = points.find(point => point.time === Date.UTC(2024, 11, 31));
    const year2025End = points.find(point => point.time === Date.UTC(2025, 0, 10));

    expect(yearly[0].ctl).toBeCloseTo(year2024End?.ctl || 0, 8);
    expect(yearly[1].ctl).toBeCloseTo(year2025End?.ctl || 0, 8);
  });

  it('should aggregate render points by weekly buckets while preserving latest CTL/ATL/form in bucket', () => {
    const points = buildDashboardFormPointsFromDailyLoads([
      { dayMs: Date.UTC(2024, 0, 1), load: 10 },
      { dayMs: Date.UTC(2024, 0, 2), load: 20 },
      { dayMs: Date.UTC(2024, 0, 8), load: 30 },
    ]);

    const weekly = buildDashboardFormRenderPoints(points, TimeIntervals.Weekly);
    expect(weekly.length).toBeLessThan(points.length);
    expect(weekly[0].trainingStressScore).toBe(30);
    expect(weekly[1].trainingStressScore).toBe(30);
  });

  it('should bucket weekly render points by UTC Monday boundaries for derived daily loads', () => {
    const points = buildDashboardFormPointsFromDailyLoads([
      { dayMs: Date.UTC(2024, 0, 7), load: 10 }, // Sunday
      { dayMs: Date.UTC(2024, 0, 8), load: 20 }, // Monday
    ]);

    const weekly = buildDashboardFormRenderPoints(points, TimeIntervals.Weekly);

    expect(weekly).toHaveLength(2);
    expect(weekly.map(point => point.time)).toEqual([
      Date.UTC(2024, 0, 1),
      Date.UTC(2024, 0, 8),
    ]);
    expect(weekly.map(point => point.trainingStressScore)).toEqual([10, 20]);
  });

  it('should resolve same-day and prior-day form values safely', () => {
    const points = buildDashboardFormPoints([
      buildEvent(Date.UTC(2024, 0, 1), {
        [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 10,
      }),
      buildEvent(Date.UTC(2024, 0, 2), {
        [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 20,
      }),
    ]);

    expect(resolveDashboardFormValue(points[0], 'same-day')).toBeCloseTo(points[0].formSameDay, 8);
    expect(resolveDashboardFormValue(points[0], 'prior-day')).toBeNull();
    expect(resolveDashboardFormValue(points[1], 'prior-day')).toBeCloseTo(points[1].formPriorDay as number, 8);
    expect(resolveDashboardFormValue(null, 'same-day')).toBeNull();
  });

  it('should resolve the latest form point when points are available', () => {
    const points = buildDashboardFormPoints([
      buildEvent(Date.UTC(2024, 0, 1), {
        [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 10,
      }),
      buildEvent(Date.UTC(2024, 0, 2), {
        [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 20,
      }),
    ]);

    expect(resolveDashboardFormLatestPoint(points)).toEqual(points[1]);
    expect(resolveDashboardFormLatestPoint([])).toBeNull();
  });

  it('should extend form points with zero-load decay until a target day', () => {
    const points = buildDashboardFormPointsFromDailyLoads([
      { dayMs: Date.UTC(2024, 0, 1), load: 30 },
      { dayMs: Date.UTC(2024, 0, 2), load: 10 },
    ]);

    const extended = extendDashboardFormPointsWithZeroLoadUntil(points, Date.UTC(2024, 0, 5, 16, 0, 0));
    expect(extended[extended.length - 1].time).toBe(Date.UTC(2024, 0, 5));
    expect(extended.slice(points.length).every(point => point.trainingStressScore === 0)).toBe(true);
    expect(extended[extended.length - 1].ctl).toBeLessThan(points[points.length - 1].ctl);
    expect(extended[extended.length - 1].atl).toBeLessThan(points[points.length - 1].atl);
  });

  it('should map form value bands to the expected dynamic status title', () => {
    expect(resolveDashboardFormStatus(-25).title).toBe('High fatigue');
    expect(resolveDashboardFormStatus(-7).title).toBe('Building fitness');
    expect(resolveDashboardFormStatus(-5).title).toBe('Maintaining fitness');
    expect(resolveDashboardFormStatus(2).title).toBe('Maintaining fitness');
    expect(resolveDashboardFormStatus(9).title).toBe('Fresh');
    expect(resolveDashboardFormStatus(null).title).toBe('Fresh');
  });
});
