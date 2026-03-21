import { describe, expect, it } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { validateAiInsightsLatestSnapshot } from '@shared/ai-insights-latest-snapshot.validation';

describe('Ai Insights latest snapshot shared validation', () => {
  it('accepts a valid snapshot payload', () => {
    const validation = validateAiInsightsLatestSnapshot({
      version: 1,
      savedAt: '2026-03-21T10:00:00.000Z',
      prompt: 'show my total distance this year',
      response: {
        status: 'ok',
        resultKind: 'aggregate',
        narrative: 'ok',
        query: {
          resultKind: 'aggregate',
          dataType: 'Distance',
          valueType: ChartDataValueTypes.Total,
          categoryType: ChartDataCategoryTypes.DateType,
          requestedTimeInterval: TimeIntervals.Monthly,
          activityTypeGroups: [],
          activityTypes: [ActivityTypes.Cycling],
          dateRange: {
            kind: 'bounded',
            startDate: '2026-01-01T00:00:00.000Z',
            endDate: '2026-03-21T23:59:59.999Z',
            timezone: 'UTC',
            source: 'prompt',
          },
          chartType: ChartTypes.ColumnsVertical,
        },
        aggregation: {
          dataType: 'Distance',
          valueType: ChartDataValueTypes.Total,
          categoryType: ChartDataCategoryTypes.DateType,
          resolvedTimeInterval: TimeIntervals.Monthly,
          buckets: [],
        },
        summary: {
          matchedEventCount: 0,
          overallAggregateValue: null,
          peakBucket: null,
          lowestBucket: null,
          latestBucket: null,
          activityMix: null,
          bucketCoverage: null,
          trend: null,
        },
        presentation: {
          title: 'Total distance over time',
          chartType: ChartTypes.ColumnsVertical,
        },
      },
    }, 1);

    expect(validation.valid).toBe(true);
  });

  it('rejects invalid snapshots with a structured failure reason', () => {
    const validation = validateAiInsightsLatestSnapshot({
      version: 1,
      savedAt: '2026-03-21T10:00:00.000Z',
      prompt: 'show my total distance this year',
      response: {
        status: 'ok',
        narrative: 'ok',
        query: {
          resultKind: 'aggregate',
          dataType: 'Distance',
          valueType: ChartDataValueTypes.Total,
          categoryType: ChartDataCategoryTypes.DateType,
          requestedTimeInterval: TimeIntervals.Monthly,
          activityTypeGroups: [],
          activityTypes: [ActivityTypes.Cycling],
          dateRange: {
            kind: 'bounded',
            startDate: '2026-01-01T00:00:00.000Z',
            endDate: '2026-03-21T23:59:59.999Z',
            timezone: 'UTC',
            source: 'prompt',
          },
          chartType: ChartTypes.ColumnsVertical,
        },
        aggregation: {
          dataType: 'Distance',
          valueType: ChartDataValueTypes.Total,
          categoryType: ChartDataCategoryTypes.DateType,
          resolvedTimeInterval: TimeIntervals.Monthly,
          buckets: [],
        },
        presentation: {
          title: 'Total distance over time',
          chartType: ChartTypes.ColumnsVertical,
        },
      },
    }, 1);

    expect(validation.valid).toBe(false);
    if (validation.valid) {
      return;
    }
    expect(validation.failure.reason).toContain('response_');
  });

  it('accepts enum-primitive activity arrays in query snapshots', () => {
    const validation = validateAiInsightsLatestSnapshot({
      version: 1,
      savedAt: '2026-03-21T10:00:00.000Z',
      prompt: 'show my total distance this year',
      response: {
        status: 'ok',
        resultKind: 'aggregate',
        narrative: 'ok',
        query: {
          resultKind: 'aggregate',
          dataType: 'Distance',
          valueType: ChartDataValueTypes.Total,
          categoryType: ChartDataCategoryTypes.DateType,
          requestedTimeInterval: TimeIntervals.Monthly,
          activityTypeGroups: [1],
          activityTypes: [2],
          dateRange: {
            kind: 'bounded',
            startDate: '2026-01-01T00:00:00.000Z',
            endDate: '2026-03-21T23:59:59.999Z',
            timezone: 'UTC',
            source: 'prompt',
          },
          chartType: ChartTypes.ColumnsVertical,
        },
        aggregation: {
          dataType: 'Distance',
          valueType: ChartDataValueTypes.Total,
          categoryType: ChartDataCategoryTypes.DateType,
          resolvedTimeInterval: TimeIntervals.Monthly,
          buckets: [],
        },
        summary: {
          matchedEventCount: 0,
          overallAggregateValue: null,
          peakBucket: null,
          lowestBucket: null,
          latestBucket: null,
          activityMix: null,
          bucketCoverage: null,
          trend: null,
        },
        presentation: {
          title: 'Total distance over time',
          chartType: ChartTypes.ColumnsVertical,
        },
      },
    }, 1);

    expect(validation.valid).toBe(true);
  });

  it('accepts latest_event snapshot payloads', () => {
    const validation = validateAiInsightsLatestSnapshot({
      version: 1,
      savedAt: '2026-03-21T10:00:00.000Z',
      prompt: 'when was my last ride?',
      response: {
        status: 'ok',
        resultKind: 'latest_event',
        narrative: 'Your latest cycling event was on Mar 18, 2026.',
        query: {
          resultKind: 'latest_event',
          categoryType: ChartDataCategoryTypes.DateType,
          activityTypeGroups: [],
          activityTypes: [ActivityTypes.Cycling],
          dateRange: {
            kind: 'bounded',
            startDate: '2026-01-01T00:00:00.000Z',
            endDate: '2026-03-21T23:59:59.999Z',
            timezone: 'UTC',
            source: 'prompt',
          },
          chartType: ChartTypes.LinesVertical,
        },
        latestEvent: {
          eventId: 'event-9',
          startDate: '2026-03-18T08:00:00.000Z',
          matchedEventCount: 4,
        },
        presentation: {
          title: 'Latest event for Cycling',
          chartType: ChartTypes.LinesVertical,
        },
      },
    }, 1);

    expect(validation.valid).toBe(true);
  });
});
