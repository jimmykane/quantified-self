import { describe, expect, it } from 'vitest';
import { TimeIntervals } from '@sports-alliance/sports-lib';
import {
  AssistantMetricHistoryQueryError,
  ASSISTANT_METRIC_QUERY_WINDOW_MS,
  mergeAssistantMetricHistoryResponses,
  splitAssistantMetricHistoryQuery,
} from './metric-history-query';

function metricResult(overrides: Record<string, unknown> = {}) {
  return {
    metric: {
      type: 'Distance',
      displayType: 'Distance',
      unit: 'm',
      unitSystem: 'metric',
    },
    matchedEventCount: 1,
    aggregation: {
      dataType: 'Distance',
      valueType: 'Total',
      categoryType: 'Date Type',
      resolvedTimeInterval: TimeIntervals.Yearly,
      buckets: [{
        bucketKey: Date.parse('2024-01-01T00:00:00.000Z'),
        time: Date.parse('2024-01-01T00:00:00.000Z'),
        totalCount: 1,
        aggregateValue: 1_000,
        seriesValues: { Running: 1_000 },
        seriesCounts: { Running: 1 },
      }],
    },
    ...overrides,
  };
}

describe('Assistant metric history queries', () => {
  it('splits a long metric query into gap-free public-compatible windows', () => {
    const startTimeMs = Date.parse('2020-01-01T00:00:00.000Z');
    const endTimeMs = startTimeMs + (ASSISTANT_METRIC_QUERY_WINDOW_MS * 2) + 5;
    const pages = splitAssistantMetricHistoryQuery('query_metric', {
      metric: 'Distance',
      start: new Date(startTimeMs).toISOString(),
      end: new Date(endTimeMs).toISOString(),
      aggregation: 'total',
      groupBy: 'date',
      interval: 'auto',
      timeZone: 'UTC',
    });

    expect(pages).toHaveLength(3);
    expect(pages).toEqual([
      expect.objectContaining({
        start: new Date(startTimeMs).toISOString(),
        end: new Date(startTimeMs + ASSISTANT_METRIC_QUERY_WINDOW_MS).toISOString(),
        interval: 'yearly',
      }),
      expect.objectContaining({
        start: new Date(startTimeMs + ASSISTANT_METRIC_QUERY_WINDOW_MS + 1).toISOString(),
      }),
      expect.objectContaining({
        end: new Date(endTimeMs).toISOString(),
      }),
    ]);
    expect(Date.parse(pages![1].start as string)).toBe(
      Date.parse(pages![0].end as string) + 1,
    );
  });

  it('does not page a normal public-compatible metric range', () => {
    expect(splitAssistantMetricHistoryQuery('query_metric', {
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-02-01T00:00:00.000Z',
    })).toBeNull();
  });

  it('uses yearly buckets for a long range when the model omits the public daily default', () => {
    const pages = splitAssistantMetricHistoryQuery('query_metric', {
      start: '2020-01-01T00:00:00.000Z',
      end: '2022-01-01T00:00:00.000Z',
    });

    expect(pages).toHaveLength(2);
    expect(pages?.every(page => page.interval === 'yearly')).toBe(true);
  });

  it('rejects an unbounded fan-out before it can create excessive backend work', () => {
    expect(() => splitAssistantMetricHistoryQuery('query_metric', {
      start: '1900-01-01T00:00:00.000Z',
      end: '2026-01-01T00:00:00.000Z',
    })).toThrow(AssistantMetricHistoryQueryError);
  });

  it('merges totals and averages by bucket and activity type without duplicating a boundary', () => {
    const merged = mergeAssistantMetricHistoryResponses('query_metric', [
      metricResult(),
      metricResult({
        matchedEventCount: 2,
        aggregation: {
          ...metricResult().aggregation,
          buckets: [{
            bucketKey: Date.parse('2024-01-01T00:00:00.000Z'),
            time: Date.parse('2024-01-01T00:00:00.000Z'),
            totalCount: 2,
            aggregateValue: 2_500,
            seriesValues: { Running: 2_500, Cycling: 100 },
            seriesCounts: { Running: 2, Cycling: 1 },
          }],
        },
      }),
    ]);

    expect(merged).toMatchObject({
      matchedEventCount: 3,
      aggregation: {
        buckets: [{
          totalCount: 3,
          aggregateValue: 3_500,
          seriesValues: { Running: 3_500, Cycling: 100 },
          seriesCounts: { Running: 3, Cycling: 1 },
        }],
      },
    });

    const averages = mergeAssistantMetricHistoryResponses('query_metric', [
      metricResult({
        aggregation: {
          ...metricResult().aggregation,
          valueType: 'Average',
          buckets: [{
            bucketKey: 'Running',
            totalCount: 2,
            aggregateValue: 10,
            seriesValues: { Running: 10 },
            seriesCounts: { Running: 2 },
          }],
        },
      }),
      metricResult({
        aggregation: {
          ...metricResult().aggregation,
          valueType: 'Average',
          buckets: [{
            bucketKey: 'Running',
            totalCount: 1,
            aggregateValue: 4,
            seriesValues: { Running: 4 },
            seriesCounts: { Running: 1 },
          }],
        },
      }),
    ]);
    expect(averages).toMatchObject({
      aggregation: {
        buckets: [{
          totalCount: 3,
          aggregateValue: 8,
          seriesValues: { Running: 8 },
          seriesCounts: { Running: 3 },
        }],
      },
    });

    const extremes = mergeAssistantMetricHistoryResponses('query_metric', [
      metricResult({
        aggregation: {
          ...metricResult().aggregation,
          valueType: 'Minimum',
          buckets: [{
            bucketKey: 'Running',
            totalCount: 1,
            aggregateValue: 5,
            seriesValues: { Running: 5 },
            seriesCounts: { Running: 1 },
          }],
        },
      }),
      metricResult({
        aggregation: {
          ...metricResult().aggregation,
          valueType: 'Minimum',
          buckets: [{
            bucketKey: 'Running',
            totalCount: 1,
            aggregateValue: 2,
            seriesValues: { Running: 2 },
            seriesCounts: { Running: 1 },
          }],
        },
      }),
    ]);
    expect(extremes).toMatchObject({
      aggregation: { buckets: [{ aggregateValue: 2 }] },
    });
  });

  it('keeps the multi-metric response shape while merging every selected metric', () => {
    const merged = mergeAssistantMetricHistoryResponses('query_metrics', [{
      results: [metricResult(), metricResult({
        metric: { type: 'Ascent', displayType: 'Ascent', unit: 'm', unitSystem: 'metric' },
        aggregation: {
          ...metricResult().aggregation,
          dataType: 'Ascent',
        },
      })],
    }, {
      results: [metricResult(), metricResult({
        metric: { type: 'Ascent', displayType: 'Ascent', unit: 'm', unitSystem: 'metric' },
        aggregation: {
          ...metricResult().aggregation,
          dataType: 'Ascent',
        },
      })],
    }]);

    expect(merged).toMatchObject({
      results: [
        {
          matchedEventCount: 2,
          aggregation: { resolvedTimeInterval: TimeIntervals.Yearly },
        },
        { matchedEventCount: 2 },
      ],
    });
  });

  it('accepts the numeric Sports Lib interval enum returned by the MCP schema', () => {
    const merged = mergeAssistantMetricHistoryResponses('query_metrics', [{
      results: [metricResult({
        metric: {
          type: 'Average Temperature',
          displayType: 'Average Temperature',
          unit: '°C',
          unitSystem: 'metric',
        },
        aggregation: {
          ...metricResult().aggregation,
          dataType: 'Average Temperature',
          valueType: 'Average',
          resolvedTimeInterval: TimeIntervals.Yearly,
        },
      })],
    }]);

    expect(merged).toMatchObject({
      results: [{
        metric: { type: 'Average Temperature' },
        aggregation: {
          valueType: 'Average',
          resolvedTimeInterval: TimeIntervals.Yearly,
        },
      }],
    });
  });
});
