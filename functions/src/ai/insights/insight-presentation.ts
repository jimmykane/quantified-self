import { HttpsError } from 'firebase-functions/v2/https';
import { ChartDataCategoryTypes, ChartDataValueTypes, TimeIntervals } from '@sports-alliance/sports-lib';
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

function joinMetricLabels(metricLabels: string[]): string {
  if (metricLabels.length <= 1) {
    return metricLabels[0] ?? '';
  }

  if (metricLabels.length === 2) {
    return `${metricLabels[0]} and ${metricLabels[1]}`;
  }

  return `${metricLabels.slice(0, -1).join(', ')}, and ${metricLabels[metricLabels.length - 1]}`;
}

function resolveInsightTitle(query: NormalizedInsightQuery, metricLabelOrLabels: string | string[]): string {
  const activityFilterLabel = resolveAiInsightsActivityFilterLabel(query);
  const activityLabel = activityFilterLabel === 'All activities'
    ? ''
    : ` for ${activityFilterLabel}`;
  const metricLabel = Array.isArray(metricLabelOrLabels)
    ? joinMetricLabels(metricLabelOrLabels)
    : metricLabelOrLabels;

  if (query.resultKind === 'event_lookup') {
    return `Top ${metricLabel} events${activityLabel}`;
  }

  if (query.resultKind === 'latest_event') {
    return `Latest event${activityLabel}`;
  }

  if (query.resultKind === 'multi_metric_aggregate') {
    return query.groupingMode === 'date'
      ? `${metricLabel} over time${activityLabel}`
      : `${metricLabel}${activityLabel}`;
  }

  if (query.resultKind === 'power_curve') {
    return query.mode === 'compare_over_time'
      ? `Power curve over time${activityLabel}`
      : `Best power curve${activityLabel}`;
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

  if (query.resultKind === 'latest_event') {
    return undefined;
  }

  if (query.resultKind === 'power_curve') {
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
  metricLabelOrLabels: string | string[],
): AiInsightPresentation {
  return {
    title: resolveInsightTitle(query, metricLabelOrLabels),
    chartType: query.chartType,
    warnings: resolvePresentationWarnings(query),
  };
}

export function buildEmptyAggregation(query: NormalizedInsightQuery) {
  const dataType = query.resultKind === 'multi_metric_aggregate'
    ? (query.metricSelections[0]?.dataType ?? 'Unknown')
    : query.resultKind === 'latest_event'
      ? 'Latest Event'
      : query.resultKind === 'power_curve'
        ? 'Power Curve'
    : query.dataType;
  const valueType = query.resultKind === 'multi_metric_aggregate'
    ? (query.metricSelections[0]?.valueType ?? null)
    : query.resultKind === 'latest_event'
      ? ChartDataValueTypes.Total
      : query.resultKind === 'power_curve'
        ? ChartDataValueTypes.Maximum
    : query.valueType;

  return {
    dataType,
    valueType: valueType ?? ChartDataValueTypes.Total,
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
    case 'too_many_metrics':
      return 'I can compare up to three metrics in one prompt right now. Try narrowing the request to three metrics or fewer.';
    case 'unsupported_multi_metric_combination':
      return 'I can compare up to three metrics when they share one aggregation style. Use one aggregation such as average for all metrics, and say over time if you want a combined comparison chart.';
    case 'unsupported_metric':
    default:
      return 'I can answer a curated set of event-level metrics right now, such as distance, duration, ascent, descent, cadence, power, heart rate, speed, pace, calories, and selected performance metrics like TSS, normalized power, intensity factor, VO2 max, training effect, and recovery time. This list is growing over time, and if you need a specific metric please contact us so we can prioritize it.';
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
