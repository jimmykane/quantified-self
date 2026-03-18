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
      importEvent,
      logger: { warn: vi.fn(), error: vi.fn() } as any,
    });

    const result = await executeAiInsightsQuery('user-1', createQuery());

    expect(fetchEventDocs).toHaveBeenCalledWith({
      userID: 'user-1',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-03-31T23:59:59.999Z'),
    });
    expect(result.matchedEventsCount).toBe(1);
    expect(result.aggregation.buckets).toHaveLength(1);
    expect(result.aggregation.buckets[0]?.aggregateValue).toBe(40);
  });

  it('returns an empty aggregation when no events match', async () => {
    setExecuteQueryDependenciesForTesting({
      fetchEventDocs: async () => [],
      importEvent: vi.fn() as any,
      logger: { warn: vi.fn(), error: vi.fn() } as any,
    });

    const result = await executeAiInsightsQuery('user-1', createQuery());

    expect(result.matchedEventsCount).toBe(0);
    expect(result.aggregation.buckets).toEqual([]);
  });

  it('normalizes nested timestamp-like values recursively', () => {
    const normalized = normalizeFirestoreValue({
      startDate: { seconds: 1710000000, nanoseconds: 0 },
      nested: [{ updatedAt: { seconds: 1710003600, nanoseconds: 0 } }],
    }) as Record<string, any>;

    expect(normalized.startDate).toBeInstanceOf(Date);
    expect(normalized.nested[0].updatedAt).toBeInstanceOf(Date);
  });
});
