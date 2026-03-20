import { z } from 'genkit';
import {
  ActivityTypeGroups,
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import type {
  AiInsightEventLookup,
  AiInsightsMultiMetricAggregateMetricResult,
  AiInsightsQuotaStatus,
  AiInsightSummary,
  NormalizedInsightQuery,
} from '../../../../shared/ai-insights.types';
import type { AiInsightsPromptMetricKey } from '../../../../shared/ai-insights-prompts';
import { CANONICAL_ACTIVITY_TYPES } from './canonical-activity-types';

const CANONICAL_ACTIVITY_TYPE_SCHEMA_VALUES = (
  CANONICAL_ACTIVITY_TYPES.length > 0
    ? CANONICAL_ACTIVITY_TYPES
    : ['Unknown Sport']
) as [string, ...string[]];

export const CanonicalActivityTypeSchema = z.enum(CANONICAL_ACTIVITY_TYPE_SCHEMA_VALUES);
const AiInsightsPromptMetricKeySchema = z.string().min(1) as unknown as z.ZodType<AiInsightsPromptMetricKey>;

export const AiInsightsRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  clientTimezone: z.string().min(1).max(100),
  clientLocale: z.string().min(1).max(100).optional(),
});

const NormalizedInsightBoundedDateRangeSchema = z.object({
  kind: z.literal('bounded'),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  timezone: z.string().min(1),
  source: z.enum(['prompt', 'default']),
});

const NormalizedInsightAllTimeDateRangeSchema = z.object({
  kind: z.literal('all_time'),
  timezone: z.string().min(1),
  source: z.literal('prompt'),
});

export const NormalizedInsightDateRangeSchema = z.discriminatedUnion('kind', [
  NormalizedInsightBoundedDateRangeSchema,
  NormalizedInsightAllTimeDateRangeSchema,
]);

const NormalizedInsightQueryBaseSchema = z.object({
  categoryType: z.nativeEnum(ChartDataCategoryTypes),
  requestedTimeInterval: z.nativeEnum(TimeIntervals).optional(),
  activityTypeGroups: z.array(z.nativeEnum(ActivityTypeGroups)),
  activityTypes: z.array(
    CanonicalActivityTypeSchema as unknown as z.ZodType<ActivityTypes>
  ),
  dateRange: NormalizedInsightDateRangeSchema,
  requestedDateRanges: z.array(NormalizedInsightBoundedDateRangeSchema).max(12).optional(),
  periodMode: z.enum(['combined', 'compare']).optional(),
  chartType: z.nativeEnum(ChartTypes),
});

export const NormalizedInsightMetricSelectionSchema = z.object({
  metricKey: AiInsightsPromptMetricKeySchema,
  dataType: z.string().min(1),
  valueType: z.nativeEnum(ChartDataValueTypes),
});

export const NormalizedInsightQuerySchema: z.ZodType<NormalizedInsightQuery> = z.discriminatedUnion('resultKind', [
  NormalizedInsightQueryBaseSchema.extend({
    resultKind: z.literal('aggregate'),
    dataType: z.string().min(1),
    valueType: z.nativeEnum(ChartDataValueTypes),
  }),
  NormalizedInsightQueryBaseSchema.extend({
    resultKind: z.literal('event_lookup'),
    dataType: z.string().min(1),
    valueType: z.nativeEnum(ChartDataValueTypes),
    categoryType: z.literal(ChartDataCategoryTypes.DateType),
  }),
  NormalizedInsightQueryBaseSchema.extend({
    resultKind: z.literal('multi_metric_aggregate'),
    groupingMode: z.enum(['overall', 'date']),
    categoryType: z.literal(ChartDataCategoryTypes.DateType),
    metricSelections: z.array(NormalizedInsightMetricSelectionSchema).min(2).max(3),
  }),
]) as z.ZodType<NormalizedInsightQuery>;

export const NormalizedInsightAggregateQuerySchema = NormalizedInsightQueryBaseSchema.extend({
  resultKind: z.literal('aggregate'),
  dataType: z.string().min(1),
  valueType: z.nativeEnum(ChartDataValueTypes),
});

export const NormalizedInsightEventLookupQuerySchema = NormalizedInsightQueryBaseSchema.extend({
  resultKind: z.literal('event_lookup'),
  dataType: z.string().min(1),
  valueType: z.nativeEnum(ChartDataValueTypes),
  categoryType: z.literal(ChartDataCategoryTypes.DateType),
});

export const NormalizedInsightMultiMetricAggregateQuerySchema = NormalizedInsightQueryBaseSchema.extend({
  resultKind: z.literal('multi_metric_aggregate'),
  groupingMode: z.enum(['overall', 'date']),
  categoryType: z.literal(ChartDataCategoryTypes.DateType),
  metricSelections: z.array(NormalizedInsightMetricSelectionSchema).min(2).max(3),
});

const BucketKeySchema: z.ZodType<string | number> = z.custom<string | number>(
  (value): value is string | number => typeof value === 'string' || typeof value === 'number',
  { message: 'Expected bucketKey to be a string or number.' },
);

export const EventStatAggregationBucketSchema = z.object({
  bucketKey: BucketKeySchema,
  time: z.number().optional(),
  totalCount: z.number().int().nonnegative(),
  aggregateValue: z.number(),
  seriesValues: z.record(z.string(), z.number()),
  seriesCounts: z.record(z.string(), z.number().int().nonnegative()),
});

export const EventStatAggregationResultSchema = z.object({
  dataType: z.string().min(1),
  valueType: z.nativeEnum(ChartDataValueTypes),
  categoryType: z.nativeEnum(ChartDataCategoryTypes),
  resolvedTimeInterval: z.nativeEnum(TimeIntervals),
  buckets: z.array(EventStatAggregationBucketSchema),
});

export const AiInsightPresentationSchema = z.object({
  title: z.string().min(1),
  chartType: z.nativeEnum(ChartTypes),
  emptyState: z.string().optional(),
  warnings: z.array(z.string()).optional(),
});

export const AiInsightsQuotaStatusSchema: z.ZodType<AiInsightsQuotaStatus> = z.object({
  role: z.enum(['free', 'basic', 'pro']),
  limit: z.number().int().nonnegative(),
  successfulRequestCount: z.number().int().nonnegative(),
  activeRequestCount: z.number().int().nonnegative(),
  remainingCount: z.number().int().nonnegative(),
  periodStart: z.string().datetime().nullable(),
  periodEnd: z.string().datetime().nullable(),
  periodKind: z.enum(['subscription', 'grace_hold', 'no_billing_period']),
  resetMode: z.enum(['date', 'next_successful_payment']),
  isEligible: z.boolean(),
  blockedReason: z.enum(['requires_pro', 'limit_reached']).nullable(),
});

export const AiInsightSummaryBucketSchema = z.object({
  bucketKey: BucketKeySchema,
  time: z.number().optional(),
  aggregateValue: z.number(),
  totalCount: z.number().int().nonnegative(),
});

export const AiInsightSummaryActivityTypeCountSchema = z.object({
  activityType: z.string().min(1),
  eventCount: z.number().int().nonnegative(),
});

export const AiInsightSummaryActivityMixSchema = z.object({
  topActivityTypes: z.array(AiInsightSummaryActivityTypeCountSchema),
  remainingActivityTypeCount: z.number().int().nonnegative(),
});

export const AiInsightSummaryCoverageSchema = z.object({
  nonEmptyBucketCount: z.number().int().nonnegative(),
  totalBucketCount: z.number().int().nonnegative(),
});

export const AiInsightSummaryTrendSchema = z.object({
  previousBucket: AiInsightSummaryBucketSchema,
  deltaAggregateValue: z.number(),
});

export const AiInsightSummarySchema: z.ZodType<AiInsightSummary> = z.object({
  matchedEventCount: z.number().int().nonnegative(),
  overallAggregateValue: z.number().nullable(),
  peakBucket: AiInsightSummaryBucketSchema.nullable(),
  lowestBucket: AiInsightSummaryBucketSchema.nullable(),
  latestBucket: AiInsightSummaryBucketSchema.nullable(),
  activityMix: AiInsightSummaryActivityMixSchema.nullable(),
  bucketCoverage: AiInsightSummaryCoverageSchema.nullable(),
  trend: AiInsightSummaryTrendSchema.nullable(),
});

export const AiInsightEventLookupSchema: z.ZodType<AiInsightEventLookup> = z.object({
  primaryEventId: z.string().min(1),
  topEventIds: z.array(z.string().min(1)).max(10),
  matchedEventCount: z.number().int().nonnegative(),
});

export const AiInsightsMultiMetricAggregateMetricResultSchema: z.ZodType<AiInsightsMultiMetricAggregateMetricResult> = z.object({
  metricKey: AiInsightsPromptMetricKeySchema,
  metricLabel: z.string().min(1),
  query: NormalizedInsightAggregateQuerySchema,
  aggregation: EventStatAggregationResultSchema,
  summary: AiInsightSummarySchema,
  presentation: AiInsightPresentationSchema,
});

export const AiInsightsUnsupportedReasonCodeSchema = z.enum([
  'invalid_prompt',
  'unsupported_metric',
  'ambiguous_metric',
  'unsupported_capability',
  'too_many_metrics',
  'unsupported_multi_metric_combination',
]);

export const AiInsightsResponseSchema = z.union([
  z.object({
    status: z.literal('ok'),
    resultKind: z.literal('aggregate'),
    narrative: z.string().min(1),
    quota: AiInsightsQuotaStatusSchema.optional(),
    query: NormalizedInsightQuerySchema,
    aggregation: EventStatAggregationResultSchema,
    summary: AiInsightSummarySchema,
    eventRanking: AiInsightEventLookupSchema.optional(),
    presentation: AiInsightPresentationSchema,
  }),
  z.object({
    status: z.literal('ok'),
    resultKind: z.literal('event_lookup'),
    narrative: z.string().min(1),
    quota: AiInsightsQuotaStatusSchema.optional(),
    query: NormalizedInsightQuerySchema,
    eventLookup: AiInsightEventLookupSchema,
    presentation: AiInsightPresentationSchema,
  }),
  z.object({
    status: z.literal('ok'),
    resultKind: z.literal('multi_metric_aggregate'),
    narrative: z.string().min(1),
    quota: AiInsightsQuotaStatusSchema.optional(),
    query: NormalizedInsightQuerySchema,
    metricResults: z.array(AiInsightsMultiMetricAggregateMetricResultSchema).min(1).max(3),
    presentation: AiInsightPresentationSchema,
  }),
  z.object({
    status: z.literal('empty'),
    narrative: z.string().min(1),
    quota: AiInsightsQuotaStatusSchema.optional(),
    query: NormalizedInsightQuerySchema,
    aggregation: EventStatAggregationResultSchema,
    summary: AiInsightSummarySchema,
    presentation: AiInsightPresentationSchema.extend({
      emptyState: z.string().min(1),
    }),
  }),
  z.object({
    status: z.literal('unsupported'),
    narrative: z.string().min(1),
    quota: AiInsightsQuotaStatusSchema.optional(),
    reasonCode: AiInsightsUnsupportedReasonCodeSchema,
    suggestedPrompts: z.array(z.string()),
  }),
]);
