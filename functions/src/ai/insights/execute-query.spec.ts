import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataDistance,
  TimeIntervals,
} from '@sports-alliance/sports-lib';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

import type { NormalizedInsightQuery } from '../../../../shared/ai-insights.types';
import {
  executeAiInsightsQuery,
  normalizeFirestoreValue,
  rehydrateAiInsightsEvent,
  setExecuteQueryDependenciesForTesting,
} from './execute-query';

function createMockEvent(options: {
  id: string;
  startDate: Date;
  activityTypes: ActivityTypes[];
  stats: Record<string, number | null | undefined>;
  isMerge?: boolean;
}) {
  return {
    startDate: options.startDate,
    getID: () => options.id,
    getActivityTypesAsArray: () => options.activityTypes,
    getStat: (dataType: string) => {
      const value = options.stats[dataType];
      if (value === null || value === undefined) {
        return null;
      }
      return {
        getValue: () => value,
      };
    },
    isMerge: options.isMerge === true,
  } as any;
}

function createQuery(overrides: Partial<NormalizedInsightQuery> = {}): NormalizedInsightQuery {
  return {
    dataType: DataDistance.type,
    valueType: ChartDataValueTypes.Total,
    categoryType: ChartDataCategoryTypes.DateType,
    requestedTimeInterval: TimeIntervals.Daily,
    activityTypeGroups: [],
    activityTypes: [ActivityTypes.Cycling],
    dateRange: {
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-03-31T23:59:59.999Z',
      timezone: 'UTC',
    },
    chartType: ChartTypes.ColumnsVertical,
    ...overrides,
  };
}

describe('execute-query', () => {
  afterEach(() => {
    setExecuteQueryDependenciesForTesting();
    vi.restoreAllMocks();
  });

  it('normalizes Firestore timestamps before event import', () => {
    const importEvent = vi.fn((eventJSON: Record<string, unknown>, eventID: string) => ({
      startDate: eventJSON.startDate,
      getID: () => eventID,
      getActivityTypesAsArray: () => [ActivityTypes.Cycling],
      getStat: () => null,
    }));

    const event = rehydrateAiInsightsEvent('event-1', {
      startDate: { seconds: 1710000000, nanoseconds: 0 },
    }, importEvent as any);

    expect(event).not.toBeNull();
    expect(importEvent).toHaveBeenCalledWith(expect.objectContaining({
      startDate: expect.any(Date),
    }), 'event-1');
  });

  it('skips malformed start dates during rehydration', () => {
    const warn = vi.fn();

    const event = rehydrateAiInsightsEvent('bad-event', {
      startDate: 'not-a-date',
    }, vi.fn() as any, { warn, error: vi.fn() });

    expect(event).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('keeps missing or legacy fields compatible with import stubs', () => {
    const importEvent = vi.fn((_eventJSON: Record<string, unknown>, eventID: string) => ({
      startDate: new Date('2026-01-02T00:00:00.000Z'),
      getID: () => eventID,
      getActivityTypesAsArray: () => [ActivityTypes.Cycling],
      getStat: () => null,
    }));

    const event = rehydrateAiInsightsEvent('legacy-event', {
      startDate: new Date('2026-01-02T00:00:00.000Z'),
      originalFile: { path: 'a.fit' },
    }, importEvent as any);

    expect(event?.getID()).toBe('legacy-event');
  });

  it('logs detailed diagnostics when event rehydration fails', () => {
    const warn = vi.fn();

    const event = rehydrateAiInsightsEvent('bad-event', {
      startDate: 1768003200000,
      stats: {
        'Average Cadence': { value: 90 },
      },
      streams: [{ type: 'Heart Rate' }],
      activities: [{ id: 'a1' }],
    }, (() => {
      throw new Error('Importer exploded');
    }) as any, { info: vi.fn(), warn, error: vi.fn() });

    expect(event).toBeNull();
    expect(warn).toHaveBeenCalledWith('[aiInsights] Failed to rehydrate event snapshot', expect.objectContaining({
      eventID: 'bad-event',
      errorName: 'Error',
      errorMessage: 'Importer exploded',
      rawStartDateType: 'number',
      rawStartDatePreview: 1768003200000,
      normalizedStartDateISO: 1768003200000,
      statsKeysSample: ['Average Cadence'],
      streamsShape: 'array:1',
      eventsShape: 'undefined',
      activitiesShape: 'array:1',
    }));
  });

  it('filters on startDate, removes merges, filters activities, and aggregates matching events', async () => {
    const fetchEventDocs = vi.fn(async () => [
      { id: 'e1', data: () => ({ startDate: new Date('2026-01-10T12:00:00.000Z') }) },
      { id: 'e2', data: () => ({ startDate: new Date('2026-01-11T12:00:00.000Z') }) },
      { id: 'e3', data: () => ({ startDate: new Date('2026-01-12T12:00:00.000Z') }) },
    ]);

    const importEvent = vi
      .fn()
      .mockImplementationOnce(() => createMockEvent({
        id: 'e1',
        startDate: new Date('2026-01-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: { [DataDistance.type]: 40 },
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'e2',
        startDate: new Date('2026-01-11T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: { [DataDistance.type]: 20 },
        isMerge: true,
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'e3',
        startDate: new Date('2026-01-12T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Running],
        stats: { [DataDistance.type]: 10 },
      }));

    setExecuteQueryDependenciesForTesting({
      fetchEventDocs,
      fetchDebugEventSnapshot: vi.fn(async () => ({
        totalEventsCount: 3,
        recentEventsSample: [],
      })),
      importEvent,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    const result = await executeAiInsightsQuery('user-1', createQuery(), 'show my cycling distance');

    expect(fetchEventDocs).toHaveBeenCalledWith({
      userID: 'user-1',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-03-31T23:59:59.999Z'),
    });
    expect(result.matchedEventsCount).toBe(1);
    expect(result.aggregation.buckets).toHaveLength(1);
    expect(result.aggregation.buckets[0]?.aggregateValue).toBe(40);
  });

  it('supports events collections that store startDate as epoch milliseconds', async () => {
    const fetchEventDocs = vi.fn(async ({ startDate, endDate }) => {
      expect(startDate).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(endDate).toEqual(new Date('2026-03-31T23:59:59.999Z'));
      return [
        { id: 'e1', data: () => ({ startDate: 1768003200000 }) },
      ];
    });

    const importEvent = vi.fn(() => createMockEvent({
      id: 'e1',
      startDate: new Date('2026-01-10T12:00:00.000Z'),
      activityTypes: [ActivityTypes.Cycling],
      stats: { [DataDistance.type]: 40 },
    }));

    setExecuteQueryDependenciesForTesting({
      fetchEventDocs,
      fetchDebugEventSnapshot: vi.fn(async () => ({
        totalEventsCount: 1,
        recentEventsSample: [],
      })),
      importEvent,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    const result = await executeAiInsightsQuery('user-1', createQuery(), 'show my cycling distance');

    expect(fetchEventDocs).toHaveBeenCalledTimes(1);
    expect(result.matchedEventsCount).toBe(1);
    expect(result.aggregation.buckets[0]?.aggregateValue).toBe(40);
  });

  it('returns an empty aggregation when no events match', async () => {
    const fetchDebugEventSnapshot = vi.fn(async () => ({
      totalEventsCount: 4,
      recentEventsSample: [{ id: 'e-latest', startDateRaw: 1768003200000, startDateType: 'number' }],
    }));

    setExecuteQueryDependenciesForTesting({
      fetchEventDocs: async () => [],
      fetchDebugEventSnapshot,
      importEvent: vi.fn() as any,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    const result = await executeAiInsightsQuery('user-1', createQuery(), 'show my cycling distance');

    expect(fetchDebugEventSnapshot).toHaveBeenCalledWith('user-1');
    expect(result.matchedEventsCount).toBe(0);
    expect(result.aggregation.buckets).toEqual([]);
  });

  it('logs query-stage diagnostics including requested-stat coverage', async () => {
    const info = vi.fn();
    const originalFirestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8081';

    try {
      setExecuteQueryDependenciesForTesting({
        fetchEventDocs: async () => [
          { id: 'e1', data: () => ({ startDate: new Date('2026-01-10T12:00:00.000Z') }) },
          { id: 'e2', data: () => ({ startDate: new Date('2026-01-11T12:00:00.000Z') }) },
        ],
        fetchDebugEventSnapshot: vi.fn(async () => ({
          totalEventsCount: 2,
          recentEventsSample: [],
        })),
        importEvent: vi
          .fn()
          .mockImplementationOnce(() => createMockEvent({
            id: 'e1',
            startDate: new Date('2026-01-10T12:00:00.000Z'),
            activityTypes: [ActivityTypes.Cycling],
            stats: { [DataDistance.type]: 40 },
          }))
          .mockImplementationOnce(() => createMockEvent({
            id: 'e2',
            startDate: new Date('2026-01-11T12:00:00.000Z'),
            activityTypes: [ActivityTypes.Cycling],
            stats: { [DataDistance.type]: undefined },
          })),
        logger: { info, warn: vi.fn(), error: vi.fn() } as any,
      });

      await executeAiInsightsQuery('user-1', createQuery(), 'tell me my avg cadence for cycling the last 3 months');

      expect(info).toHaveBeenCalledWith('[aiInsights] Query execution summary', expect.objectContaining({
        prompt: 'tell me my avg cadence for cycling the last 3 months',
        fetchedDocsCount: 2,
        rehydratedEventsCount: 2,
        mergedEventsExcludedCount: 0,
        activityFilteredOutCount: 0,
        matchedEventsCount: 2,
        eventsWithRequestedStatCount: 1,
        matchedEventIDsSample: ['e1', 'e2'],
        firestoreTarget: 'emulator',
        firestoreEmulatorHost: '127.0.0.1:8081',
        debugTotalEventsCount: null,
        debugRecentEventsSample: [],
      }));
    } finally {
      if (originalFirestoreEmulatorHost === undefined) {
        delete process.env.FIRESTORE_EMULATOR_HOST;
      } else {
        process.env.FIRESTORE_EMULATOR_HOST = originalFirestoreEmulatorHost;
      }
    }
  });

  it('normalizes nested timestamp-like values recursively', () => {
    const normalized = normalizeFirestoreValue({
      startDate: { seconds: 1710000000, nanoseconds: 0 },
      distance: 42,
      nested: [{ updatedAt: { seconds: 1710003600, nanoseconds: 0 } }],
    }) as Record<string, any>;

    expect(normalized.startDate).toBeInstanceOf(Date);
    expect(normalized.distance).toBe(42);
    expect(normalized.nested[0].updatedAt).toBeInstanceOf(Date);
  });
});
