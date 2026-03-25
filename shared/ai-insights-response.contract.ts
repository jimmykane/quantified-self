import { z } from 'zod';
import {
  ActivityTypeGroups,
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import type { AiInsightsResponse } from './ai-insights.types';
import type { AiInsightsPromptMetricKey } from './ai-insights-prompts';
import {
  AI_INSIGHTS_TOP_RESULTS_MAX,
  AI_INSIGHTS_TOP_RESULTS_MIN,
} from './ai-insights-ranking.constants';
import {
  AI_INSIGHTS_POWER_CURVE_COMPARE_SERIES_SAFETY_MAX,
} from './ai-insights-power-curve.constants';
import {
  AI_INSIGHTS_COMPARE_EVENT_CONTRIBUTORS_MAX,
} from './ai-insights-compare.constants';

type UnknownRecord = Record<string, unknown>;

export type AiInsightsResponseValidationFailure = {
  reason: string;
  details?: UnknownRecord;
};

export type AiInsightsResponseValidationResult =
  | { ok: true; data: AiInsightsResponse }
  | { ok: false; reason: string; details?: UnknownRecord };

const AiInsightsPromptMetricKeySchema = z.string().min(1) as unknown as z.ZodType<AiInsightsPromptMetricKey>;
const ActivityTypeSchema = z.nativeEnum(ActivityTypes) as unknown as z.ZodType<ActivityTypes>;

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
  activityTypes: z.array(ActivityTypeSchema),
  dateRange: NormalizedInsightDateRangeSchema,
  requestedDateRanges: z.array(NormalizedInsightBoundedDateRangeSchema).max(12).optional(),
  periodMode: z.enum(['combined', 'compare']).optional(),
  chartType: z.nativeEnum(ChartTypes),
});

const TopResultsLimitSchema = z.number()
  .int()
  .min(AI_INSIGHTS_TOP_RESULTS_MIN)
  .max(AI_INSIGHTS_TOP_RESULTS_MAX);

export const NormalizedInsightMetricSelectionSchema = z.object({
  metricKey: AiInsightsPromptMetricKeySchema,
  dataType: z.string().min(1),
  valueType: z.nativeEnum(ChartDataValueTypes),
});

const NormalizedInsightPowerCurveModeSchema = z.enum(['best', 'compare_over_time']);

export const NormalizedInsightQuerySchema = z.discriminatedUnion('resultKind', [
  NormalizedInsightQueryBaseSchema.extend({
    resultKind: z.literal('aggregate'),
    dataType: z.string().min(1),
    valueType: z.nativeEnum(ChartDataValueTypes),
    topResultsLimit: TopResultsLimitSchema.optional(),
  }),
  NormalizedInsightQueryBaseSchema.extend({
    resultKind: z.literal('event_lookup'),
    dataType: z.string().min(1),
    valueType: z.nativeEnum(ChartDataValueTypes),
    categoryType: z.literal(ChartDataCategoryTypes.DateType),
    topResultsLimit: TopResultsLimitSchema.optional(),
  }),
  NormalizedInsightQueryBaseSchema.extend({
    resultKind: z.literal('latest_event'),
    categoryType: z.literal(ChartDataCategoryTypes.DateType),
  }),
  NormalizedInsightQueryBaseSchema.extend({
    resultKind: z.literal('multi_metric_aggregate'),
    groupingMode: z.enum(['overall', 'date']),
    categoryType: z.literal(ChartDataCategoryTypes.DateType),
    metricSelections: z.array(NormalizedInsightMetricSelectionSchema).min(2).max(3),
  }),
  NormalizedInsightQueryBaseSchema.extend({
    resultKind: z.literal('power_curve'),
    mode: NormalizedInsightPowerCurveModeSchema,
    categoryType: z.literal(ChartDataCategoryTypes.DateType),
    defaultedToCycling: z.boolean(),
  }),
]);

export const NormalizedInsightAggregateQuerySchema = NormalizedInsightQueryBaseSchema.extend({
  resultKind: z.literal('aggregate'),
  dataType: z.string().min(1),
  valueType: z.nativeEnum(ChartDataValueTypes),
  topResultsLimit: TopResultsLimitSchema.optional(),
});

export const NormalizedInsightEventLookupQuerySchema = NormalizedInsightQueryBaseSchema.extend({
  resultKind: z.literal('event_lookup'),
  dataType: z.string().min(1),
  valueType: z.nativeEnum(ChartDataValueTypes),
  categoryType: z.literal(ChartDataCategoryTypes.DateType),
  topResultsLimit: TopResultsLimitSchema.optional(),
});

export const NormalizedInsightMultiMetricAggregateQuerySchema = NormalizedInsightQueryBaseSchema.extend({
  resultKind: z.literal('multi_metric_aggregate'),
  groupingMode: z.enum(['overall', 'date']),
  categoryType: z.literal(ChartDataCategoryTypes.DateType),
  metricSelections: z.array(NormalizedInsightMetricSelectionSchema).min(2).max(3),
});

export const NormalizedInsightLatestEventQuerySchema = NormalizedInsightQueryBaseSchema.extend({
  resultKind: z.literal('latest_event'),
  categoryType: z.literal(ChartDataCategoryTypes.DateType),
});

export const NormalizedInsightPowerCurveQuerySchema = NormalizedInsightQueryBaseSchema.extend({
  resultKind: z.literal('power_curve'),
  mode: NormalizedInsightPowerCurveModeSchema,
  categoryType: z.literal(ChartDataCategoryTypes.DateType),
  defaultedToCycling: z.boolean(),
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

export const AiInsightsQuotaStatusSchema = z.object({
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

const AiInsightSummaryDeltaDirectionSchema = z.enum(['increase', 'decrease', 'no_change']);

const AiInsightSummaryPeriodDeltaContributorSchema = z.object({
  seriesKey: z.string().min(1),
  deltaAggregateValue: z.number(),
  direction: AiInsightSummaryDeltaDirectionSchema,
});

const AiInsightSummaryPeriodDeltaEventContributorSchema = z.object({
  eventId: z.string().min(1),
  startDate: z.string().datetime(),
  activityType: z.string().min(1),
  eventStatValue: z.number(),
  deltaContributionValue: z.number(),
  direction: AiInsightSummaryDeltaDirectionSchema,
});

const AiInsightSummaryPeriodDeltaSchema = z.object({
  fromBucket: AiInsightSummaryBucketSchema,
  toBucket: AiInsightSummaryBucketSchema,
  deltaAggregateValue: z.number(),
  direction: AiInsightSummaryDeltaDirectionSchema,
  contributors: z.array(AiInsightSummaryPeriodDeltaContributorSchema),
  eventContributors: z.array(AiInsightSummaryPeriodDeltaEventContributorSchema)
    .max(AI_INSIGHTS_COMPARE_EVENT_CONTRIBUTORS_MAX)
    .optional(),
});

export const AiInsightSummarySchema = z.object({
  matchedEventCount: z.number().int().nonnegative(),
  overallAggregateValue: z.number().nullable(),
  peakBucket: AiInsightSummaryBucketSchema.nullable(),
  lowestBucket: AiInsightSummaryBucketSchema.nullable(),
  latestBucket: AiInsightSummaryBucketSchema.nullable(),
  activityMix: AiInsightSummaryActivityMixSchema.nullable(),
  bucketCoverage: AiInsightSummaryCoverageSchema.nullable(),
  trend: AiInsightSummaryTrendSchema.nullable(),
  periodDeltas: z.array(AiInsightSummaryPeriodDeltaSchema).nullable().optional(),
});

export const AiInsightEventLookupSchema = z.object({
  primaryEventId: z.string().min(1),
  topEventIds: z.array(z.string().min(1)).max(AI_INSIGHTS_TOP_RESULTS_MAX),
  matchedEventCount: z.number().int().nonnegative(),
});

export const AiInsightLatestEventSchema = z.object({
  eventId: z.string().min(1),
  startDate: z.string().datetime(),
  matchedEventCount: z.number().int().nonnegative(),
});

export const AiInsightPowerCurvePointSchema = z.object({
  duration: z.number().positive(),
  power: z.number().finite(),
  wattsPerKg: z.number().finite().optional(),
});

export const AiInsightPowerCurveSeriesSchema = z.object({
  seriesKey: z.string().min(1),
  label: z.string().min(1),
  matchedEventCount: z.number().int().nonnegative(),
  bucketStartDate: z.string().datetime().nullable(),
  bucketEndDate: z.string().datetime().nullable(),
  points: z.array(AiInsightPowerCurvePointSchema),
});

export const AiInsightPowerCurveSchema = z.object({
  mode: NormalizedInsightPowerCurveModeSchema,
  resolvedTimeInterval: z.nativeEnum(TimeIntervals),
  matchedEventCount: z.number().int().nonnegative(),
  requestedSeriesCount: z.number().int().nonnegative(),
  returnedSeriesCount: z.number().int().nonnegative(),
  safetyGuardApplied: z.boolean(),
  safetyGuardMaxSeries: z.number().int().positive().nullable(),
  trimmedSeriesCount: z.number().int().nonnegative(),
  series: z.array(AiInsightPowerCurveSeriesSchema).max(AI_INSIGHTS_POWER_CURVE_COMPARE_SERIES_SAFETY_MAX),
});

export const AiInsightsMultiMetricAggregateMetricResultSchema = z.object({
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

const AiInsightsOkResponseBaseSchema = z.object({
  status: z.literal('ok'),
  narrative: z.string().min(1),
  quota: AiInsightsQuotaStatusSchema.optional(),
});

const AiInsightsAggregateOkResponseSchema = AiInsightsOkResponseBaseSchema.extend({
  resultKind: z.literal('aggregate'),
  query: NormalizedInsightAggregateQuerySchema,
  aggregation: EventStatAggregationResultSchema,
  summary: AiInsightSummarySchema,
  deterministicCompareSummary: z.string().min(1).optional(),
  eventRanking: AiInsightEventLookupSchema.optional(),
  presentation: AiInsightPresentationSchema,
});

const AiInsightsEventLookupOkResponseSchema = AiInsightsOkResponseBaseSchema.extend({
  resultKind: z.literal('event_lookup'),
  query: NormalizedInsightEventLookupQuerySchema,
  eventLookup: AiInsightEventLookupSchema,
  presentation: AiInsightPresentationSchema,
});

const AiInsightsLatestEventOkResponseSchema = AiInsightsOkResponseBaseSchema.extend({
  resultKind: z.literal('latest_event'),
  query: NormalizedInsightLatestEventQuerySchema,
  latestEvent: AiInsightLatestEventSchema,
  presentation: AiInsightPresentationSchema,
});

const AiInsightsMultiMetricAggregateOkResponseSchema = AiInsightsOkResponseBaseSchema.extend({
  resultKind: z.literal('multi_metric_aggregate'),
  query: NormalizedInsightMultiMetricAggregateQuerySchema,
  metricResults: z.array(AiInsightsMultiMetricAggregateMetricResultSchema).min(1).max(3),
  presentation: AiInsightPresentationSchema,
});

const AiInsightsPowerCurveOkResponseSchema = AiInsightsOkResponseBaseSchema.extend({
  resultKind: z.literal('power_curve'),
  query: NormalizedInsightPowerCurveQuerySchema,
  powerCurve: AiInsightPowerCurveSchema,
  presentation: AiInsightPresentationSchema,
});

const AiInsightsOkStrictSchema = z.discriminatedUnion('resultKind', [
  AiInsightsAggregateOkResponseSchema,
  AiInsightsEventLookupOkResponseSchema,
  AiInsightsLatestEventOkResponseSchema,
  AiInsightsMultiMetricAggregateOkResponseSchema,
  AiInsightsPowerCurveOkResponseSchema,
]);

const AiInsightsEmptyResponseSchema = z.object({
  status: z.literal('empty'),
  narrative: z.string().min(1),
  quota: AiInsightsQuotaStatusSchema.optional(),
  query: NormalizedInsightQuerySchema,
  aggregation: EventStatAggregationResultSchema,
  summary: AiInsightSummarySchema,
  presentation: AiInsightPresentationSchema.extend({
    emptyState: z.string().min(1),
  }),
});

const AiInsightsUnsupportedResponseSchema = z.object({
  status: z.literal('unsupported'),
  narrative: z.string().min(1),
  quota: AiInsightsQuotaStatusSchema.optional(),
  reasonCode: AiInsightsUnsupportedReasonCodeSchema,
  suggestedPrompts: z.array(z.string()),
});

export const AiInsightsResponseSchema = z.union([
  AiInsightsOkStrictSchema,
  AiInsightsEmptyResponseSchema,
  AiInsightsUnsupportedResponseSchema,
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeValueType(value: unknown): string {
  if (Array.isArray(value)) {
    return 'array';
  }

  if (value === null) {
    return 'null';
  }

  return typeof value;
}

function resolveResponseValidationReason(value: unknown, firstIssuePathKey: string | undefined): string {
  if (!isRecord(value)) {
    return 'not_object';
  }

  if (value.status !== 'ok' && value.status !== 'empty' && value.status !== 'unsupported') {
    return 'status_invalid';
  }

  if (value.status === 'unsupported') {
    return 'unsupported_shape_invalid';
  }

  if (firstIssuePathKey === 'query') {
    return 'query_invalid';
  }
  if (firstIssuePathKey === 'presentation') {
    return 'presentation_invalid';
  }
  if (firstIssuePathKey === 'quota') {
    return 'quota_invalid';
  }
  if (firstIssuePathKey === 'aggregation') {
    return 'aggregation_invalid';
  }
  if (firstIssuePathKey === 'summary') {
    return 'summary_invalid';
  }
  if (firstIssuePathKey === 'deterministicCompareSummary') {
    return 'deterministic_compare_summary_invalid';
  }
  if (firstIssuePathKey === 'eventLookup') {
    return 'event_lookup_invalid';
  }
  if (firstIssuePathKey === 'latestEvent') {
    return 'latest_event_invalid';
  }
  if (firstIssuePathKey === 'powerCurve') {
    return 'power_curve_invalid';
  }
  if (firstIssuePathKey === 'metricResults') {
    return 'metric_results_invalid';
  }
  if (firstIssuePathKey === 'narrative') {
    return 'narrative_invalid';
  }

  return 'shape_invalid';
}

function buildResponseValidationDetails(value: unknown, parsedError: z.ZodError): UnknownRecord {
  const firstIssue = parsedError.issues[0];
  const responseValue = isRecord(value) ? value : null;
  const queryValue = responseValue && isRecord(responseValue.query) ? responseValue.query : null;

  return {
    responseKeys: responseValue ? Object.keys(responseValue) : null,
    queryKeys: queryValue ? Object.keys(queryValue) : null,
    issueCode: firstIssue?.code ?? null,
    issuePath: firstIssue ? firstIssue.path.map(pathSegment => String(pathSegment)).join('.') : null,
    issueMessage: firstIssue?.message ?? null,
    resultKind: responseValue?.resultKind ?? null,
    resultKindType: describeValueType(responseValue?.resultKind),
    dataTypeType: describeValueType(queryValue?.dataType),
    valueTypeType: describeValueType(queryValue?.valueType),
    requestedTimeIntervalType: describeValueType(queryValue?.requestedTimeInterval),
    periodModeType: describeValueType(queryValue?.periodMode),
    chartTypeType: describeValueType(queryValue?.chartType),
  };
}

export function validateAiInsightsResponse(value: unknown): AiInsightsResponseValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      reason: 'not_object',
      details: {
        responseKeys: null,
        queryKeys: null,
      },
    };
  }

  if (value.status === 'ok') {
    const parsedOk = AiInsightsOkStrictSchema.safeParse(value);
    if (parsedOk.success) {
      return {
        ok: true,
        data: parsedOk.data as unknown as AiInsightsResponse,
      };
    }

    const firstIssuePathKey = parsedOk.error.issues[0]?.path?.[0];
    return {
      ok: false,
      reason: resolveResponseValidationReason(
        value,
        typeof firstIssuePathKey === 'string' ? firstIssuePathKey : undefined,
      ),
      details: buildResponseValidationDetails(value, parsedOk.error),
    };
  }

  if (value.status === 'empty') {
    const parsedEmpty = AiInsightsEmptyResponseSchema.safeParse(value);
    if (parsedEmpty.success) {
      return {
        ok: true,
        data: parsedEmpty.data as unknown as AiInsightsResponse,
      };
    }

    const firstIssuePathKey = parsedEmpty.error.issues[0]?.path?.[0];
    return {
      ok: false,
      reason: resolveResponseValidationReason(
        value,
        typeof firstIssuePathKey === 'string' ? firstIssuePathKey : undefined,
      ),
      details: buildResponseValidationDetails(value, parsedEmpty.error),
    };
  }

  if (value.status === 'unsupported') {
    const parsedUnsupported = AiInsightsUnsupportedResponseSchema.safeParse(value);
    if (parsedUnsupported.success) {
      return {
        ok: true,
        data: parsedUnsupported.data as unknown as AiInsightsResponse,
      };
    }

    const firstIssuePathKey = parsedUnsupported.error.issues[0]?.path?.[0];
    return {
      ok: false,
      reason: resolveResponseValidationReason(
        value,
        typeof firstIssuePathKey === 'string' ? firstIssuePathKey : undefined,
      ),
      details: buildResponseValidationDetails(value, parsedUnsupported.error),
    };
  }

  return {
    ok: false,
    reason: 'status_invalid',
    details: {
      responseKeys: Object.keys(value),
      queryKeys: isRecord(value.query) ? Object.keys(value.query) : null,
      issueCode: null,
      issuePath: null,
      issueMessage: null,
      resultKind: value.resultKind ?? null,
      resultKindType: describeValueType(value.resultKind),
      dataTypeType: describeValueType((value.query as UnknownRecord | undefined)?.dataType),
      valueTypeType: describeValueType((value.query as UnknownRecord | undefined)?.valueType),
      requestedTimeIntervalType: describeValueType((value.query as UnknownRecord | undefined)?.requestedTimeInterval),
      periodModeType: describeValueType((value.query as UnknownRecord | undefined)?.periodMode),
      chartTypeType: describeValueType((value.query as UnknownRecord | undefined)?.chartType),
    },
  };
}
