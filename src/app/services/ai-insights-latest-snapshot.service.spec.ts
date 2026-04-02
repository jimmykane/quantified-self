import { TestBed } from '@angular/core/testing';
import { Firestore, deleteDoc, doc, getDoc } from 'app/firebase/firestore';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import type {
  AiInsightsLatestSnapshot,
  AiInsightsEventLookupOkResponse,
  AiInsightsLatestEventOkResponse,
  AiInsightsMultiMetricAggregateOkResponse,
  AiInsightsOkResponse,
  AiInsightsQuotaStatus,
} from '@shared/ai-insights.types';
import { LoggerService } from './logger.service';
import {
  AiInsightsLatestSnapshotService,
} from './ai-insights-latest-snapshot.service';

vi.mock('app/firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/firebase/firestore')>();
  class MockFirestore {}

    return {
        ...actual,
        Firestore: MockFirestore,
        doc: vi.fn((...segments: unknown[]) => ({ path: segments.slice(1).join('/') })),
        getDoc: vi.fn(),
        deleteDoc: vi.fn().mockResolvedValue(undefined),
    };
});

function buildOkResponse(): AiInsightsOkResponse {
  return {
    status: 'ok',
    resultKind: 'aggregate',
    narrative: 'Insight narrative',
    query: {
      resultKind: 'aggregate',
      dataType: 'DataDistance',
      valueType: ChartDataValueTypes.Total,
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Monthly,
      activityTypeGroups: [],
      activityTypes: [ActivityTypes.Cycling],
      dateRange: {
        kind: 'bounded',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-03-18T23:59:59.999Z',
        timezone: 'Europe/Helsinki',
        source: 'prompt',
      },
      chartType: ChartTypes.LinesVertical,
    },
    aggregation: {
      dataType: 'DataDistance',
      valueType: ChartDataValueTypes.Total,
      categoryType: ChartDataCategoryTypes.DateType,
      resolvedTimeInterval: TimeIntervals.Monthly,
      buckets: [
        {
          bucketKey: '2026-03',
          time: Date.UTC(2026, 2, 1),
          totalCount: 3,
          aggregateValue: 120.4,
          seriesValues: { Cycling: 120.4 },
          seriesCounts: { Cycling: 3 },
        },
      ],
    },
    summary: {
      matchedEventCount: 3,
      overallAggregateValue: 120.4,
      peakBucket: {
        bucketKey: '2026-03',
        time: Date.UTC(2026, 2, 1),
        aggregateValue: 120.4,
        totalCount: 3,
      },
      lowestBucket: {
        bucketKey: '2026-03',
        time: Date.UTC(2026, 2, 1),
        aggregateValue: 120.4,
        totalCount: 3,
      },
      latestBucket: {
        bucketKey: '2026-03',
        time: Date.UTC(2026, 2, 1),
        aggregateValue: 120.4,
        totalCount: 3,
      },
      activityMix: {
        topActivityTypes: [{ activityType: ActivityTypes.Cycling, eventCount: 3 }],
        remainingActivityTypeCount: 0,
      },
      bucketCoverage: {
        nonEmptyBucketCount: 1,
        totalBucketCount: 3,
      },
      trend: {
        previousBucket: {
          bucketKey: '2026-02',
          time: Date.UTC(2026, 1, 1),
          aggregateValue: 118.2,
          totalCount: 2,
        },
        deltaAggregateValue: 2.2,
      },
    },
    presentation: {
      title: 'Total distance over time for Cycling',
      chartType: ChartTypes.LinesVertical,
    },
  };
}

function buildAggregateRankingResponse(): AiInsightsOkResponse {
  return {
    ...buildOkResponse(),
    query: {
      ...buildOkResponse().query,
      valueType: ChartDataValueTypes.Maximum,
      categoryType: ChartDataCategoryTypes.ActivityType,
    },
    aggregation: {
      ...buildOkResponse().aggregation,
      valueType: ChartDataValueTypes.Maximum,
      categoryType: ChartDataCategoryTypes.ActivityType,
    },
    eventRanking: {
      primaryEventId: 'event-3',
      topEventIds: ['event-3', 'event-2', 'event-1'],
      matchedEventCount: 3,
    },
  };
}

function buildEventLookupResponse(): AiInsightsEventLookupOkResponse {
  return {
    status: 'ok',
    resultKind: 'event_lookup',
    narrative: 'Your longest distance event was 123.4 km on Mar 10, 2026.',
    query: {
      resultKind: 'event_lookup',
      dataType: 'DataDistance',
      valueType: ChartDataValueTypes.Maximum,
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Monthly,
      activityTypeGroups: [],
      activityTypes: [ActivityTypes.Cycling],
      dateRange: {
        kind: 'bounded',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-03-18T23:59:59.999Z',
        timezone: 'Europe/Helsinki',
        source: 'default',
      },
      chartType: ChartTypes.LinesVertical,
    },
    eventLookup: {
      primaryEventId: 'event-3',
      topEventIds: ['event-3', 'event-2', 'event-1'],
      matchedEventCount: 3,
    },
    presentation: {
      title: 'Top distance events for Cycling',
      chartType: ChartTypes.LinesVertical,
    },
  };
}

function buildMultiMetricResponse(): AiInsightsMultiMetricAggregateOkResponse {
  return {
    status: 'ok',
    resultKind: 'multi_metric_aggregate',
    narrative: 'Cadence and power both trended upward over the last three months.',
    query: {
      resultKind: 'multi_metric_aggregate',
      groupingMode: 'date',
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Monthly,
      activityTypeGroups: [],
      activityTypes: [ActivityTypes.Cycling],
      dateRange: {
        kind: 'bounded',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-03-18T23:59:59.999Z',
        timezone: 'Europe/Helsinki',
        source: 'prompt',
      },
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
    },
    metricResults: [
      {
        metricKey: 'cadence',
        metricLabel: 'cadence',
        query: {
          resultKind: 'aggregate',
          dataType: 'Average Cadence',
          valueType: ChartDataValueTypes.Average,
          categoryType: ChartDataCategoryTypes.DateType,
          requestedTimeInterval: TimeIntervals.Monthly,
          activityTypeGroups: [],
          activityTypes: [ActivityTypes.Cycling],
          dateRange: {
            kind: 'bounded',
            startDate: '2026-01-01T00:00:00.000Z',
            endDate: '2026-03-18T23:59:59.999Z',
            timezone: 'Europe/Helsinki',
            source: 'prompt',
          },
          chartType: ChartTypes.LinesVertical,
        },
        aggregation: {
          dataType: 'Average Cadence',
          valueType: ChartDataValueTypes.Average,
          categoryType: ChartDataCategoryTypes.DateType,
          resolvedTimeInterval: TimeIntervals.Monthly,
          buckets: [
            {
              bucketKey: '2026-03',
              time: Date.UTC(2026, 2, 1),
              totalCount: 3,
              aggregateValue: 86,
              seriesValues: { Cycling: 86 },
              seriesCounts: { Cycling: 3 },
            },
          ],
        },
        summary: {
          matchedEventCount: 3,
          overallAggregateValue: 86,
          peakBucket: {
            bucketKey: '2026-03',
            time: Date.UTC(2026, 2, 1),
            aggregateValue: 86,
            totalCount: 3,
          },
          lowestBucket: {
            bucketKey: '2026-03',
            time: Date.UTC(2026, 2, 1),
            aggregateValue: 86,
            totalCount: 3,
          },
          latestBucket: {
            bucketKey: '2026-03',
            time: Date.UTC(2026, 2, 1),
            aggregateValue: 86,
            totalCount: 3,
          },
          activityMix: {
            topActivityTypes: [{ activityType: ActivityTypes.Cycling, eventCount: 3 }],
            remainingActivityTypeCount: 0,
          },
          bucketCoverage: {
            nonEmptyBucketCount: 1,
            totalBucketCount: 3,
          },
          trend: null,
        },
        presentation: {
          title: 'Average cadence over time for Cycling',
          chartType: ChartTypes.LinesVertical,
        },
      },
      {
        metricKey: 'power',
        metricLabel: 'power',
        query: {
          resultKind: 'aggregate',
          dataType: 'Average Power',
          valueType: ChartDataValueTypes.Average,
          categoryType: ChartDataCategoryTypes.DateType,
          requestedTimeInterval: TimeIntervals.Monthly,
          activityTypeGroups: [],
          activityTypes: [ActivityTypes.Cycling],
          dateRange: {
            kind: 'bounded',
            startDate: '2026-01-01T00:00:00.000Z',
            endDate: '2026-03-18T23:59:59.999Z',
            timezone: 'Europe/Helsinki',
            source: 'prompt',
          },
          chartType: ChartTypes.LinesVertical,
        },
        aggregation: {
          dataType: 'Average Power',
          valueType: ChartDataValueTypes.Average,
          categoryType: ChartDataCategoryTypes.DateType,
          resolvedTimeInterval: TimeIntervals.Monthly,
          buckets: [
            {
              bucketKey: '2026-03',
              time: Date.UTC(2026, 2, 1),
              totalCount: 3,
              aggregateValue: 210,
              seriesValues: { Cycling: 210 },
              seriesCounts: { Cycling: 3 },
            },
          ],
        },
        summary: {
          matchedEventCount: 3,
          overallAggregateValue: 210,
          peakBucket: {
            bucketKey: '2026-03',
            time: Date.UTC(2026, 2, 1),
            aggregateValue: 210,
            totalCount: 3,
          },
          lowestBucket: {
            bucketKey: '2026-03',
            time: Date.UTC(2026, 2, 1),
            aggregateValue: 210,
            totalCount: 3,
          },
          latestBucket: {
            bucketKey: '2026-03',
            time: Date.UTC(2026, 2, 1),
            aggregateValue: 210,
            totalCount: 3,
          },
          activityMix: {
            topActivityTypes: [{ activityType: ActivityTypes.Cycling, eventCount: 3 }],
            remainingActivityTypeCount: 0,
          },
          bucketCoverage: {
            nonEmptyBucketCount: 1,
            totalBucketCount: 3,
          },
          trend: null,
        },
        presentation: {
          title: 'Average power over time for Cycling',
          chartType: ChartTypes.LinesVertical,
        },
      },
    ],
    presentation: {
      title: 'Cadence and power over time for Cycling',
      chartType: ChartTypes.LinesVertical,
    },
  };
}

function buildLatestEventResponse(): AiInsightsLatestEventOkResponse {
  return {
    status: 'ok',
    resultKind: 'latest_event',
    narrative: 'Your latest cycling event was on Mar 18, 2026.',
    query: {
      resultKind: 'latest_event',
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Daily,
      activityTypeGroups: [],
      activityTypes: [ActivityTypes.Cycling],
      dateRange: {
        kind: 'bounded',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-03-18T23:59:59.999Z',
        timezone: 'Europe/Helsinki',
        source: 'default',
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
  };
}

function buildQuotaStatus(): AiInsightsQuotaStatus {
  return {
    role: 'pro',
    limit: 100,
    successfulRequestCount: 12,
    activeRequestCount: 0,
    remainingCount: 88,
    periodStart: '2026-03-01T00:00:00.000Z',
    periodEnd: '2026-04-01T00:00:00.000Z',
    periodKind: 'subscription',
    resetMode: 'date',
    isEligible: true,
    blockedReason: null,
  };
}

describe('AiInsightsLatestSnapshotService', () => {
  let service: AiInsightsLatestSnapshotService;
  let loggerMock: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    loggerMock = {
      warn: vi.fn(),
      error: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        AiInsightsLatestSnapshotService,
        { provide: Firestore, useValue: {} },
        { provide: LoggerService, useValue: loggerMock },
      ],
    });

    service = TestBed.inject(AiInsightsLatestSnapshotService);
  });

  it('should restore a valid latest snapshot from Firestore', async () => {
    const snapshot: AiInsightsLatestSnapshot = {
      version: 1,
      savedAt: '2026-03-18T12:00:00.000Z',
      prompt: 'Show my total distance',
      response: buildOkResponse(),
    };
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => snapshot,
    } as never);

    const restored = await service.loadLatest('user-1');

    expect(restored).toEqual(snapshot);
  });

  it('should restore snapshots that include the optional quota payload', async () => {
    const snapshot: AiInsightsLatestSnapshot = {
      version: 1,
      savedAt: '2026-03-18T12:00:00.000Z',
      prompt: 'Show my total distance',
      response: {
        ...buildOkResponse(),
        quota: buildQuotaStatus(),
      },
    };
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => snapshot,
    } as never);

    const restored = await service.loadLatest('user-1');

    expect(restored).toEqual(snapshot);
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('should clear snapshots with null presentation warnings because the contract is strict', async () => {
    const snapshotWithLegacyWarnings = {
      version: 1,
      savedAt: '2026-03-18T12:00:00.000Z',
      prompt: 'Show my total distance',
      response: {
        ...buildOkResponse(),
        presentation: {
          ...buildOkResponse().presentation,
          warnings: null,
        },
      },
    };
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => snapshotWithLegacyWarnings,
    } as never);

    const restored = await service.loadLatest('user-1');

    expect(restored).toBeNull();
    expect(deleteDoc).toHaveBeenCalledWith({ path: 'users/user-1/aiInsightsRequests/latest' });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      '[AiInsightsLatestSnapshotService] Clearing invalid latest AI insight snapshot.',
      expect.objectContaining({
        userID: 'user-1',
        reason: 'response_presentation_invalid',
      }),
    );
  });

  it('should clear snapshots with null requestedTimeInterval because the contract is strict', async () => {
    const legacyResponse = buildOkResponse();
    const snapshotWithNullRequestedInterval = {
      version: 1,
      savedAt: '2026-03-18T12:00:00.000Z',
      prompt: 'Show my total distance',
      response: {
        ...legacyResponse,
        query: {
          ...legacyResponse.query,
          requestedTimeInterval: null,
        },
      },
    };
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => snapshotWithNullRequestedInterval,
    } as never);

    const restored = await service.loadLatest('user-1');

    expect(restored).toBeNull();
    expect(deleteDoc).toHaveBeenCalledWith({ path: 'users/user-1/aiInsightsRequests/latest' });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      '[AiInsightsLatestSnapshotService] Clearing invalid latest AI insight snapshot.',
      expect.objectContaining({
        userID: 'user-1',
        reason: 'response_query_invalid',
      }),
    );
  });

  it('should clear snapshots with nullable summary fields because the contract is strict', async () => {
    const legacyResponse = buildOkResponse();
    const snapshotWithLegacySummary = {
      version: 1,
      savedAt: '2026-03-18T12:00:00.000Z',
      prompt: 'Show my total distance',
      response: {
        ...legacyResponse,
        summary: {
          ...legacyResponse.summary,
          peakBucket: {
            ...(legacyResponse.summary.peakBucket as NonNullable<typeof legacyResponse.summary.peakBucket>),
            time: null,
          },
          lowestBucket: {
            ...(legacyResponse.summary.lowestBucket as NonNullable<typeof legacyResponse.summary.lowestBucket>),
            time: null,
          },
          latestBucket: {
            ...(legacyResponse.summary.latestBucket as NonNullable<typeof legacyResponse.summary.latestBucket>),
            time: null,
          },
          activityMix: {
            ...(legacyResponse.summary.activityMix as NonNullable<typeof legacyResponse.summary.activityMix>),
            remainingActivityTypeCount: null,
          },
        },
      },
    };
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => snapshotWithLegacySummary,
    } as never);

    const restored = await service.loadLatest('user-1');

    expect(restored).toBeNull();
    expect(deleteDoc).toHaveBeenCalledWith({ path: 'users/user-1/aiInsightsRequests/latest' });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      '[AiInsightsLatestSnapshotService] Clearing invalid latest AI insight snapshot.',
      expect.objectContaining({
        userID: 'user-1',
        reason: 'response_summary_invalid',
      }),
    );
  });

  it('should clear invalid latest snapshots instead of restoring them', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({
        version: 1,
        savedAt: '2026-03-18T12:00:00.000Z',
        prompt: 'Bad snapshot',
        response: {
          status: 'ok',
        },
      }),
    } as never);

    const restored = await service.loadLatest('user-1');

    expect(restored).toBeNull();
    expect(deleteDoc).toHaveBeenCalledWith({ path: 'users/user-1/aiInsightsRequests/latest' });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      '[AiInsightsLatestSnapshotService] Clearing invalid latest AI insight snapshot.',
      expect.objectContaining({
        userID: 'user-1',
        reason: 'response_shape_invalid',
        responseKeys: ['status'],
        issuePath: 'resultKind',
      }),
    );
  });

  it('should clear snapshots when query enum variants are unknown', async () => {
    const snapshotWithUnknownChartType = {
      version: 1,
      savedAt: '2026-03-18T12:00:00.000Z',
      prompt: 'Show my total distance',
      response: {
        ...buildOkResponse(),
        query: {
          ...buildOkResponse().query,
          chartType: 9999,
        },
      },
    };
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => snapshotWithUnknownChartType,
    } as never);

    const restored = await service.loadLatest('user-1');

    expect(restored).toBeNull();
    expect(deleteDoc).toHaveBeenCalledWith({ path: 'users/user-1/aiInsightsRequests/latest' });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      '[AiInsightsLatestSnapshotService] Clearing invalid latest AI insight snapshot.',
      expect.objectContaining({
        userID: 'user-1',
        reason: 'response_query_invalid',
      }),
    );
  });

  it('should clear snapshots when aggregation enum variants are unknown', async () => {
    const snapshotWithUnknownAggregationInterval = {
      version: 1,
      savedAt: '2026-03-18T12:00:00.000Z',
      prompt: 'Show my total distance',
      response: {
        ...buildOkResponse(),
        aggregation: {
          ...buildOkResponse().aggregation,
          resolvedTimeInterval: 9999,
        },
      },
    };
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => snapshotWithUnknownAggregationInterval,
    } as never);

    const restored = await service.loadLatest('user-1');

    expect(restored).toBeNull();
    expect(deleteDoc).toHaveBeenCalledWith({ path: 'users/user-1/aiInsightsRequests/latest' });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      '[AiInsightsLatestSnapshotService] Clearing invalid latest AI insight snapshot.',
      expect.objectContaining({
        userID: 'user-1',
        reason: 'response_aggregation_invalid',
      }),
    );
  });

  it('should restore event-lookup snapshots without clearing them', async () => {
    const snapshot: AiInsightsLatestSnapshot = {
      version: 1,
      savedAt: '2026-03-18T12:00:00.000Z',
      prompt: 'I want to know when I had my longest distance in cycling',
      response: buildEventLookupResponse(),
    };
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => snapshot,
    } as never);

    const restored = await service.loadLatest('user-1');

    expect(restored).toEqual(snapshot);
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('should restore latest-event snapshots without clearing them', async () => {
    const snapshot: AiInsightsLatestSnapshot = {
      version: 1,
      savedAt: '2026-03-18T12:00:00.000Z',
      prompt: 'When was my last ride?',
      response: buildLatestEventResponse(),
    };
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => snapshot,
    } as never);

    const restored = await service.loadLatest('user-1');

    expect(restored).toEqual(snapshot);
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('should restore aggregate snapshots that include supplemental event rankings', async () => {
    const snapshot: AiInsightsLatestSnapshot = {
      version: 1,
      savedAt: '2026-03-18T12:00:00.000Z',
      prompt: 'Show my longest distances by sport',
      response: buildAggregateRankingResponse(),
    };
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => snapshot,
    } as never);

    const restored = await service.loadLatest('user-1');

    expect(restored).toEqual(snapshot);
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('should restore multi-metric snapshots without clearing them', async () => {
    const snapshot: AiInsightsLatestSnapshot = {
      version: 1,
      savedAt: '2026-03-18T12:00:00.000Z',
      prompt: 'Show me avg cadence and avg power for the last 3 months for cycling',
      response: buildMultiMetricResponse(),
    };
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => snapshot,
    } as never);

    const restored = await service.loadLatest('user-1');

    expect(restored).toEqual(snapshot);
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('should ignore version mismatches and remove the stale snapshot', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({
        version: 999,
        savedAt: '2026-03-18T12:00:00.000Z',
        prompt: 'Old snapshot',
        response: buildOkResponse(),
      }),
    } as never);

    const restored = await service.loadLatest('user-1');

    expect(restored).toBeNull();
    expect(deleteDoc).toHaveBeenCalledWith({ path: 'users/user-1/aiInsightsRequests/latest' });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      '[AiInsightsLatestSnapshotService] Clearing invalid latest AI insight snapshot.',
      expect.objectContaining({
        userID: 'user-1',
        reason: 'version_mismatch',
        actualVersion: 999,
        expectedVersion: 1,
      }),
    );
  });

});
