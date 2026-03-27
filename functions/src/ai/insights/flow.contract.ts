import { z } from 'genkit';
import type {
  AiInsightsRequest,
  AiInsightsResponse,
} from '../../../../shared/ai-insights.types';
import { AiInsightsResponseSchema } from '../../../../shared/ai-insights-response.contract';

export const AiInsightsRequestSchema: z.ZodType<AiInsightsRequest> = z.object({
  prompt: z.string().min(1).max(2000),
  clientTimezone: z.string().min(1).max(100),
  clientLocale: z.string().min(1).max(100).optional(),
  locationFilter: z.object({
    locationText: z.string().min(1).max(200).optional(),
    radiusKm: z.number().min(1).max(500).optional(),
  }).optional(),
});

// Genkit's defineFlow is typed against its own Zod re-export. Keep the underlying strict shared
// schema, but expose a flattened Genkit-compatible boundary type for the flow.
export const AiInsightsFlowResponseSchema = AiInsightsResponseSchema as unknown as z.ZodType<AiInsightsResponse>;
