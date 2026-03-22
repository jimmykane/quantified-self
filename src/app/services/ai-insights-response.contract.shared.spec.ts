import { describe, expect, it } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { validateAiInsightsResponse } from '@shared/ai-insights-response.contract';

describe('Ai insights shared response contract', () => {
  it('accepts valid responses for all result kinds', () => {
    const aggregate = validateAiInsightsResponse({
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
          endDate: '2026-03-22T23:59:59.999Z',
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
        title: 'Total distance',
        chartType: ChartTypes.ColumnsVertical,
      },
    });
    const eventLookup = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'event_lookup',
      narrative: 'ok',
      query: {
        resultKind: 'event_lookup',
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Maximum,
        categoryType: ChartDataCategoryTypes.DateType,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
      },
      eventLookup: {
        primaryEventId: 'event-1',
        topEventIds: ['event-1'],
        matchedEventCount: 1,
      },
      presentation: {
        title: 'Top event',
        chartType: ChartTypes.LinesVertical,
      },
    });
    const latestEvent = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'latest_event',
      narrative: 'ok',
      query: {
        resultKind: 'latest_event',
        categoryType: ChartDataCategoryTypes.DateType,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Running],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
      },
      latestEvent: {
        eventId: 'event-2',
        startDate: '2026-03-21T10:00:00.000Z',
        matchedEventCount: 4,
      },
      presentation: {
        title: 'Latest event',
        chartType: ChartTypes.LinesVertical,
      },
    });
    const multiMetric = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'multi_metric_aggregate',
      narrative: 'ok',
      query: {
        resultKind: 'multi_metric_aggregate',
        groupingMode: 'date',
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
        metricSelections: [
          {
            metricKey: 'cadence',
            dataType: 'Average Cadence',
            valueType: ChartDataValueTypes.Average,
          },
          {
            metricKey: 'power',
            dataType: 'Average Power',
            valueType: ChartDataValueTypes.Average,
          },
        ],
      },
      metricResults: [
        {
          metricKey: 'cadence',
          metricLabel: 'Cadence',
          query: {
            resultKind: 'aggregate',
            dataType: 'Average Cadence',
            valueType: ChartDataValueTypes.Average,
            categoryType: ChartDataCategoryTypes.DateType,
            requestedTimeInterval: TimeIntervals.Monthly,
            activityTypeGroups: [],
            activityTypes: [ActivityTypes.Cycling],
            dateRange: {
              kind: 'bounded',
              startDate: '2026-01-01T00:00:00.000Z',
              endDate: '2026-03-22T23:59:59.999Z',
              timezone: 'UTC',
              source: 'prompt',
            },
            chartType: ChartTypes.LinesVertical,
          },
          aggregation: {
            dataType: 'Average Cadence',
            valueType: ChartDataValueTypes.Average,
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
            title: 'Cadence',
            chartType: ChartTypes.LinesVertical,
          },
        },
      ],
      presentation: {
        title: 'Cadence and power',
        chartType: ChartTypes.LinesVertical,
      },
    });

    expect(aggregate.ok).toBe(true);
    expect(eventLookup.ok).toBe(true);
    expect(latestEvent.ok).toBe(true);
    expect(multiMetric.ok).toBe(true);
  });

  it('rejects invalid query combinations with deterministic reason', () => {
    const result = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'aggregate',
      narrative: 'ok',
      query: {
        resultKind: 'aggregate',
        dataType: 'Distance',
        valueType: 'not-valid',
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: null,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        periodMode: 'not-valid',
        requestedDateRanges: [{}],
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
        title: 'Total distance',
        chartType: ChartTypes.ColumnsVertical,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe('query_invalid');
    expect(result.details?.queryKeys).toContain('periodMode');
    expect(result.details?.queryKeys).toContain('requestedDateRanges');
    expect(result.details?.valueTypeType).toBe('string');
  });
});
