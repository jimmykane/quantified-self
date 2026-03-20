import { afterEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataCadenceAvg,
  DataDistance,
  DataPowerAvg,
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
    resultKind: 'aggregate',
    dataType: DataDistance.type,
    valueType: ChartDataValueTypes.Total,
    categoryType: ChartDataCategoryTypes.DateType,
    requestedTimeInterval: TimeIntervals.Daily,
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
    ...overrides,
  };
}

function createMultiMetricQuery(): Extract<NormalizedInsightQuery, { resultKind: 'multi_metric_aggregate' }> {
  return {
    resultKind: 'multi_metric_aggregate',
    groupingMode: 'date',
    categoryType: ChartDataCategoryTypes.DateType,
    requestedTimeInterval: TimeIntervals.Monthly,
    activityTypeGroups: [],
    activityTypes: [ActivityTypes.Cycling],
    dateRange: {
      kind: 'bounded',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-03-31T23:59:59.999Z',
      timezone: 'UTC',
      source: 'prompt',
    },
    chartType: ChartTypes.LinesVertical,
    metricSelections: [
      {
        metricKey: 'cadence',
        dataType: DataCadenceAvg.type,
        valueType: ChartDataValueTypes.Average,
      },
      {
        metricKey: 'power',
        dataType: DataPowerAvg.type,
        valueType: ChartDataValueTypes.Average,
      },
    ],
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

  it('filters matched events to the exact requested date-range union inside the broader fetch span', async () => {
    const fetchEventDocs = vi.fn(async () => [
      { id: 'e2024', data: () => ({ startDate: Date.UTC(2024, 5, 1, 12, 0, 0) }) },
      { id: 'e2025', data: () => ({ startDate: Date.UTC(2025, 5, 1, 12, 0, 0) }) },
      { id: 'e2026', data: () => ({ startDate: Date.UTC(2026, 5, 1, 12, 0, 0) }) },
    ]);

    const importEvent = vi
      .fn()
      .mockImplementationOnce(() => createMockEvent({
        id: 'e2024',
        startDate: new Date('2024-06-01T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: { [DataDistance.type]: 40 },
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'e2025',
        startDate: new Date('2025-06-01T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: { [DataDistance.type]: 50 },
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'e2026',
        startDate: new Date('2026-06-01T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: { [DataDistance.type]: 60 },
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

    const result = await executeAiInsightsQuery('user-1', createQuery({
      requestedTimeInterval: TimeIntervals.Yearly,
      dateRange: {
        kind: 'bounded',
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2026-12-31T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt',
      },
      requestedDateRanges: [
        {
          kind: 'bounded',
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2024-12-31T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-12-31T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
      ],
      periodMode: 'compare',
    }), 'show my max distance in 2024 and 2026');

    expect(fetchEventDocs).toHaveBeenCalledWith({
      userID: 'user-1',
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      endDate: new Date('2026-12-31T23:59:59.999Z'),
    });
    expect(result.matchedEventsCount).toBe(2);
    expect(result.aggregation.buckets.map(bucket => bucket.aggregateValue)).toEqual([40, 60]);
  });

  it('reuses one filtered event pool for multi-metric aggregations', async () => {
    const fetchEventDocs = vi.fn(async () => [
      { id: 'e1', data: () => ({ startDate: 1768003200000 }) },
      { id: 'e2', data: () => ({ startDate: 1768608000000 }) },
    ]);

    const importEvent = vi
      .fn()
      .mockImplementationOnce(() => createMockEvent({
        id: 'e1',
        startDate: new Date('2026-01-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          [DataCadenceAvg.type]: 88,
          [DataPowerAvg.type]: 210,
        },
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'e2',
        startDate: new Date('2026-02-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          [DataCadenceAvg.type]: 91,
        },
      }));

    setExecuteQueryDependenciesForTesting({
      fetchEventDocs,
      fetchDebugEventSnapshot: vi.fn(async () => ({
        totalEventsCount: 2,
        recentEventsSample: [],
      })),
      importEvent,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    const result = await executeAiInsightsQuery('user-1', createMultiMetricQuery(), 'compare cadence and power');

    expect(fetchEventDocs).toHaveBeenCalledTimes(1);
    expect(result.resultKind).toBe('multi_metric_aggregate');
    if (result.resultKind !== 'multi_metric_aggregate') {
      return;
    }

    expect(result.metricResults).toHaveLength(2);
    expect(result.metricResults[0]).toEqual(expect.objectContaining({
      metricKey: 'cadence',
      matchedEventsCount: 2,
    }));
    expect(result.metricResults[1]).toEqual(expect.objectContaining({
      metricKey: 'power',
      matchedEventsCount: 1,
    }));
  });

  it('uses a single numeric startDate Firestore query for bounded requests', async () => {
    const where = vi.fn();
    const orderBy = vi.fn();
    const get = vi.fn(async () => ({
      docs: [
        { id: 'e1', data: () => ({ startDate: 1768003200000 }) },
      ],
    }));
    const queryChain = {
      where,
      orderBy,
      get,
    };

    where.mockImplementation(() => queryChain);
    orderBy.mockImplementation(() => queryChain);

    const eventsCollection = {
      get: vi.fn(),
      where,
      orderBy,
      count: vi.fn(),
    };
    const docRef = {
      collection: vi.fn((_path: string) => eventsCollection),
    };
    const usersCollection = {
      doc: vi.fn((_userID: string) => docRef),
    };
    const firestore = {
      collection: vi.fn((_path: string) => usersCollection),
    };

    vi.spyOn(admin, 'firestore').mockReturnValue(firestore as any);

    setExecuteQueryDependenciesForTesting({
      importEvent: vi.fn(() => createMockEvent({
        id: 'e1',
        startDate: new Date('2026-01-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: { [DataDistance.type]: 40 },
      })),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    const result = await executeAiInsightsQuery('user-1', createQuery(), 'show my cycling distance');

    expect(where).toHaveBeenCalledTimes(2);
    expect(where).toHaveBeenNthCalledWith(1, 'startDate', '>=', new Date('2026-01-01T00:00:00.000Z').getTime());
    expect(where).toHaveBeenNthCalledWith(2, 'startDate', '<=', new Date('2026-03-31T23:59:59.999Z').getTime());
    expect(orderBy).toHaveBeenCalledWith('startDate', 'asc');
    expect(get).toHaveBeenCalledTimes(1);
    expect(result.matchedEventsCount).toBe(1);
  });

  it('skips date filters for explicit all-time queries', async () => {
    const fetchEventDocs = vi.fn(async ({ startDate, endDate }) => {
      expect(startDate).toBeUndefined();
      expect(endDate).toBeUndefined();
      return [
        { id: 'e1', data: () => ({ startDate: new Date('2026-01-10T12:00:00.000Z') }) },
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

    const result = await executeAiInsightsQuery('user-1', createQuery({
      dateRange: {
        kind: 'all_time',
        timezone: 'UTC',
        source: 'prompt',
      },
    }), 'show my cycling distance all time');

    expect(fetchEventDocs).toHaveBeenCalledWith({
      userID: 'user-1',
      startDate: undefined,
      endDate: undefined,
    });
    expect(result.matchedEventsCount).toBe(1);
  });

  it('returns ranked event ids for event lookup mode and caps the list at 10', async () => {
    const fetchEventDocs = vi.fn(async () => Array.from({ length: 12 }, (_, index) => ({
      id: `e${index + 1}`,
      data: () => ({
        startDate: new Date(Date.UTC(2026, 0, index + 1, 12, 0, 0)),
      }),
    })));

    const importEvent = vi.fn((eventJSON: { startDate: Date }, eventID: string) => createMockEvent({
      id: eventID,
      startDate: eventJSON.startDate,
      activityTypes: [ActivityTypes.Cycling],
      stats: {
        [DataDistance.type]: Number(eventID.slice(1)),
      },
    }));

    setExecuteQueryDependenciesForTesting({
      fetchEventDocs,
      fetchDebugEventSnapshot: vi.fn(async () => ({
        totalEventsCount: 12,
        recentEventsSample: [],
      })),
      importEvent,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    const result = await executeAiInsightsQuery('user-1', createQuery({
      resultKind: 'event_lookup',
      valueType: ChartDataValueTypes.Maximum,
    }), 'when did I have my longest distance in cycling');

    expect(result.resultKind).toBe('event_lookup');
    if (result.resultKind !== 'event_lookup') {
      return;
    }

    expect(result.eventLookup.primaryEventId).toBe('e12');
    expect(result.eventLookup.topEventIds).toHaveLength(10);
    expect(result.eventLookup.topEventIds).toEqual(['e12', 'e11', 'e10', 'e9', 'e8', 'e7', 'e6', 'e5', 'e4', 'e3']);
    expect(result.eventLookup.rankedEvents[0]).toEqual(expect.objectContaining({
      eventId: 'e12',
      aggregateValue: 12,
    }));
  });

  it('breaks event-lookup ties by most recent event date and then event id', async () => {
    const fetchEventDocs = vi.fn(async () => [
      { id: 'e2', data: () => ({ startDate: new Date('2026-01-10T12:00:00.000Z') }) },
      { id: 'e1', data: () => ({ startDate: new Date('2026-01-10T12:00:00.000Z') }) },
      { id: 'e3', data: () => ({ startDate: new Date('2026-01-11T12:00:00.000Z') }) },
    ]);

    const importEvent = vi
      .fn()
      .mockImplementationOnce(() => createMockEvent({
        id: 'e2',
        startDate: new Date('2026-01-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: { [DataDistance.type]: 40 },
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'e1',
        startDate: new Date('2026-01-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: { [DataDistance.type]: 40 },
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'e3',
        startDate: new Date('2026-01-11T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: { [DataDistance.type]: 40 },
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

    const result = await executeAiInsightsQuery('user-1', createQuery({
      resultKind: 'event_lookup',
      valueType: ChartDataValueTypes.Maximum,
    }), 'which event had my longest distance');

    expect(result.resultKind).toBe('event_lookup');
    if (result.resultKind !== 'event_lookup') {
      return;
    }

    expect(result.eventLookup.topEventIds).toEqual(['e3', 'e1', 'e2']);
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

  it('does not override normalized query shape based on prompt text', async () => {
    const info = vi.fn();

    setExecuteQueryDependenciesForTesting({
      fetchEventDocs: async () => [
        { id: 'e1', data: () => ({ startDate: new Date('2026-01-10T12:00:00.000Z') }) },
      ],
      fetchDebugEventSnapshot: vi.fn(async () => ({
        totalEventsCount: 1,
        recentEventsSample: [],
      })),
      importEvent: vi.fn(() => createMockEvent({
        id: 'e1',
        startDate: new Date('2026-01-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: { [DataDistance.type]: 40 },
      })),
      logger: { info, warn: vi.fn(), error: vi.fn() } as any,
    });

    await executeAiInsightsQuery('user-1', createQuery({
      categoryType: ChartDataCategoryTypes.ActivityType,
      chartType: ChartTypes.LinesVertical,
      requestedTimeInterval: TimeIntervals.Auto,
      activityTypes: [],
    }), 'Show my max heart rate last 3 months as stacked columns by activity type over time');

    const aggregationSummaryCall = info.mock.calls.find((call) => call[0] === '[aiInsights] Aggregation summary');
    expect(aggregationSummaryCall?.[1]).toEqual(expect.objectContaining({
      categoryType: ChartDataCategoryTypes.ActivityType,
      requestedTimeInterval: TimeIntervals.Auto,
    }));
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
