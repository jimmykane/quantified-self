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

export type AiInsightsResultKind =
  | 'aggregate'
  | 'event_lookup';

export interface NormalizedInsightQuery {
  resultKind: AiInsightsResultKind;
  dataType: string;
  valueType: ChartDataValueTypes;
  categoryType: ChartDataCategoryTypes;
  requestedTimeInterval?: TimeIntervals;
  activityTypeGroups: ActivityTypeGroup[];
  activityTypes: ActivityTypes[];
  dateRange: NormalizedInsightDateRange;
  chartType: ChartTypes;
}

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
  successfulGenkitCount: number;
  activeReservationCount: number;
  remainingCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  periodKind: AiInsightsQuotaPeriodKind;
  resetMode: AiInsightsQuotaResetMode;
  isEligible: boolean;
  blockedReason: AiInsightsQuotaBlockedReason;
}

export interface AiInsightsQuotaStatusRequest {
}

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

export interface AiInsightEventLookup {
  primaryEventId: string;
  topEventIds: string[];
  matchedEventCount: number;
}

export type AiInsightsUnsupportedReasonCode =
  | 'invalid_prompt'
  | 'unsupported_metric'
  | 'ambiguous_metric'
  | 'unsupported_capability';

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
  presentation: AiInsightPresentation;
}

export interface AiInsightsEventLookupOkResponse {
  status: 'ok';
  resultKind: 'event_lookup';
  narrative: string;
  quota?: AiInsightsQuotaStatus;
  query: NormalizedInsightQuery & {
    resultKind: 'event_lookup';
  };
  eventLookup: AiInsightEventLookup;
  presentation: AiInsightPresentation;
}

export type AiInsightsOkResponse =
  | AiInsightsAggregateOkResponse
  | AiInsightsEventLookupOkResponse;

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
