import { describe, expect, it } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { validateAiInsightsResponse } from '@shared/ai-insights-response.contract';

const EXPECTED_RESULT_KINDS = [
  'aggregate',
  'event_lookup',
  'latest_event',
  'multi_metric_aggregate',
] as const;

describe('Ai insights response contract result-kind coverage', () => {
  it('accepts one valid payload for each supported result kind', () => {
    const validations = [
      validateAiInsightsResponse({
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
          title: 'Aggregate',
          chartType: ChartTypes.ColumnsVertical,
        },
      }),
      validateAiInsightsResponse({
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
            endDate: '2026-03-21T23:59:59.999Z',
            timezone: 'UTC',
            source: 'prompt',
          },
          chartType: ChartTypes.ColumnsVertical,
        },
        eventLookup: {
          primaryEventId: 'event-1',
          topEventIds: ['event-1'],
          matchedEventCount: 1,
        },
        presentation: {
          title: 'Event lookup',
          chartType: ChartTypes.ColumnsVertical,
        },
      }),
      validateAiInsightsResponse({
        status: 'ok',
        resultKind: 'latest_event',
        narrative: 'ok',
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
          chartType: ChartTypes.ColumnsVertical,
        },
        latestEvent: {
          eventId: 'event-1',
          startDate: '2026-03-21T09:00:00.000Z',
          matchedEventCount: 2,
        },
        presentation: {
          title: 'Latest event',
          chartType: ChartTypes.ColumnsVertical,
        },
      }),
      validateAiInsightsResponse({
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
            endDate: '2026-03-21T23:59:59.999Z',
            timezone: 'UTC',
            source: 'prompt',
          },
          chartType: ChartTypes.ColumnsVertical,
          metricSelections: [
            {
              metricKey: 'cadence',
              dataType: 'cadence',
              valueType: ChartDataValueTypes.Average,
            },
            {
              metricKey: 'power',
              dataType: 'power',
              valueType: ChartDataValueTypes.Average,
            },
          ],
        },
        metricResults: [
          {
            metricKey: 'cadence',
            metricLabel: 'cadence',
            query: {
              resultKind: 'aggregate',
              dataType: 'cadence',
              valueType: ChartDataValueTypes.Average,
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
              dataType: 'cadence',
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
              chartType: ChartTypes.ColumnsVertical,
            },
          },
        ],
        presentation: {
          title: 'Multi metric',
          chartType: ChartTypes.ColumnsVertical,
        },
      }),
    ];

    expect(validations).toHaveLength(EXPECTED_RESULT_KINDS.length);
    for (const validation of validations) {
      expect(validation.ok).toBe(true);
    }
  });
});
