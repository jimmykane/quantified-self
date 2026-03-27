import { afterEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataCadenceAvg,
  DataDistance,
  DataEndPosition,
  DataPowerAvg,
  DataStartPosition,
  TimeIntervals,
} from '@sports-alliance/sports-lib';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

import type { NormalizedInsightQuery } from '../../../../shared/ai-insights.types';
import {
  AI_INSIGHTS_TOP_RESULTS_DEFAULT,
  AI_INSIGHTS_TOP_RESULTS_MAX,
} from '../../../../shared/ai-insights-ranking.constants';
import {
  createExecuteQuery,
  normalizeFirestoreValue,
  rehydrateAiInsightsEvent,
  type ExecuteQueryApi,
  type ExecuteQueryDependencies,
} from './execute-query';

let executeQuerySubject = createExecuteQuery();

function setExecuteQueryDependenciesForTesting(
  dependencies: Partial<ExecuteQueryDependencies> = {},
): void {
  executeQuerySubject = createExecuteQuery(dependencies);
}

async function withExecuteQueryDependenciesForTesting<T>(
  dependencies: Partial<ExecuteQueryDependencies>,
  run: () => Promise<T> | T,
): Promise<T> {
  const previousSubject = executeQuerySubject;
  executeQuerySubject = createExecuteQuery(dependencies);
  try {
    return await run();
  } finally {
    executeQuerySubject = previousSubject;
  }
}

async function executeAiInsightsQuery(
  ...args: Parameters<ExecuteQueryApi['executeAiInsightsQuery']>
): ReturnType<ExecuteQueryApi['executeAiInsightsQuery']> {
  return executeQuerySubject.executeAiInsightsQuery(...args);
}

function createMockEvent(options: {
  id: string;
  startDate: Date;
  activityTypes: ActivityTypes[];
  stats: Record<string, unknown>;
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

function createLatestEventQuery(): Extract<NormalizedInsightQuery, { resultKind: 'latest_event' }> {
  return {
    resultKind: 'latest_event',
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
    chartType: ChartTypes.LinesVertical,
  };
}

function createPowerCurveQuery(
  overrides: Partial<Extract<NormalizedInsightQuery, { resultKind: 'power_curve' }>> = {},
): Extract<NormalizedInsightQuery, { resultKind: 'power_curve' }> {
  return {
    resultKind: 'power_curve',
    mode: 'best',
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
    defaultedToCycling: false,
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

  it('logs structured error metadata when importer throws an HttpsError-like failure', () => {
    const warn = vi.fn();

    const event = rehydrateAiInsightsEvent('bad-event', {
      startDate: 1768003200000,
      stats: {
        'Average Cadence': { value: 90 },
      },
    }, (() => {
      throw new HttpsError('internal', 'Importer exploded');
    }) as any, { info: vi.fn(), warn, error: vi.fn() });

    expect(event).toBeNull();
    expect(warn).toHaveBeenCalledWith('[aiInsights] Failed to rehydrate event snapshot', expect.objectContaining({
      eventID: 'bad-event',
      errorName: 'Error',
      errorMessage: 'Importer exploded',
      errorCode: 'internal',
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
      activityTypes: [ActivityTypes.Cycling],
    });
    expect(result.matchedEventsCount).toBe(1);
    expect(result.aggregation.buckets).toHaveLength(1);
    expect(result.aggregation.buckets[0]?.aggregateValue).toBe(40);
  });

  it('returns the newest matching event for latest_event queries', async () => {
    const fetchEventDocs = vi.fn(async () => [
      { id: 'e1', data: () => ({ startDate: new Date('2026-01-10T12:00:00.000Z') }) },
      { id: 'e2', data: () => ({ startDate: new Date('2026-02-11T12:00:00.000Z') }) },
      { id: 'e3', data: () => ({ startDate: new Date('2026-03-12T12:00:00.000Z') }) },
    ]);
    const importEvent = vi
      .fn()
      .mockImplementationOnce(() => createMockEvent({
        id: 'e1',
        startDate: new Date('2026-01-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {},
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'e2',
        startDate: new Date('2026-02-11T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {},
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'e3',
        startDate: new Date('2026-03-12T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {},
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

    const result = await executeAiInsightsQuery('user-1', createLatestEventQuery(), 'when was my last ride');

    expect(result.resultKind).toBe('latest_event');
    if (result.resultKind !== 'latest_event') {
      return;
    }

    expect(result.matchedEventsCount).toBe(3);
    expect(result.latestEvent.eventId).toBe('e3');
    expect(result.latestEvent.startDate).toBe('2026-03-12T12:00:00.000Z');
  });

  it('uses event id as deterministic tiebreaker for latest_event queries', async () => {
    const fetchEventDocs = vi.fn(async () => [
      { id: 'e2', data: () => ({ startDate: new Date('2026-03-12T12:00:00.000Z') }) },
      { id: 'e1', data: () => ({ startDate: new Date('2026-03-12T12:00:00.000Z') }) },
    ]);
    const importEvent = vi
      .fn()
      .mockImplementationOnce(() => createMockEvent({
        id: 'e2',
        startDate: new Date('2026-03-12T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {},
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'e1',
        startDate: new Date('2026-03-12T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {},
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

    const result = await executeAiInsightsQuery('user-1', createLatestEventQuery(), 'latest ride');
    expect(result.resultKind).toBe('latest_event');
    if (result.resultKind !== 'latest_event') {
      return;
    }

    expect(result.latestEvent.eventId).toBe('e1');
    expect(result.latestEvent.startDate).toBe('2026-03-12T12:00:00.000Z');
  });

  it('returns null latest event when no events match latest_event filters', async () => {
    const fetchEventDocs = vi.fn(async () => []);
    const importEvent = vi.fn();

    setExecuteQueryDependenciesForTesting({
      fetchEventDocs,
      fetchDebugEventSnapshot: vi.fn(async () => ({
        totalEventsCount: 0,
        recentEventsSample: [],
      })),
      importEvent,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    const result = await executeAiInsightsQuery('user-1', createLatestEventQuery(), 'latest ride');
    expect(result.resultKind).toBe('latest_event');
    if (result.resultKind !== 'latest_event') {
      return;
    }

    expect(result.matchedEventsCount).toBe(0);
    expect(result.latestEvent.eventId).toBeNull();
    expect(result.latestEvent.startDate).toBeNull();
  });

  it('builds a best power-curve envelope across matching events', async () => {
    const fetchEventDocs = vi.fn(async () => [
      { id: 'e1', data: () => ({ startDate: new Date('2026-01-10T12:00:00.000Z') }) },
      { id: 'e2', data: () => ({ startDate: new Date('2026-01-12T12:00:00.000Z') }) },
    ]);
    const importEvent = vi
      .fn()
      .mockImplementationOnce(() => createMockEvent({
        id: 'e1',
        startDate: new Date('2026-01-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          PowerCurve: [
            { duration: 5, power: 300, wattsPerKg: 4.1 },
            { duration: 60, power: 250, wattsPerKg: 3.6 },
          ],
        },
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'e2',
        startDate: new Date('2026-01-12T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          PowerCurve: [
            { duration: 5, power: 320, wattsPerKg: 4.3 },
            { duration: 60, power: 240, wattsPerKg: 3.4 },
            { duration: 120, power: 205, wattsPerKg: 3.1 },
          ],
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

    const result = await executeAiInsightsQuery(
      'user-1',
      createPowerCurveQuery({ mode: 'best' }),
      'what is my best power curve',
    );

    expect(result.resultKind).toBe('power_curve');
    if (result.resultKind !== 'power_curve') {
      return;
    }

    expect(result.powerCurve.mode).toBe('best');
    expect(result.powerCurve.matchedEventCount).toBe(2);
    expect(result.powerCurve.returnedSeriesCount).toBe(1);
    expect(result.powerCurve.series[0]?.points).toEqual([
      { duration: 5, power: 320, wattsPerKg: 4.3 },
      { duration: 60, power: 250, wattsPerKg: 3.6 },
      { duration: 120, power: 205, wattsPerKg: 3.1 },
    ]);
  });

  it('builds compare-over-time power-curve envelopes by requested interval', async () => {
    const fetchEventDocs = vi.fn(async () => [
      { id: 'e1', data: () => ({ startDate: new Date('2026-01-10T12:00:00.000Z') }) },
      { id: 'e2', data: () => ({ startDate: new Date('2026-02-10T12:00:00.000Z') }) },
      { id: 'e3', data: () => ({ startDate: new Date('2026-03-10T12:00:00.000Z') }) },
    ]);
    const importEvent = vi
      .fn()
      .mockImplementationOnce(() => createMockEvent({
        id: 'e1',
        startDate: new Date('2026-01-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          PowerCurve: [{ duration: 60, power: 260 }],
        },
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'e2',
        startDate: new Date('2026-02-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          PowerCurve: [{ duration: 60, power: 280 }],
        },
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'e3',
        startDate: new Date('2026-03-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          PowerCurve: [{ duration: 60, power: 300 }],
        },
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

    const result = await executeAiInsightsQuery(
      'user-1',
      createPowerCurveQuery({
        mode: 'compare_over_time',
        requestedTimeInterval: TimeIntervals.Monthly,
      }),
      'compare my power curve over the last 3 months',
    );

    expect(result.resultKind).toBe('power_curve');
    if (result.resultKind !== 'power_curve') {
      return;
    }

    expect(result.powerCurve.mode).toBe('compare_over_time');
    expect(result.powerCurve.resolvedTimeInterval).toBe(TimeIntervals.Monthly);
    expect(result.powerCurve.requestedSeriesCount).toBe(3);
    expect(result.powerCurve.returnedSeriesCount).toBe(3);
    expect(result.powerCurve.series).toHaveLength(3);
    expect(result.powerCurve.series.map(series => series.points[0]?.power)).toEqual([260, 280, 300]);
    const expectedMonthlyBucketKeys = [
      new Date(2026, 0, 1).getTime(),
      new Date(2026, 1, 1).getTime(),
      new Date(2026, 2, 1).getTime(),
    ];
    expect(result.powerCurve.series.map(series => Number(series.seriesKey))).toEqual(expectedMonthlyBucketKeys);
  });

  it('supports sports-lib wrapped numeric values inside PowerCurve points', async () => {
    const fetchEventDocs = vi.fn(async () => [
      { id: 'e1', data: () => ({ startDate: new Date('2026-01-10T12:00:00.000Z') }) },
      { id: 'e2', data: () => ({ startDate: new Date('2026-01-12T12:00:00.000Z') }) },
    ]);
    const importEvent = vi
      .fn()
      .mockImplementationOnce(() => createMockEvent({
        id: 'e1',
        startDate: new Date('2026-01-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          PowerCurve: [
            {
              duration: { Duration: 5 },
              power: { Power: 300 },
              wattsPerKg: { PowerWattsPerKg: 4.1 },
            },
            {
              duration: { Duration: 60 },
              power: { Power: 250 },
              wattsPerKg: { PowerWattsPerKg: 3.6 },
            },
          ],
        },
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'e2',
        startDate: new Date('2026-01-12T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          PowerCurve: [
            {
              duration: { Duration: 5 },
              power: { Power: 320 },
              wattsPerKg: { PowerWattsPerKg: 4.3 },
            },
          ],
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

    const result = await executeAiInsightsQuery(
      'user-1',
      createPowerCurveQuery({ mode: 'best' }),
      'what is my best power curve',
    );

    expect(result.resultKind).toBe('power_curve');
    if (result.resultKind !== 'power_curve') {
      return;
    }

    expect(result.powerCurve.matchedEventCount).toBe(2);
    expect(result.powerCurve.series[0]?.points).toEqual([
      { duration: 5, power: 320, wattsPerKg: 4.3 },
      { duration: 60, power: 250, wattsPerKg: 3.6 },
    ]);
  });

  it('logs warning diagnostics when malformed power-curve points are dropped', async () => {
    const loggerStub = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
    const fetchEventDocs = vi.fn(async () => [
      { id: 'e1', data: () => ({ startDate: new Date('2026-01-10T12:00:00.000Z') }) },
    ]);
    const importEvent = vi.fn(() => createMockEvent({
      id: 'e1',
      startDate: new Date('2026-01-10T12:00:00.000Z'),
      activityTypes: [ActivityTypes.Cycling],
      stats: {
        PowerCurve: [
          { duration: 5, power: 300 },
          { duration: 'bad-value', power: 320 },
          { duration: 30, power: 0 },
          42,
        ],
      },
    }));

    setExecuteQueryDependenciesForTesting({
      fetchEventDocs,
      fetchDebugEventSnapshot: vi.fn(async () => ({
        totalEventsCount: 1,
        recentEventsSample: [],
      })),
      importEvent,
      logger: loggerStub,
    });

    const result = await executeAiInsightsQuery(
      'user-1',
      createPowerCurveQuery({ mode: 'best' }),
      'what is my best power curve',
    );

    expect(result.resultKind).toBe('power_curve');
    if (result.resultKind !== 'power_curve') {
      return;
    }

    expect(result.powerCurve.series[0]?.points).toEqual([
      { duration: 5, power: 300 },
    ]);
    expect(loggerStub.warn).toHaveBeenCalledWith(
      '[aiInsights] Dropped malformed power-curve points during normalization',
      expect.objectContaining({
        userID: 'user-1',
        droppedPointCount: 3,
        affectedEventCount: 1,
        droppedPointSamples: expect.arrayContaining([
          expect.objectContaining({
            rawPointType: 'object',
            durationType: 'string',
            powerType: 'number',
          }),
          expect.objectContaining({
            rawPointType: 'number',
          }),
        ]),
      }),
    );
  });

  it('applies the power-curve safety guard when compare series exceed the technical threshold', async () => {
    const totalSeries = 130;
    const docs = Array.from({ length: totalSeries }, (_, index) => ({
      id: `e${index + 1}`,
      data: () => ({ startDate: new Date(Date.UTC(2026, 0, index + 1, 12, 0, 0)) }),
    }));
    const fetchEventDocs = vi.fn(async () => docs);
    const importEvent = vi.fn((eventJSON: { startDate?: Date }, eventID: string) => createMockEvent({
      id: eventID,
      startDate: eventJSON.startDate ?? new Date('2026-01-01T12:00:00.000Z'),
      activityTypes: [ActivityTypes.Cycling],
      stats: {
        PowerCurve: [{ duration: 60, power: 200 }],
      },
    }));

    setExecuteQueryDependenciesForTesting({
      fetchEventDocs,
      fetchDebugEventSnapshot: vi.fn(async () => ({
        totalEventsCount: totalSeries,
        recentEventsSample: [],
      })),
      importEvent,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    const result = await executeAiInsightsQuery(
      'user-1',
      createPowerCurveQuery({
        mode: 'compare_over_time',
        requestedTimeInterval: TimeIntervals.Daily,
      }),
      'compare my power curve over time',
    );

    expect(result.resultKind).toBe('power_curve');
    if (result.resultKind !== 'power_curve') {
      return;
    }

    expect(result.powerCurve.requestedSeriesCount).toBe(totalSeries);
    expect(result.powerCurve.safetyGuardApplied).toBe(true);
    expect(result.powerCurve.safetyGuardMaxSeries).toBe(120);
    expect(result.powerCurve.trimmedSeriesCount).toBe(10);
    expect(result.powerCurve.returnedSeriesCount).toBe(120);
    const expectedDailyBucketKeys = docs
      .map((doc) => {
        const startDate = doc.data().startDate as Date;
        return new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
      })
      .sort((left, right) => left - right)
      .slice(-120);
    expect(result.powerCurve.series.map(series => Number(series.seriesKey))).toEqual(expectedDailyBucketKeys);
  });

  it('scopes dependency overrides and restores previous test dependencies', async () => {
    const loggerStub = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
    const importEvent = vi.fn(() => createMockEvent({
      id: 'e1',
      startDate: new Date('2026-01-10T12:00:00.000Z'),
      activityTypes: [ActivityTypes.Cycling],
      stats: { [DataDistance.type]: 40 },
    }));
    const baseFetchEventDocs = vi.fn(async () => [
      { id: 'e1', data: () => ({ startDate: new Date('2026-01-10T12:00:00.000Z') }) },
    ]);
    const scopedFetchEventDocs = vi.fn(async () => [
      { id: 'e1', data: () => ({ startDate: new Date('2026-01-10T12:00:00.000Z') }) },
    ]);

    setExecuteQueryDependenciesForTesting({
      fetchEventDocs: baseFetchEventDocs as any,
      fetchDebugEventSnapshot: vi.fn(async () => ({ totalEventsCount: 1, recentEventsSample: [] })),
      importEvent,
      logger: loggerStub,
    });

    await withExecuteQueryDependenciesForTesting({
      fetchEventDocs: scopedFetchEventDocs as any,
      fetchDebugEventSnapshot: vi.fn(async () => ({ totalEventsCount: 1, recentEventsSample: [] })),
      importEvent,
      logger: loggerStub,
    }, async () => {
      await executeAiInsightsQuery('user-1', createQuery(), 'show distance');
    });

    await executeAiInsightsQuery('user-1', createQuery(), 'show distance');

    expect(scopedFetchEventDocs).toHaveBeenCalledTimes(1);
    expect(baseFetchEventDocs).toHaveBeenCalledTimes(1);
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
      activityTypes: [ActivityTypes.Cycling],
    });
    expect(result.matchedEventsCount).toBe(2);
    expect(result.aggregation.buckets.map(bucket => bucket.aggregateValue)).toEqual([40, 60]);
  });

  it('filters events by bbox using the stored start position only', async () => {
    const fetchEventDocs = vi.fn(async () => [
      { id: 'inside', data: () => ({ startDate: 1768003200000 }) },
      { id: 'outside-start', data: () => ({ startDate: 1768608000000 }) },
    ]);

    const importEvent = vi
      .fn()
      .mockImplementationOnce(() => createMockEvent({
        id: 'inside',
        startDate: new Date('2026-01-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          [DataDistance.type]: 40,
          [DataStartPosition.type]: {
            latitudeDegrees: 37.9838,
            longitudeDegrees: 23.7275,
          },
        },
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'outside-start',
        startDate: new Date('2026-01-11T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          [DataDistance.type]: 60,
          [DataStartPosition.type]: {
            latitudeDegrees: 41.9028,
            longitudeDegrees: 12.4964,
          },
          [DataEndPosition.type]: {
            latitudeDegrees: 37.9838,
            longitudeDegrees: 23.7275,
          },
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

    const result = await executeAiInsightsQuery('user-1', createQuery({
      locationFilter: {
        requestedText: 'Athens',
        effectiveText: 'Athens',
        resolvedLabel: 'Athens, Greece',
        source: 'input',
        mode: 'bbox',
        radiusKm: 50,
        center: {
          latitudeDegrees: 37.9838,
          longitudeDegrees: 23.7275,
        },
        bbox: {
          west: 23.60,
          south: 37.90,
          east: 23.85,
          north: 38.10,
        },
      },
    }), 'show my cycling distance in Athens');

    expect(result.matchedEventsCount).toBe(1);
    expect(result.aggregation.buckets[0]?.aggregateValue).toBe(40);
  });

  it('filters events by anti-meridian bbox when west is greater than east', async () => {
    const fetchEventDocs = vi.fn(async () => [
      { id: 'inside-east', data: () => ({ startDate: 1768003200000 }) },
      { id: 'inside-west', data: () => ({ startDate: 1768608000000 }) },
      { id: 'outside', data: () => ({ startDate: 1769212800000 }) },
    ]);

    const importEvent = vi
      .fn()
      .mockImplementationOnce(() => createMockEvent({
        id: 'inside-east',
        startDate: new Date('2026-01-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          [DataDistance.type]: 40,
          [DataStartPosition.type]: {
            latitudeDegrees: 0,
            longitudeDegrees: 179.5,
          },
        },
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'inside-west',
        startDate: new Date('2026-01-11T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          [DataDistance.type]: 60,
          [DataStartPosition.type]: {
            latitudeDegrees: -1,
            longitudeDegrees: -179.5,
          },
        },
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'outside',
        startDate: new Date('2026-01-12T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          [DataDistance.type]: 80,
          [DataStartPosition.type]: {
            latitudeDegrees: 0,
            longitudeDegrees: 160,
          },
        },
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
      locationFilter: {
        requestedText: 'Dateline region',
        effectiveText: 'Dateline region',
        resolvedLabel: 'Dateline region',
        source: 'input',
        mode: 'bbox',
        radiusKm: 50,
        center: {
          latitudeDegrees: 0,
          longitudeDegrees: 180,
        },
        bbox: {
          west: 170,
          south: -10,
          east: -170,
          north: 10,
        },
      },
    }), 'show my cycling distance near the dateline');

    expect(result.matchedEventsCount).toBe(2);
    const totalAggregate = result.aggregation.buckets
      .reduce((total, bucket) => total + (bucket.aggregateValue ?? 0), 0);
    expect(totalAggregate).toBe(100);
  });

  it('filters events by radius and excludes missing or invalid start positions', async () => {
    const loggerStub = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
    const fetchEventDocs = vi.fn(async () => [
      { id: 'inside', data: () => ({ startDate: 1768003200000 }) },
      { id: 'outside', data: () => ({ startDate: 1768608000000 }) },
      { id: 'missing-position', data: () => ({ startDate: 1769212800000 }) },
      { id: 'invalid-position', data: () => ({ startDate: 1769817600000 }) },
    ]);

    const importEvent = vi
      .fn()
      .mockImplementationOnce(() => createMockEvent({
        id: 'inside',
        startDate: new Date('2026-01-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          [DataDistance.type]: 40,
          [DataStartPosition.type]: {
            latitudeDegrees: 37.9838,
            longitudeDegrees: 23.7275,
          },
        },
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'outside',
        startDate: new Date('2026-01-11T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          [DataDistance.type]: 60,
          [DataStartPosition.type]: {
            latitudeDegrees: 40.6401,
            longitudeDegrees: 22.9444,
          },
        },
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'missing-position',
        startDate: new Date('2026-01-12T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          [DataDistance.type]: 25,
        },
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'invalid-position',
        startDate: new Date('2026-01-13T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          [DataDistance.type]: 25,
          [DataStartPosition.type]: {
            latitudeDegrees: 123,
            longitudeDegrees: 22.9444,
          },
        },
      }));

    setExecuteQueryDependenciesForTesting({
      fetchEventDocs,
      fetchDebugEventSnapshot: vi.fn(async () => ({
        totalEventsCount: 4,
        recentEventsSample: [],
      })),
      importEvent,
      logger: loggerStub,
    });

    const result = await executeAiInsightsQuery('user-1', createQuery({
      locationFilter: {
        requestedText: 'Athens',
        effectiveText: 'Athens',
        resolvedLabel: 'Athens, Greece',
        source: 'input',
        mode: 'radius',
        radiusKm: 50,
        center: {
          latitudeDegrees: 37.9838,
          longitudeDegrees: 23.7275,
        },
      },
    }), 'show my cycling distance near Athens');

    expect(result.matchedEventsCount).toBe(1);
    expect(result.aggregation.buckets[0]?.aggregateValue).toBe(40);
    expect(loggerStub.info).toHaveBeenCalledWith('[aiInsights] Query execution summary', expect.objectContaining({
      locationFilterRequestedText: 'Athens',
      locationFilterMode: 'radius',
      locationFilteredOutCount: 3,
      locationMissingStartPositionCount: 1,
      locationInvalidStartPositionCount: 1,
    }));
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

    expect(where).toHaveBeenCalledTimes(3);
    expect(where).toHaveBeenNthCalledWith(1, 'startDate', '>=', new Date('2026-01-01T00:00:00.000Z').getTime());
    expect(where).toHaveBeenNthCalledWith(2, 'startDate', '<=', new Date('2026-03-31T23:59:59.999Z').getTime());
    expect(where).toHaveBeenNthCalledWith(3, expect.anything(), 'array-contains', ActivityTypes.Cycling);
    expect(orderBy).toHaveBeenCalledWith('startDate', 'asc');
    expect(get).toHaveBeenCalledTimes(1);
    expect(result.matchedEventsCount).toBe(1);
  });

  it('uses array-contains-any for activity filters up to ten values', async () => {
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

    await executeAiInsightsQuery('user-1', createQuery({
      activityTypes: [ActivityTypes.Cycling, ActivityTypes.Running],
    }), 'show my distance');

    expect(where).toHaveBeenCalledTimes(3);
    expect(where).toHaveBeenNthCalledWith(1, 'startDate', '>=', new Date('2026-01-01T00:00:00.000Z').getTime());
    expect(where).toHaveBeenNthCalledWith(2, 'startDate', '<=', new Date('2026-03-31T23:59:59.999Z').getTime());
    expect(where).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      'array-contains-any',
      [ActivityTypes.Cycling, ActivityTypes.Running],
    );
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('chunks activity-type Firestore filters above ten values, de-dups docs, and sorts by startDate/id', async () => {
    const where = vi.fn();
    const orderBy = vi.fn();
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        docs: [
          { id: 'e2', data: () => ({ startDate: Date.UTC(2026, 0, 2, 12, 0, 0) }) },
          { id: 'e1', data: () => ({ startDate: Date.UTC(2026, 0, 1, 12, 0, 0) }) },
        ],
      })
      .mockResolvedValueOnce({
        docs: [
          { id: 'e3', data: () => ({ startDate: Date.UTC(2026, 0, 3, 12, 0, 0) }) },
          { id: 'e1', data: () => ({ startDate: Date.UTC(2026, 0, 1, 12, 0, 0) }) },
        ],
      });
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

    const importEvent = vi.fn((eventJSON: { startDate: Date }, eventID: string) => createMockEvent({
      id: eventID,
      startDate: eventJSON.startDate,
      activityTypes: [ActivityTypes.Cycling],
      stats: { [DataDistance.type]: 40 },
    }));
    const info = vi.fn();

    setExecuteQueryDependenciesForTesting({
      importEvent,
      logger: { info, warn: vi.fn(), error: vi.fn() } as any,
    });

    const manyActivityTypes = [
      ActivityTypes.Cycling,
      ActivityTypes.Running,
      'A' as ActivityTypes,
      'B' as ActivityTypes,
      'C' as ActivityTypes,
      'D' as ActivityTypes,
      'E' as ActivityTypes,
      'F' as ActivityTypes,
      'G' as ActivityTypes,
      'H' as ActivityTypes,
      'I' as ActivityTypes,
      'J' as ActivityTypes,
    ];

    await executeAiInsightsQuery('user-1', createQuery({
      activityTypes: manyActivityTypes,
    }), 'show my distance');

    expect(get).toHaveBeenCalledTimes(2);
    expect(where).toHaveBeenCalledTimes(6);
    expect(importEvent.mock.calls.map((call) => call[1])).toEqual(['e1', 'e2', 'e3']);
    expect(info).toHaveBeenCalledWith('[aiInsights] Query execution summary', expect.objectContaining({
      prefilterMode: 'chunked',
      prefilterChunkCount: 2,
      prefilterDedupedCount: 1,
    }));
  });

  it('skips date filters for explicit all-time queries', async () => {
    const fetchEventDocs = vi.fn(async ({ startDate, endDate, activityTypes }) => {
      expect(startDate).toBeUndefined();
      expect(endDate).toBeUndefined();
      expect(activityTypes).toEqual([ActivityTypes.Cycling]);
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
      activityTypes: [ActivityTypes.Cycling],
    });
    expect(result.matchedEventsCount).toBe(1);
  });

  it('skips events with missing activity-type stats and normalizes non-canonical values with warning telemetry', async () => {
    const warn = vi.fn();
    const info = vi.fn();

    setExecuteQueryDependenciesForTesting({
      fetchEventDocs: async () => [
        { id: 'missing', data: () => ({ startDate: new Date('2026-01-10T12:00:00.000Z') }) },
        { id: 'alias', data: () => ({ startDate: new Date('2026-01-11T12:00:00.000Z') }) },
      ],
      fetchDebugEventSnapshot: vi.fn(async () => ({
        totalEventsCount: 2,
        recentEventsSample: [],
      })),
      importEvent: vi
        .fn()
        .mockImplementationOnce(() => ({
          startDate: new Date('2026-01-10T12:00:00.000Z'),
          getID: () => 'missing',
          getActivityTypesAsArray: () => {
            throw new Error('missing activity type stat');
          },
          getStat: () => ({ getValue: () => 12 }),
        }))
        .mockImplementationOnce(() => ({
          startDate: new Date('2026-01-11T12:00:00.000Z'),
          getID: () => 'alias',
          getActivityTypesAsArray: () => ['cycling_road'],
          getStat: () => ({ getValue: () => 34 }),
        })),
      logger: { info, warn, error: vi.fn() } as any,
    });

    const result = await executeAiInsightsQuery('user-1', createQuery(), 'show my cycling distance');

    expect(result.matchedEventsCount).toBe(1);
    expect(warn).toHaveBeenCalledWith('[aiInsights] Skipped events with missing or invalid activity type stats', expect.objectContaining({
      skippedMissingActivityTypeCount: 1,
    }));
    expect(warn).toHaveBeenCalledWith('[aiInsights] Normalized non-canonical activity types in AI filtering', expect.objectContaining({
      normalizedNonCanonicalActivityTypeCount: 1,
    }));
    expect(info).toHaveBeenCalledWith('[aiInsights] Query execution summary', expect.objectContaining({
      skippedMissingActivityTypeCount: 1,
      normalizedNonCanonicalActivityTypeCount: 1,
    }));
  });

  it('returns ranked event ids for event lookup mode and caps the list at the default limit', async () => {
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
    expect(result.eventLookup.topEventIds).toHaveLength(AI_INSIGHTS_TOP_RESULTS_DEFAULT);
    expect(result.eventLookup.topEventIds).toEqual(['e12', 'e11', 'e10', 'e9', 'e8', 'e7', 'e6', 'e5', 'e4', 'e3']);
    expect(result.eventLookup.rankedEvents[0]).toEqual(expect.objectContaining({
      eventId: 'e12',
      aggregateValue: 12,
    }));
  });

  it('respects explicit event-lookup topResultsLimit values', async () => {
    const fetchEventDocs = vi.fn(async () => Array.from({ length: 24 }, (_, index) => ({
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
        totalEventsCount: 24,
        recentEventsSample: [],
      })),
      importEvent,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    const result = await executeAiInsightsQuery('user-1', createQuery({
      resultKind: 'event_lookup',
      valueType: ChartDataValueTypes.Maximum,
      topResultsLimit: 20,
    }), 'show top 20 distance events');

    expect(result.resultKind).toBe('event_lookup');
    if (result.resultKind !== 'event_lookup') {
      return;
    }

    expect(result.eventLookup.topEventIds).toHaveLength(20);
    expect(result.eventLookup.topEventIds[0]).toBe('e24');
    expect(result.eventLookup.topEventIds.at(-1)).toBe('e5');
  });

  it('clamps oversized event-lookup topResultsLimit values to the shared max cap', async () => {
    const fetchEventDocs = vi.fn(async () => Array.from({ length: 80 }, (_, index) => ({
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
        totalEventsCount: 80,
        recentEventsSample: [],
      })),
      importEvent,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    const result = await executeAiInsightsQuery('user-1', createQuery({
      resultKind: 'event_lookup',
      valueType: ChartDataValueTypes.Maximum,
      topResultsLimit: 999,
    }), 'show top 999 distance events');

    expect(result.resultKind).toBe('event_lookup');
    if (result.resultKind !== 'event_lookup') {
      return;
    }

    expect(result.eventLookup.topEventIds).toHaveLength(AI_INSIGHTS_TOP_RESULTS_MAX);
    expect(result.eventLookup.topEventIds[0]).toBe('e80');
    expect(result.eventLookup.topEventIds.at(-1)).toBe('e31');
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

  it('returns a global top-10 event ranking for maximum aggregate results', async () => {
    const fetchEventDocs = vi.fn(async () => Array.from({ length: 12 }, (_, index) => ({
      id: `e${index + 1}`,
      data: () => ({
        startDate: new Date(Date.UTC(2026, 0, index + 1, 12, 0, 0)),
      }),
    })));

    const importEvent = vi.fn((eventJSON: { startDate: Date }, eventID: string) => createMockEvent({
      id: eventID,
      startDate: eventJSON.startDate,
      activityTypes: [
        Number(eventID.slice(1)) % 2 === 0
          ? ActivityTypes.Cycling
          : ActivityTypes.Running,
      ],
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
      categoryType: ChartDataCategoryTypes.ActivityType,
      valueType: ChartDataValueTypes.Maximum,
      activityTypes: [ActivityTypes.Cycling, ActivityTypes.Running],
    }), 'show my longest distances by sport');

    expect(result.resultKind).toBe('aggregate');
    if (result.resultKind !== 'aggregate') {
      return;
    }

    expect(result.eventRanking).toEqual(expect.objectContaining({
      primaryEventId: 'e12',
      matchedEventCount: 12,
      topEventIds: ['e12', 'e11', 'e10', 'e9', 'e8', 'e7', 'e6', 'e5', 'e4', 'e3'],
    }));
  });

  it('respects explicit topResultsLimit for aggregate min/max event rankings', async () => {
    const fetchEventDocs = vi.fn(async () => Array.from({ length: 15 }, (_, index) => ({
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
        totalEventsCount: 15,
        recentEventsSample: [],
      })),
      importEvent,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    const result = await executeAiInsightsQuery('user-1', createQuery({
      categoryType: ChartDataCategoryTypes.ActivityType,
      valueType: ChartDataValueTypes.Maximum,
      topResultsLimit: 5,
      activityTypes: [ActivityTypes.Cycling],
    }), 'show top 5 longest distances by sport');

    expect(result.resultKind).toBe('aggregate');
    if (result.resultKind !== 'aggregate') {
      return;
    }

    expect(result.eventRanking).toEqual(expect.objectContaining({
      primaryEventId: 'e15',
      matchedEventCount: 15,
      topEventIds: ['e15', 'e14', 'e13', 'e12', 'e11'],
    }));
  });

  it('returns ascending global event ranking for minimum aggregate results with date filters applied', async () => {
    const fetchEventDocs = vi.fn(async () => [
      { id: 'e1', data: () => ({ startDate: new Date('2026-01-10T12:00:00.000Z') }) },
      { id: 'e2', data: () => ({ startDate: new Date('2026-02-10T12:00:00.000Z') }) },
      { id: 'e3', data: () => ({ startDate: new Date('2026-03-10T12:00:00.000Z') }) },
      { id: 'e4', data: () => ({ startDate: new Date('2026-04-10T12:00:00.000Z') }) },
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
        startDate: new Date('2026-02-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: { [DataDistance.type]: 20 },
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'e3',
        startDate: new Date('2026-03-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: { [DataDistance.type]: 20 },
      }))
      .mockImplementationOnce(() => createMockEvent({
        id: 'e4',
        startDate: new Date('2026-04-10T12:00:00.000Z'),
        activityTypes: [ActivityTypes.Cycling],
        stats: { [DataDistance.type]: 10 },
      }));

    setExecuteQueryDependenciesForTesting({
      fetchEventDocs,
      fetchDebugEventSnapshot: vi.fn(async () => ({
        totalEventsCount: 4,
        recentEventsSample: [],
      })),
      importEvent,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    const result = await executeAiInsightsQuery('user-1', createQuery({
      categoryType: ChartDataCategoryTypes.ActivityType,
      valueType: ChartDataValueTypes.Minimum,
      requestedDateRanges: [
        {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-31T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
      ],
    }), 'show my shortest distances by sport in q1');

    expect(result.resultKind).toBe('aggregate');
    if (result.resultKind !== 'aggregate') {
      return;
    }

    expect(result.eventRanking).toEqual(expect.objectContaining({
      primaryEventId: 'e3',
      matchedEventCount: 3,
      topEventIds: ['e3', 'e2', 'e1'],
    }));
  });

  it('omits aggregate event ranking when no stat-bearing events match', async () => {
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
        stats: { [DataDistance.type]: null },
      })),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    const result = await executeAiInsightsQuery('user-1', createQuery({
      valueType: ChartDataValueTypes.Maximum,
    }), 'show my max distance');

    expect(result.resultKind).toBe('aggregate');
    if (result.resultKind !== 'aggregate') {
      return;
    }

    expect(result.eventRanking).toBeUndefined();
    expect(result.aggregation.buckets).toEqual([]);
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

      const queryExecutionSummaryCall = info.mock.calls.find((call) => call[0] === '[aiInsights] Query execution summary');
      expect(queryExecutionSummaryCall?.[1]).toEqual(expect.objectContaining({
        promptLength: 52,
        promptPreview: 'tell me my avg cadence for cycling the last 3 months',
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
      expect((queryExecutionSummaryCall?.[1] as { prompt?: unknown } | undefined)?.prompt).toBeUndefined();
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
