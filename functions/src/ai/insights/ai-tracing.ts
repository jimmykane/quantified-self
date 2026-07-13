import { SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('quantified-self-ai-insights');
const model = 'googleai/gemini-3.1-flash-lite';

export async function traceInsightModelCall<T>(
  stage: 'sanitize' | 'repair' | 'location' | 'summarize',
  generate: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    `ai-insights.${stage}`,
    {
      attributes: {
        'openinference.span.kind': 'LLM',
        'llm.provider': 'google',
        'llm.model_name': model,
        'ai.insights.stage': stage,
      },
    },
    async span => {
      try {
        const response = await generate();
        span.setStatus({ code: SpanStatusCode.OK });
        return response;
      } catch (error) {
        if (error instanceof Error) span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown AI error',
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
