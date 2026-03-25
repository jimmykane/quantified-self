import { describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataActivityTypes,
  TimeIntervals,
  type EventInterface,
} from '@sports-alliance/sports-lib';
import { buildInsightSummary, buildNonAggregateEmptySummary } from './insight-summary';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

function buildMockEvent(params: {
  eventId: string;
  startDate: string;
  activityType: ActivityTypes;
  metricDataType: string;
  metricValue: number;
}): EventInterface {
  return {
    startDate: new Date(params.startDate),
    getID: () => params.eventId,
    getActivityTypesAsArray: () => [params.activityType],
    getStat: (dataType: string) => {
      if (dataType === params.metricDataType) {
        return {
          getValue: () => params.metricValue,
        };
      }
      if (dataType === DataActivityTypes.type) {
        return {
          getValue: () => [params.activityType],
          getDisplayValue: () => params.activityType,
        };
      }
      return null;
    },
  } as unknown as EventInterface;
}

function toLocalHourlyBucketKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  return `${year}-${month}-${day}T${hours}`;
}

describe('insight-summary', () => {
  it('builds date-based summaries with latest bucket, coverage, and trend', () => {
    const query = {
      resultKind: 'aggregate' as const,
      dataType: 'Average Cadence',
      valueType: ChartDataValueTypes.Average,
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Monthly,
      activityTypeGroups: [],
      activityTypes: [ActivityTypes.Cycling],
      dateRange: {
        kind: 'bounded' as const,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-03-31T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt' as const,
      },
      chartType: ChartTypes.LinesVertical,
    };

    const summary = buildInsightSummary(query, {
      resolvedTimeInterval: TimeIntervals.Monthly,
      buckets: [
        { bucketKey: '2026-01', time: 1, aggregateValue: 80, totalCount: 2 },
        { bucketKey: '2026-02', time: 2, aggregateValue: 84, totalCount: 4 },
      ],
    }, 6, [{ activityType: ActivityTypes.Cycling, eventCount: 6 }]);

    expect(summary.overallAggregateValue).toBeCloseTo(82.6666666667);
    expect(summary.latestBucket).toEqual(expect.objectContaining({
      bucketKey: '2026-02',
      aggregateValue: 84,
    }));
    expect(summary.bucketCoverage).toEqual({
      nonEmptyBucketCount: 2,
      totalBucketCount: 3,
    });
    expect(summary.trend).toEqual({
      previousBucket: {
        bucketKey: '2026-01',
        time: 1,
        aggregateValue: 80,
        totalCount: 2,
      },
      deltaAggregateValue: 4,
    });
    expect(summary.periodDeltas).toBeNull();
  });

  it('prefers query valueType over aggregation valueType for single-metric summaries', () => {
    const query = {
      resultKind: 'aggregate' as const,
      dataType: 'Average Cadence',
      valueType: ChartDataValueTypes.Average,
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Monthly,
      activityTypeGroups: [],
      activityTypes: [ActivityTypes.Cycling],
      dateRange: {
        kind: 'bounded' as const,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-03-31T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt' as const,
      },
      chartType: ChartTypes.LinesVertical,
    };

    const summary = buildInsightSummary(query, {
      valueType: ChartDataValueTypes.Maximum,
      resolvedTimeInterval: TimeIntervals.Monthly,
      buckets: [
        { bucketKey: '2026-01', time: 1, aggregateValue: 80, totalCount: 2 },
        { bucketKey: '2026-02', time: 2, aggregateValue: 84, totalCount: 4 },
      ],
    }, 6, [{ activityType: ActivityTypes.Cycling, eventCount: 6 }]);

    expect(summary.overallAggregateValue).toBeCloseTo(82.6666666667);
    expect(summary.periodDeltas).toBeNull();
  });

  it('omits latest bucket for non-date grouped summaries and preserves activity mix', () => {
    const query = {
      resultKind: 'aggregate' as const,
      dataType: 'Distance',
      valueType: ChartDataValueTypes.Total,
      categoryType: ChartDataCategoryTypes.ActivityType,
      requestedTimeInterval: null,
      activityTypeGroups: [],
      activityTypes: [],
      dateRange: {
        kind: 'bounded' as const,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-03-31T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt' as const,
      },
      chartType: ChartTypes.ColumnsHorizontal,
    };

    const summary = buildInsightSummary(query, {
      resolvedTimeInterval: TimeIntervals.Monthly,
      buckets: [
        { bucketKey: ActivityTypes.Diving, aggregateValue: 0, totalCount: 2 },
        { bucketKey: ActivityTypes.Yoga, aggregateValue: 0, totalCount: 3 },
        { bucketKey: ActivityTypes.Cycling, aggregateValue: 24500, totalCount: 5 },
      ],
    }, 10, [
      { activityType: ActivityTypes.Cycling, eventCount: 5 },
      { activityType: ActivityTypes.Yoga, eventCount: 3 },
      { activityType: ActivityTypes.Diving, eventCount: 2 },
      { activityType: ActivityTypes.Running, eventCount: 1 },
    ]);

    expect(summary.latestBucket).toBeNull();
    expect(summary.activityMix).toEqual({
      topActivityTypes: [
        { activityType: ActivityTypes.Cycling, eventCount: 5 },
        { activityType: ActivityTypes.Yoga, eventCount: 3 },
        { activityType: ActivityTypes.Diving, eventCount: 2 },
      ],
      remainingActivityTypeCount: 1,
    });
    expect(summary.periodDeltas).toBeNull();
  });

  it('builds compare-mode period deltas with deterministic activity contributors', () => {
    const query = {
      resultKind: 'aggregate' as const,
      dataType: 'Average Power',
      valueType: ChartDataValueTypes.Average,
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Monthly,
      activityTypeGroups: [],
      activityTypes: [ActivityTypes.Cycling, ActivityTypes.Running],
      dateRange: {
        kind: 'bounded' as const,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-03-31T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt' as const,
      },
      periodMode: 'compare' as const,
      chartType: ChartTypes.LinesVertical,
    };

    const matchedEvents = [
      buildMockEvent({
        eventId: 'jan-cycling-a',
        startDate: '2026-01-10T08:00:00.000Z',
        activityType: ActivityTypes.Cycling,
        metricDataType: query.dataType,
        metricValue: 210,
      }),
      buildMockEvent({
        eventId: 'jan-running',
        startDate: '2026-01-11T08:00:00.000Z',
        activityType: ActivityTypes.Running,
        metricDataType: query.dataType,
        metricValue: 240,
      }),
      buildMockEvent({
        eventId: 'jan-cycling-b',
        startDate: '2026-01-12T08:00:00.000Z',
        activityType: ActivityTypes.Cycling,
        metricDataType: query.dataType,
        metricValue: 210,
      }),
      buildMockEvent({
        eventId: 'feb-cycling-a',
        startDate: '2026-02-10T08:00:00.000Z',
        activityType: ActivityTypes.Cycling,
        metricDataType: query.dataType,
        metricValue: 225,
      }),
      buildMockEvent({
        eventId: 'feb-running',
        startDate: '2026-02-11T08:00:00.000Z',
        activityType: ActivityTypes.Running,
        metricDataType: query.dataType,
        metricValue: 235,
      }),
      buildMockEvent({
        eventId: 'feb-cycling-b',
        startDate: '2026-02-12T08:00:00.000Z',
        activityType: ActivityTypes.Cycling,
        metricDataType: query.dataType,
        metricValue: 230,
      }),
      buildMockEvent({
        eventId: 'feb-running-b',
        startDate: '2026-02-13T08:00:00.000Z',
        activityType: ActivityTypes.Running,
        metricDataType: query.dataType,
        metricValue: 230,
      }),
      buildMockEvent({
        eventId: 'mar-cycling-a',
        startDate: '2026-03-10T08:00:00.000Z',
        activityType: ActivityTypes.Cycling,
        metricDataType: query.dataType,
        metricValue: 240,
      }),
      buildMockEvent({
        eventId: 'mar-running',
        startDate: '2026-03-11T08:00:00.000Z',
        activityType: ActivityTypes.Running,
        metricDataType: query.dataType,
        metricValue: 220,
      }),
      buildMockEvent({
        eventId: 'mar-cycling-b',
        startDate: '2026-03-12T08:00:00.000Z',
        activityType: ActivityTypes.Cycling,
        metricDataType: query.dataType,
        metricValue: 235,
      }),
      buildMockEvent({
        eventId: 'mar-running-b',
        startDate: '2026-03-13T08:00:00.000Z',
        activityType: ActivityTypes.Running,
        metricDataType: query.dataType,
        metricValue: 225,
      }),
    ];

    const summary = buildInsightSummary(query, {
      resolvedTimeInterval: TimeIntervals.Monthly,
      buckets: [
        {
          bucketKey: '2026-01',
          time: 1,
          aggregateValue: 220,
          totalCount: 3,
          seriesValues: {
            [ActivityTypes.Cycling]: 210,
            [ActivityTypes.Running]: 240,
          },
        },
        {
          bucketKey: '2026-02',
          time: 2,
          aggregateValue: 230,
          totalCount: 4,
          seriesValues: {
            [ActivityTypes.Cycling]: 225,
            [ActivityTypes.Running]: 235,
          },
        },
        {
          bucketKey: '2026-03',
          time: 3,
          aggregateValue: 230,
          totalCount: 4,
          seriesValues: {
            [ActivityTypes.Cycling]: 240,
            [ActivityTypes.Running]: 220,
          },
        },
      ],
    }, 11, [
      { activityType: ActivityTypes.Cycling, eventCount: 8 },
      { activityType: ActivityTypes.Running, eventCount: 3 },
    ], matchedEvents);

    expect(summary.periodDeltas).toEqual([
      {
        fromBucket: {
          bucketKey: '2026-01',
          time: 1,
          aggregateValue: 220,
          totalCount: 3,
        },
        toBucket: {
          bucketKey: '2026-02',
          time: 2,
          aggregateValue: 230,
          totalCount: 4,
        },
        deltaAggregateValue: 10,
        direction: 'increase',
        contributors: [
          {
            seriesKey: ActivityTypes.Cycling,
            deltaAggregateValue: 15,
            direction: 'increase',
          },
          {
            seriesKey: ActivityTypes.Running,
            deltaAggregateValue: -5,
            direction: 'decrease',
          },
        ],
        eventContributors: [
          expect.objectContaining({
            eventId: 'jan-running',
            direction: 'decrease',
          }),
          expect.objectContaining({
            eventId: 'jan-cycling-b',
            direction: 'decrease',
          }),
          expect.objectContaining({
            eventId: 'jan-cycling-a',
            direction: 'decrease',
          }),
        ],
      },
      {
        fromBucket: {
          bucketKey: '2026-02',
          time: 2,
          aggregateValue: 230,
          totalCount: 4,
        },
        toBucket: {
          bucketKey: '2026-03',
          time: 3,
          aggregateValue: 230,
          totalCount: 4,
        },
        deltaAggregateValue: 0,
        direction: 'no_change',
        contributors: [
          {
            seriesKey: ActivityTypes.Cycling,
            deltaAggregateValue: 15,
            direction: 'increase',
          },
          {
            seriesKey: ActivityTypes.Running,
            deltaAggregateValue: -15,
            direction: 'decrease',
          },
        ],
        eventContributors: expect.arrayContaining([
          expect.objectContaining({
            eventId: 'feb-running',
          }),
        ]),
      },
    ]);
  });

  it('builds compare-mode event contributors for total aggregations', () => {
    const query = {
      resultKind: 'aggregate' as const,
      dataType: 'Distance',
      valueType: ChartDataValueTypes.Total,
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Monthly,
      activityTypeGroups: [],
      activityTypes: [ActivityTypes.Cycling],
      dateRange: {
        kind: 'bounded' as const,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-02-28T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt' as const,
      },
      periodMode: 'compare' as const,
      chartType: ChartTypes.LinesVertical,
    };
    const matchedEvents = [
      buildMockEvent({
        eventId: 'jan-a',
        startDate: '2026-01-05T08:00:00.000Z',
        activityType: ActivityTypes.Cycling,
        metricDataType: query.dataType,
        metricValue: 100,
      }),
      buildMockEvent({
        eventId: 'jan-b',
        startDate: '2026-01-10T08:00:00.000Z',
        activityType: ActivityTypes.Cycling,
        metricDataType: query.dataType,
        metricValue: 50,
      }),
      buildMockEvent({
        eventId: 'feb-a',
        startDate: '2026-02-06T08:00:00.000Z',
        activityType: ActivityTypes.Cycling,
        metricDataType: query.dataType,
        metricValue: 120,
      }),
      buildMockEvent({
        eventId: 'feb-b',
        startDate: '2026-02-12T08:00:00.000Z',
        activityType: ActivityTypes.Cycling,
        metricDataType: query.dataType,
        metricValue: 30,
      }),
    ];

    const summary = buildInsightSummary(query, {
      resolvedTimeInterval: TimeIntervals.Monthly,
      buckets: [
        { bucketKey: '2026-01', time: Date.parse('2026-01-01T00:00:00.000Z'), aggregateValue: 150, totalCount: 2 },
        { bucketKey: '2026-02', time: Date.parse('2026-02-01T00:00:00.000Z'), aggregateValue: 150, totalCount: 2 },
      ],
    }, 4, [{ activityType: ActivityTypes.Cycling, eventCount: 4 }], matchedEvents);

    expect(summary.periodDeltas?.[0]?.eventContributors).toEqual([
      expect.objectContaining({ eventId: 'feb-a', deltaContributionValue: 120, direction: 'increase' }),
      expect.objectContaining({ eventId: 'jan-a', deltaContributionValue: -100, direction: 'decrease' }),
      expect.objectContaining({ eventId: 'jan-b', deltaContributionValue: -50, direction: 'decrease' }),
    ]);
  });

  it('builds compare-mode event contributors for maximum and minimum aggregations', () => {
    const maxQuery = {
      resultKind: 'aggregate' as const,
      dataType: 'Average Power',
      valueType: ChartDataValueTypes.Maximum,
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Monthly,
      activityTypeGroups: [],
      activityTypes: [ActivityTypes.Cycling],
      dateRange: {
        kind: 'bounded' as const,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-02-28T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt' as const,
      },
      periodMode: 'compare' as const,
      chartType: ChartTypes.LinesVertical,
    };
    const minQuery = {
      ...maxQuery,
      valueType: ChartDataValueTypes.Minimum,
    };
    const matchedEvents = [
      buildMockEvent({
        eventId: 'jan-low',
        startDate: '2026-01-05T08:00:00.000Z',
        activityType: ActivityTypes.Cycling,
        metricDataType: maxQuery.dataType,
        metricValue: 180,
      }),
      buildMockEvent({
        eventId: 'jan-high',
        startDate: '2026-01-10T08:00:00.000Z',
        activityType: ActivityTypes.Cycling,
        metricDataType: maxQuery.dataType,
        metricValue: 240,
      }),
      buildMockEvent({
        eventId: 'feb-low',
        startDate: '2026-02-06T08:00:00.000Z',
        activityType: ActivityTypes.Cycling,
        metricDataType: maxQuery.dataType,
        metricValue: 160,
      }),
      buildMockEvent({
        eventId: 'feb-high',
        startDate: '2026-02-12T08:00:00.000Z',
        activityType: ActivityTypes.Cycling,
        metricDataType: maxQuery.dataType,
        metricValue: 280,
      }),
    ];
    const aggregation = {
      resolvedTimeInterval: TimeIntervals.Monthly,
      buckets: [
        { bucketKey: '2026-01', time: Date.parse('2026-01-01T00:00:00.000Z'), aggregateValue: 240, totalCount: 2 },
        { bucketKey: '2026-02', time: Date.parse('2026-02-01T00:00:00.000Z'), aggregateValue: 280, totalCount: 2 },
      ],
    };

    const maxSummary = buildInsightSummary(maxQuery, aggregation, 4, [
      { activityType: ActivityTypes.Cycling, eventCount: 4 },
    ], matchedEvents);
    const minSummary = buildInsightSummary(minQuery, {
      ...aggregation,
      buckets: [
        { bucketKey: '2026-01', time: Date.parse('2026-01-01T00:00:00.000Z'), aggregateValue: 180, totalCount: 2 },
        { bucketKey: '2026-02', time: Date.parse('2026-02-01T00:00:00.000Z'), aggregateValue: 160, totalCount: 2 },
      ],
    }, 4, [
      { activityType: ActivityTypes.Cycling, eventCount: 4 },
    ], matchedEvents);

    expect(maxSummary.periodDeltas?.[0]?.eventContributors).toEqual([
      expect.objectContaining({ eventId: 'feb-high', deltaContributionValue: 280, direction: 'increase' }),
      expect.objectContaining({ eventId: 'jan-high', deltaContributionValue: -240, direction: 'decrease' }),
    ]);
    expect(minSummary.periodDeltas?.[0]?.eventContributors).toEqual([
      expect.objectContaining({ eventId: 'jan-low', deltaContributionValue: -180, direction: 'decrease' }),
      expect.objectContaining({ eventId: 'feb-low', deltaContributionValue: 160, direction: 'increase' }),
    ]);
  });

  it('maps hourly compare event contributors when buckets use local hour string keys', () => {
    const query = {
      resultKind: 'aggregate' as const,
      dataType: 'Distance',
      valueType: ChartDataValueTypes.Total,
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Hourly,
      activityTypeGroups: [],
      activityTypes: [ActivityTypes.Cycling],
      dateRange: {
        kind: 'bounded' as const,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-02T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt' as const,
      },
      periodMode: 'compare' as const,
      chartType: ChartTypes.LinesVertical,
    };
    const fromBucketDate = new Date(2026, 0, 1, 9, 0, 0, 0);
    const toBucketDate = new Date(2026, 0, 1, 10, 0, 0, 0);
    const matchedEvents = [
      buildMockEvent({
        eventId: 'event-from',
        startDate: new Date(2026, 0, 1, 9, 15, 0, 0).toISOString(),
        activityType: ActivityTypes.Cycling,
        metricDataType: query.dataType,
        metricValue: 20,
      }),
      buildMockEvent({
        eventId: 'event-to',
        startDate: new Date(2026, 0, 1, 10, 20, 0, 0).toISOString(),
        activityType: ActivityTypes.Cycling,
        metricDataType: query.dataType,
        metricValue: 35,
      }),
    ];

    const summary = buildInsightSummary(query, {
      resolvedTimeInterval: TimeIntervals.Hourly,
      buckets: [
        {
          bucketKey: toLocalHourlyBucketKey(fromBucketDate),
          time: fromBucketDate.getTime(),
          aggregateValue: 20,
          totalCount: 1,
        },
        {
          bucketKey: toLocalHourlyBucketKey(toBucketDate),
          time: toBucketDate.getTime(),
          aggregateValue: 35,
          totalCount: 1,
        },
      ],
    }, 2, [{ activityType: ActivityTypes.Cycling, eventCount: 2 }], matchedEvents);

    expect(summary.periodDeltas?.[0]?.eventContributors).toEqual([
      expect.objectContaining({
        eventId: 'event-to',
        deltaContributionValue: 35,
        direction: 'increase',
      }),
      expect.objectContaining({
        eventId: 'event-from',
        deltaContributionValue: -20,
        direction: 'decrease',
      }),
    ]);
  });

  it('returns a null-filled non-aggregate empty summary helper', () => {
    expect(buildNonAggregateEmptySummary()).toEqual({
      matchedEventCount: 0,
      overallAggregateValue: null,
      peakBucket: null,
      lowestBucket: null,
      latestBucket: null,
      activityMix: null,
      bucketCoverage: null,
      trend: null,
      periodDeltas: null,
    });
  });
});
