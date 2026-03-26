import { describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import type { AiInsightsMultiMetricAggregateMetricResult } from '../../../../shared/ai-insights.types';
import { buildAiInsightsDigest } from './digest';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

function buildMetricResult(params: {
  metricKey: AiInsightsMultiMetricAggregateMetricResult['metricKey'];
  metricLabel: string;
  dataType: string;
  resolvedTimeInterval: TimeIntervals;
  buckets: AiInsightsMultiMetricAggregateMetricResult['aggregation']['buckets'];
}): AiInsightsMultiMetricAggregateMetricResult {
  return {
    metricKey: params.metricKey,
    metricLabel: params.metricLabel,
    query: {
      resultKind: 'aggregate',
      dataType: params.dataType,
      valueType: ChartDataValueTypes.Total,
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: params.resolvedTimeInterval,
      activityTypeGroups: [],
      activityTypes: [ActivityTypes.Cycling],
      dateRange: {
        kind: 'bounded',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-04-30T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt',
      },
      chartType: ChartTypes.LinesVertical,
    },
    aggregation: {
      dataType: params.dataType,
      valueType: ChartDataValueTypes.Total,
      categoryType: ChartDataCategoryTypes.DateType,
      resolvedTimeInterval: params.resolvedTimeInterval,
      buckets: params.buckets,
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
      periodDeltas: null,
      anomalyCallouts: null,
    },
    presentation: {
      title: params.metricLabel,
      chartType: ChartTypes.LinesVertical,
    },
  };
}

describe('buildAiInsightsDigest', () => {
  it('builds monthly digest periods with explicit no-data periods', () => {
    const digest = buildAiInsightsDigest({
      digestMode: 'monthly',
      dateRange: {
        kind: 'bounded',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-04-30T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt',
      },
      metricResults: [
        buildMetricResult({
          metricKey: 'distance',
          metricLabel: 'Distance',
          dataType: 'Distance',
          resolvedTimeInterval: TimeIntervals.Monthly,
          buckets: [
            {
              bucketKey: '2026-01',
              time: Date.parse('2026-01-01T00:00:00.000Z'),
              aggregateValue: 120_000,
              totalCount: 4,
              seriesValues: {},
              seriesCounts: {},
            },
            {
              bucketKey: '2026-03',
              time: Date.parse('2026-03-01T00:00:00.000Z'),
              aggregateValue: 98_000,
              totalCount: 3,
              seriesValues: {},
              seriesCounts: {},
            },
          ],
        }),
        buildMetricResult({
          metricKey: 'duration',
          metricLabel: 'Duration',
          dataType: 'Duration',
          resolvedTimeInterval: TimeIntervals.Monthly,
          buckets: [
            {
              bucketKey: '2026-02',
              time: Date.parse('2026-02-01T00:00:00.000Z'),
              aggregateValue: 18_000,
              totalCount: 5,
              seriesValues: {},
              seriesCounts: {},
            },
          ],
        }),
        buildMetricResult({
          metricKey: 'ascent',
          metricLabel: 'Ascent',
          dataType: 'Ascent',
          resolvedTimeInterval: TimeIntervals.Monthly,
          buckets: [],
        }),
      ],
    });

    expect(digest.granularity).toBe('monthly');
    expect(digest.periodCount).toBe(4);
    expect(digest.nonEmptyPeriodCount).toBe(3);
    expect(digest.periods.map(period => period.time)).toEqual([
      Date.parse('2026-01-01T00:00:00.000Z'),
      Date.parse('2026-02-01T00:00:00.000Z'),
      Date.parse('2026-03-01T00:00:00.000Z'),
      Date.parse('2026-04-01T00:00:00.000Z'),
    ]);
    expect(digest.periods[3]).toEqual({
      bucketKey: Date.parse('2026-04-01T00:00:00.000Z'),
      time: Date.parse('2026-04-01T00:00:00.000Z'),
      hasData: false,
      metrics: [
        {
          metricKey: 'distance',
          metricLabel: 'Distance',
          dataType: 'Distance',
          valueType: ChartDataValueTypes.Total,
          aggregateValue: null,
          totalCount: 0,
        },
        {
          metricKey: 'duration',
          metricLabel: 'Duration',
          dataType: 'Duration',
          valueType: ChartDataValueTypes.Total,
          aggregateValue: null,
          totalCount: 0,
        },
        {
          metricKey: 'ascent',
          metricLabel: 'Ascent',
          dataType: 'Ascent',
          valueType: ChartDataValueTypes.Total,
          aggregateValue: null,
          totalCount: 0,
        },
      ],
    });
  });

  it('keeps all periods explicit when every metric bucket is empty', () => {
    const digest = buildAiInsightsDigest({
      digestMode: 'monthly',
      dateRange: {
        kind: 'bounded',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-03-31T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt',
      },
      metricResults: [
        buildMetricResult({
          metricKey: 'distance',
          metricLabel: 'Distance',
          dataType: 'Distance',
          resolvedTimeInterval: TimeIntervals.Monthly,
          buckets: [],
        }),
        buildMetricResult({
          metricKey: 'duration',
          metricLabel: 'Duration',
          dataType: 'Duration',
          resolvedTimeInterval: TimeIntervals.Monthly,
          buckets: [],
        }),
        buildMetricResult({
          metricKey: 'ascent',
          metricLabel: 'Ascent',
          dataType: 'Ascent',
          resolvedTimeInterval: TimeIntervals.Monthly,
          buckets: [],
        }),
      ],
    });

    expect(digest.periodCount).toBe(3);
    expect(digest.nonEmptyPeriodCount).toBe(0);
    expect(digest.periods.every(period => !period.hasData)).toBe(true);
  });

  it('builds weekly and yearly digests using expected period starts', () => {
    const weeklyDigest = buildAiInsightsDigest({
      digestMode: 'weekly',
      dateRange: {
        kind: 'bounded',
        startDate: '2026-03-04T00:00:00.000Z',
        endDate: '2026-03-22T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt',
      },
      metricResults: [
        buildMetricResult({
          metricKey: 'distance',
          metricLabel: 'Distance',
          dataType: 'Distance',
          resolvedTimeInterval: TimeIntervals.Weekly,
          buckets: [
            {
              bucketKey: '2026-03-09',
              time: Date.parse('2026-03-09T00:00:00.000Z'),
              aggregateValue: 30_000,
              totalCount: 2,
              seriesValues: {},
              seriesCounts: {},
            },
          ],
        }),
      ],
    });
    expect(weeklyDigest.periodCount).toBe(3);
    expect(weeklyDigest.periods.map(period => period.time)).toEqual([
      Date.parse('2026-03-02T00:00:00.000Z'),
      Date.parse('2026-03-09T00:00:00.000Z'),
      Date.parse('2026-03-16T00:00:00.000Z'),
    ]);

    const yearlyDigest = buildAiInsightsDigest({
      digestMode: 'yearly',
      dateRange: {
        kind: 'bounded',
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2026-12-31T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt',
      },
      metricResults: [
        buildMetricResult({
          metricKey: 'duration',
          metricLabel: 'Duration',
          dataType: 'Duration',
          resolvedTimeInterval: TimeIntervals.Yearly,
          buckets: [
            {
              bucketKey: '2025',
              time: Date.parse('2025-01-01T00:00:00.000Z'),
              aggregateValue: 90_000,
              totalCount: 32,
              seriesValues: {},
              seriesCounts: {},
            },
          ],
        }),
      ],
    });
    expect(yearlyDigest.periodCount).toBe(3);
    expect(yearlyDigest.periods.map(period => period.time)).toEqual([
      Date.parse('2024-01-01T00:00:00.000Z'),
      Date.parse('2025-01-01T00:00:00.000Z'),
      Date.parse('2026-01-01T00:00:00.000Z'),
    ]);
    expect(yearlyDigest.nonEmptyPeriodCount).toBe(1);
  });

  it('derives all-time digest period bounds from aggregation buckets', () => {
    const digest = buildAiInsightsDigest({
      digestMode: 'yearly',
      dateRange: {
        kind: 'all_time',
        timezone: 'UTC',
        source: 'prompt',
      },
      metricResults: [
        buildMetricResult({
          metricKey: 'distance',
          metricLabel: 'Distance',
          dataType: 'Distance',
          resolvedTimeInterval: TimeIntervals.Yearly,
          buckets: [
            {
              bucketKey: '2024',
              time: Date.parse('2024-01-01T00:00:00.000Z'),
              aggregateValue: 120_000,
              totalCount: 6,
              seriesValues: {},
              seriesCounts: {},
            },
            {
              bucketKey: '2026',
              time: Date.parse('2026-01-01T00:00:00.000Z'),
              aggregateValue: 135_000,
              totalCount: 7,
              seriesValues: {},
              seriesCounts: {},
            },
          ],
        }),
      ],
    });

    expect(digest.granularity).toBe('yearly');
    expect(digest.periodCount).toBe(3);
    expect(digest.nonEmptyPeriodCount).toBe(2);
    expect(digest.periods.map(period => period.time)).toEqual([
      Date.parse('2024-01-01T00:00:00.000Z'),
      Date.parse('2025-01-01T00:00:00.000Z'),
      Date.parse('2026-01-01T00:00:00.000Z'),
    ]);
    expect(digest.periods[1]?.hasData).toBe(false);
  });

  it('keeps all-time digests explicit but empty when no bucket timeline is available', () => {
    const digest = buildAiInsightsDigest({
      digestMode: 'yearly',
      dateRange: {
        kind: 'all_time',
        timezone: 'UTC',
        source: 'prompt',
      },
      metricResults: [
        buildMetricResult({
          metricKey: 'distance',
          metricLabel: 'Distance',
          dataType: 'Distance',
          resolvedTimeInterval: TimeIntervals.Yearly,
          buckets: [],
        }),
        buildMetricResult({
          metricKey: 'duration',
          metricLabel: 'Duration',
          dataType: 'Duration',
          resolvedTimeInterval: TimeIntervals.Monthly,
          buckets: [
            {
              bucketKey: '2026-01',
              time: Date.parse('2026-01-01T00:00:00.000Z'),
              aggregateValue: 1,
              totalCount: 1,
              seriesValues: {},
              seriesCounts: {},
            },
          ],
        }),
      ],
    });

    expect(digest.periodCount).toBe(0);
    expect(digest.nonEmptyPeriodCount).toBe(0);
    expect(digest.periods).toEqual([]);
  });
});
