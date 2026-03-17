import { describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  DataActivityTypes,
  DataAscent,
  DataDistance,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import {
  buildEventStatAggregation,
  filterEventStatsForAggregation,
  resolveAggregationCategoryKey,
  resolveAutoAggregationTimeInterval,
} from '@shared/event-stat-aggregation';

type MockEventOptions = {
  id?: string;
  startDate: Date;
  activityTypes: ActivityTypes[];
  displayActivityType?: string;
  stats?: Record<string, number | null | undefined>;
};

function createActivityTypeStat(displayValue: string, activityTypes: ActivityTypes[]) {
  return {
    getValue: () => activityTypes.map(type => `${type}`),
    getDisplayValue: () => displayValue,
  };
}

function makeEvent(options: MockEventOptions): any {
  const displayActivityType = options.displayActivityType || `${options.activityTypes[0] || ''}`;
  const activityTypeStat = createActivityTypeStat(displayActivityType, options.activityTypes);
  const stats = options.stats || {};

  return {
    startDate: options.startDate,
    getID: () => options.id || `${options.startDate.getTime()}`,
    getActivityTypesAsArray: () => [...options.activityTypes],
    getStat: (type: string) => {
      if (type === DataActivityTypes.type) {
        return activityTypeStat;
      }

      const value = stats[type];
      if (value === null || value === undefined) {
        return null;
      }

      return {
        getValue: () => value,
      };
    },
  };
}

describe('event-stat-aggregation shared core', () => {
  it('should resolve auto interval for empty, single-day, cross-month and cross-year event sets', () => {
    expect(resolveAutoAggregationTimeInterval([])).toBe(TimeIntervals.Daily);

    expect(resolveAutoAggregationTimeInterval([
      makeEvent({
        startDate: new Date('2024-01-01T10:00:00.000Z'),
        activityTypes: [ActivityTypes.Running],
      }),
      makeEvent({
        startDate: new Date('2024-01-01T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Running],
      }),
    ])).toBe(TimeIntervals.Hourly);

    expect(resolveAutoAggregationTimeInterval([
      makeEvent({
        startDate: new Date('2024-01-25T10:00:00.000Z'),
        activityTypes: [ActivityTypes.Running],
      }),
      makeEvent({
        startDate: new Date('2024-02-10T10:00:00.000Z'),
        activityTypes: [ActivityTypes.Running],
      }),
    ])).toBe(TimeIntervals.Daily);

    expect(resolveAutoAggregationTimeInterval([
      makeEvent({
        startDate: new Date('2024-01-01T10:00:00.000Z'),
        activityTypes: [ActivityTypes.Running],
      }),
      makeEvent({
        startDate: new Date('2025-01-01T10:00:00.000Z'),
        activityTypes: [ActivityTypes.Running],
      }),
    ])).toBe(TimeIntervals.Yearly);
  });

  it('should resolve known, unknown and multisport activity category keys', () => {
    const logger = { error: vi.fn() };

    expect(resolveAggregationCategoryKey(
      makeEvent({
        startDate: new Date('2024-01-01T10:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        displayActivityType: 'Cycling',
      }),
      ChartDataCategoryTypes.ActivityType,
      TimeIntervals.Daily,
      logger,
    )).toBe(ActivityTypes.Cycling);

    expect(resolveAggregationCategoryKey(
      makeEvent({
        startDate: new Date('2024-01-01T10:00:00.000Z'),
        activityTypes: [ActivityTypes.Running],
        displayActivityType: 'Custom Activity',
      }),
      ChartDataCategoryTypes.ActivityType,
      TimeIntervals.Daily,
      logger,
    )).toBe('??');

    expect(resolveAggregationCategoryKey(
      makeEvent({
        startDate: new Date('2024-01-01T10:00:00.000Z'),
        activityTypes: [ActivityTypes.Running, ActivityTypes.Cycling],
        displayActivityType: 'Running',
      }),
      ChartDataCategoryTypes.ActivityType,
      TimeIntervals.Daily,
      logger,
    )).toBe(ActivityTypes.Multisport);
  });

  it('should filter ascent exclusions using both automatic and manual preferences', () => {
    const skiingEvent = makeEvent({
      startDate: new Date('2024-01-01T10:00:00.000Z'),
      activityTypes: [ActivityTypes.AlpineSki],
      stats: { [DataAscent.type]: 500 },
    });
    const runningEvent = makeEvent({
      startDate: new Date('2024-01-02T10:00:00.000Z'),
      activityTypes: [ActivityTypes.Running],
      stats: { [DataAscent.type]: 150 },
    });

    const autoFiltered = filterEventStatsForAggregation(
      [skiingEvent, runningEvent],
      DataAscent.type,
      {},
    );
    expect(autoFiltered).toEqual([runningEvent]);

    const manuallyFiltered = filterEventStatsForAggregation(
      [runningEvent],
      DataAscent.type,
      { removeAscentForEventTypes: [ActivityTypes.Running] },
    );
    expect(manuallyFiltered).toEqual([]);
  });

  it('should return empty buckets for zero totals and non-finite aggregates', () => {
    const zeroTotal = buildEventStatAggregation([
      makeEvent({
        startDate: new Date('2024-01-01T10:00:00.000Z'),
        activityTypes: [ActivityTypes.Running],
        stats: { [DataDistance.type]: 0 },
      }),
    ], {
      dataType: DataDistance.type,
      valueType: ChartDataValueTypes.Total,
      categoryType: ChartDataCategoryTypes.ActivityType,
    });
    expect(zeroTotal.buckets).toEqual([]);

    const missingAverage = buildEventStatAggregation([
      makeEvent({
        startDate: new Date('2024-01-01T10:00:00.000Z'),
        activityTypes: [ActivityTypes.Running],
        stats: {},
      }),
    ], {
      dataType: DataDistance.type,
      valueType: ChartDataValueTypes.Average,
      categoryType: ChartDataCategoryTypes.ActivityType,
    });
    expect(missingAverage.buckets).toEqual([]);
  });

  it('should build total, average, minimum and maximum date buckets and preserve per-series counts', () => {
    const events = [
      makeEvent({
        id: 'run-1',
        startDate: new Date('2024-01-01T10:00:00.000Z'),
        activityTypes: [ActivityTypes.Running],
        displayActivityType: 'Running',
        stats: { [DataDistance.type]: 5 },
      }),
      makeEvent({
        id: 'cycle-1',
        startDate: new Date('2024-01-01T11:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        displayActivityType: 'Cycling',
        stats: { [DataDistance.type]: 15 },
      }),
      makeEvent({
        id: 'run-2',
        startDate: new Date('2024-01-02T10:00:00.000Z'),
        activityTypes: [ActivityTypes.Running],
        displayActivityType: 'Running',
        stats: { [DataDistance.type]: 20 },
      }),
    ];

    const total = buildEventStatAggregation(events, {
      dataType: DataDistance.type,
      valueType: ChartDataValueTypes.Total,
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Daily,
    });
    expect(total.buckets).toHaveLength(2);
    expect(total.buckets[0].aggregateValue).toBe(20);
    expect(total.buckets[0].seriesValues.Running).toBe(5);
    expect(total.buckets[0].seriesValues.Cycling).toBe(15);
    expect(total.buckets[0].seriesCounts.Running).toBe(1);
    expect(total.buckets[0].seriesCounts.Cycling).toBe(1);

    const average = buildEventStatAggregation(events, {
      dataType: DataDistance.type,
      valueType: ChartDataValueTypes.Average,
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Daily,
    });
    expect(average.buckets[0].aggregateValue).toBe(10);
    expect(average.buckets[1].aggregateValue).toBe(20);

    const minimum = buildEventStatAggregation(events, {
      dataType: DataDistance.type,
      valueType: ChartDataValueTypes.Minimum,
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Daily,
    });
    expect(minimum.buckets[0].aggregateValue).toBe(5);

    const maximum = buildEventStatAggregation(events, {
      dataType: DataDistance.type,
      valueType: ChartDataValueTypes.Maximum,
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Daily,
    });
    expect(maximum.buckets[0].aggregateValue).toBe(15);
  });

  it('should not mutate the caller event array while normalizing chronologically', () => {
    const first = makeEvent({
      id: 'later',
      startDate: new Date('2024-01-02T10:00:00.000Z'),
      activityTypes: [ActivityTypes.Running],
      stats: { [DataDistance.type]: 20 },
    });
    const second = makeEvent({
      id: 'earlier',
      startDate: new Date('2024-01-01T10:00:00.000Z'),
      activityTypes: [ActivityTypes.Running],
      stats: { [DataDistance.type]: 10 },
    });
    const events = [first, second];

    buildEventStatAggregation(events, {
      dataType: DataDistance.type,
      valueType: ChartDataValueTypes.Total,
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Daily,
    });

    expect(events[0]).toBe(first);
    expect(events[1]).toBe(second);
  });
});
