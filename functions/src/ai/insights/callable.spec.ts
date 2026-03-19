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
    loggerError: vi.fn(),
    loggerWarn: vi.fn(),
    loggerInfo: vi.fn(),
    loggerDebug: vi.fn(),
    getAiInsightsQuotaStatus: vi.fn(),
    reserveAiInsightsQuotaForGenkit: vi.fn(),
    finalizeAiInsightsQuotaReservation: vi.fn(),
    releaseAiInsightsQuotaReservation: vi.fn(),
    normalizeInsightQuery: vi.fn(),
    executeAiInsightsQuery: vi.fn(),
    summarizeAiInsightResult: vi.fn(),
    getInsightMetricDefinition: vi.fn(),
    loadUserUnitSettings: vi.fn(),
  };
});

vi.mock('firebase-functions/logger', () => ({
  error: (...args: unknown[]) => hoisted.loggerError(...args),
  warn: (...args: unknown[]) => hoisted.loggerWarn(...args),
  info: (...args: unknown[]) => hoisted.loggerInfo(...args),
  debug: (...args: unknown[]) => hoisted.loggerDebug(...args),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_options: unknown, handler: unknown) => handler,
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
  enforceAppCheck: vi.fn(),
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

vi.mock('./quota', () => ({
  AI_INSIGHTS_LIMIT_REACHED_MESSAGE: 'AI Insights limit reached for this billing period.',
  getAiInsightsQuotaStatus: (...args: unknown[]) => hoisted.getAiInsightsQuotaStatus(...args),
  reserveAiInsightsQuotaForGenkit: (...args: unknown[]) => hoisted.reserveAiInsightsQuotaForGenkit(...args),
  finalizeAiInsightsQuotaReservation: (...args: unknown[]) => hoisted.finalizeAiInsightsQuotaReservation(...args),
  releaseAiInsightsQuotaReservation: (...args: unknown[]) => hoisted.releaseAiInsightsQuotaReservation(...args),
}));

vi.mock('./metric-catalog', () => ({
  getInsightMetricDefinition: (...args: unknown[]) => hoisted.getInsightMetricDefinition(...args),
  getSuggestedInsightPrompts: () => [
    'Show my total distance by activity type this year.',
    'Tell me my average cadence for cycling over the last 3 months.',
    'Show my average heart rate over time for running in the last 90 days.',
  ],
}));

import { aiInsights, getAiInsightsQuotaStatus } from './callable';

const quotaStatus = {
  role: 'pro',
  limit: 100,
  successfulGenkitCount: 12,
  activeReservationCount: 0,
  remainingCount: 88,
  periodStart: '2026-03-01T00:00:00.000Z',
  periodEnd: '2026-04-01T00:00:00.000Z',
  periodKind: 'subscription',
  resetMode: 'date',
  isEligible: true,
  blockedReason: null,
} as const;

const normalizedQuery = {
  resultKind: 'aggregate',
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

const eventLookupQuery = {
  ...normalizedQuery,
  resultKind: 'event_lookup' as const,
  chartType: ChartTypes.LinesVertical,
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
      resultKind: 'aggregate',
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
    hoisted.getAiInsightsQuotaStatus.mockResolvedValue(quotaStatus);
    hoisted.reserveAiInsightsQuotaForGenkit.mockResolvedValue({
      userID: 'user-1',
      reservationID: 'reservation-1',
      periodDocId: 'period_1_2',
      role: 'pro',
      limit: 100,
      periodStart: quotaStatus.periodStart,
      periodEnd: quotaStatus.periodEnd,
      periodKind: 'subscription',
      resetMode: 'date',
      isEligible: true,
    });
    hoisted.finalizeAiInsightsQuotaReservation.mockResolvedValue(quotaStatus);
    hoisted.releaseAiInsightsQuotaReservation.mockResolvedValue(quotaStatus);
    hoisted.summarizeAiInsightResult.mockResolvedValue({
      narrative: 'Narrative',
      source: 'genkit',
    });
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

  it('rejects unpaid users before normalization', async () => {
    hoisted.getAiInsightsQuotaStatus.mockResolvedValue({
      ...quotaStatus,
      role: 'free',
      limit: 0,
      successfulGenkitCount: 0,
      remainingCount: 0,
      isEligible: false,
      blockedReason: 'requires_pro',
    });

    await expect(aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any)).rejects.toMatchObject({
      code: 'permission-denied',
      message: 'AI Insights is available to Basic and Pro members.',
    });

    expect(hoisted.normalizeInsightQuery).not.toHaveBeenCalled();
  });

  it('rejects exhausted users before normalization', async () => {
    hoisted.getAiInsightsQuotaStatus.mockResolvedValue({
      ...quotaStatus,
      successfulGenkitCount: 100,
      remainingCount: 0,
      blockedReason: 'limit_reached',
    });

    await expect(aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any)).rejects.toMatchObject({
      code: 'resource-exhausted',
      message: 'AI Insights limit reached for this billing period.',
    });

    expect(hoisted.normalizeInsightQuery).not.toHaveBeenCalled();
  });

  it('allows active basic users', async () => {
    hoisted.getAiInsightsQuotaStatus.mockResolvedValue({
      ...quotaStatus,
      role: 'basic',
      limit: 50,
      successfulGenkitCount: 5,
      remainingCount: 45,
    });
    hoisted.reserveAiInsightsQuotaForGenkit.mockResolvedValue({
      userID: 'user-1',
      reservationID: 'reservation-1',
      periodDocId: 'period_1_2',
      role: 'basic',
      limit: 50,
      periodStart: quotaStatus.periodStart,
      periodEnd: quotaStatus.periodEnd,
      periodKind: 'subscription',
      resetMode: 'date',
      isEligible: true,
    });
    hoisted.finalizeAiInsightsQuotaReservation.mockResolvedValue({
      ...quotaStatus,
      role: 'basic',
      limit: 50,
      successfulGenkitCount: 6,
      remainingCount: 44,
    });

    const result = await aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any);

    expect(result).toMatchObject({
      status: 'ok',
      quota: expect.objectContaining({
        role: 'basic',
        limit: 50,
      }),
    });
  });

  it('returns an ok response when aggregation buckets exist', async () => {
    const result = await aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.normalizeInsightQuery).toHaveBeenCalled();
    expect(hoisted.loadUserUnitSettings).toHaveBeenCalledWith('user-1');
    expect(hoisted.executeAiInsightsQuery).toHaveBeenCalledWith('user-1', normalizedQuery, 'show distance');
    expect(hoisted.reserveAiInsightsQuotaForGenkit).toHaveBeenCalledWith('user-1');
    expect(hoisted.finalizeAiInsightsQuotaReservation).toHaveBeenCalledWith(expect.objectContaining({
      reservationID: 'reservation-1',
    }));
    expect(hoisted.summarizeAiInsightResult).toHaveBeenCalledWith(expect.objectContaining({
      summary,
      unitSettings: expect.objectContaining({
        paceUnits: ['Pace'],
      }),
    }));
    expect(result).toEqual({
      status: 'ok',
      resultKind: 'aggregate',
      narrative: 'Narrative',
      quota: quotaStatus,
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

  it('returns an event lookup response with ranked event ids for singular event prompts', async () => {
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      metricKey: 'distance',
      query: eventLookupQuery,
    });
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      resultKind: 'event_lookup',
      matchedEventsCount: 3,
      matchedActivityTypeCounts: [
        {
          activityType: ActivityTypes.Cycling,
          eventCount: 3,
        },
      ],
      eventLookup: {
        primaryEventId: 'event-3',
        topEventIds: ['event-3', 'event-2', 'event-1'],
        rankedEvents: [
          {
            eventId: 'event-3',
            startDate: '2026-03-10T08:00:00.000Z',
            aggregateValue: 123,
          },
          {
            eventId: 'event-2',
            startDate: '2026-02-14T08:00:00.000Z',
            aggregateValue: 118,
          },
          {
            eventId: 'event-1',
            startDate: '2026-01-11T08:00:00.000Z',
            aggregateValue: 105,
          },
        ],
      },
    });

    const result = await aiInsights({
      prompt: 'I want to know when I had my longest distance in cycling',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.summarizeAiInsightResult).toHaveBeenCalledWith(expect.objectContaining({
      query: eventLookupQuery,
      eventLookup: {
        matchedEventCount: 3,
        primaryEvent: expect.objectContaining({
          eventId: 'event-3',
          aggregateValue: 123,
        }),
        rankedEvents: expect.arrayContaining([
          expect.objectContaining({ eventId: 'event-3' }),
          expect.objectContaining({ eventId: 'event-2' }),
        ]),
      },
    }));
    expect(result).toEqual({
      status: 'ok',
      resultKind: 'event_lookup',
      narrative: 'Narrative',
      quota: quotaStatus,
      query: eventLookupQuery,
      eventLookup: {
        primaryEventId: 'event-3',
        topEventIds: ['event-3', 'event-2', 'event-1'],
        matchedEventCount: 3,
      },
      presentation: expect.objectContaining({
        title: 'Top distance events for Cycling',
        chartType: ChartTypes.LinesVertical,
      }),
    });
  });

  it('returns an empty response when no aggregation buckets exist', async () => {
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      resultKind: 'aggregate',
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
      quota: quotaStatus,
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

  it('counts biweekly bucket coverage using paired week buckets that intersect the range', async () => {
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      metricKey: 'distance',
      query: {
        ...normalizedQuery,
        requestedTimeInterval: TimeIntervals.BiWeekly,
        dateRange: {
          kind: 'bounded',
          startDate: '2024-01-08T00:00:00.000Z',
          endDate: '2024-01-21T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
      },
    });
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      resultKind: 'aggregate',
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
        resolvedTimeInterval: TimeIntervals.BiWeekly,
        buckets: [
          {
            bucketKey: Date.UTC(2024, 0, 1),
            time: Date.UTC(2024, 0, 1),
            totalCount: 1,
            aggregateValue: 50,
            seriesValues: { Cycling: 50 },
            seriesCounts: { Cycling: 1 },
          },
          {
            bucketKey: Date.UTC(2024, 0, 15),
            time: Date.UTC(2024, 0, 15),
            totalCount: 1,
            aggregateValue: 70,
            seriesValues: { Cycling: 70 },
            seriesCounts: { Cycling: 1 },
          },
        ],
      },
    });

    const result = await aiInsights({
      prompt: 'show distance biweekly',
      clientTimezone: 'UTC',
    } as any);

    expect(result).toMatchObject({
      status: 'ok',
      summary: {
        bucketCoverage: {
          nonEmptyBucketCount: 2,
          totalBucketCount: 2,
        },
      },
    });
  });

  it('derives the lowest bucket from aggregation results', async () => {
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      resultKind: 'aggregate',
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
      quota: quotaStatus,
      reasonCode: 'unsupported_capability',
      suggestedPrompts: ['show my distance'],
    });
  });

  it('releases the reservation when Genkit falls back instead of consuming quota', async () => {
    hoisted.summarizeAiInsightResult.mockResolvedValue({
      narrative: 'Fallback narrative',
      source: 'fallback',
    });

    const result = await aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.finalizeAiInsightsQuotaReservation).not.toHaveBeenCalled();
    expect(hoisted.releaseAiInsightsQuotaReservation).toHaveBeenCalledWith(expect.objectContaining({
      reservationID: 'reservation-1',
    }));
    expect(result).toMatchObject({
      status: 'ok',
      narrative: 'Fallback narrative',
      quota: quotaStatus,
    });
  });

  it('releases the reservation when summarize-result throws before quota can be finalized', async () => {
    hoisted.summarizeAiInsightResult.mockRejectedValue(new Error('summarize failed'));

    await expect(aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any)).rejects.toMatchObject({
      code: 'internal',
    });

    expect(hoisted.releaseAiInsightsQuotaReservation).toHaveBeenCalledWith(expect.objectContaining({
      reservationID: 'reservation-1',
    }));
    expect(hoisted.finalizeAiInsightsQuotaReservation).not.toHaveBeenCalled();
  });

  it('logs serialized error details when ai insight generation fails', async () => {
    hoisted.summarizeAiInsightResult.mockRejectedValue(new Error('summarize failed'));

    await expect(aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any)).rejects.toMatchObject({
      code: 'internal',
    });

    expect(hoisted.loggerError).toHaveBeenCalledWith(
      '[aiInsights] Failed to generate AI insight',
      expect.objectContaining({
        errorName: 'Error',
        errorMessage: 'summarize failed',
        errorStack: expect.stringContaining('summarize failed'),
      }),
    );
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

  it('omits latestBucket for non-date grouped summaries', async () => {
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      metricKey: 'distance',
      query: {
        ...normalizedQuery,
        categoryType: ChartDataCategoryTypes.ActivityType,
        chartType: ChartTypes.ColumnsHorizontal,
      },
    });
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      resultKind: 'aggregate',
      matchedEventsCount: 10,
      matchedActivityTypeCounts: [
        { activityType: ActivityTypes.Cycling, eventCount: 5 },
        { activityType: ActivityTypes.Yoga, eventCount: 3 },
        { activityType: ActivityTypes.Diving, eventCount: 2 },
      ],
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.ActivityType,
        resolvedTimeInterval: TimeIntervals.Monthly,
        buckets: [
          {
            bucketKey: ActivityTypes.Diving,
            totalCount: 2,
            aggregateValue: 0,
            seriesValues: { [ActivityTypes.Diving]: 0 },
            seriesCounts: { [ActivityTypes.Diving]: 2 },
          },
          {
            bucketKey: ActivityTypes.Yoga,
            totalCount: 3,
            aggregateValue: 0,
            seriesValues: { [ActivityTypes.Yoga]: 0 },
            seriesCounts: { [ActivityTypes.Yoga]: 3 },
          },
          {
            bucketKey: ActivityTypes.Cycling,
            totalCount: 5,
            aggregateValue: 24500,
            seriesValues: { [ActivityTypes.Cycling]: 24500 },
            seriesCounts: { [ActivityTypes.Cycling]: 5 },
          },
        ],
      },
    });

    const result = await aiInsights({
      prompt: 'show my total distance by activity type this year',
      clientTimezone: 'UTC',
    } as any);

    expect(result).toMatchObject({
      status: 'ok',
      summary: expect.objectContaining({
        latestBucket: null,
        lowestBucket: expect.objectContaining({
          bucketKey: ActivityTypes.Diving,
        }),
      }),
    });
  });

  it('returns quota status from the dedicated callable', async () => {
    const result = await getAiInsightsQuotaStatus({
      auth: { uid: 'user-1' },
      app: { appId: 'app-1' },
      data: undefined,
    } as any);

    expect(hoisted.getAiInsightsQuotaStatus).toHaveBeenCalledWith('user-1');
    expect(result).toEqual(quotaStatus);
  });
});
