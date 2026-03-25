import { describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  type EventInterface,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import type { NormalizedInsightQuery } from '../../../../shared/ai-insights.types';
import type { ExecuteQueryDependencies, RankedInsightEvent } from './execute-query';
import { executeQueryByResultKind } from './execute-query.result-kind-handlers';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

function buildMockEvent(eventId: string, startDate: string, metricValue: number): EventInterface {
  return {
    startDate: new Date(startDate),
    getID: () => eventId,
    getActivityTypesAsArray: () => [ActivityTypes.Cycling],
    getStat: (dataType: string) => {
      if (dataType === 'Distance') {
        return {
          getValue: () => metricValue,
        };
      }
      return null;
    },
  } as unknown as EventInterface;
}

function buildAggregateQuery(): Extract<NormalizedInsightQuery, { resultKind: 'aggregate' }> {
  return {
    resultKind: 'aggregate',
    dataType: 'Distance',
    valueType: ChartDataValueTypes.Maximum,
    categoryType: ChartDataCategoryTypes.DateType,
    requestedTimeInterval: TimeIntervals.Daily,
    activityTypeGroups: [],
    activityTypes: [ActivityTypes.Cycling],
    dateRange: {
      kind: 'bounded',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-31T23:59:59.999Z',
      timezone: 'UTC',
      source: 'prompt',
    },
    chartType: ChartTypes.ColumnsVertical,
  };
}

describe('execute-query.result-kind-handlers', () => {
  it('uses metric-eligible events for aggregate stat/ranking sources', () => {
    const eventOne = buildMockEvent('event-one', '2026-01-10T10:00:00.000Z', 100);
    const eventTwo = buildMockEvent('event-two', '2026-01-11T10:00:00.000Z', 200);
    const rankedEventBuilder = vi.fn((events: EventInterface[]): RankedInsightEvent[] => events.map((event) => ({
      eventId: event.getID?.() ?? '',
      startDate: event.startDate?.toISOString?.() ?? '',
      aggregateValue: Number(event.getStat?.('Distance')?.getValue?.() ?? 0),
    })));
    const filterEventsForAggregationMetric = vi.fn((_events: readonly EventInterface[]) => [eventTwo]);

    const result = executeQueryByResultKind({
      userID: 'user-1',
      prompt: 'Which rides had my highest distance this month?',
      query: buildAggregateQuery(),
      matchedEvents: [eventOne, eventTwo],
      dependencies: {
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      } as unknown as ExecuteQueryDependencies,
      helpers: {
        buildLatestEvent: vi.fn(),
        buildPowerCurve: vi.fn(),
        buildMatchedActivityTypeCounts: vi.fn().mockReturnValue([]),
        buildOverallAggregation: vi.fn(),
        buildRankedEvents: rankedEventBuilder,
        resolveRankedTopResultsLimit: vi.fn().mockReturnValue(10),
        hasRequestedStat: vi.fn().mockReturnValue(true),
        filterEventsForAggregationMetric,
      },
    });

    expect(filterEventsForAggregationMetric).toHaveBeenCalledWith([eventOne, eventTwo], 'Distance');
    expect(rankedEventBuilder).toHaveBeenCalledWith([eventTwo], expect.objectContaining({
      resultKind: 'aggregate',
    }), 10);
    expect(result.resultKind).toBe('aggregate');
    if (result.resultKind !== 'aggregate') {
      return;
    }

    expect(result.matchedEventsWithRequestedStat?.map(event => event.getID?.())).toEqual(['event-two']);
    expect(result.eventRanking?.matchedEventCount).toBe(1);
  });
});

