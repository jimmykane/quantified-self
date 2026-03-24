import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
  type ActivityTypeGroup,
  type ActivityTypes,
} from '@sports-alliance/sports-lib';
import type {
  AiInsightsPowerCurveMode,
  NormalizedInsightBoundedDateRange,
  NormalizedInsightDateRange,
  NormalizedInsightMetricSelection,
  NormalizedInsightPeriodMode,
  NormalizedInsightQuery,
} from '../../../../shared/ai-insights.types';

interface BuildQueryCommonInput {
  activityTypeGroups: ActivityTypeGroup[];
  activityTypes: ActivityTypes[];
  dateRange: NormalizedInsightDateRange;
  requestedDateRanges?: NormalizedInsightBoundedDateRange[];
  periodMode?: NormalizedInsightPeriodMode;
  chartType: ChartTypes;
}

interface BuildMetricQueryCommonInput extends BuildQueryCommonInput {
  dataType: string;
  valueType: ChartDataValueTypes;
  requestedTimeInterval?: TimeIntervals;
  topResultsLimit?: number;
}

export function buildLatestEventInsightQuery(
  input: BuildQueryCommonInput,
): Extract<NormalizedInsightQuery, { resultKind: 'latest_event' }> {
  return {
    resultKind: 'latest_event',
    categoryType: ChartDataCategoryTypes.DateType,
    activityTypeGroups: input.activityTypeGroups,
    activityTypes: input.activityTypes,
    dateRange: input.dateRange,
    requestedDateRanges: input.requestedDateRanges,
    periodMode: input.periodMode,
    chartType: input.chartType,
  };
}

export function buildEventLookupInsightQuery(
  input: BuildMetricQueryCommonInput,
): Extract<NormalizedInsightQuery, { resultKind: 'event_lookup' }> {
  return {
    resultKind: 'event_lookup',
    dataType: input.dataType,
    valueType: input.valueType,
    categoryType: ChartDataCategoryTypes.DateType,
    requestedTimeInterval: input.requestedTimeInterval,
    activityTypeGroups: input.activityTypeGroups,
    activityTypes: input.activityTypes,
    dateRange: input.dateRange,
    requestedDateRanges: input.requestedDateRanges,
    periodMode: input.periodMode,
    chartType: input.chartType,
    ...(input.topResultsLimit !== undefined ? { topResultsLimit: input.topResultsLimit } : {}),
  };
}

interface BuildAggregateQueryInput extends BuildMetricQueryCommonInput {
  categoryType: ChartDataCategoryTypes;
}

export function buildAggregateInsightQuery(
  input: BuildAggregateQueryInput,
): Extract<NormalizedInsightQuery, { resultKind: 'aggregate' }> {
  return {
    resultKind: 'aggregate',
    dataType: input.dataType,
    valueType: input.valueType,
    categoryType: input.categoryType,
    requestedTimeInterval: input.requestedTimeInterval,
    activityTypeGroups: input.activityTypeGroups,
    activityTypes: input.activityTypes,
    dateRange: input.dateRange,
    requestedDateRanges: input.requestedDateRanges,
    periodMode: input.periodMode,
    chartType: input.chartType,
    ...(input.topResultsLimit !== undefined ? { topResultsLimit: input.topResultsLimit } : {}),
  };
}

interface BuildMultiMetricQueryInput extends BuildQueryCommonInput {
  groupingMode: Extract<NormalizedInsightQuery, { resultKind: 'multi_metric_aggregate' }>['groupingMode'];
  requestedTimeInterval?: TimeIntervals;
  metricSelections: NormalizedInsightMetricSelection[];
}

export function buildMultiMetricInsightQuery(
  input: BuildMultiMetricQueryInput,
): Extract<NormalizedInsightQuery, { resultKind: 'multi_metric_aggregate' }> {
  return {
    resultKind: 'multi_metric_aggregate',
    groupingMode: input.groupingMode,
    categoryType: ChartDataCategoryTypes.DateType,
    requestedTimeInterval: input.requestedTimeInterval,
    activityTypeGroups: input.activityTypeGroups,
    activityTypes: input.activityTypes,
    dateRange: input.dateRange,
    requestedDateRanges: input.requestedDateRanges,
    periodMode: input.periodMode,
    chartType: input.chartType,
    metricSelections: input.metricSelections,
  };
}

interface BuildPowerCurveQueryInput extends BuildQueryCommonInput {
  mode: AiInsightsPowerCurveMode;
  requestedTimeInterval?: TimeIntervals;
  defaultedToCycling: boolean;
}

export function buildPowerCurveInsightQuery(
  input: BuildPowerCurveQueryInput,
): Extract<NormalizedInsightQuery, { resultKind: 'power_curve' }> {
  return {
    resultKind: 'power_curve',
    mode: input.mode,
    categoryType: ChartDataCategoryTypes.DateType,
    requestedTimeInterval: input.requestedTimeInterval,
    activityTypeGroups: input.activityTypeGroups,
    activityTypes: input.activityTypes,
    dateRange: input.dateRange,
    requestedDateRanges: input.requestedDateRanges,
    periodMode: input.periodMode,
    chartType: input.chartType,
    defaultedToCycling: input.defaultedToCycling,
  };
}
