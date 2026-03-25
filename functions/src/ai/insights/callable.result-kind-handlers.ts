import { TimeIntervals, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type {
  AiInsightPresentation,
  AiInsightSummary,
  AiInsightsAggregateOkResponse,
  AiInsightsEventLookupOkResponse,
  AiInsightsLatestEventOkResponse,
  AiInsightsMultiMetricAggregateMetricResult,
  AiInsightsMultiMetricAggregateOkResponse,
  AiInsightsOkResponse,
  AiInsightsPowerCurveOkResponse,
  AiInsightsQuotaStatusResponse,
  AiInsightsRequest,
  AiInsightsResultKind,
  NormalizedInsightAggregateQuery,
  NormalizedInsightEventLookupQuery,
  NormalizedInsightLatestEventQuery,
  NormalizedInsightMultiMetricAggregateQuery,
  NormalizedInsightPowerCurveQuery,
} from '../../../../shared/ai-insights.types';
import { resolveAiInsightsActivityFilterLabel } from '../../../../shared/ai-insights-activity-filter';
import type { AiInsightsExecutionResult } from './execute-query';
import type {
  SummarizeInsightApi,
  SummarizeInsightNarrativeResult,
} from './summarize-result.flow';

type SummarizeAiInsightResult = SummarizeInsightApi['summarizeAiInsightResult'];

interface CallableResultKindContextBase {
  userID: string;
  input: AiInsightsRequest;
  effectivePrompt: string;
  presentation: AiInsightPresentation;
  emptyPresentation: AiInsightPresentation;
  summarizeAiInsightResult: SummarizeAiInsightResult;
  unitSettings?: UserUnitSettingsInterface;
}

interface AggregateCallableResultKindContext extends CallableResultKindContextBase {
  resultKind: 'aggregate';
  query: NormalizedInsightAggregateQuery;
  metricLabel: string;
  executionResult: Extract<AiInsightsExecutionResult, { resultKind: 'aggregate' }>;
  aggregateSummary: AiInsightSummary;
}

interface EventLookupCallableResultKindContext extends CallableResultKindContextBase {
  resultKind: 'event_lookup';
  query: NormalizedInsightEventLookupQuery;
  metricLabel: string;
  executionResult: Extract<AiInsightsExecutionResult, { resultKind: 'event_lookup' }>;
}

interface LatestEventCallableResultKindContext extends CallableResultKindContextBase {
  resultKind: 'latest_event';
  query: NormalizedInsightLatestEventQuery;
  executionResult: Extract<AiInsightsExecutionResult, { resultKind: 'latest_event' }>;
}

interface MultiMetricCallableResultKindContext extends CallableResultKindContextBase {
  resultKind: 'multi_metric_aggregate';
  query: NormalizedInsightMultiMetricAggregateQuery;
  metricLabels: string[];
  metricResults: AiInsightsMultiMetricAggregateMetricResult[];
  executionResult: Extract<AiInsightsExecutionResult, { resultKind: 'multi_metric_aggregate' }>;
}

interface PowerCurveCallableResultKindContext extends CallableResultKindContextBase {
  resultKind: 'power_curve';
  query: NormalizedInsightPowerCurveQuery;
  executionResult: Extract<AiInsightsExecutionResult, { resultKind: 'power_curve' }>;
}

export type CallableResultKindContext =
  | AggregateCallableResultKindContext
  | EventLookupCallableResultKindContext
  | LatestEventCallableResultKindContext
  | MultiMetricCallableResultKindContext
  | PowerCurveCallableResultKindContext;

interface CallableResultKindContextMap {
  aggregate: AggregateCallableResultKindContext;
  event_lookup: EventLookupCallableResultKindContext;
  latest_event: LatestEventCallableResultKindContext;
  multi_metric_aggregate: MultiMetricCallableResultKindContext;
  power_curve: PowerCurveCallableResultKindContext;
}

export type InsightNarrativeResult = SummarizeInsightNarrativeResult;

interface CallableResultKindHandler<K extends AiInsightsResultKind> {
  isEmpty: (context: CallableResultKindContextMap[K]) => boolean;
  summarize: (
    context: CallableResultKindContextMap[K],
    isEmpty: boolean,
  ) => Promise<InsightNarrativeResult>;
  buildOkResponse: (
    context: CallableResultKindContextMap[K],
    narrativeResult: InsightNarrativeResult,
    quota: AiInsightsQuotaStatusResponse,
  ) => Extract<AiInsightsOkResponse, { resultKind: K }>;
}

type CallableResultKindRegistry = {
  [K in AiInsightsResultKind]: CallableResultKindHandler<K>;
};

function buildLatestEventNarrative(params: {
  query: NormalizedInsightLatestEventQuery;
  latestEventStartDate: string | null;
  matchedEventCount: number;
  locale?: string;
}): string {
  const activityLabel = resolveAiInsightsActivityFilterLabel(params.query).toLowerCase();
  const activityText = activityLabel === 'all activities'
    ? 'activities'
    : activityLabel;
  const matchedNoun = params.matchedEventCount === 1 ? 'event' : 'events';

  if (!params.latestEventStartDate) {
    return `I found no matching ${activityText} events in this range.`;
  }

  const eventDate = new Date(params.latestEventStartDate);
  const eventDateLabel = Number.isFinite(eventDate.getTime())
    ? new Intl.DateTimeFormat(params.locale || 'en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: params.query.dateRange.timezone,
    }).format(eventDate)
    : params.latestEventStartDate;

  return `Your latest ${activityText} event was on ${eventDateLabel}. I matched ${params.matchedEventCount} ${matchedNoun}.`;
}

function resolveTimeIntervalLabel(timeInterval: TimeIntervals): string {
  switch (timeInterval) {
    case TimeIntervals.Hourly:
      return 'hour';
    case TimeIntervals.Daily:
      return 'day';
    case TimeIntervals.Weekly:
      return 'week';
    case TimeIntervals.BiWeekly:
      return 'two-week period';
    case TimeIntervals.Monthly:
      return 'month';
    case TimeIntervals.Quarterly:
      return 'quarter';
    case TimeIntervals.Semesterly:
      return 'half-year period';
    case TimeIntervals.Yearly:
      return 'year';
    default:
      return 'period';
  }
}

function buildPowerCurveNarrative(context: PowerCurveCallableResultKindContext): string {
  const powerCurve = context.executionResult.powerCurve;
  const activityLabel = resolveAiInsightsActivityFilterLabel(context.query);
  const activitySuffix = activityLabel === 'All activities'
    ? ''
    : ` for ${activityLabel.toLowerCase()}`;
  if (!powerCurve.series.length) {
    return `I found no power-curve data${activitySuffix} in this range.`;
  }

  if (powerCurve.mode === 'best') {
    const eventNoun = powerCurve.matchedEventCount === 1 ? 'event' : 'events';
    return `I built your best power curve${activitySuffix} as the max-power envelope across ${powerCurve.matchedEventCount} matching ${eventNoun}.`;
  }

  const intervalLabel = resolveTimeIntervalLabel(powerCurve.resolvedTimeInterval);
  return `I compared your power curve${activitySuffix} over time by building one envelope per ${intervalLabel}.`;
}

const CALLABLE_RESULT_KIND_REGISTRY = {
  aggregate: {
    isEmpty: (context) => context.executionResult.aggregation.buckets.length === 0,
    summarize: async (context, isEmpty) => context.summarizeAiInsightResult({
      status: isEmpty ? 'empty' : 'ok',
      prompt: context.effectivePrompt,
      metricLabel: context.metricLabel,
      query: context.query,
      aggregation: context.executionResult.aggregation,
      summary: context.aggregateSummary,
      presentation: isEmpty ? context.emptyPresentation : context.presentation,
      clientLocale: context.input.clientLocale,
      unitSettings: context.unitSettings,
    }),
    buildOkResponse: (context, narrativeResult, quota) => ({
      status: 'ok',
      resultKind: 'aggregate',
      narrative: narrativeResult.narrative,
      quota,
      query: context.query,
      aggregation: context.executionResult.aggregation,
      summary: context.aggregateSummary,
      ...(narrativeResult.deterministicCompareSummary
        ? { deterministicCompareSummary: narrativeResult.deterministicCompareSummary }
        : {}),
      ...(context.executionResult.eventRanking
        ? {
          eventRanking: {
            primaryEventId: context.executionResult.eventRanking.primaryEventId as string,
            topEventIds: context.executionResult.eventRanking.topEventIds,
            matchedEventCount: context.executionResult.eventRanking.matchedEventCount,
          },
        }
        : {}),
      presentation: context.presentation,
    } satisfies AiInsightsAggregateOkResponse),
  },
  event_lookup: {
    isEmpty: (context) => !context.executionResult.eventLookup.primaryEventId,
    summarize: async (context, isEmpty) => context.summarizeAiInsightResult({
      status: isEmpty ? 'empty' : 'ok',
      prompt: context.effectivePrompt,
      metricLabel: context.metricLabel,
      query: context.query,
      eventLookup: {
        matchedEventCount: context.executionResult.matchedEventsCount,
        primaryEvent: context.executionResult.eventLookup.rankedEvents[0] ?? null,
        rankedEvents: context.executionResult.eventLookup.rankedEvents,
      },
      presentation: isEmpty ? context.emptyPresentation : context.presentation,
      clientLocale: context.input.clientLocale,
      unitSettings: context.unitSettings,
    }),
    buildOkResponse: (context, narrativeResult, quota) => ({
      status: 'ok',
      resultKind: 'event_lookup',
      narrative: narrativeResult.narrative,
      quota,
      query: context.query,
      eventLookup: {
        primaryEventId: context.executionResult.eventLookup.primaryEventId as string,
        topEventIds: context.executionResult.eventLookup.topEventIds,
        matchedEventCount: context.executionResult.matchedEventsCount,
      },
      presentation: context.presentation,
    } satisfies AiInsightsEventLookupOkResponse),
  },
  latest_event: {
    isEmpty: (context) => !context.executionResult.latestEvent.eventId,
    summarize: async (context) => ({
      narrative: buildLatestEventNarrative({
        query: context.query,
        latestEventStartDate: context.executionResult.latestEvent.startDate ?? null,
        matchedEventCount: context.executionResult.matchedEventsCount,
        locale: context.input.clientLocale,
      }),
      source: 'fallback',
    }),
    buildOkResponse: (context, narrativeResult, quota) => ({
      status: 'ok',
      resultKind: 'latest_event',
      narrative: narrativeResult.narrative,
      quota,
      query: context.query,
      latestEvent: {
        eventId: context.executionResult.latestEvent.eventId as string,
        startDate: context.executionResult.latestEvent.startDate as string,
        matchedEventCount: context.executionResult.matchedEventsCount,
      },
      presentation: context.presentation,
    } satisfies AiInsightsLatestEventOkResponse),
  },
  multi_metric_aggregate: {
    isEmpty: (context) => context.metricResults.every(metricResult => metricResult.aggregation.buckets.length === 0),
    summarize: async (context, isEmpty) => context.summarizeAiInsightResult({
      status: isEmpty ? 'empty' : 'ok',
      prompt: context.effectivePrompt,
      query: context.query,
      metricLabels: context.metricLabels,
      metricResults: context.metricResults,
      presentation: isEmpty ? context.emptyPresentation : context.presentation,
      clientLocale: context.input.clientLocale,
      unitSettings: context.unitSettings,
    }),
    buildOkResponse: (context, narrativeResult, quota) => ({
      status: 'ok',
      resultKind: 'multi_metric_aggregate',
      narrative: narrativeResult.narrative,
      quota,
      query: context.query,
      metricResults: context.metricResults,
      presentation: context.presentation,
    } satisfies AiInsightsMultiMetricAggregateOkResponse),
  },
  power_curve: {
    isEmpty: (context) => context.executionResult.powerCurve.series.length === 0,
    summarize: async (context) => ({
      narrative: buildPowerCurveNarrative(context),
      source: 'fallback',
    }),
    buildOkResponse: (context, narrativeResult, quota) => ({
      status: 'ok',
      resultKind: 'power_curve',
      narrative: narrativeResult.narrative,
      quota,
      query: context.query,
      powerCurve: context.executionResult.powerCurve,
      presentation: context.presentation,
    } satisfies AiInsightsPowerCurveOkResponse),
  },
} satisfies CallableResultKindRegistry;

export const CALLABLE_RESULT_KIND_KEYS = Object.freeze(
  Object.keys(CALLABLE_RESULT_KIND_REGISTRY) as AiInsightsResultKind[],
);

export function resolveCallableResultKindHandler<K extends AiInsightsResultKind>(
  resultKind: K,
): CallableResultKindHandler<K> {
  const handler = CALLABLE_RESULT_KIND_REGISTRY[resultKind];
  if (!handler) {
    throw new Error(`[aiInsights] Unsupported callable result kind: ${String(resultKind)}`);
  }

  return handler as unknown as CallableResultKindHandler<K>;
}
