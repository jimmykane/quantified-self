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
    const schemaDef = (AiInsightsResponseSchema as unknown as { _def?: { typeName?: string } })._def;
    expect(schemaDef?.typeName).toBe('ZodUnion');
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
