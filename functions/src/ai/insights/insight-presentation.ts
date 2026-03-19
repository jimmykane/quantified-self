import { HttpsError } from 'firebase-functions/v2/https';
import { ChartDataCategoryTypes, TimeIntervals } from '@sports-alliance/sports-lib';
import type {
  AiInsightPresentation,
  AiInsightsQuotaStatusResponse,
  AiInsightsResponse,
  AiInsightsUnsupportedReasonCode,
  NormalizedInsightQuery,
} from '../../../../shared/ai-insights.types';
import { resolveAiInsightsActivityFilterLabel } from '../../../../shared/ai-insights-activity-filter';
import { getSuggestedInsightPrompts } from './metric-catalog';

export function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch (_error) {
    throw new HttpsError('invalid-argument', 'clientTimezone must be a valid IANA time zone.');
  }
}

function resolveInsightTitle(query: NormalizedInsightQuery, metricLabel: string): string {
  const activityFilterLabel = resolveAiInsightsActivityFilterLabel(query);
  const activityLabel = activityFilterLabel === 'All activities'
    ? ''
    : ` for ${activityFilterLabel}`;

  if (query.resultKind === 'event_lookup') {
    return `Top ${metricLabel} events${activityLabel}`;
  }

  if (query.categoryType === ChartDataCategoryTypes.ActivityType) {
    return `${query.valueType} ${metricLabel} by activity type${activityLabel}`;
  }

  return `${query.valueType} ${metricLabel} over time${activityLabel}`;
}

function resolvePresentationWarnings(query: NormalizedInsightQuery): string[] | undefined {
  if (query.resultKind === 'event_lookup') {
    return undefined;
  }

  if (
    query.categoryType === ChartDataCategoryTypes.ActivityType
    && query.activityTypeGroups.length === 0
    && query.activityTypes.length === 1
  ) {
    return ['This compares a single selected activity type, so the chart will contain one bar.'];
  }

  return undefined;
}

export function buildInsightPresentation(
  query: NormalizedInsightQuery,
  metricLabel: string,
): AiInsightPresentation {
  return {
    title: resolveInsightTitle(query, metricLabel),
    chartType: query.chartType,
    warnings: resolvePresentationWarnings(query),
  };
}

export function buildEmptyAggregation(query: NormalizedInsightQuery) {
  return {
    dataType: query.dataType,
    valueType: query.valueType,
    categoryType: query.categoryType,
    resolvedTimeInterval: query.requestedTimeInterval ?? TimeIntervals.Auto,
    buckets: [],
  };
}

function buildUnsupportedNarrative(reasonCode: AiInsightsUnsupportedReasonCode): string {
  switch (reasonCode) {
    case 'unsupported_capability':
      return 'I can only answer questions from persisted event-level stats right now, so streams, splits, laps, routes, and original-file reprocessing are out of scope.';
    case 'ambiguous_metric':
      return 'I could not map that request to one supported metric and aggregation combination with enough confidence.';
    case 'invalid_prompt':
      return 'I could not turn that request into a valid insight query.';
    case 'unsupported_metric':
    default:
      return 'I can answer a curated set of event-level metrics right now, such as distance, duration, ascent, descent, cadence, power, heart rate, speed, pace, calories, and selected performance metrics like TSS, normalized power, intensity factor, VO2 max, EPOC, training effect, and recovery time.';
  }
}

export function buildUnsupportedResponse(
  reasonCode: AiInsightsUnsupportedReasonCode,
  quota?: AiInsightsQuotaStatusResponse,
  options?: {
    sourceText?: string;
    suggestedPrompts?: string[];
  },
): AiInsightsResponse {
  return {
    status: 'unsupported',
    narrative: buildUnsupportedNarrative(reasonCode),
    ...(quota ? { quota } : {}),
    reasonCode,
    suggestedPrompts: options?.suggestedPrompts ?? getSuggestedInsightPrompts(3, options?.sourceText),
  };
}
