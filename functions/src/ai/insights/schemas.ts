import { z } from 'zod/v3';
import {
  AiInsightsResponseSchema,
  AiInsightsUnsupportedReasonCodeSchema,
  AiInsightsQuotaStatusSchema,
  AiInsightEventLookupSchema,
  AiInsightLatestEventSchema,
  AiInsightPresentationSchema,
  AiInsightSummarySchema,
  AiInsightsMultiMetricAggregateMetricResultSchema,
  EventStatAggregationBucketSchema,
  EventStatAggregationResultSchema,
  NormalizedInsightAggregateQuerySchema,
  NormalizedInsightDateRangeSchema,
  NormalizedInsightEventLookupQuerySchema,
  NormalizedInsightLatestEventQuerySchema,
  NormalizedInsightMetricSelectionSchema,
  NormalizedInsightMultiMetricAggregateQuerySchema,
  NormalizedInsightQuerySchema,
} from '../../../../shared/ai-insights-response.contract';

export {
  AiInsightsResponseSchema,
  AiInsightsUnsupportedReasonCodeSchema,
  AiInsightsQuotaStatusSchema,
  AiInsightEventLookupSchema,
  AiInsightLatestEventSchema,
  AiInsightPresentationSchema,
  AiInsightSummarySchema,
  AiInsightsMultiMetricAggregateMetricResultSchema,
  EventStatAggregationBucketSchema,
  EventStatAggregationResultSchema,
  NormalizedInsightAggregateQuerySchema,
  NormalizedInsightDateRangeSchema,
  NormalizedInsightEventLookupQuerySchema,
  NormalizedInsightLatestEventQuerySchema,
  NormalizedInsightMetricSelectionSchema,
  NormalizedInsightMultiMetricAggregateQuerySchema,
  NormalizedInsightQuerySchema,
};

export const AiInsightsRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  clientTimezone: z.string().min(1).max(100),
  clientLocale: z.string().min(1).max(100).optional(),
});
