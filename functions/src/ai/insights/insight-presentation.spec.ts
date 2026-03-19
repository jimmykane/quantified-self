import { describe, expect, it, vi } from 'vitest';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  assertValidTimeZone,
  buildEmptyAggregation,
  buildInsightPresentation,
  buildUnsupportedResponse,
} from './insight-presentation';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

const baseQuery = {
  resultKind: 'aggregate' as const,
  dataType: 'Distance',
  valueType: ChartDataValueTypes.Total,
  categoryType: ChartDataCategoryTypes.DateType,
  requestedTimeInterval: TimeIntervals.Monthly,
  activityTypeGroups: [],
  activityTypes: [],
  dateRange: {
    kind: 'bounded' as const,
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-03-31T23:59:59.999Z',
    timezone: 'UTC',
    source: 'prompt' as const,
  },
  chartType: ChartTypes.ColumnsVertical,
};

describe('insight-presentation', () => {
  it('builds titles and warnings from the normalized query', () => {
    expect(buildInsightPresentation(baseQuery, 'distance')).toEqual({
      title: 'Total distance over time',
      chartType: ChartTypes.ColumnsVertical,
      warnings: undefined,
    });

    expect(buildInsightPresentation({
      ...baseQuery,
      categoryType: ChartDataCategoryTypes.ActivityType,
      activityTypes: ['Cycling'],
    }, 'distance')).toEqual({
      title: 'Total distance by activity type for Cycling',
      chartType: ChartTypes.ColumnsVertical,
      warnings: ['This compares a single selected activity type, so the chart will contain one bar.'],
    });
  });

  it('builds empty aggregation shells and unsupported responses', () => {
    expect(buildEmptyAggregation(baseQuery)).toEqual({
      dataType: 'Distance',
      valueType: ChartDataValueTypes.Total,
      categoryType: ChartDataCategoryTypes.DateType,
      resolvedTimeInterval: TimeIntervals.Monthly,
      buckets: [],
    });

    expect(buildUnsupportedResponse('unsupported_metric')).toEqual(expect.objectContaining({
      status: 'unsupported',
      reasonCode: 'unsupported_metric',
      suggestedPrompts: expect.any(Array),
    }));
  });

  it('uses prompt-aware unsupported suggestions and preserves explicit suggestions when provided', () => {
    expect(buildUnsupportedResponse('unsupported_capability', undefined, {
      sourceText: 'show average power per lap',
    })).toEqual(expect.objectContaining({
      suggestedPrompts: expect.arrayContaining([
        'Show my average power over time for cycling in the last 90 days.',
      ]),
    }));

    expect(buildUnsupportedResponse('unsupported_capability', undefined, {
      suggestedPrompts: ['custom prompt'],
    })).toEqual(expect.objectContaining({
      suggestedPrompts: ['custom prompt'],
    }));
  });

  it('rejects invalid IANA time zones', () => {
    expect(() => assertValidTimeZone('Europe/Helsinki')).not.toThrow();
    expect(() => assertValidTimeZone('Not/AZone')).toThrowError(HttpsError);
  });
});
