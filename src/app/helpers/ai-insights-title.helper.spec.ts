import { describe, expect, it } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import type {
  AiInsightsAggregateOkResponse,
  AiInsightsEmptyResponse,
  AiInsightsEventLookupOkResponse,
  AiInsightsLatestEventOkResponse,
  AiInsightsMultiMetricAggregateOkResponse,
} from '@shared/ai-insights.types';
import { resolveAiInsightsDisplayTitle } from './ai-insights-title.helper';

function buildAggregateResponse(): AiInsightsAggregateOkResponse {
  return {
    status: 'ok',
    resultKind: 'aggregate',
    narrative: 'Narrative',
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
        startDate: '2025-12-01',
        endDate: '2026-03-01',
        timezone: 'Europe/Helsinki',
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
      title: 'Backend Title',
      chartType: ChartTypes.LinesVertical,
    },
  };
}

describe('resolveAiInsightsDisplayTitle', () => {
  it('builds an aggregate date title in sentence case', () => {
    const title = resolveAiInsightsDisplayTitle(buildAggregateResponse());
    expect(title).toBe('Cadence over time for cycling');
  });

  it('builds an aggregate activity-type title', () => {
    const response = buildAggregateResponse();
    response.query.categoryType = ChartDataCategoryTypes.ActivityType;

    const title = resolveAiInsightsDisplayTitle(response);
    expect(title).toBe('Cadence by activity type for cycling');
  });

  it('builds a multi-metric title with joined labels', () => {
    const response: AiInsightsMultiMetricAggregateOkResponse = {
      status: 'ok',
      resultKind: 'multi_metric_aggregate',
      narrative: 'Narrative',
      query: {
        resultKind: 'multi_metric_aggregate',
        groupingMode: 'date',
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2025-12-01',
          endDate: '2026-03-01',
          timezone: 'Europe/Helsinki',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
        metricSelections: [
          { metricKey: 'cadence', dataType: 'Average Cadence', valueType: ChartDataValueTypes.Average },
          { metricKey: 'speed', dataType: 'Average Speed', valueType: ChartDataValueTypes.Average },
          { metricKey: 'power', dataType: 'Average Power', valueType: ChartDataValueTypes.Average },
        ],
      },
      metricResults: [],
      presentation: {
        title: 'Backend title',
        chartType: ChartTypes.LinesVertical,
      },
    };

    const title = resolveAiInsightsDisplayTitle(response);
    expect(title).toBe('Cadence, speed, and power over time for cycling');
  });

  it('builds an event-lookup title', () => {
    const response: AiInsightsEventLookupOkResponse = {
      status: 'ok',
      resultKind: 'event_lookup',
      narrative: 'Narrative',
      query: {
        resultKind: 'event_lookup',
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Maximum,
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2025-12-01',
          endDate: '2026-03-01',
          timezone: 'Europe/Helsinki',
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
        title: 'Backend title',
        chartType: ChartTypes.LinesVertical,
      },
    };

    const title = resolveAiInsightsDisplayTitle(response);
    expect(title).toBe('Top distance events for cycling');
  });

  it('builds a latest-event title', () => {
    const response: AiInsightsLatestEventOkResponse = {
      status: 'ok',
      resultKind: 'latest_event',
      narrative: 'Narrative',
      query: {
        resultKind: 'latest_event',
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2025-12-01',
          endDate: '2026-03-01',
          timezone: 'Europe/Helsinki',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
      },
      latestEvent: {
        eventId: 'event-1',
        startDate: '2026-03-10T08:00:00.000Z',
        matchedEventCount: 1,
      },
      presentation: {
        title: 'Backend title',
        chartType: ChartTypes.LinesVertical,
      },
    };

    const title = resolveAiInsightsDisplayTitle(response);
    expect(title).toBe('Latest event for cycling');
  });

  it('returns null when metric labels cannot be resolved for multi-metric empty responses', () => {
    const response: AiInsightsEmptyResponse = {
      status: 'empty',
      narrative: 'Narrative',
      query: {
        resultKind: 'multi_metric_aggregate',
        groupingMode: 'date',
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [],
        dateRange: {
          kind: 'bounded',
          startDate: '2025-12-01',
          endDate: '2026-03-01',
          timezone: 'Europe/Helsinki',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
        metricSelections: [],
      },
      aggregation: {
        dataType: 'Unknown',
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
        title: 'Backend fallback title',
        chartType: ChartTypes.LinesVertical,
        emptyState: 'No data',
      },
    };

    expect(resolveAiInsightsDisplayTitle(response)).toBeNull();
  });
});
