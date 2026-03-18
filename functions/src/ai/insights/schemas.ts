import { z } from 'genkit';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import type { AiInsightSummary, NormalizedInsightQuery } from '../../../../shared/ai-insights.types';
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

export const NormalizedInsightDateRangeSchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  timezone: z.string().min(1),
});

export const NormalizedInsightQuerySchema: z.ZodType<NormalizedInsightQuery> = z.object({
  dataType: z.string().min(1),
  valueType: z.nativeEnum(ChartDataValueTypes),
  categoryType: z.nativeEnum(ChartDataCategoryTypes),
  requestedTimeInterval: z.nativeEnum(TimeIntervals).optional(),
  activityTypes: z.array(
    CanonicalActivityTypeSchema as unknown as z.ZodType<ActivityTypes>
  ),
  dateRange: NormalizedInsightDateRangeSchema,
  chartType: z.nativeEnum(ChartTypes),
});

export const EventStatAggregationBucketSchema = z.object({
  bucketKey: z.union([z.string(), z.number()]),
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

export const AiInsightSummaryBucketSchema = z.object({
  bucketKey: z.union([z.string(), z.number()]),
  time: z.number().optional(),
  aggregateValue: z.number(),
  totalCount: z.number().int().nonnegative(),
});

export const AiInsightSummarySchema: z.ZodType<AiInsightSummary> = z.object({
  matchedEventCount: z.number().int().nonnegative(),
  overallAggregateValue: z.number().nullable(),
  peakBucket: AiInsightSummaryBucketSchema.nullable(),
  lowestBucket: AiInsightSummaryBucketSchema.nullable(),
  latestBucket: AiInsightSummaryBucketSchema.nullable(),
});

export const AiInsightsUnsupportedReasonCodeSchema = z.enum([
  'invalid_prompt',
  'unsupported_metric',
  'ambiguous_metric',
  'unsupported_capability',
]);

export const AiInsightsResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    narrative: z.string().min(1),
    query: NormalizedInsightQuerySchema,
    aggregation: EventStatAggregationResultSchema,
    summary: AiInsightSummarySchema,
    presentation: AiInsightPresentationSchema,
  }),
  z.object({
    status: z.literal('empty'),
    narrative: z.string().min(1),
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
    reasonCode: AiInsightsUnsupportedReasonCodeSchema,
    suggestedPrompts: z.array(z.string()),
  }),
]);
