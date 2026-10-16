import { z } from 'zod';
import { MCP_ACTIVITY_STREAM_METRICS } from './activity-stream.service';

/** Compact, exact metric/unit pairs shared by the additive stream contracts. */
export function activityStreamSeriesSchema<T extends z.ZodRawShape>(shape: T) {
  const metrics = MCP_ACTIVITY_STREAM_METRICS;
  return z.strictObject({
    metric: z.enum(metrics.map(metric => metric.id) as [string, ...string[]]),
    canonicalUnit: z.enum([...new Set(metrics.map(metric => metric.unit))] as [string, ...string[]]),
    ...shape,
  }).superRefine((value, context) => {
    const pair = value as { metric?: unknown; canonicalUnit?: unknown };
    if (!metrics.some(metric => metric.id === pair.metric && metric.unit === pair.canonicalUnit)) {
      context.addIssue({ code: 'custom', path: ['canonicalUnit'], message: 'Unit must match the selected metric.' });
    }
  }).meta({
    anyOf: metrics.map(metric => ({ properties: {
      metric: { const: metric.id }, canonicalUnit: { const: metric.unit },
    } })),
  });
}
