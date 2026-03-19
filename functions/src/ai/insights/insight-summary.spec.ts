import { describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { buildInsightSummary, buildNonAggregateEmptySummary } from './insight-summary';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

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
    });
  });
});
