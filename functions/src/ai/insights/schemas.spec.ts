import { describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { AiInsightsResponseSchema } from './schemas';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

describe('AiInsightsResponseSchema', () => {
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
