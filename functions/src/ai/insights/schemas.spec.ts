import { describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartTypes,
} from '@sports-alliance/sports-lib';
import { AiInsightsResponseSchema } from './schemas';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

describe('AiInsightsResponseSchema', () => {
  it('is defined as a discriminated union on status', () => {
    expect((AiInsightsResponseSchema as any)._def?.typeName).toBe('ZodDiscriminatedUnion');
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
});
