import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  ActivityTypeGroups,
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataJumpDistanceMax,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { AI_INSIGHTS_REQUEST_LIMITS } from '../../../../shared/limits';

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
    reserveAiInsightsQuotaForRequest: vi.fn(),
    finalizeAiInsightsQuotaReservation: vi.fn(),
    releaseAiInsightsQuotaReservation: vi.fn(),
    normalizeInsightQuery: vi.fn(),
    repairUnsupportedInsightQuery: vi.fn(),
    detectPromptLanguageDeterministic: vi.fn(),
    sanitizePromptToEnglish: vi.fn(),
    buildAiInsightsPromptRepairIdentity: vi.fn(),
    recordSuccessfulAiInsightRepair: vi.fn(),
    executeAiInsightsQuery: vi.fn(),
    summarizeAiInsightResult: vi.fn(),
    getInsightMetricDefinition: vi.fn(),
    loadUserUnitSettings: vi.fn(),
    persistLatestAiInsightsSnapshot: vi.fn(),
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

vi.mock('./runtime', () => ({
  AI_INSIGHTS_LIMIT_REACHED_MESSAGE: 'AI Insights limit reached for this billing period.',
  aiInsightsRuntime: {
    getAiInsightsQuotaStatus: (...args: unknown[]) => hoisted.getAiInsightsQuotaStatus(...args),
    reserveAiInsightsQuotaForRequest: (...args: unknown[]) => hoisted.reserveAiInsightsQuotaForRequest(...args),
    finalizeAiInsightsQuotaReservation: (...args: unknown[]) => hoisted.finalizeAiInsightsQuotaReservation(...args),
    releaseAiInsightsQuotaReservation: (...args: unknown[]) => hoisted.releaseAiInsightsQuotaReservation(...args),
    normalizeInsightQuery: (...args: unknown[]) => hoisted.normalizeInsightQuery(...args),
    repairUnsupportedInsightQuery: (...args: unknown[]) => hoisted.repairUnsupportedInsightQuery(...args),
    detectPromptLanguageDeterministic: (...args: unknown[]) => hoisted.detectPromptLanguageDeterministic(...args),
    sanitizePromptToEnglish: (...args: unknown[]) => hoisted.sanitizePromptToEnglish(...args),
    buildAiInsightsPromptRepairIdentity: (...args: unknown[]) => hoisted.buildAiInsightsPromptRepairIdentity(...args),
    recordSuccessfulAiInsightRepair: (...args: unknown[]) => hoisted.recordSuccessfulAiInsightRepair(...args),
    executeAiInsightsQuery: (...args: unknown[]) => hoisted.executeAiInsightsQuery(...args),
    summarizeAiInsightResult: (...args: unknown[]) => hoisted.summarizeAiInsightResult(...args),
    loadUserUnitSettings: (...args: unknown[]) => hoisted.loadUserUnitSettings(...args),
    persistLatestAiInsightsSnapshot: (...args: unknown[]) => hoisted.persistLatestAiInsightsSnapshot(...args),
  },
}));

vi.mock('./normalize-query.flow', () => ({
  normalizeInsightQuery: (...args: unknown[]) => hoisted.normalizeInsightQuery(...args),
}));

vi.mock('./normalize-query.repair', () => ({
  repairUnsupportedInsightQuery: (...args: unknown[]) => hoisted.repairUnsupportedInsightQuery(...args),
}));

vi.mock('./prompt-language-sanitization', () => ({
  detectPromptLanguageDeterministic: (...args: unknown[]) => hoisted.detectPromptLanguageDeterministic(...args),
  sanitizePromptToEnglish: (...args: unknown[]) => hoisted.sanitizePromptToEnglish(...args),
}));

vi.mock('./repaired-prompt-backlog', () => ({
  buildAiInsightsPromptRepairIdentity: (...args: unknown[]) => hoisted.buildAiInsightsPromptRepairIdentity(...args),
  recordSuccessfulAiInsightRepair: (...args: unknown[]) => hoisted.recordSuccessfulAiInsightRepair(...args),
  trimPromptSample: (prompt: string, maxChars = 1000) => `${prompt || ''}`.trim().slice(0, Math.max(0, maxChars)),
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
  reserveAiInsightsQuotaForRequest: (...args: unknown[]) => hoisted.reserveAiInsightsQuotaForRequest(...args),
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

function buildAggregateEventRanking() {
  return {
    primaryEventId: 'event-3',
    topEventIds: ['event-3', 'event-2', 'event-1'],
    matchedEventCount: 3,
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
  };
}

const quotaStatus = {
  role: 'pro',
  limit: AI_INSIGHTS_REQUEST_LIMITS.pro,
  successfulRequestCount: 12,
  activeRequestCount: 0,
  remainingCount: AI_INSIGHTS_REQUEST_LIMITS.pro - 12,
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

const latestEventQuery = {
  resultKind: 'latest_event' as const,
  categoryType: ChartDataCategoryTypes.DateType,
  activityTypeGroups: [],
  activityTypes: [ActivityTypes.Cycling],
  dateRange: normalizedQuery.dateRange,
  chartType: ChartTypes.LinesVertical,
};

const jumpEventLookupQuery = {
  ...eventLookupQuery,
  dataType: DataJumpDistanceMax.type,
  valueType: ChartDataValueTypes.Maximum,
};

const multiMetricQuery = {
  resultKind: 'multi_metric_aggregate' as const,
  groupingMode: 'date' as const,
  categoryType: ChartDataCategoryTypes.DateType,
  requestedTimeInterval: TimeIntervals.Monthly,
  activityTypeGroups: [],
  activityTypes: [ActivityTypes.Cycling],
  dateRange: normalizedQuery.dateRange,
  chartType: ChartTypes.LinesVertical,
  metricSelections: [
    {
      metricKey: 'cadence',
      dataType: 'Average Cadence',
      valueType: ChartDataValueTypes.Average,
    },
    {
      metricKey: 'power',
      dataType: 'Average Power',
      valueType: ChartDataValueTypes.Average,
    },
  ],
};

const yearlyDigestMultiMetricQuery = {
  ...multiMetricQuery,
  requestedTimeInterval: TimeIntervals.Yearly,
  dateRange: {
    kind: 'bounded' as const,
    startDate: '2024-01-01T00:00:00.000Z',
    endDate: '2026-12-31T23:59:59.999Z',
    timezone: 'UTC',
    source: 'prompt' as const,
  },
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
    {
      metricKey: 'ascent',
      dataType: 'Ascent',
      valueType: ChartDataValueTypes.Total,
    },
  ],
  digestMode: 'yearly' as const,
};

const powerCurveQuery = {
  resultKind: 'power_curve' as const,
  mode: 'best' as const,
  categoryType: ChartDataCategoryTypes.DateType,
  requestedTimeInterval: TimeIntervals.Monthly,
  activityTypeGroups: [],
  activityTypes: [ActivityTypes.Cycling],
  dateRange: normalizedQuery.dateRange,
  chartType: ChartTypes.LinesVertical,
  defaultedToCycling: true,
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
  periodDeltas: null,
  anomalyCallouts: null,
};

describe('aiInsights callable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.currentContext.auth = { uid: 'user-1' };
    hoisted.currentContext.app = { appId: 'app-1' };
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    hoisted.getInsightMetricDefinition.mockReturnValue({
      key: 'distance',
      label: 'distance',
    });
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      metricKey: 'distance',
      query: normalizedQuery,
    });
    hoisted.repairUnsupportedInsightQuery.mockResolvedValue({
      result: {
        status: 'unsupported',
        reasonCode: 'unsupported_metric',
        suggestedPrompts: ['show my distance'],
      },
      source: 'none',
    });
    hoisted.detectPromptLanguageDeterministic.mockReturnValue('english');
    hoisted.sanitizePromptToEnglish.mockResolvedValue({
      status: 'english',
      prompt: 'show distance',
    });
    hoisted.buildAiInsightsPromptRepairIdentity.mockReturnValue({
      canonicalPrompt: 'show my max cardio in cycling',
      normalizedQuerySignature: '{"query":"signature"}',
      intentDocID: 'repair-intent-1',
    });
    hoisted.recordSuccessfulAiInsightRepair.mockResolvedValue({
      canonicalPrompt: 'show my max cardio in cycling',
      normalizedQuerySignature: '{"query":"signature"}',
      intentDocID: 'repair-intent-1',
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
    hoisted.reserveAiInsightsQuotaForRequest.mockResolvedValue({
      userID: 'user-1',
      reservationID: 'reservation-1',
      periodDocId: 'period_1_2',
      role: 'pro',
      limit: AI_INSIGHTS_REQUEST_LIMITS.pro,
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
    hoisted.persistLatestAiInsightsSnapshot.mockResolvedValue(undefined);
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
      successfulRequestCount: 0,
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
      successfulRequestCount: 100,
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

  it('fails before normalization when concurrent requests exhaust quota during reservation', async () => {
    hoisted.getAiInsightsQuotaStatus.mockResolvedValue({
      ...quotaStatus,
      remainingCount: 1,
    });
    hoisted.reserveAiInsightsQuotaForRequest.mockRejectedValue(
      new HttpsError('resource-exhausted', 'AI Insights limit reached for this billing period.'),
    );

    await expect(aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any)).rejects.toMatchObject({
      code: 'resource-exhausted',
      message: 'AI Insights limit reached for this billing period.',
    });

    expect(hoisted.normalizeInsightQuery).not.toHaveBeenCalled();
    expect(hoisted.executeAiInsightsQuery).not.toHaveBeenCalled();
    expect(hoisted.summarizeAiInsightResult).not.toHaveBeenCalled();
  });

  it('releases reserved quota when deterministic normalization throws', async () => {
    hoisted.normalizeInsightQuery.mockRejectedValue(new Error('normalize failed'));

    await expect(aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any)).rejects.toMatchObject({
      code: 'internal',
      message: 'Could not generate AI insights.',
    });

    expect(hoisted.reserveAiInsightsQuotaForRequest).toHaveBeenCalledTimes(1);
    expect(hoisted.finalizeAiInsightsQuotaReservation).not.toHaveBeenCalled();
    expect(hoisted.releaseAiInsightsQuotaReservation).toHaveBeenCalledTimes(1);
    expect(hoisted.releaseAiInsightsQuotaReservation).toHaveBeenCalledWith(expect.objectContaining({
      userID: 'user-1',
      reservationID: 'reservation-1',
    }));
  });

  it('allows active basic users', async () => {
    hoisted.getAiInsightsQuotaStatus.mockResolvedValue({
      ...quotaStatus,
      role: 'basic',
      limit: AI_INSIGHTS_REQUEST_LIMITS.basic,
      successfulRequestCount: 5,
      remainingCount: AI_INSIGHTS_REQUEST_LIMITS.basic - 5,
    });
    hoisted.reserveAiInsightsQuotaForRequest.mockResolvedValue({
      userID: 'user-1',
      reservationID: 'reservation-1',
      periodDocId: 'period_1_2',
      role: 'basic',
      limit: AI_INSIGHTS_REQUEST_LIMITS.basic,
      periodStart: quotaStatus.periodStart,
      periodEnd: quotaStatus.periodEnd,
      periodKind: 'subscription',
      resetMode: 'date',
      isEligible: true,
    });
    hoisted.finalizeAiInsightsQuotaReservation.mockResolvedValue({
      ...quotaStatus,
      role: 'basic',
      limit: AI_INSIGHTS_REQUEST_LIMITS.basic,
      successfulRequestCount: 6,
      remainingCount: AI_INSIGHTS_REQUEST_LIMITS.basic - 6,
    });

    const result = await aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any);

    expect(result).toMatchObject({
      status: 'ok',
      quota: expect.objectContaining({
        role: 'basic',
        limit: AI_INSIGHTS_REQUEST_LIMITS.basic,
      }),
    });
  });

  it('returns a multi-metric aggregate response from one prompt', async () => {
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      query: multiMetricQuery,
    });
    hoisted.getInsightMetricDefinition.mockImplementation((metricKey: string) => {
      if (metricKey === 'cadence') {
        return { key: 'cadence', label: 'cadence' };
      }
      if (metricKey === 'power') {
        return { key: 'power', label: 'power' };
      }
      return null;
    });
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      resultKind: 'multi_metric_aggregate',
      matchedEventsCount: 3,
      matchedActivityTypeCounts: [
        {
          activityType: ActivityTypes.Cycling,
          eventCount: 3,
        },
      ],
      metricResults: [
        {
          metricKey: 'cadence',
          matchedEventsCount: 3,
          matchedActivityTypeCounts: [
            {
              activityType: ActivityTypes.Cycling,
              eventCount: 3,
            },
          ],
          aggregation: {
            dataType: 'Average Cadence',
            valueType: ChartDataValueTypes.Average,
            categoryType: ChartDataCategoryTypes.DateType,
            resolvedTimeInterval: TimeIntervals.Monthly,
            buckets: [
              {
                bucketKey: 1,
                time: 1,
                totalCount: 3,
                aggregateValue: 90,
                seriesValues: { Cycling: 90 },
                seriesCounts: { Cycling: 3 },
              },
            ],
          },
        },
        {
          metricKey: 'power',
          matchedEventsCount: 2,
          matchedActivityTypeCounts: [
            {
              activityType: ActivityTypes.Cycling,
              eventCount: 2,
            },
          ],
          aggregation: {
            dataType: 'Average Power',
            valueType: ChartDataValueTypes.Average,
            categoryType: ChartDataCategoryTypes.DateType,
            resolvedTimeInterval: TimeIntervals.Monthly,
            buckets: [
              {
                bucketKey: 1,
                time: 1,
                totalCount: 2,
                aggregateValue: 220,
                seriesValues: { Cycling: 220 },
                seriesCounts: { Cycling: 2 },
              },
            ],
          },
        },
      ],
    });

    const result = await aiInsights({
      prompt: 'show me avg cadence and avg power for the last 3 months for cycling',
      clientTimezone: 'UTC',
    } as any);

    expect(result).toMatchObject({
      status: 'ok',
      resultKind: 'multi_metric_aggregate',
      query: multiMetricQuery,
      metricResults: [
        {
          metricKey: 'cadence',
          metricLabel: 'cadence',
        },
        {
          metricKey: 'power',
          metricLabel: 'power',
        },
      ],
    });
    expect(hoisted.reserveAiInsightsQuotaForRequest).toHaveBeenCalledTimes(1);
    expect(hoisted.summarizeAiInsightResult).toHaveBeenCalledTimes(1);
  });

  it('returns yearly digest payloads for multi-metric digest responses', async () => {
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      query: yearlyDigestMultiMetricQuery,
    });
    hoisted.getInsightMetricDefinition.mockImplementation((metricKey: string) => {
      if (metricKey === 'distance') {
        return { key: 'distance', label: 'distance' };
      }
      if (metricKey === 'duration') {
        return { key: 'duration', label: 'duration' };
      }
      if (metricKey === 'ascent') {
        return { key: 'ascent', label: 'ascent' };
      }
      return null;
    });
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      resultKind: 'multi_metric_aggregate',
      matchedEventsCount: 4,
      matchedActivityTypeCounts: [
        {
          activityType: ActivityTypes.Cycling,
          eventCount: 4,
        },
      ],
      metricResults: [
        {
          metricKey: 'distance',
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
            resolvedTimeInterval: TimeIntervals.Yearly,
            buckets: [
              {
                bucketKey: '2025',
                time: Date.parse('2025-01-01T00:00:00.000Z'),
                totalCount: 2,
                aggregateValue: 310_000,
                seriesValues: { Cycling: 310_000 },
                seriesCounts: { Cycling: 2 },
              },
            ],
          },
        },
        {
          metricKey: 'duration',
          matchedEventsCount: 2,
          matchedActivityTypeCounts: [
            {
              activityType: ActivityTypes.Cycling,
              eventCount: 2,
            },
          ],
          aggregation: {
            dataType: 'Duration',
            valueType: ChartDataValueTypes.Total,
            categoryType: ChartDataCategoryTypes.DateType,
            resolvedTimeInterval: TimeIntervals.Yearly,
            buckets: [
              {
                bucketKey: '2026',
                time: Date.parse('2026-01-01T00:00:00.000Z'),
                totalCount: 2,
                aggregateValue: 42_000,
                seriesValues: { Cycling: 42_000 },
                seriesCounts: { Cycling: 2 },
              },
            ],
          },
        },
        {
          metricKey: 'ascent',
          matchedEventsCount: 0,
          matchedActivityTypeCounts: [],
          aggregation: {
            dataType: 'Ascent',
            valueType: ChartDataValueTypes.Total,
            categoryType: ChartDataCategoryTypes.DateType,
            resolvedTimeInterval: TimeIntervals.Yearly,
            buckets: [],
          },
        },
      ],
    });

    const result = await aiInsights({
      prompt: 'Give me a yearly digest for cycling.',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.summarizeAiInsightResult).toHaveBeenCalledWith(expect.objectContaining({
      status: 'ok',
      query: yearlyDigestMultiMetricQuery,
      digest: expect.objectContaining({
        granularity: 'yearly',
        periodCount: 3,
        nonEmptyPeriodCount: 2,
      }),
    }));
    expect(result).toMatchObject({
      status: 'ok',
      resultKind: 'multi_metric_aggregate',
      query: yearlyDigestMultiMetricQuery,
      digest: {
        granularity: 'yearly',
        periodCount: 3,
        nonEmptyPeriodCount: 2,
        periods: [
          {
            time: Date.parse('2024-01-01T00:00:00.000Z'),
            hasData: false,
          },
          {
            time: Date.parse('2025-01-01T00:00:00.000Z'),
            hasData: true,
          },
          {
            time: Date.parse('2026-01-01T00:00:00.000Z'),
            hasData: true,
          },
        ],
      },
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
    expect(hoisted.reserveAiInsightsQuotaForRequest).toHaveBeenCalledWith('user-1');
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
      statementChips: expect.any(Array),
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
    expect(result).toMatchObject({
      statementChips: expect.arrayContaining([
        expect.objectContaining({
          statementId: 'aggregate:narrative',
          chipType: 'confidence',
        }),
      ]),
    });
    expect(hoisted.persistLatestAiInsightsSnapshot).toHaveBeenCalledWith(
      'user-1',
      'show distance',
      result,
    );
  });

  it('includes deterministic period deltas in compare-mode aggregate responses', async () => {
    const compareQuery = {
      ...normalizedQuery,
      periodMode: 'compare' as const,
      requestedTimeInterval: TimeIntervals.Yearly,
    };
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      metricKey: 'distance',
      query: compareQuery,
    });
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      resultKind: 'aggregate',
      matchedEventsCount: 4,
      matchedActivityTypeCounts: [
        {
          activityType: ActivityTypes.Cycling,
          eventCount: 4,
        },
      ],
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        resolvedTimeInterval: TimeIntervals.Yearly,
        buckets: [
          {
            bucketKey: '2025',
            time: Date.parse('2025-01-01T00:00:00.000Z'),
            totalCount: 2,
            aggregateValue: 250,
            seriesValues: { [ActivityTypes.Cycling]: 250 },
            seriesCounts: { [ActivityTypes.Cycling]: 2 },
          },
          {
            bucketKey: '2026',
            time: Date.parse('2026-01-01T00:00:00.000Z'),
            totalCount: 2,
            aggregateValue: 300,
            seriesValues: { [ActivityTypes.Cycling]: 300 },
            seriesCounts: { [ActivityTypes.Cycling]: 2 },
          },
        ],
      },
    });
    hoisted.summarizeAiInsightResult.mockResolvedValueOnce({
      narrative: 'Narrative',
      source: 'genkit',
      deterministicCompareSummary: 'From 2025 to 2026, distance increased by 50 km.',
    });

    const result = await aiInsights({
      prompt: 'compare my total distance this year vs last year',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.summarizeAiInsightResult).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.objectContaining({
        periodDeltas: [
          expect.objectContaining({
            direction: 'increase',
            deltaAggregateValue: 50,
            contributors: [
              expect.objectContaining({
                seriesKey: ActivityTypes.Cycling,
                deltaAggregateValue: 50,
              }),
            ],
          }),
        ],
      }),
    }));
    expect(result).toMatchObject({
      status: 'ok',
      resultKind: 'aggregate',
      deterministicCompareSummary: 'From 2025 to 2026, distance increased by 50 km.',
      summary: {
        periodDeltas: [
          expect.objectContaining({
            direction: 'increase',
            deltaAggregateValue: 50,
          }),
        ],
      },
    });
  });

  it('logs prompt metadata without storing raw prompt text', async () => {
    const piiPrompt = 'what was my pace when I ran the day I had my knee surgery in ioannina';

    await aiInsights({
      prompt: piiPrompt,
      clientTimezone: 'UTC',
    } as any);

    const queryNormalizationLogCall = hoisted.loggerInfo.mock.calls.find(
      (call) => call[0] === '[aiInsights] Query normalization debug',
    );
    expect(queryNormalizationLogCall).toBeDefined();
    const queryNormalizationPayload = queryNormalizationLogCall?.[1] as Record<string, unknown>;

    expect(queryNormalizationPayload.prompt).toBeUndefined();
    expect(queryNormalizationPayload.effectivePrompt).toBeUndefined();
    expect(queryNormalizationPayload.promptLength).toBe(piiPrompt.length);
    expect(queryNormalizationPayload.promptPreview).toBe(piiPrompt.slice(0, 60));
    expect(queryNormalizationPayload.effectivePromptLength).toBe(piiPrompt.length);
    expect(queryNormalizationPayload.effectivePromptPreview).toBe(piiPrompt.slice(0, 60));
  });

  it('returns aggregate min/max responses with supplemental event ranking ids', async () => {
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      metricKey: 'distance',
      query: {
        ...normalizedQuery,
        valueType: ChartDataValueTypes.Maximum,
        categoryType: ChartDataCategoryTypes.ActivityType,
      },
    });
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      resultKind: 'aggregate',
      matchedEventsCount: 3,
      matchedActivityTypeCounts: [
        {
          activityType: ActivityTypes.Cycling,
          eventCount: 2,
        },
        {
          activityType: ActivityTypes.Running,
          eventCount: 1,
        },
      ],
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Maximum,
        categoryType: ChartDataCategoryTypes.ActivityType,
        resolvedTimeInterval: TimeIntervals.Auto,
        buckets: [
          {
            bucketKey: ActivityTypes.Cycling,
            aggregateValue: 123,
            totalCount: 2,
            seriesValues: {},
            seriesCounts: {},
          },
        ],
      },
      eventRanking: buildAggregateEventRanking(),
    });

    const result = await aiInsights({
      prompt: 'show my longest distances by sport',
      clientTimezone: 'UTC',
    } as any);

    expect(result).toMatchObject({
      status: 'ok',
      resultKind: 'aggregate',
      eventRanking: {
        primaryEventId: 'event-3',
        topEventIds: ['event-3', 'event-2', 'event-1'],
        matchedEventCount: 3,
      },
    });
  });

  it('does not include aggregate event ranking for non min/max aggregate responses', async () => {
    const result = await aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any);

    expect(result).toEqual(expect.objectContaining({
      status: 'ok',
      resultKind: 'aggregate',
    }));
    expect((result as { eventRanking?: unknown }).eventRanking).toBeUndefined();
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
      statementChips: expect.any(Array),
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
    expect(result).toMatchObject({
      statementChips: expect.arrayContaining([
        expect.objectContaining({
          statementId: 'event_lookup:narrative',
          chipType: 'confidence',
        }),
        expect.objectContaining({
          statementId: 'event_lookup:narrative',
          chipType: 'evidence',
        }),
      ]),
    });
  });

  it('omits optional undefined fields from callable responses before returning them', async () => {
    const queryWithUndefinedOptionals = {
      ...eventLookupQuery,
      requestedTimeInterval: undefined,
      requestedDateRanges: undefined,
      periodMode: undefined,
    };

    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      metricKey: 'distance',
      query: queryWithUndefinedOptionals,
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
        ],
      },
    });

    const result = await aiInsights({
      prompt: 'I want to know when I had my longest distance in cycling',
      clientTimezone: 'UTC',
    } as any) as Record<string, unknown>;

    const resultQuery = (result.query ?? {}) as Record<string, unknown>;
    expect('requestedTimeInterval' in resultQuery).toBe(false);
    expect('requestedDateRanges' in resultQuery).toBe(false);
    expect('periodMode' in resultQuery).toBe(false);

    const resultPresentation = (result.presentation ?? {}) as Record<string, unknown>;
    expect('warnings' in resultPresentation).toBe(false);

    const persistedResponse = hoisted.persistLatestAiInsightsSnapshot.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(persistedResponse).toBeDefined();
    const persistedQuery = (persistedResponse.query ?? {}) as Record<string, unknown>;
    expect('requestedTimeInterval' in persistedQuery).toBe(false);
    expect('requestedDateRanges' in persistedQuery).toBe(false);
    expect('periodMode' in persistedQuery).toBe(false);
    const persistedPresentation = (persistedResponse.presentation ?? {}) as Record<string, unknown>;
    expect('warnings' in persistedPresentation).toBe(false);
  });

  it('returns a latest_event response with one event payload for latest prompts', async () => {
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      query: latestEventQuery,
    });
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      resultKind: 'latest_event',
      matchedEventsCount: 4,
      matchedActivityTypeCounts: [
        {
          activityType: ActivityTypes.Cycling,
          eventCount: 4,
        },
      ],
      latestEvent: {
        eventId: 'event-9',
        startDate: '2026-03-18T08:00:00.000Z',
      },
    });

    const result = await aiInsights({
      prompt: 'When was my last ride?',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.summarizeAiInsightResult).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'ok',
      resultKind: 'latest_event',
      narrative: 'Your latest cycling event was on Mar 18, 2026. I matched 4 events.',
      quota: quotaStatus,
      statementChips: expect.any(Array),
      query: latestEventQuery,
      latestEvent: {
        eventId: 'event-9',
        startDate: '2026-03-18T08:00:00.000Z',
        matchedEventCount: 4,
      },
      presentation: expect.objectContaining({
        title: 'Latest event for Cycling',
        chartType: ChartTypes.LinesVertical,
      }),
    });
  });

  it('returns empty for latest_event prompts when no event matches', async () => {
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      query: latestEventQuery,
    });
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      resultKind: 'latest_event',
      matchedEventsCount: 0,
      matchedActivityTypeCounts: [],
      latestEvent: {
        eventId: null,
        startDate: null,
      },
    });

    const result = await aiInsights({
      prompt: 'When was my last ride?',
      clientTimezone: 'UTC',
    } as any);

    expect(result).toEqual(expect.objectContaining({
      status: 'empty',
      query: latestEventQuery,
      narrative: 'I found no matching cycling events in this range.',
      presentation: expect.objectContaining({
        emptyState: expect.any(String),
      }),
    }));
  });

  it('returns a power_curve response with deterministic fallback narrative and warnings', async () => {
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      query: powerCurveQuery,
    });
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      resultKind: 'power_curve',
      matchedEventsCount: 3,
      matchedActivityTypeCounts: [
        {
          activityType: ActivityTypes.Cycling,
          eventCount: 3,
        },
      ],
      powerCurve: {
        mode: 'best',
        resolvedTimeInterval: TimeIntervals.Auto,
        matchedEventCount: 3,
        requestedSeriesCount: 1,
        returnedSeriesCount: 1,
        safetyGuardApplied: false,
        safetyGuardMaxSeries: null,
        trimmedSeriesCount: 0,
        series: [
          {
            seriesKey: 'best',
            label: 'Best power curve',
            matchedEventCount: 3,
            bucketStartDate: null,
            bucketEndDate: null,
            points: [
              { duration: 5, power: 640, wattsPerKg: 8.9 },
              { duration: 60, power: 420, wattsPerKg: 5.7 },
            ],
          },
        ],
      },
    });

    const result = await aiInsights({
      prompt: 'What is my best power curve?',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.summarizeAiInsightResult).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'ok',
      resultKind: 'power_curve',
      narrative: 'I built your best power curve for cycling as the max-power envelope across 3 matching events.',
      quota: quotaStatus,
      statementChips: expect.any(Array),
      query: powerCurveQuery,
      powerCurve: {
        mode: 'best',
        resolvedTimeInterval: TimeIntervals.Auto,
        matchedEventCount: 3,
        requestedSeriesCount: 1,
        returnedSeriesCount: 1,
        safetyGuardApplied: false,
        safetyGuardMaxSeries: null,
        trimmedSeriesCount: 0,
        series: [
          {
            seriesKey: 'best',
            label: 'Best power curve',
            matchedEventCount: 3,
            bucketStartDate: null,
            bucketEndDate: null,
            points: [
              { duration: 5, power: 640, wattsPerKg: 8.9 },
              { duration: 60, power: 420, wattsPerKg: 5.7 },
            ],
          },
        ],
      },
      presentation: expect.objectContaining({
        title: 'Best power curve for Cycling',
        chartType: ChartTypes.LinesVertical,
        warnings: [
          'No activity filter was specified, so this power-curve result defaults to Cycling.',
          'Best power curve means the max-power envelope across matching events, not one single event curve.',
        ],
      }),
    });
  });

  it('returns empty for power_curve prompts when no curve points match', async () => {
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      query: {
        ...powerCurveQuery,
        mode: 'compare_over_time',
      },
    });
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      resultKind: 'power_curve',
      matchedEventsCount: 0,
      matchedActivityTypeCounts: [],
      powerCurve: {
        mode: 'compare_over_time',
        resolvedTimeInterval: TimeIntervals.Monthly,
        matchedEventCount: 0,
        requestedSeriesCount: 0,
        returnedSeriesCount: 0,
        safetyGuardApplied: false,
        safetyGuardMaxSeries: null,
        trimmedSeriesCount: 0,
        series: [],
      },
    });

    const result = await aiInsights({
      prompt: 'Compare my power curve over the last 3 months',
      clientTimezone: 'UTC',
    } as any);

    expect(result).toEqual(expect.objectContaining({
      status: 'empty',
      query: {
        ...powerCurveQuery,
        mode: 'compare_over_time',
      },
      narrative: 'I found no power-curve data for cycling in this range.',
      presentation: expect.objectContaining({
        emptyState: expect.any(String),
      }),
    }));
  });

  it('returns an event lookup response for longest-jump prompts', async () => {
    hoisted.getInsightMetricDefinition.mockReturnValue({
      key: 'jump_distance',
      label: 'jump distance',
    });
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      metricKey: 'jump_distance',
      query: jumpEventLookupQuery,
    });
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      resultKind: 'event_lookup',
      matchedEventsCount: 2,
      matchedActivityTypeCounts: [
        {
          activityType: ActivityTypes.Snowboarding,
          eventCount: 2,
        },
      ],
      eventLookup: {
        primaryEventId: 'jump-event-2',
        topEventIds: ['jump-event-2', 'jump-event-1'],
        rankedEvents: [
          {
            eventId: 'jump-event-2',
            startDate: '2026-03-12T10:00:00.000Z',
            aggregateValue: 9.4,
          },
          {
            eventId: 'jump-event-1',
            startDate: '2026-02-18T10:00:00.000Z',
            aggregateValue: 8.9,
          },
        ],
      },
    });

    const result = await aiInsights({
      prompt: 'Find my longest jump.',
      clientTimezone: 'UTC',
    } as any);

    expect(result).toEqual({
      status: 'ok',
      resultKind: 'event_lookup',
      narrative: 'Narrative',
      quota: quotaStatus,
      statementChips: expect.any(Array),
      query: jumpEventLookupQuery,
      eventLookup: {
        primaryEventId: 'jump-event-2',
        topEventIds: ['jump-event-2', 'jump-event-1'],
        matchedEventCount: 2,
      },
      presentation: expect.objectContaining({
        title: 'Top jump distance events for Cycling',
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
        periodDeltas: null,
        anomalyCallouts: null,
      },
      presentation: expect.objectContaining({
        emptyState: 'No matching events were found for this insight in the requested range.',
      }),
    });
  });

  it('returns yearly digest payloads on empty multi-metric digest responses', async () => {
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      query: yearlyDigestMultiMetricQuery,
    });
    hoisted.getInsightMetricDefinition.mockImplementation((metricKey: string) => {
      if (metricKey === 'distance') {
        return { key: 'distance', label: 'distance' };
      }
      if (metricKey === 'duration') {
        return { key: 'duration', label: 'duration' };
      }
      if (metricKey === 'ascent') {
        return { key: 'ascent', label: 'ascent' };
      }
      return null;
    });
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      resultKind: 'multi_metric_aggregate',
      matchedEventsCount: 0,
      matchedActivityTypeCounts: [],
      metricResults: [
        {
          metricKey: 'distance',
          matchedEventsCount: 0,
          matchedActivityTypeCounts: [],
          aggregation: {
            dataType: 'Distance',
            valueType: ChartDataValueTypes.Total,
            categoryType: ChartDataCategoryTypes.DateType,
            resolvedTimeInterval: TimeIntervals.Yearly,
            buckets: [],
          },
        },
        {
          metricKey: 'duration',
          matchedEventsCount: 0,
          matchedActivityTypeCounts: [],
          aggregation: {
            dataType: 'Duration',
            valueType: ChartDataValueTypes.Total,
            categoryType: ChartDataCategoryTypes.DateType,
            resolvedTimeInterval: TimeIntervals.Yearly,
            buckets: [],
          },
        },
        {
          metricKey: 'ascent',
          matchedEventsCount: 0,
          matchedActivityTypeCounts: [],
          aggregation: {
            dataType: 'Ascent',
            valueType: ChartDataValueTypes.Total,
            categoryType: ChartDataCategoryTypes.DateType,
            resolvedTimeInterval: TimeIntervals.Yearly,
            buckets: [],
          },
        },
      ],
    });

    const result = await aiInsights({
      prompt: 'Give me a yearly digest for cycling.',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.summarizeAiInsightResult).toHaveBeenCalledWith(expect.objectContaining({
      status: 'empty',
      query: yearlyDigestMultiMetricQuery,
      digest: expect.objectContaining({
        granularity: 'yearly',
        periodCount: 3,
        nonEmptyPeriodCount: 0,
      }),
    }));
    expect(result).toMatchObject({
      status: 'empty',
      query: yearlyDigestMultiMetricQuery,
      digest: {
        granularity: 'yearly',
        periodCount: 3,
        nonEmptyPeriodCount: 0,
      },
    });
  });

  it('returns an explicit empty digest payload for all-time yearly digest requests without buckets', async () => {
    const allTimeYearlyDigestQuery = {
      ...yearlyDigestMultiMetricQuery,
      dateRange: {
        kind: 'all_time' as const,
        timezone: 'UTC',
        source: 'prompt' as const,
      },
    };
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'ok',
      query: allTimeYearlyDigestQuery,
    });
    hoisted.getInsightMetricDefinition.mockImplementation((metricKey: string) => {
      if (metricKey === 'distance') {
        return { key: 'distance', label: 'distance' };
      }
      if (metricKey === 'duration') {
        return { key: 'duration', label: 'duration' };
      }
      if (metricKey === 'ascent') {
        return { key: 'ascent', label: 'ascent' };
      }
      return null;
    });
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      resultKind: 'multi_metric_aggregate',
      matchedEventsCount: 0,
      matchedActivityTypeCounts: [],
      metricResults: [
        {
          metricKey: 'distance',
          matchedEventsCount: 0,
          matchedActivityTypeCounts: [],
          aggregation: {
            dataType: 'Distance',
            valueType: ChartDataValueTypes.Total,
            categoryType: ChartDataCategoryTypes.DateType,
            resolvedTimeInterval: TimeIntervals.Yearly,
            buckets: [],
          },
        },
        {
          metricKey: 'duration',
          matchedEventsCount: 0,
          matchedActivityTypeCounts: [],
          aggregation: {
            dataType: 'Duration',
            valueType: ChartDataValueTypes.Total,
            categoryType: ChartDataCategoryTypes.DateType,
            resolvedTimeInterval: TimeIntervals.Yearly,
            buckets: [],
          },
        },
        {
          metricKey: 'ascent',
          matchedEventsCount: 0,
          matchedActivityTypeCounts: [],
          aggregation: {
            dataType: 'Ascent',
            valueType: ChartDataValueTypes.Total,
            categoryType: ChartDataCategoryTypes.DateType,
            resolvedTimeInterval: TimeIntervals.Yearly,
            buckets: [],
          },
        },
      ],
    });

    const result = await aiInsights({
      prompt: 'Give me a yearly digest for all activities all time.',
      clientTimezone: 'UTC',
    } as any);

    expect(result).toMatchObject({
      status: 'empty',
      query: allTimeYearlyDigestQuery,
      digest: {
        granularity: 'yearly',
        periodCount: 0,
        nonEmptyPeriodCount: 0,
        periods: [],
      },
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

  it('uses stat-matched event count when building aggregate summaries', async () => {
    hoisted.executeAiInsightsQuery.mockResolvedValue({
      resultKind: 'aggregate',
      matchedEventsCount: 5,
      matchedEventsWithRequestedStat: [
        {
          getID: () => 'event-with-stat-1',
        },
      ],
      matchedActivityTypeCounts: [
        {
          activityType: ActivityTypes.Cycling,
          eventCount: 5,
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
            totalCount: 5,
            aggregateValue: 123,
            seriesValues: { Cycling: 123 },
            seriesCounts: { Cycling: 5 },
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
      summary: expect.objectContaining({
        matchedEventCount: 1,
      }),
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
    expect(hoisted.reserveAiInsightsQuotaForRequest).toHaveBeenCalledTimes(1);
    expect(hoisted.finalizeAiInsightsQuotaReservation).not.toHaveBeenCalled();
    expect(hoisted.releaseAiInsightsQuotaReservation).toHaveBeenCalledTimes(1);
    expect(hoisted.sanitizePromptToEnglish).not.toHaveBeenCalled();
    expect(hoisted.recordSuccessfulAiInsightRepair).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'unsupported',
      narrative: 'I can only answer questions from persisted event-level stats right now, so streams, splits, laps, routes, and original-file reprocessing are out of scope.',
      quota: quotaStatus,
      reasonCode: 'unsupported_capability',
      suggestedPrompts: ['show my distance'],
    });
    expect(hoisted.persistLatestAiInsightsSnapshot).toHaveBeenCalledWith(
      'user-1',
      'show cadence per kilometer splits',
      result,
    );
  });

  it('sanitizes non-english prompts before deterministic normalization and still consumes one credit', async () => {
    hoisted.detectPromptLanguageDeterministic.mockReturnValue('non_english');
    hoisted.sanitizePromptToEnglish.mockResolvedValue({
      status: 'english',
      prompt: 'show my total distance over time for cycling this year',
    });

    const result = await aiInsights({
      prompt: 'δείξε μου τη συνολική απόσταση ποδηλασίας φέτος',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.sanitizePromptToEnglish).toHaveBeenCalledWith('δείξε μου τη συνολική απόσταση ποδηλασίας φέτος');
    expect(hoisted.normalizeInsightQuery).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'show my total distance over time for cycling this year',
    }));
    expect(hoisted.executeAiInsightsQuery).toHaveBeenCalledWith(
      'user-1',
      normalizedQuery,
      'show my total distance over time for cycling this year',
    );
    expect(hoisted.finalizeAiInsightsQuotaReservation).toHaveBeenCalledTimes(1);
    expect(hoisted.releaseAiInsightsQuotaReservation).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'ok',
      quota: quotaStatus,
    });
  });

  it('returns unsupported and consumes one credit when non-english sanitization cannot recover intent', async () => {
    hoisted.detectPromptLanguageDeterministic.mockReturnValue('non_english');
    hoisted.sanitizePromptToEnglish.mockResolvedValue({
      status: 'unsupported',
      reasonCode: 'invalid_prompt',
      suggestedPrompts: ['show distance'],
    });

    const result = await aiInsights({
      prompt: 'просто что-то невалидное',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.finalizeAiInsightsQuotaReservation).toHaveBeenCalledTimes(1);
    expect(hoisted.releaseAiInsightsQuotaReservation).not.toHaveBeenCalled();
    expect(hoisted.normalizeInsightQuery).not.toHaveBeenCalled();
    expect(hoisted.executeAiInsightsQuery).not.toHaveBeenCalled();
    expect(hoisted.summarizeAiInsightResult).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'unsupported',
      narrative: 'I could not turn that request into a valid insight query.',
      quota: quotaStatus,
      reasonCode: 'invalid_prompt',
      suggestedPrompts: ['show distance'],
    });
  });

  it('consumes one credit when non-english sanitization AI attempt throws', async () => {
    hoisted.detectPromptLanguageDeterministic.mockReturnValue('uncertain');
    hoisted.sanitizePromptToEnglish.mockRejectedValue(new Error('sanitize failed'));

    await expect(aiInsights({
      prompt: 'zeige mir distanz',
      clientTimezone: 'UTC',
    } as any)).rejects.toMatchObject({
      code: 'internal',
    });

    expect(hoisted.finalizeAiInsightsQuotaReservation).toHaveBeenCalledTimes(1);
    expect(hoisted.releaseAiInsightsQuotaReservation).not.toHaveBeenCalled();
    expect(hoisted.normalizeInsightQuery).not.toHaveBeenCalled();
  });

  it('consumes prompt quota once when AI repair succeeds before narrative generation', async () => {
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'unsupported',
      reasonCode: 'unsupported_metric',
      suggestedPrompts: ['show my distance'],
    });
    hoisted.repairUnsupportedInsightQuery.mockResolvedValue({
      source: 'genkit',
      result: {
        status: 'ok',
        metricKey: 'distance',
        query: normalizedQuery,
      },
    });

    const result = await aiInsights({
      prompt: 'show my max cardio in cycling',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.reserveAiInsightsQuotaForRequest).toHaveBeenCalledTimes(1);
    expect(hoisted.finalizeAiInsightsQuotaReservation).toHaveBeenCalledTimes(1);
    expect(hoisted.releaseAiInsightsQuotaReservation).not.toHaveBeenCalled();
    expect(hoisted.executeAiInsightsQuery).toHaveBeenCalledWith('user-1', normalizedQuery, 'show my max cardio in cycling');
    expect(hoisted.summarizeAiInsightResult).toHaveBeenCalledTimes(1);
    expect(hoisted.buildAiInsightsPromptRepairIdentity).toHaveBeenCalledWith('show my max cardio in cycling', normalizedQuery);
    expect(hoisted.recordSuccessfulAiInsightRepair).toHaveBeenCalledWith(expect.objectContaining({
      rawPrompt: 'show my max cardio in cycling',
      repairInputPrompt: 'show my max cardio in cycling',
      normalizedQuery,
      deterministicFailureReasonCode: 'unsupported_metric',
      metricKey: 'distance',
    }));
    expect(result).toMatchObject({
      status: 'ok',
      quota: quotaStatus,
    });
  });

  it('does not record repaired prompts when AI repair source is none', async () => {
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'unsupported',
      reasonCode: 'unsupported_metric',
      suggestedPrompts: ['show my distance'],
    });
    hoisted.repairUnsupportedInsightQuery.mockResolvedValue({
      source: 'none',
      result: {
        status: 'ok',
        metricKey: 'distance',
        query: normalizedQuery,
      },
    });

    await aiInsights({
      prompt: 'show my max cardio in cycling',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.buildAiInsightsPromptRepairIdentity).not.toHaveBeenCalled();
    expect(hoisted.recordSuccessfulAiInsightRepair).not.toHaveBeenCalled();
  });

  it('does not record repaired prompts when AI repair remains unsupported', async () => {
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'unsupported',
      reasonCode: 'unsupported_metric',
      suggestedPrompts: ['show my distance'],
    });
    hoisted.repairUnsupportedInsightQuery.mockResolvedValue({
      source: 'genkit',
      result: {
        status: 'unsupported',
        reasonCode: 'unsupported_metric',
        suggestedPrompts: ['show my distance'],
      },
    });

    await aiInsights({
      prompt: 'show my max cardio in cycling',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.buildAiInsightsPromptRepairIdentity).not.toHaveBeenCalled();
    expect(hoisted.recordSuccessfulAiInsightRepair).not.toHaveBeenCalled();
  });

  it('continues successfully when backlog recording fails after AI repair success', async () => {
    hoisted.normalizeInsightQuery.mockResolvedValue({
      status: 'unsupported',
      reasonCode: 'unsupported_metric',
      suggestedPrompts: ['show my distance'],
    });
    hoisted.repairUnsupportedInsightQuery.mockResolvedValue({
      source: 'genkit',
      result: {
        status: 'ok',
        metricKey: 'distance',
        query: normalizedQuery,
      },
    });
    hoisted.buildAiInsightsPromptRepairIdentity.mockReturnValue({
      canonicalPrompt: 'show my max cardio in cycling',
      normalizedQuerySignature: '{"query":"signature"}',
      intentDocID: 'repair-intent-123',
    });
    hoisted.recordSuccessfulAiInsightRepair.mockRejectedValue(new Error('write failed'));

    const result = await aiInsights({
      prompt: 'show my max cardio in cycling',
      clientTimezone: 'UTC',
    } as any);

    expect(result).toMatchObject({
      status: 'ok',
      quota: quotaStatus,
    });
    expect(hoisted.summarizeAiInsightResult).toHaveBeenCalledTimes(1);
    expect(hoisted.loggerWarn).toHaveBeenCalledWith(
      '[aiInsights] Failed to record successful AI prompt repair backlog entry.',
      expect.objectContaining({
        intentDocID: 'repair-intent-123',
        deterministicFailureReasonCode: 'unsupported_metric',
      }),
    );
  });

  it('consumes prompt quota when summarize returns fallback narrative', async () => {
    hoisted.summarizeAiInsightResult.mockResolvedValue({
      narrative: 'Fallback narrative',
      source: 'fallback',
    });

    const result = await aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.finalizeAiInsightsQuotaReservation).toHaveBeenCalledWith(expect.objectContaining({
      reservationID: 'reservation-1',
    }));
    expect(hoisted.releaseAiInsightsQuotaReservation).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'ok',
      narrative: 'Fallback narrative',
      quota: quotaStatus,
    });
  });

  it('keeps consumed quota when summarize-result throws after AI attempt', async () => {
    hoisted.summarizeAiInsightResult.mockRejectedValue(new Error('summarize failed'));

    await expect(aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any)).rejects.toMatchObject({
      code: 'internal',
    });

    expect(hoisted.finalizeAiInsightsQuotaReservation).toHaveBeenCalledWith(expect.objectContaining({
      reservationID: 'reservation-1',
    }));
    expect(hoisted.releaseAiInsightsQuotaReservation).not.toHaveBeenCalled();
  });

  it('logs serialized error details when ai insight generation fails', async () => {
    hoisted.summarizeAiInsightResult.mockRejectedValue(new Error('summarize failed'));
    const piiPrompt = 'what was my pace when I ran the day I had my knee surgery';

    await expect(aiInsights({
      prompt: piiPrompt,
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

    const errorPayload = hoisted.loggerError.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(errorPayload.prompt).toBeUndefined();
    expect(errorPayload.promptLength).toBe(piiPrompt.length);
    expect(errorPayload.promptPreview).toBe(piiPrompt.slice(0, 60));
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

  it('uses callable auth token claims for aiInsights quota checks in emulator mode', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';
    hoisted.currentContext.auth = {
      uid: 'user-1',
      token: {
        stripeRole: 'basic',
        gracePeriodUntil: 1775237359811,
      },
    };

    await aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.getAiInsightsQuotaStatus).toHaveBeenCalledWith('user-1', {
      role: 'basic',
      gracePeriodUntil: 1775237359811,
    });
    expect(hoisted.reserveAiInsightsQuotaForRequest).toHaveBeenCalledWith('user-1', {
      role: 'basic',
      gracePeriodUntil: 1775237359811,
    });
  });

  it('falls back to Firestore quota role resolution in emulator mode when stripeRole claim is missing', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';
    hoisted.currentContext.auth = {
      uid: 'user-1',
      token: {
        gracePeriodUntil: 1775237359811,
      },
    };

    await aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.getAiInsightsQuotaStatus).toHaveBeenCalledWith('user-1');
    expect(hoisted.reserveAiInsightsQuotaForRequest).toHaveBeenCalledWith('user-1');
  });

  it('does not use callable auth token claims outside explicit functions emulator mode', async () => {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    delete process.env.FUNCTIONS_EMULATOR;
    hoisted.currentContext.auth = {
      uid: 'user-1',
      token: {
        stripeRole: 'basic',
        gracePeriodUntil: 1775237359811,
      },
    };

    await aiInsights({
      prompt: 'show distance',
      clientTimezone: 'UTC',
    } as any);

    expect(hoisted.getAiInsightsQuotaStatus).toHaveBeenCalledWith('user-1');
    expect(hoisted.reserveAiInsightsQuotaForRequest).toHaveBeenCalledWith('user-1');
  });

  it('uses callable auth token claims for quota status in emulator mode', async () => {
    const originalFunctionsEmulator = process.env.FUNCTIONS_EMULATOR;
    process.env.FUNCTIONS_EMULATOR = 'true';

    try {
      await getAiInsightsQuotaStatus({
        auth: {
          uid: 'user-1',
          token: {
            stripeRole: 'basic',
            gracePeriodUntil: 1775237359811,
          },
        },
        app: { appId: 'app-1' },
        data: undefined,
      } as any);

      expect(hoisted.getAiInsightsQuotaStatus).toHaveBeenCalledWith('user-1', {
        role: 'basic',
        gracePeriodUntil: 1775237359811,
      });
    } finally {
      if (originalFunctionsEmulator === undefined) {
        delete process.env.FUNCTIONS_EMULATOR;
      } else {
        process.env.FUNCTIONS_EMULATOR = originalFunctionsEmulator;
      }
    }
  });
});
