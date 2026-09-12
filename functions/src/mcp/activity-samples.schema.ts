import { z } from 'zod';
import { MCP_ACTIVITY_CHART_METRICS } from './activity-stream.service';
import { MCP_ACTIVITY_SAMPLES_LIMITS as limits } from './activity-samples.service';

const offset = z.number().int().min(0).max(limits.maxOffsetSeconds);
const rowCount = z.number().int().min(0).max(limits.maxRows);
function seriesSchema(metric: typeof MCP_ACTIVITY_CHART_METRICS[number]) {
  return z.strictObject({
    metric: z.literal(metric.id), canonicalUnit: z.literal(metric.unit),
    sourceSampleCount: offset, missingSampleCount: rowCount,
    values: z.array(z.number().nullable()).max(limits.maxRows),
  });
}
const variants = MCP_ACTIVITY_CHART_METRICS.map(seriesSchema) as [ReturnType<typeof seriesSchema>, ...ReturnType<typeof seriesSchema>[]];
export const MCP_ACTIVITY_SAMPLES_SCHEMA = z.strictObject({
  activityType: z.string().min(1).max(120),
  sampling: z.literal('all_available'), timeUnit: z.literal('seconds'), sampleIntervalSeconds: z.literal(1),
  range: z.strictObject({startOffsetSeconds: offset, endOffsetSeconds: offset, totalSampleCount: offset}),
  page: z.strictObject({startOffsetSeconds: offset, endOffsetSeconds: offset, returnedSampleCount: rowCount}),
  elapsedTimeSeconds: z.array(offset).max(limits.maxRows),
  series: z.array(z.union(variants)).min(1).max(4),
  nextCursor: z.string().min(1).max(512).nullable(),
}).superRefine((value, context) => {
  const {range, page} = value;
  if (range.endOffsetSeconds < range.startOffsetSeconds || range.totalSampleCount !== range.endOffsetSeconds - range.startOffsetSeconds
    || page.startOffsetSeconds < range.startOffsetSeconds || page.endOffsetSeconds > range.endOffsetSeconds
    || page.endOffsetSeconds < page.startOffsetSeconds || page.returnedSampleCount !== page.endOffsetSeconds - page.startOffsetSeconds
    || (value.nextCursor !== null) !== (page.endOffsetSeconds < range.endOffsetSeconds)
    || (value.nextCursor !== null && page.returnedSampleCount === 0)
    || value.elapsedTimeSeconds.length !== page.returnedSampleCount
    || value.elapsedTimeSeconds.some((time, index) => time !== page.startOffsetSeconds + index)
    || new Set(value.series.map(series => series.metric)).size !== value.series.length
    || value.series.some(series => series.values.length !== page.returnedSampleCount
      || series.missingSampleCount !== series.values.filter(sample => sample === null).length
      || series.values.some((sample, index) => sample !== null && page.startOffsetSeconds + index >= series.sourceSampleCount))) {
    context.addIssue({code: 'custom', message: 'Activity sample ranges, counts, series, and continuation must align.'});
  }
});
