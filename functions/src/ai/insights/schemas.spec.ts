import { describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { AI_INSIGHTS_POWER_CURVE_COMPARE_SERIES_SAFETY_MAX } from '../../../../shared/ai-insights-power-curve.constants';
import { AiInsightsRequestSchema, AiInsightsResponseSchema } from './schemas';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

describe('AiInsightsResponseSchema', () => {
  it('parses request payloads with an optional location filter', () => {
    const parsed = AiInsightsRequestSchema.safeParse({
      prompt: 'Show my total distance this year',
      clientTimezone: 'Europe/Helsinki',
      clientLocale: 'en-US',
      locationFilter: {
        locationText: 'Greece',
        radiusKm: 50,
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('is defined as a union over all response variants', () => {
    const schemaDef = (AiInsightsResponseSchema as unknown as {
      _def?: { typeName?: string; type?: string };
      constructor?: { name?: string };
    })._def;
    const schemaType = schemaDef?.typeName ?? schemaDef?.type;
    expect(['ZodUnion', 'union']).toContain(schemaType);
  });

  it('parses unsupported responses through the status discriminator', () => {
    const parsed = AiInsightsResponseSchema.safeParse({
      status: 'unsupported',
      narrative: 'Unsupported prompt',
      reasonCode: 'unsupported_capability',
      suggestedPrompts: ['Show my total distance for last month'],
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects payloads without the status discriminator', () => {
    const parsed = AiInsightsResponseSchema.safeParse({
      narrative: 'Missing status',
    });

    expect(parsed.success).toBe(false);
  });

  it('parses latest_event responses through the status discriminator', () => {
    const parsed = AiInsightsResponseSchema.safeParse({
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
          endDate: '2026-03-18T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
        locationFilter: {
          requestedText: 'Greece',
          effectiveText: 'Greece',
          resolvedLabel: 'Greece',
          source: 'prompt',
          mode: 'bbox',
          radiusKm: 50,
          center: {
            latitudeDegrees: 39.0742,
            longitudeDegrees: 21.8243,
          },
          bbox: {
            west: 19.3736,
            south: 34.8002,
            east: 28.2471,
            north: 41.7488,
          },
        },
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
    });

    expect(parsed.success).toBe(true);
  });

  it('parses power_curve responses through the result-kind discriminator', () => {
    const parsed = AiInsightsResponseSchema.safeParse({
      status: 'ok',
      resultKind: 'power_curve',
      narrative: 'Best power curve summary.',
      query: {
        resultKind: 'power_curve',
        mode: 'best',
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-18T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
        defaultedToCycling: true,
      },
      powerCurve: {
        mode: 'best',
        resolvedTimeInterval: TimeIntervals.Auto,
        matchedEventCount: 4,
        requestedSeriesCount: 1,
        returnedSeriesCount: 1,
        safetyGuardApplied: false,
        safetyGuardMaxSeries: null,
        trimmedSeriesCount: 0,
        series: [
          {
            seriesKey: 'best',
            label: 'Best power curve',
            matchedEventCount: 4,
            bucketStartDate: null,
            bucketEndDate: null,
            points: [
              { duration: 5, power: 640, wattsPerKg: 8.4 },
              { duration: 60, power: 420, wattsPerKg: 5.5 },
            ],
          },
        ],
      },
      presentation: {
        title: 'Best power curve for Cycling',
        chartType: ChartTypes.LinesVertical,
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('parses multi-metric digest responses with period-level payloads', () => {
    const parsed = AiInsightsResponseSchema.safeParse({
      status: 'ok',
      resultKind: 'multi_metric_aggregate',
      narrative: 'Weekly digest summary.',
      query: {
        resultKind: 'multi_metric_aggregate',
        groupingMode: 'date',
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Weekly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-18T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
        digestMode: 'weekly',
        metricSelections: [
          {
            metricKey: 'distance',
            dataType: 'Distance',
            valueType: ChartDataValueTypes.Total,
          },
          {
            metricKey: 'duration',
            dataType: 'Duration',
            valueType: ChartDataValueTypes.Total,
          },
        ],
      },
      metricResults: [
        {
          metricKey: 'distance',
          metricLabel: 'Distance',
          query: {
            resultKind: 'aggregate',
            dataType: 'Distance',
            valueType: ChartDataValueTypes.Total,
            categoryType: ChartDataCategoryTypes.DateType,
            requestedTimeInterval: TimeIntervals.Weekly,
            activityTypeGroups: [],
            activityTypes: [ActivityTypes.Cycling],
            dateRange: {
              kind: 'bounded',
              startDate: '2026-01-01T00:00:00.000Z',
              endDate: '2026-03-18T23:59:59.999Z',
              timezone: 'UTC',
              source: 'prompt',
            },
            chartType: ChartTypes.LinesVertical,
          },
          aggregation: {
            dataType: 'Distance',
            valueType: ChartDataValueTypes.Total,
            categoryType: ChartDataCategoryTypes.DateType,
            resolvedTimeInterval: TimeIntervals.Weekly,
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
            title: 'Distance',
            chartType: ChartTypes.LinesVertical,
          },
        },
      ],
      digest: {
        granularity: 'weekly',
        periodCount: 2,
        nonEmptyPeriodCount: 1,
        periods: [
          {
            bucketKey: '2026-W09',
            time: Date.parse('2026-02-23T00:00:00.000Z'),
            hasData: true,
            metrics: [
              {
                metricKey: 'distance',
                metricLabel: 'Distance',
                dataType: 'Distance',
                valueType: ChartDataValueTypes.Total,
                aggregateValue: 40000,
                totalCount: 2,
              },
            ],
          },
          {
            bucketKey: '2026-W10',
            time: Date.parse('2026-03-02T00:00:00.000Z'),
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
            ],
          },
        ],
      },
      presentation: {
        title: 'Digest',
        chartType: ChartTypes.LinesVertical,
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects power_curve responses when series exceed the safety max', () => {
    const seriesCount = AI_INSIGHTS_POWER_CURVE_COMPARE_SERIES_SAFETY_MAX + 1;
    const parsed = AiInsightsResponseSchema.safeParse({
      status: 'ok',
      resultKind: 'power_curve',
      narrative: 'Power curve summary.',
      query: {
        resultKind: 'power_curve',
        mode: 'compare_over_time',
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-18T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
        defaultedToCycling: true,
      },
      powerCurve: {
        mode: 'compare_over_time',
        resolvedTimeInterval: TimeIntervals.Monthly,
        matchedEventCount: seriesCount,
        requestedSeriesCount: seriesCount,
        returnedSeriesCount: seriesCount,
        safetyGuardApplied: true,
        safetyGuardMaxSeries: AI_INSIGHTS_POWER_CURVE_COMPARE_SERIES_SAFETY_MAX,
        trimmedSeriesCount: 0,
        series: Array.from({ length: seriesCount }, (_, index) => ({
          seriesKey: `series-${index + 1}`,
          label: `Series ${index + 1}`,
          matchedEventCount: 1,
          bucketStartDate: '2026-01-01T00:00:00.000Z',
          bucketEndDate: '2026-01-31T23:59:59.999Z',
          points: [{ duration: 60, power: 300 }],
        })),
      },
      presentation: {
        title: 'Power curve',
        chartType: ChartTypes.LinesVertical,
      },
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects invalid aggregate query fields for strict response contracts', () => {
    const parsed = AiInsightsResponseSchema.safeParse({
      status: 'ok',
      resultKind: 'aggregate',
      narrative: 'Invalid aggregate query',
      query: {
        resultKind: 'aggregate',
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: null,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-18T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        requestedDateRanges: [{}],
        periodMode: 'invalid-mode',
        chartType: ChartTypes.LinesVertical,
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
        chartType: ChartTypes.LinesVertical,
      },
    });

    expect(parsed.success).toBe(false);
  });
});
