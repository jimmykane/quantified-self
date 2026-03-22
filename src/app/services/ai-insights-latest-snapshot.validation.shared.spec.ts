import { describe, expect, it } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { validateAiInsightsLatestSnapshot } from '@shared/ai-insights-latest-snapshot.validation';
import { validateAiInsightsResponse } from '@shared/ai-insights-response.contract';

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

  it('rejects snapshots that do not match strict query enums', () => {
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
          requestedTimeInterval: null,
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

    expect(validation.valid).toBe(false);
    if (validation.valid) {
      return;
    }
    expect(validation.failure.reason).toBe('response_query_invalid');
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

  it('rejects ok responses that do not include result-kind required payload fields', () => {
    const latestEventMissingValidation = validateAiInsightsLatestSnapshot({
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
        presentation: {
          title: 'Latest event for Cycling',
          chartType: ChartTypes.LinesVertical,
        },
      },
    }, 1);

    expect(latestEventMissingValidation.valid).toBe(false);
    if (latestEventMissingValidation.valid) {
      return;
    }
    expect(latestEventMissingValidation.failure.reason).toBe('response_latest_event_invalid');

    const eventLookupMissingValidation = validateAiInsightsLatestSnapshot({
      version: 1,
      savedAt: '2026-03-21T10:00:00.000Z',
      prompt: 'when did I have my longest ride?',
      response: {
        status: 'ok',
        resultKind: 'event_lookup',
        narrative: 'Your longest cycling event was on Mar 18, 2026.',
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
          chartType: ChartTypes.LinesVertical,
        },
        presentation: {
          title: 'Longest event for Cycling',
          chartType: ChartTypes.LinesVertical,
        },
      },
    }, 1);

    expect(eventLookupMissingValidation.valid).toBe(false);
    if (eventLookupMissingValidation.valid) {
      return;
    }
    expect(eventLookupMissingValidation.failure.reason).toBe('response_event_lookup_invalid');
  });

  it('rejects malformed ok responses at contract level when result-kind fields are missing', () => {
    const validation = validateAiInsightsResponse({
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
      presentation: {
        title: 'Latest event for Cycling',
        chartType: ChartTypes.LinesVertical,
      },
    });

    expect(validation.ok).toBe(false);
    if (validation.ok) {
      return;
    }
    expect(validation.reason).toBe('latest_event_invalid');
  });
});
