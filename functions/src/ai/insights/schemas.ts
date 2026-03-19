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
  AiInsightsQuotaStatus,
  AiInsightSummary,
  NormalizedInsightQuery,
} from '../../../../shared/ai-insights.types';
import { CANONICAL_ACTIVITY_TYPES } from './canonical-activity-types';

const CANONICAL_ACTIVITY_TYPE_SCHEMA_VALUES = (
  CANONICAL_ACTIVITY_TYPES.length > 0
    ? CANONICAL_ACTIVITY_TYPES
    : ['Unknown Sport']
) as [string, ...string[]];

export const CanonicalActivityTypeSchema = z.enum(CANONICAL_ACTIVITY_TYPE_SCHEMA_VALUES);

export const AiInsightsRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  clientTimezone: z.string().min(1).max(100),
  clientLocale: z.string().min(1).max(100).optional(),
});

export const NormalizedInsightDateRangeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('bounded'),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    timezone: z.string().min(1),
    source: z.enum(['prompt', 'default']),
  }),
  z.object({
    kind: z.literal('all_time'),
    timezone: z.string().min(1),
    source: z.literal('prompt'),
  }),
]);

export const NormalizedInsightQuerySchema: z.ZodType<NormalizedInsightQuery> = z.object({
  resultKind: z.enum(['aggregate', 'event_lookup']),
  dataType: z.string().min(1),
  valueType: z.nativeEnum(ChartDataValueTypes),
  categoryType: z.nativeEnum(ChartDataCategoryTypes),
  requestedTimeInterval: z.nativeEnum(TimeIntervals).optional(),
  activityTypeGroups: z.array(z.nativeEnum(ActivityTypeGroups)),
  activityTypes: z.array(
    CanonicalActivityTypeSchema as unknown as z.ZodType<ActivityTypes>
  ),
  dateRange: NormalizedInsightDateRangeSchema,
  chartType: z.nativeEnum(ChartTypes),
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
  successfulGenkitCount: z.number().int().nonnegative(),
  activeReservationCount: z.number().int().nonnegative(),
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

export const AiInsightsUnsupportedReasonCodeSchema = z.enum([
  'invalid_prompt',
  'unsupported_metric',
  'ambiguous_metric',
  'unsupported_capability',
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
