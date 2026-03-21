import { ChartDataCategoryTypes, ChartDataValueTypes } from '@sports-alliance/sports-lib';
import type {
  AiInsightsEmptyResponse,
  AiInsightsOkResponse,
  NormalizedInsightMetricSelection,
} from '@shared/ai-insights.types';
import { resolveAiInsightsActivityFilterLabel } from '@shared/ai-insights-activity-filter';

type DisplayableInsightResponse = AiInsightsOkResponse | AiInsightsEmptyResponse;

function toSentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return `${trimmed.slice(0, 1).toUpperCase()}${trimmed.slice(1).toLowerCase()}`;
}

function stripAggregationPrefix(label: string, valueType: ChartDataValueTypes): string {
  const prefixCandidates = (() => {
    switch (valueType) {
      case ChartDataValueTypes.Average:
        return ['Average ', 'Avg '];
      case ChartDataValueTypes.Maximum:
        return ['Maximum ', 'Max '];
      case ChartDataValueTypes.Minimum:
        return ['Minimum ', 'Min '];
      case ChartDataValueTypes.Total:
        return ['Total '];
      default:
        return [];
    }
  })();

  for (const prefix of prefixCandidates) {
    if (label.startsWith(prefix) && label.length > prefix.length) {
      return label.slice(prefix.length);
    }
  }

  return label;
}

function normalizeMetricLabel(metricLabel: string, valueType: ChartDataValueTypes): string {
  return stripAggregationPrefix(metricLabel, valueType).trim().toLowerCase();
}

function joinMetricLabels(labels: string[]): string {
  if (labels.length <= 1) {
    return labels[0] ?? '';
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

function resolveActivitySuffix(response: DisplayableInsightResponse): string {
  const activityLabel = resolveAiInsightsActivityFilterLabel(response.query);
  if (activityLabel === 'All activities') {
    return '';
  }

  return ` for ${activityLabel.trim().toLowerCase()}`;
}

function resolveMetricLabelsFromSelections(
  selections: readonly NormalizedInsightMetricSelection[],
): string[] {
  return selections
    .map(selection => normalizeMetricLabel(selection.dataType, selection.valueType))
    .filter(label => label.length > 0);
}

export function resolveAiInsightsDisplayTitle(
  response: DisplayableInsightResponse,
  options?: {
    metricLabels?: readonly string[];
  },
): string | null {
  const activitySuffix = resolveActivitySuffix(response);

  if (response.query.resultKind === 'event_lookup') {
    const metricLabel = normalizeMetricLabel(response.query.dataType, response.query.valueType);
    return metricLabel ? toSentenceCase(`top ${metricLabel} events${activitySuffix}`) : null;
  }

  if (response.query.resultKind === 'latest_event') {
    return toSentenceCase(`latest event${activitySuffix}`);
  }

  if (response.query.resultKind === 'multi_metric_aggregate') {
    const defaultValueType = response.query.metricSelections[0]?.valueType ?? ChartDataValueTypes.Total;
    const incomingLabels = (options?.metricLabels ?? [])
      .map(label => normalizeMetricLabel(label, defaultValueType))
      .filter(label => label.length > 0);
    const metricLabels = incomingLabels.length
      ? incomingLabels
      : resolveMetricLabelsFromSelections(response.query.metricSelections);
    if (!metricLabels.length) {
      return null;
    }

    const joinedMetricLabels = joinMetricLabels(metricLabels);
    return toSentenceCase(response.query.groupingMode === 'date'
      ? `${joinedMetricLabels} over time${activitySuffix}`
      : `${joinedMetricLabels}${activitySuffix}`);
  }

  const metricLabel = normalizeMetricLabel(response.query.dataType, response.query.valueType);
  if (!metricLabel) {
    return null;
  }

  if (response.query.categoryType === ChartDataCategoryTypes.ActivityType) {
    return toSentenceCase(`${metricLabel} by activity type${activitySuffix}`);
  }

  return toSentenceCase(`${metricLabel} over time${activitySuffix}`);
}
