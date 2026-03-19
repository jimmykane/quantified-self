import { TestBed } from '@angular/core/testing';
import { Firestore, deleteDoc, doc, getDoc, setDoc } from '@angular/fire/firestore';
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
  AiInsightsOkResponse,
  AiInsightsQuotaStatus,
} from '@shared/ai-insights.types';
import { LoggerService } from './logger.service';
import {
  AiInsightsLatestSnapshotService,
} from './ai-insights-latest-snapshot.service';

vi.mock('@angular/fire/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/fire/firestore')>();
  class MockFirestore {}

    return {
        ...actual,
        Firestore: MockFirestore,
        doc: vi.fn((...segments: unknown[]) => ({ path: segments.slice(1).join('/') })),
        getDoc: vi.fn(),
        setDoc: vi.fn().mockResolvedValue(undefined),
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

function buildQuotaStatus(): AiInsightsQuotaStatus {
  return {
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

  it('should save the latest completed AI snapshot to the fixed latest doc', async () => {
    const response = buildOkResponse();

    const result = await service.saveLatest('user-1', 'Show my total distance', response);

    expect(result).toBe('saved');
    expect(doc).toHaveBeenCalledWith({}, 'users', 'user-1', 'aiInsightsRequests', 'latest');
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'users/user-1/aiInsightsRequests/latest' },
      expect.objectContaining({
        version: 1,
        prompt: 'Show my total distance',
        response,
        savedAt: expect.any(String),
      }),
    );
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

    expect(restored).toEqual({
      ...snapshot,
      response: {
        ...snapshot.response,
        resultKind: 'aggregate',
        query: {
          ...snapshot.response.query,
          resultKind: 'aggregate',
        },
      },
    });
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

    expect(restored).toEqual({
      ...snapshot,
      response: {
        ...snapshot.response,
        resultKind: 'aggregate',
        query: {
          ...snapshot.response.query,
          resultKind: 'aggregate',
        },
      },
    });
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('should restore legacy snapshots with null presentation warnings by normalizing them', async () => {
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

    expect(restored).toEqual({
      version: 1,
      savedAt: '2026-03-18T12:00:00.000Z',
      prompt: 'Show my total distance',
      response: {
        ...buildOkResponse(),
        resultKind: 'aggregate',
        query: {
          ...buildOkResponse().query,
          resultKind: 'aggregate',
        },
        presentation: buildOkResponse().presentation,
      },
    });
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('should restore legacy snapshots with null requestedTimeInterval by normalizing it away', async () => {
    const legacyResponse = buildOkResponse();
    const { requestedTimeInterval: _requestedTimeInterval, ...legacyQueryWithoutRequestedInterval } = legacyResponse.query;
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

    expect(restored).toEqual({
      version: 1,
      savedAt: '2026-03-18T12:00:00.000Z',
      prompt: 'Show my total distance',
      response: {
        ...legacyResponse,
        query: {
          ...legacyQueryWithoutRequestedInterval,
          resultKind: 'aggregate',
        },
        resultKind: 'aggregate',
      },
    });
    expect((restored as AiInsightsLatestSnapshot | null)?.response.status).toBe('ok');
    if ((restored as AiInsightsLatestSnapshot | null)?.response.status === 'ok') {
      expect((restored as AiInsightsLatestSnapshot).response.query.requestedTimeInterval).toBeUndefined();
    }
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('should restore legacy snapshots with nullable summary bucket time and activity mix remainder', async () => {
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

    expect(restored).not.toBeNull();
    expect((restored as AiInsightsLatestSnapshot).response.status).toBe('ok');
    if ((restored as AiInsightsLatestSnapshot).response.status === 'ok') {
      const restoredSummary = (restored as AiInsightsLatestSnapshot).response.summary;
      expect(restoredSummary.peakBucket?.time).toBeUndefined();
      expect(restoredSummary.lowestBucket?.time).toBeUndefined();
      expect(restoredSummary.latestBucket?.time).toBeUndefined();
      expect(restoredSummary.activityMix?.remainingActivityTypeCount).toBe(0);
    }
    expect(deleteDoc).not.toHaveBeenCalled();
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
        reason: 'response_narrative_invalid',
        responseKeys: ['status'],
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

  it('should skip oversized snapshots before writing to Firestore', async () => {
    const largePrompt = 'x'.repeat(900 * 1024);

    const result = await service.saveLatest('user-1', largePrompt, buildOkResponse());

    expect(result).toBe('skipped_too_large');
    expect(setDoc).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalled();
  });
});
