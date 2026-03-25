import {
  type ActivityTypeGroup,
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import type { EventStatAggregationResult } from './event-stat-aggregation.types';
import type { AiInsightsPromptMetricKey } from './ai-insights-prompts';

export interface AiInsightsRequest {
  prompt: string;
  clientTimezone: string;
  clientLocale?: string;
}

export interface NormalizedInsightBoundedDateRange {
  kind: 'bounded';
  startDate: string;
  endDate: string;
  timezone: string;
  source: 'prompt' | 'default';
}

export interface NormalizedInsightAllTimeDateRange {
  kind: 'all_time';
  timezone: string;
  source: 'prompt';
}

export type NormalizedInsightDateRange =
  | NormalizedInsightBoundedDateRange
  | NormalizedInsightAllTimeDateRange;

export type AiInsightsResultKind =
  | 'aggregate'
  | 'event_lookup'
  | 'latest_event'
  | 'multi_metric_aggregate'
  | 'power_curve';

export type AiInsightsPowerCurveMode =
  | 'best'
  | 'compare_over_time';

export type AiInsightsMultiMetricGroupingMode =
  | 'overall'
  | 'date';

export type NormalizedInsightPeriodMode =
  | 'combined'
  | 'compare';

export interface NormalizedInsightQueryBase {
  resultKind: AiInsightsResultKind;
  categoryType: ChartDataCategoryTypes;
  requestedTimeInterval?: TimeIntervals;
  activityTypeGroups: ActivityTypeGroup[];
  activityTypes: ActivityTypes[];
  dateRange: NormalizedInsightDateRange;
  requestedDateRanges?: NormalizedInsightBoundedDateRange[];
  periodMode?: NormalizedInsightPeriodMode;
  chartType: ChartTypes;
}

export interface NormalizedInsightAggregateQuery extends NormalizedInsightQueryBase {
  resultKind: 'aggregate';
  dataType: string;
  valueType: ChartDataValueTypes;
  topResultsLimit?: number;
}

export interface NormalizedInsightEventLookupQuery extends NormalizedInsightQueryBase {
  resultKind: 'event_lookup';
  dataType: string;
  valueType: ChartDataValueTypes;
  categoryType: ChartDataCategoryTypes.DateType;
  topResultsLimit?: number;
}

export interface NormalizedInsightLatestEventQuery extends NormalizedInsightQueryBase {
  resultKind: 'latest_event';
  categoryType: ChartDataCategoryTypes.DateType;
}

export interface NormalizedInsightMetricSelection {
  metricKey: AiInsightsPromptMetricKey;
  dataType: string;
  valueType: ChartDataValueTypes;
}

export interface NormalizedInsightMultiMetricAggregateQuery extends NormalizedInsightQueryBase {
  resultKind: 'multi_metric_aggregate';
  groupingMode: AiInsightsMultiMetricGroupingMode;
  categoryType: ChartDataCategoryTypes.DateType;
  metricSelections: NormalizedInsightMetricSelection[];
}

export interface NormalizedInsightPowerCurveQuery extends NormalizedInsightQueryBase {
  resultKind: 'power_curve';
  mode: AiInsightsPowerCurveMode;
  categoryType: ChartDataCategoryTypes.DateType;
  defaultedToCycling: boolean;
}

export type NormalizedInsightQuery =
  | NormalizedInsightAggregateQuery
  | NormalizedInsightEventLookupQuery
  | NormalizedInsightLatestEventQuery
  | NormalizedInsightMultiMetricAggregateQuery
  | NormalizedInsightPowerCurveQuery;

export type AiInsightsQuotaPeriodKind =
  | 'subscription'
  | 'grace_hold'
  | 'no_billing_period';

export type AiInsightsQuotaResetMode =
  | 'date'
  | 'next_successful_payment';

export type AiInsightsQuotaBlockedReason =
  | 'requires_pro'
  | 'limit_reached'
  | null;

export interface AiInsightsQuotaStatus {
  role: 'free' | 'basic' | 'pro';
  limit: number;
  successfulRequestCount: number;
  activeRequestCount: number;
  remainingCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  periodKind: AiInsightsQuotaPeriodKind;
  resetMode: AiInsightsQuotaResetMode;
  isEligible: boolean;
  blockedReason: AiInsightsQuotaBlockedReason;
}

export type AiInsightsQuotaStatusRequest = Record<string, never>;

export type AiInsightsQuotaStatusResponse = AiInsightsQuotaStatus;

export interface AiInsightPresentation {
  title: string;
  chartType: ChartTypes;
  emptyState?: string;
  warnings?: string[];
}

export interface AiInsightSummaryBucket {
  bucketKey: string | number;
  time?: number;
  aggregateValue: number;
  totalCount: number;
}

export interface AiInsightSummaryActivityTypeCount {
  activityType: string;
  eventCount: number;
}

export interface AiInsightSummaryActivityMix {
  topActivityTypes: AiInsightSummaryActivityTypeCount[];
  remainingActivityTypeCount: number;
}

export interface AiInsightSummaryCoverage {
  nonEmptyBucketCount: number;
  totalBucketCount: number;
}

export interface AiInsightSummaryTrend {
  previousBucket: AiInsightSummaryBucket;
  deltaAggregateValue: number;
}

export type AiInsightSummaryDeltaDirection =
  | 'increase'
  | 'decrease'
  | 'no_change';

export interface AiInsightSummaryPeriodDeltaContributor {
  seriesKey: string;
  deltaAggregateValue: number;
  direction: AiInsightSummaryDeltaDirection;
}

export interface AiInsightSummaryPeriodDelta {
  fromBucket: AiInsightSummaryBucket;
  toBucket: AiInsightSummaryBucket;
  deltaAggregateValue: number;
  direction: AiInsightSummaryDeltaDirection;
  contributors: AiInsightSummaryPeriodDeltaContributor[];
}

export interface AiInsightSummary {
  matchedEventCount: number;
  overallAggregateValue: number | null;
  peakBucket: AiInsightSummaryBucket | null;
  lowestBucket: AiInsightSummaryBucket | null;
  latestBucket: AiInsightSummaryBucket | null;
  activityMix: AiInsightSummaryActivityMix | null;
  bucketCoverage: AiInsightSummaryCoverage | null;
  trend: AiInsightSummaryTrend | null;
  periodDeltas?: AiInsightSummaryPeriodDelta[] | null;
}

export interface AiInsightEventLookup {
  primaryEventId: string;
  topEventIds: string[];
  matchedEventCount: number;
}

export interface AiInsightLatestEvent {
  eventId: string;
  startDate: string;
  matchedEventCount: number;
}

export interface AiInsightPowerCurvePoint {
  duration: number;
  power: number;
  wattsPerKg?: number;
}

export interface AiInsightPowerCurveSeries {
  seriesKey: string;
  label: string;
  matchedEventCount: number;
  bucketStartDate: string | null;
  bucketEndDate: string | null;
  points: AiInsightPowerCurvePoint[];
}

export interface AiInsightPowerCurve {
  mode: AiInsightsPowerCurveMode;
  resolvedTimeInterval: TimeIntervals;
  matchedEventCount: number;
  requestedSeriesCount: number;
  returnedSeriesCount: number;
  safetyGuardApplied: boolean;
  safetyGuardMaxSeries: number | null;
  trimmedSeriesCount: number;
  series: AiInsightPowerCurveSeries[];
}

export type AiInsightsUnsupportedReasonCode =
  | 'invalid_prompt'
  | 'unsupported_metric'
  | 'ambiguous_metric'
  | 'unsupported_capability'
  | 'too_many_metrics'
  | 'unsupported_multi_metric_combination';

export interface AiInsightsAggregateOkResponse {
  status: 'ok';
  resultKind: 'aggregate';
  narrative: string;
  quota?: AiInsightsQuotaStatus;
  query: NormalizedInsightQuery & {
    resultKind: 'aggregate';
  };
  aggregation: EventStatAggregationResult;
  summary: AiInsightSummary;
  deterministicCompareSummary?: string;
  eventRanking?: AiInsightEventLookup;
  presentation: AiInsightPresentation;
}

export interface AiInsightsEventLookupOkResponse {
  status: 'ok';
  resultKind: 'event_lookup';
  narrative: string;
  quota?: AiInsightsQuotaStatus;
  query: NormalizedInsightEventLookupQuery;
  eventLookup: AiInsightEventLookup;
  presentation: AiInsightPresentation;
}

export interface AiInsightsLatestEventOkResponse {
  status: 'ok';
  resultKind: 'latest_event';
  narrative: string;
  quota?: AiInsightsQuotaStatus;
  query: NormalizedInsightLatestEventQuery;
  latestEvent: AiInsightLatestEvent;
  presentation: AiInsightPresentation;
}

export interface AiInsightsMultiMetricAggregateMetricResult {
  metricKey: AiInsightsPromptMetricKey;
  metricLabel: string;
  query: NormalizedInsightAggregateQuery;
  aggregation: EventStatAggregationResult;
  summary: AiInsightSummary;
  presentation: AiInsightPresentation;
}

export interface AiInsightsMultiMetricAggregateOkResponse {
  status: 'ok';
  resultKind: 'multi_metric_aggregate';
  narrative: string;
  quota?: AiInsightsQuotaStatus;
  query: NormalizedInsightMultiMetricAggregateQuery;
  metricResults: AiInsightsMultiMetricAggregateMetricResult[];
  presentation: AiInsightPresentation;
}

export interface AiInsightsPowerCurveOkResponse {
  status: 'ok';
  resultKind: 'power_curve';
  narrative: string;
  quota?: AiInsightsQuotaStatus;
  query: NormalizedInsightPowerCurveQuery;
  powerCurve: AiInsightPowerCurve;
  presentation: AiInsightPresentation;
}

export type AiInsightsOkResponse =
  | AiInsightsAggregateOkResponse
  | AiInsightsEventLookupOkResponse
  | AiInsightsLatestEventOkResponse
  | AiInsightsMultiMetricAggregateOkResponse
  | AiInsightsPowerCurveOkResponse;

export interface AiInsightsEmptyResponse {
  status: 'empty';
  narrative: string;
  quota?: AiInsightsQuotaStatus;
  query: NormalizedInsightQuery;
  aggregation: EventStatAggregationResult;
  summary: AiInsightSummary;
  presentation: AiInsightPresentation & {
    emptyState: string;
  };
}

export interface AiInsightsUnsupportedResponse {
  status: 'unsupported';
  narrative: string;
  quota?: AiInsightsQuotaStatus;
  reasonCode: AiInsightsUnsupportedReasonCode;
  suggestedPrompts: string[];
}

export type AiInsightsResponse =
  | AiInsightsOkResponse
  | AiInsightsEmptyResponse
  | AiInsightsUnsupportedResponse;

export interface AiInsightsLatestSnapshot {
  version: number;
  savedAt: string;
  prompt: string;
  response: AiInsightsResponse;
}
