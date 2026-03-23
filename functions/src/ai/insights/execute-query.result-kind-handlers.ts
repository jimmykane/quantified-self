import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  type EventInterface,
} from '@sports-alliance/sports-lib';
import type { NormalizedInsightQuery } from '../../../../shared/ai-insights.types';
import {
  buildEventStatAggregation,
} from '../../../../shared/event-stat-aggregation';
import type {
  AiInsightsExecutionResult,
  ExecuteQueryDependencies,
  MultiMetricAggregateExecutionMetricResult,
  RankedInsightEvent,
} from './execute-query';
import { buildExecutionPromptLogContext } from './execute-query.logging';

interface ExecuteQueryResultKindHelpers {
  buildLatestEvent: (events: EventInterface[]) => { eventId: string; startDate: string } | null;
  buildMatchedActivityTypeCounts: (
    events: EventInterface[],
    log: ExecuteQueryDependencies['logger'],
  ) => Array<{ activityType: string; eventCount: number }>;
  buildOverallAggregation: (
    dataType: string,
    valueType: ChartDataValueTypes,
    events: EventInterface[],
  ) => ReturnType<typeof buildEventStatAggregation>;
  buildRankedEvents: (
    events: EventInterface[],
    query: Extract<NormalizedInsightQuery, { resultKind: 'event_lookup' | 'aggregate' }>,
    topResultsLimit: number,
  ) => RankedInsightEvent[];
  resolveRankedTopResultsLimit: (
    query: Extract<NormalizedInsightQuery, { resultKind: 'event_lookup' | 'aggregate' }>,
  ) => number;
  hasRequestedStat: (event: EventInterface, dataType: string) => boolean;
}

interface ExecuteQueryResultKindContextBase {
  userID: string;
  prompt?: string;
  matchedEvents: EventInterface[];
  dependencies: ExecuteQueryDependencies;
  helpers: ExecuteQueryResultKindHelpers;
}

export interface ExecuteQueryResultKindContext<
  K extends NormalizedInsightQuery['resultKind'],
> extends ExecuteQueryResultKindContextBase {
  query: Extract<NormalizedInsightQuery, { resultKind: K }>;
}

interface ExecuteQueryResultKindHandler<K extends NormalizedInsightQuery['resultKind']> {
  execute: (
    context: ExecuteQueryResultKindContext<K>,
  ) => Extract<AiInsightsExecutionResult, { resultKind: K }>;
}

type ExecuteQueryResultKindRegistry = {
  [K in NormalizedInsightQuery['resultKind']]: ExecuteQueryResultKindHandler<K>;
};

const EXECUTE_QUERY_RESULT_KIND_REGISTRY = {
  event_lookup: {
    execute: (context) => {
      const {
        dependencies,
        helpers,
        matchedEvents,
        prompt,
        query,
        userID,
      } = context;
      const eventsWithRequestedStat = matchedEvents
        .filter(event => helpers.hasRequestedStat(event, query.dataType));
      const topResultsLimit = helpers.resolveRankedTopResultsLimit(query);
      const rankedEvents = helpers.buildRankedEvents(eventsWithRequestedStat, query, topResultsLimit);
      const topEventIds = rankedEvents.map(event => event.eventId);

      dependencies.logger.info('[aiInsights] Event lookup summary', {
        ...buildExecutionPromptLogContext(prompt),
        userID,
        dataType: query.dataType,
        valueType: query.valueType,
        topResultsLimit,
        rankedEventCount: rankedEvents.length,
        primaryEventId: rankedEvents[0]?.eventId ?? null,
        topEventIds,
      });

      return {
        resultKind: 'event_lookup',
        matchedEventsCount: eventsWithRequestedStat.length,
        matchedActivityTypeCounts: helpers.buildMatchedActivityTypeCounts(matchedEvents, dependencies.logger),
        eventLookup: {
          primaryEventId: rankedEvents[0]?.eventId ?? null,
          topEventIds,
          rankedEvents,
        },
      };
    },
  },
  latest_event: {
    execute: (context) => {
      const {
        dependencies,
        helpers,
        matchedEvents,
        prompt,
        userID,
      } = context;
      const latestEvent = helpers.buildLatestEvent(matchedEvents);

      dependencies.logger.info('[aiInsights] Latest event lookup summary', {
        ...buildExecutionPromptLogContext(prompt),
        userID,
        latestEventId: latestEvent?.eventId ?? null,
        latestEventStartDate: latestEvent?.startDate ?? null,
        matchedEventCount: matchedEvents.length,
      });

      return {
        resultKind: 'latest_event',
        matchedEventsCount: matchedEvents.length,
        matchedActivityTypeCounts: helpers.buildMatchedActivityTypeCounts(matchedEvents, dependencies.logger),
        latestEvent: {
          eventId: latestEvent?.eventId ?? null,
          startDate: latestEvent?.startDate ?? null,
        },
      };
    },
  },
  multi_metric_aggregate: {
    execute: (context) => {
      const {
        dependencies,
        helpers,
        matchedEvents,
        prompt,
        query,
        userID,
      } = context;
      const metricResults = query.metricSelections.map((metricSelection) => {
        const metricMatchedEvents = matchedEvents
          .filter(event => helpers.hasRequestedStat(event, metricSelection.dataType));
        const aggregation = query.groupingMode === 'date'
          ? buildEventStatAggregation(metricMatchedEvents, {
            dataType: metricSelection.dataType,
            valueType: metricSelection.valueType,
            categoryType: ChartDataCategoryTypes.DateType,
            requestedTimeInterval: query.requestedTimeInterval,
          }, dependencies.logger)
          : helpers.buildOverallAggregation(
            metricSelection.dataType,
            metricSelection.valueType,
            metricMatchedEvents,
          );

        return {
          metricKey: metricSelection.metricKey,
          aggregation,
          matchedEventsCount: metricMatchedEvents.length,
          matchedActivityTypeCounts: helpers.buildMatchedActivityTypeCounts(metricMatchedEvents, dependencies.logger),
        } satisfies MultiMetricAggregateExecutionMetricResult;
      });

      dependencies.logger.info('[aiInsights] Multi metric aggregation summary', {
        ...buildExecutionPromptLogContext(prompt),
        userID,
        metricCount: metricResults.length,
        groupingMode: query.groupingMode,
        requestedTimeInterval: query.requestedTimeInterval ?? null,
        metricSummaries: metricResults.map(metricResult => ({
          metricKey: metricResult.metricKey,
          matchedEventsCount: metricResult.matchedEventsCount,
          bucketCount: metricResult.aggregation.buckets.length,
          resolvedTimeInterval: metricResult.aggregation.resolvedTimeInterval,
        })),
      });

      return {
        resultKind: 'multi_metric_aggregate',
        matchedEventsCount: matchedEvents.length,
        matchedActivityTypeCounts: helpers.buildMatchedActivityTypeCounts(matchedEvents, dependencies.logger),
        metricResults,
      };
    },
  },
  aggregate: {
    execute: (context) => {
      const {
        dependencies,
        helpers,
        matchedEvents,
        prompt,
        query,
        userID,
      } = context;

      const eventsWithRequestedStat = matchedEvents
        .filter(event => helpers.hasRequestedStat(event, query.dataType));
      const aggregation = buildEventStatAggregation(matchedEvents, {
        dataType: query.dataType,
        valueType: query.valueType,
        categoryType: query.categoryType,
        requestedTimeInterval: query.requestedTimeInterval,
      }, dependencies.logger);
      const eventRanking = (
        query.valueType === ChartDataValueTypes.Minimum
        || query.valueType === ChartDataValueTypes.Maximum
      )
        ? (() => {
          const topResultsLimit = helpers.resolveRankedTopResultsLimit(query);
          const rankedEvents = helpers.buildRankedEvents(eventsWithRequestedStat, query, topResultsLimit);
          if (!rankedEvents.length) {
            return undefined;
          }

          const topEventIds = rankedEvents.map(event => event.eventId);
          return {
            primaryEventId: rankedEvents[0]?.eventId ?? null,
            topEventIds,
            matchedEventCount: eventsWithRequestedStat.length,
            rankedEvents,
          };
        })()
        : undefined;

      dependencies.logger.info('[aiInsights] Aggregation summary', {
        ...buildExecutionPromptLogContext(prompt),
        userID,
        dataType: query.dataType,
        valueType: query.valueType,
        categoryType: query.categoryType,
        requestedTimeInterval: query.requestedTimeInterval,
        resolvedTimeInterval: aggregation.resolvedTimeInterval,
        bucketCount: aggregation.buckets.length,
        rankedEventCount: eventRanking?.rankedEvents.length ?? 0,
        rankedEventTopIds: eventRanking?.topEventIds ?? [],
      });

      return {
        resultKind: 'aggregate',
        aggregation,
        matchedEventsCount: matchedEvents.length,
        matchedActivityTypeCounts: helpers.buildMatchedActivityTypeCounts(matchedEvents, dependencies.logger),
        ...(eventRanking ? { eventRanking } : {}),
      };
    },
  },
} satisfies ExecuteQueryResultKindRegistry;

export const EXECUTE_QUERY_RESULT_KIND_KEYS = Object.freeze(
  Object.keys(EXECUTE_QUERY_RESULT_KIND_REGISTRY) as Array<NormalizedInsightQuery['resultKind']>,
);

export function executeQueryByResultKind(
  context: ExecuteQueryResultKindContextBase & {
    query: NormalizedInsightQuery;
  },
): AiInsightsExecutionResult {
  const handler = EXECUTE_QUERY_RESULT_KIND_REGISTRY[context.query.resultKind];
  if (!handler) {
    throw new Error(`[aiInsights] Unsupported execute-query result kind: ${String(context.query.resultKind)}`);
  }

  return (handler as ExecuteQueryResultKindHandler<typeof context.query.resultKind>).execute(
    context as ExecuteQueryResultKindContext<typeof context.query.resultKind>,
  );
}
