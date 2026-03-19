import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityTypeGroups,
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

const hoisted = vi.hoisted(() => {
  const currentContext = {
    auth: { uid: 'user-1' },
    app: { appId: 'app-1' },
  } as Record<string, unknown>;

  return {
    currentContext,
    hasProAccess: vi.fn(),
    normalizeInsightQuery: vi.fn(),
    executeAiInsightsQuery: vi.fn(),
    summarizeAiInsightResult: vi.fn(),
    getInsightMetricDefinition: vi.fn(),
    loadUserUnitSettings: vi.fn(),
  };
});

vi.mock('firebase-functions/v2/https', () => ({
  onCallGenkit: (_options: unknown, flow: unknown) => flow,
  HttpsError: class HttpsError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock('./genkit', () => ({
  aiInsightsGenkit: {
    defineFlow: (_config: unknown, handler: unknown) => handler,
    currentContext: () => hoisted.currentContext,
  },
}));

vi.mock('../../utils', () => ({
  ALLOWED_CORS_ORIGINS: [],
  hasProAccess: (...args: unknown[]) => hoisted.hasProAccess(...args),
}));

vi.mock('./normalize-query.flow', () => ({
  normalizeInsightQuery: (...args: unknown[]) => hoisted.normalizeInsightQuery(...args),
}));

vi.mock('./execute-query', () => ({
  executeAiInsightsQuery: (...args: unknown[]) => hoisted.executeAiInsightsQuery(...args),
}));

vi.mock('./summarize-result.flow', () => ({
  summarizeAiInsightResult: (...args: unknown[]) => hoisted.summarizeAiInsightResult(...args),
}));

vi.mock('./user-unit-settings', () => ({
  loadUserUnitSettings: (...args: unknown[]) => hoisted.loadUserUnitSettings(...args),
}));

vi.mock('./metric-catalog', () => ({
  getInsightMetricDefinition: (...args: unknown[]) => hoisted.getInsightMetricDefinition(...args),
  getSuggestedInsightPrompts: () => [
    'Show my total distance by activity type this year.',
    'Tell me my average cadence for cycling over the last 3 months.',
    'Show my average heart rate over time for running in the last 90 days.',
  ],
}));

import { aiInsights } from './callable';

const normalizedQuery = {
  dataType: 'Distance',
  valueType: ChartDataValueTypes.Total,
  categoryType: ChartDataCategoryTypes.DateType,
  requestedTimeInterval: TimeIntervals.Auto,
  activityTypeGroups: [],
  activityTypes: [ActivityTypes.Cycling],
  dateRange: {
    kind: 'bounded',
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-03-31T23:59:59.999Z',
    timezone: 'UTC',
    source: 'prompt',
  },
  chartType: ChartTypes.ColumnsVertical,
};

const summary = {
  matchedEventCount: 2,
  overallAggregateValue: 123,
  peakBucket: {
    bucketKey: 1,
    time: 1,
    aggregateValue: 123,
    totalCount: 2,
  },
  lowestBucket: {
    bucketKey: 1,
    time: 1,
    aggregateValue: 123,
    totalCount: 2,
  },
  latestBucket: {
    bucketKey: 1,
    time: 1,
    aggregateValue: 123,
    totalCount: 2,
  },
  activityMix: {
    topActivityTypes: [
      {
        activityType: ActivityTypes.Cycling,
        eventCount: 2,
      },
    ],
    remainingActivityTypeCount: 0,
  },
  bucketCoverage: {
    nonEmptyBucketCount: 1,
    totalBucketCount: 3,
  },
  trend: null,
};

describe('aiInsights callable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.currentContext.auth = { uid: 'user-1' };
    hoisted.currentContext.app = { appId: 'app-1' };
    hoisted.hasProAccess.mockResolvedValue(true);
    hoisted.getInsightMetricDefinition.mockReturnValue({
      key: 'distance',
      label: 'distance',
    });
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      metricKey: 'distance',
      query: normalizedQuery,
    });
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      matchedEventsCount: 2,
      matchedActivityTypeCounts: [
        {
          activityType: ActivityTypes.Cycling,
          eventCount: 2,
        },
      ],
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        resolvedTimeInterval: TimeIntervals.Monthly,
        buckets: [
          {
            bucketKey: 1,
            time: 1,
            totalCount: 2,
            aggregateValue: 123,
            seriesValues: { Cycling: 123 },
            seriesCounts: { Cycling: 2 },
          },
        ],
      },
    });
    hoisted.loadUserUnitSettings.mockResolvedValue({
      speedUnits: ['Speed in kilometers per hour'],
      gradeAdjustedSpeedUnits: ['Grade Adjusted Speed in kilometers per hour'],
      paceUnits: ['Pace'],
      gradeAdjustedPaceUnits: ['Grade Adjusted Pace'],
      swimPaceUnits: ['Swim Pace'],
      verticalSpeedUnits: ['Vertical Speed'],
      startOfTheWeek: 1,
    });
    hoisted.summarizeAiInsightResult.mockResolvedValue('Narrative');
  });

  it('rejects unauthenticated requests', async () => {
    hoisted.currentContext.auth = undefined;

    await expect(aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects requests without app check context', async () => {
    hoisted.currentContext.app = undefined;

    await expect(aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any)).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects non-pro users', async () => {
    hoisted.hasProAccess.mockResolvedValue(false);

    await expect(aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('returns an ok response when aggregation buckets exist', async () => {
    const result = await aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.normalizeInsightQuery).toHaveBeenCalled();
    expect(hoisted.loadUserUnitSettings).toHaveBeenCalledWith('user-1');
    expect(hoisted.executeAiInsightsQuery).toHaveBeenCalledWith('user-1', normalizedQuery, 'show distance');
    expect(hoisted.summarizeAiInsightResult).toHaveBeenCalledWith(expect.objectContaining({
      summary,
      unitSettings: expect.objectContaining({
        paceUnits: ['Pace'],
      }),
    }));
    expect(result).toEqual({
      status: 'ok',
      narrative: 'Narrative',
      query: normalizedQuery,
      aggregation: expect.objectContaining({
        buckets: expect.any(Array),
      }),
      summary,
      presentation: expect.objectContaining({
        title: 'Total distance over time for Cycling',
        chartType: ChartTypes.ColumnsVertical,
      }),
    });
  });

  it('returns an empty response when no aggregation buckets exist', async () => {
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      matchedEventsCount: 0,
      matchedActivityTypeCounts: [],
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        resolvedTimeInterval: TimeIntervals.Daily,
        buckets: [],
      },
    });

    const result = await aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any);

    expect(result).toEqual({
      status: 'empty',
      narrative: 'Narrative',
      query: normalizedQuery,
      aggregation: expect.objectContaining({
        buckets: [],
      }),
      summary: {
        matchedEventCount: 0,
        overallAggregateValue: null,
        peakBucket: null,
        lowestBucket: null,
        latestBucket: null,
        activityMix: null,
        bucketCoverage: {
          nonEmptyBucketCount: 0,
          totalBucketCount: 90,
        },
        trend: null,
      },
      presentation: expect.objectContaining({
        emptyState: 'No matching events were found for this insight in the requested range.',
      }),
    });
  });

  it('derives the lowest bucket from aggregation results', async () => {
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      matchedEventsCount: 3,
      matchedActivityTypeCounts: [
        {
          activityType: ActivityTypes.Cycling,
          eventCount: 3,
        },
      ],
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        resolvedTimeInterval: TimeIntervals.Monthly,
        buckets: [
          {
            bucketKey: 1,
            time: 1,
            totalCount: 1,
            aggregateValue: 123,
            seriesValues: { Cycling: 123 },
            seriesCounts: { Cycling: 1 },
          },
          {
            bucketKey: 2,
            time: 2,
            totalCount: 2,
            aggregateValue: 45,
            seriesValues: { Cycling: 45 },
            seriesCounts: { Cycling: 2 },
          },
        ],
      },
    });

    const result = await aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any);

    expect(result).toMatchObject({
      status: 'ok',
      summary: {
        peakBucket: expect.objectContaining({
          bucketKey: 1,
          aggregateValue: 123,
        }),
        lowestBucket: expect.objectContaining({
          bucketKey: 2,
          aggregateValue: 45,
        }),
      },
    });
  });

  it('returns unsupported responses without executing the query', async () => {
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'unsupported',
      reasonCode: 'unsupported_capability',
      suggestedPrompts: ['show my distance'],
    });

    const result = await aiInsights({
      prompt: 'show cadence per kilometer splits',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.executeAiInsightsQuery).not.toHaveBeenCalled();
    expect(hoisted.summarizeAiInsightResult).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'unsupported',
      narrative: 'I can only answer questions from persisted event-level stats right now, so streams, splits, laps, routes, and original-file reprocessing are out of scope.',
      reasonCode: 'unsupported_capability',
      suggestedPrompts: expect.any(Array),
    });
  });

  it('uses the activity group label in the title when a broad group filter is present', async () => {
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      metricKey: 'distance',
      query: {
        ...normalizedQuery,
        activityTypeGroups: [ActivityTypeGroups.WaterSportsGroup],
        activityTypes: [ActivityTypes.Rowing, ActivityTypes.Kayaking, ActivityTypes.Sailing],
      },
    });

    const result = await aiInsights({
      prompt: 'show distance for water sports',
      clientTimezone: 'UTC',
    } as any);

    expect(result).toMatchObject({
      status: 'ok',
      presentation: expect.objectContaining({
        title: 'Total distance over time for Water Sports',
      }),
    });
  });

  it('passes through normalized stacked queries without callable-level overrides', async () => {
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      metricKey: 'distance',
      query: {
        ...normalizedQuery,
        categoryType: ChartDataCategoryTypes.ActivityType,
        chartType: ChartTypes.LinesVertical,
        requestedTimeInterval: TimeIntervals.Auto,
      },
    });

    await aiInsights({
      prompt: 'Show my max heart rate last month as stacked columns by activity type over time',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.executeAiInsightsQuery).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        categoryType: ChartDataCategoryTypes.ActivityType,
        chartType: ChartTypes.LinesVertical,
        requestedTimeInterval: TimeIntervals.Auto,
      }),
      'Show my max heart rate last month as stacked columns by activity type over time',
    );
  });
});
