import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  buildDashboardCartesianPoints,
  buildDashboardDateRegressionLine,
  buildLinearRegressionPoints
} from './dashboard-echarts-cartesian.helper';
import { formatDashboardDateByInterval } from './dashboard-chart-data.helper';

describe('dashboard-echarts-cartesian.helper', () => {
  it('should build and sort activity points while resolving labels and activity types', () => {
    const activityTypeAlias = Object.keys(ActivityTypes).find((key) => (
      Number.isNaN(Number(key))
      && typeof (ActivityTypes as any)[key] === 'string'
      && `${(ActivityTypes as any)[key]}`.toLowerCase() !== 'unknown sport'
    )) as string;
    const activityTypeValue = (ActivityTypes as any)[activityTypeAlias] as ActivityTypes;

    const points = buildDashboardCartesianPoints({
      data: [
        { type: 'Custom Activity', [ChartDataValueTypes.Total]: 40, count: 2 },
        { type: activityTypeAlias, [ChartDataValueTypes.Total]: 10, count: 1 },
      ],
      chartDataValueType: ChartDataValueTypes.Total,
      chartDataCategoryType: ChartDataCategoryTypes.ActivityType,
    });

    expect(points).toHaveLength(2);
    expect(points[0].label).toBe(activityTypeValue);
    expect(points[0].activityType).toBe(activityTypeValue);
    expect(points[1].label).toBe('Custom Activity');
    expect(points[1].activityType).toBeNull();
  });

  it('should build date points using interval-based labels and skip invalid dates', () => {
    const timestamp = Date.UTC(2024, 0, 1);
    const nextTimestamp = Date.UTC(2024, 0, 2);
    const points = buildDashboardCartesianPoints({
      data: [
        { time: timestamp, [ChartDataValueTypes.Total]: 10, count: 1 },
        { time: nextTimestamp, [ChartDataValueTypes.Total]: 15, count: 1 },
        { time: 'not-a-date', [ChartDataValueTypes.Total]: 20, count: 1 },
      ],
      chartDataValueType: ChartDataValueTypes.Total,
      chartDataCategoryType: ChartDataCategoryTypes.DateType,
      chartDataTimeInterval: TimeIntervals.Daily,
    });

    expect(points).toHaveLength(2);
    expect(points[0].time).toBe(timestamp);
    expect(points[0].label).toBe(formatDashboardDateByInterval(timestamp, TimeIntervals.Daily));
    expect(points[1].time).toBe(nextTimestamp);
  });

  it('should fill missing daily date buckets with zero values', () => {
    const dayOne = Date.UTC(2024, 0, 1);
    const dayThree = Date.UTC(2024, 0, 3);

    const points = buildDashboardCartesianPoints({
      data: [
        { time: dayOne, [ChartDataValueTypes.Total]: 10, count: 1 },
        { time: dayThree, [ChartDataValueTypes.Total]: 30, count: 1 },
      ],
      chartDataValueType: ChartDataValueTypes.Total,
      chartDataCategoryType: ChartDataCategoryTypes.DateType,
      chartDataTimeInterval: TimeIntervals.Daily,
    });

    expect(points).toHaveLength(3);
    expect(points[0].time).toBe(dayOne);
    expect(points[1].value).toBe(0);
    expect(points[1].count).toBe(0);
    expect(points[2].time).toBe(dayThree);
  });

  it('should fill missing biweekly date buckets using biweekly intervals instead of daily gaps', () => {
    const firstBucket = Date.UTC(2024, 0, 1);
    const thirdBucket = Date.UTC(2024, 0, 29);

    const points = buildDashboardCartesianPoints({
      data: [
        { time: firstBucket, [ChartDataValueTypes.Total]: 10, count: 1 },
        { time: thirdBucket, [ChartDataValueTypes.Total]: 30, count: 1 },
      ],
      chartDataValueType: ChartDataValueTypes.Total,
      chartDataCategoryType: ChartDataCategoryTypes.DateType,
      chartDataTimeInterval: TimeIntervals.BiWeekly,
    });

    expect(points).toHaveLength(3);
    expect(points.map(point => point.time)).toEqual([
      firstBucket,
      Date.UTC(2024, 0, 15),
      thirdBucket,
    ]);
    expect(points.map(point => point.value)).toEqual([10, 0, 30]);
  });

  it('should fill missing quarterly date buckets using quarter intervals', () => {
    const q1 = Date.UTC(2024, 0, 1);
    const q3 = Date.UTC(2024, 6, 1);

    const points = buildDashboardCartesianPoints({
      data: [
        { time: q1, [ChartDataValueTypes.Total]: 10, count: 1 },
        { time: q3, [ChartDataValueTypes.Total]: 30, count: 1 },
      ],
      chartDataValueType: ChartDataValueTypes.Total,
      chartDataCategoryType: ChartDataCategoryTypes.DateType,
      chartDataTimeInterval: TimeIntervals.Quarterly,
    });

    expect(points).toHaveLength(3);
    expect(points.map(point => point.time)).toEqual([
      q1,
      Date.UTC(2024, 3, 1),
      q3,
    ]);
    expect(points.map(point => point.value)).toEqual([10, 0, 30]);
  });

  it('should keep missing daily average buckets null instead of zero', () => {
    const dayOne = Date.UTC(2024, 0, 1);
    const dayThree = Date.UTC(2024, 0, 3);

    const points = buildDashboardCartesianPoints({
      data: [
        { time: dayOne, [ChartDataValueTypes.Average]: 10, count: 1 },
        { time: dayThree, [ChartDataValueTypes.Average]: 30, count: 1 },
      ],
      chartDataValueType: ChartDataValueTypes.Average,
      chartDataCategoryType: ChartDataCategoryTypes.DateType,
      chartDataTimeInterval: TimeIntervals.Daily,
    });

    expect(points).toHaveLength(3);
    expect(points[1].value).toBeNull();
    expect(points[1].count).toBe(0);
  });

  it('should not truncate long hourly ranges beyond ten thousand buckets', () => {
    const startHour = Date.UTC(2024, 0, 1, 0, 0, 0, 0);
    const endHour = startHour + (10000 * 60 * 60 * 1000);

    const points = buildDashboardCartesianPoints({
      data: [
        { time: startHour, [ChartDataValueTypes.Total]: 10, count: 1 },
        { time: endHour, [ChartDataValueTypes.Total]: 20, count: 1 },
      ],
      chartDataValueType: ChartDataValueTypes.Total,
      chartDataCategoryType: ChartDataCategoryTypes.DateType,
      chartDataTimeInterval: TimeIntervals.Hourly,
    });

    expect(points).toHaveLength(10001);
    expect(points[0].time).toBe(startHour);
    expect(points[0].value).toBe(10);
    expect(points[9999].value).toBe(0);
    expect(points[10000].time).toBe(endHour);
    expect(points[10000].value).toBe(20);
  }, 15000);

  it('should advance daily buckets in UTC across DST boundaries', () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = 'Europe/Berlin';

    try {
      const dayOne = Date.UTC(2024, 2, 31);
      const dayTwo = Date.UTC(2024, 3, 1);

      const points = buildDashboardCartesianPoints({
        data: [
          { time: dayOne, [ChartDataValueTypes.Total]: 10, count: 1 },
          { time: dayTwo, [ChartDataValueTypes.Total]: 20, count: 1 },
        ],
        chartDataValueType: ChartDataValueTypes.Total,
        chartDataCategoryType: ChartDataCategoryTypes.DateType,
        chartDataTimeInterval: TimeIntervals.Daily,
      });

      expect(points).toHaveLength(2);
      expect(points[0].time).toBe(dayOne);
      expect(points[1].time).toBe(dayTwo);
      expect(points.map(point => point.value)).toEqual([10, 20]);
    } finally {
      if (previousTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimeZone;
      }
    }
  });

  it('should pad a single daily date point with adjacent zero buckets', () => {
    const day = Date.UTC(2024, 0, 2);
    const points = buildDashboardCartesianPoints({
      data: [
        { time: day, [ChartDataValueTypes.Total]: 10, count: 1 }
      ],
      chartDataValueType: ChartDataValueTypes.Total,
      chartDataCategoryType: ChartDataCategoryTypes.DateType,
      chartDataTimeInterval: TimeIntervals.Daily,
    });

    expect(points).toHaveLength(3);
    expect(points[0].value).toBe(0);
    expect(points[1].value).toBe(10);
    expect(points[2].value).toBe(0);
  });

  it('should pad a single daily average point with adjacent null buckets', () => {
    const day = Date.UTC(2024, 0, 2);
    const points = buildDashboardCartesianPoints({
      data: [
        { time: day, [ChartDataValueTypes.Average]: 10, count: 1 }
      ],
      chartDataValueType: ChartDataValueTypes.Average,
      chartDataCategoryType: ChartDataCategoryTypes.DateType,
      chartDataTimeInterval: TimeIntervals.Daily,
    });

    expect(points).toHaveLength(3);
    expect(points[0].value).toBeNull();
    expect(points[1].value).toBe(10);
    expect(points[2].value).toBeNull();
  });

  it('should ignore non-finite values while preserving finite negatives', () => {
    const points = buildDashboardCartesianPoints({
      data: [
        { type: 'Running', [ChartDataValueTypes.Total]: undefined, count: 1 },
        { type: 'Cycling', [ChartDataValueTypes.Total]: 'abc', count: 1 },
        { type: 'Swimming', [ChartDataValueTypes.Total]: Number.POSITIVE_INFINITY, count: 1 },
        { type: 'Walking', [ChartDataValueTypes.Total]: -5, count: 1 },
      ],
      chartDataValueType: ChartDataValueTypes.Total,
      chartDataCategoryType: ChartDataCategoryTypes.ActivityType,
    });

    expect(points).toHaveLength(1);
    expect(points[0].label).toBe('Walking');
    expect(points[0].value).toBe(-5);
  });

  it('should compute linear regression points for finite input', () => {
    const regressionPoints = buildLinearRegressionPoints([
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 6 },
    ]);

    expect(regressionPoints).toHaveLength(3);
    expect(regressionPoints[0].y).toBeCloseTo(2, 6);
    expect(regressionPoints[1].y).toBeCloseTo(4, 6);
    expect(regressionPoints[2].y).toBeCloseTo(6, 6);
  });

  it('should return empty regression output for insufficient or degenerate points', () => {
    expect(buildLinearRegressionPoints([{ x: 1, y: 2 }])).toEqual([]);
    expect(buildLinearRegressionPoints([
      { x: 1, y: 2 },
      { x: 1, y: 3 },
    ])).toEqual([]);
  });

  it('should build a regression line from date cartesian points only', () => {
    const regression = buildDashboardDateRegressionLine([
      { index: 0, label: 'A', value: 10, count: 1, time: 1000, activityType: null, rawItem: {} },
      { index: 1, label: 'A-gap', value: 0, count: 0, time: 1500, activityType: null, rawItem: null },
      { index: 1, label: 'B', value: 20, count: 1, time: 2000, activityType: null, rawItem: {} },
      { index: 2, label: 'C', value: 30, count: 1, time: null, activityType: null, rawItem: {} },
    ]);

    expect(regression).toHaveLength(3);
    expect(regression[0].x).toBe(1000);
    expect(regression[1].x).toBe(1500);
    expect(regression[2].x).toBe(2000);
  });
});
