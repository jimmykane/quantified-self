import {
  type ActivityTypeGroup,
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import type { EventStatAggregationResult } from './event-stat-aggregation.types';

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

export interface NormalizedInsightQuery {
  dataType: string;
  valueType: ChartDataValueTypes;
  categoryType: ChartDataCategoryTypes;
  requestedTimeInterval?: TimeIntervals;
  activityTypeGroups: ActivityTypeGroup[];
  activityTypes: ActivityTypes[];
  dateRange: NormalizedInsightDateRange;
  chartType: ChartTypes;
}

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

export interface AiInsightSummary {
  matchedEventCount: number;
  overallAggregateValue: number | null;
  peakBucket: AiInsightSummaryBucket | null;
  lowestBucket: AiInsightSummaryBucket | null;
  latestBucket: AiInsightSummaryBucket | null;
  activityMix: AiInsightSummaryActivityMix | null;
  bucketCoverage: AiInsightSummaryCoverage | null;
  trend: AiInsightSummaryTrend | null;
}

export type AiInsightsUnsupportedReasonCode =
  | 'invalid_prompt'
  | 'unsupported_metric'
  | 'ambiguous_metric'
  | 'unsupported_capability';

export interface AiInsightsOkResponse {
  status: 'ok';
  narrative: string;
  query: NormalizedInsightQuery;
  aggregation: EventStatAggregationResult;
  summary: AiInsightSummary;
  presentation: AiInsightPresentation;
}

export interface AiInsightsEmptyResponse {
  status: 'empty';
  narrative: string;
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
