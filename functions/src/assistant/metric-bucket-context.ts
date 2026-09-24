import { ChartDataCategoryTypes, TimeIntervals } from '@sports-alliance/sports-lib';

/** Add date labels for Gemini without changing the validated MCP metric result. */
type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue : null;
}

function labelBuckets(aggregation: unknown, formatter: Intl.DateTimeFormat): unknown {
  const record = asRecord(aggregation);
  if (!record || record.categoryType !== ChartDataCategoryTypes.DateType
    || record.resolvedTimeInterval !== TimeIntervals.Daily
    || !Array.isArray(record.buckets)) return aggregation;
  return { ...record, buckets: record.buckets.map(value => {
    const bucket = asRecord(value);
    if (!bucket || typeof bucket.bucketKey !== 'number' || !Number.isFinite(bucket.bucketKey)
      || Math.abs(bucket.bucketKey) > 8_640_000_000_000_000) return value;
    const parts = Object.fromEntries(formatter.formatToParts(bucket.bucketKey)
      .map(part => [part.type, part.value]));
    if (!parts.year || !parts.month || !parts.day || !parts.weekday) return value;
    return { ...bucket, localDate: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday };
  }) };
}

export function addAssistantMetricBucketCalendarContext(
  toolName: string,
  value: unknown,
  timeZone: string,
): unknown {
  if (toolName !== 'query_metric' && toolName !== 'query_metrics') return value;
  const record = asRecord(value);
  if (!record) return value;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
    });
  } catch {
    // MCP remains authoritative; a bad presentation zone must not discard its result.
    return value;
  }
  if (toolName === 'query_metric') {
    return { ...record, aggregation: labelBuckets(record.aggregation, formatter) };
  }
  if (!Array.isArray(record.results)) return value;
  return { ...record, results: record.results.map(result => {
    const item = asRecord(result);
    return item ? { ...item, aggregation: labelBuckets(item.aggregation, formatter) } : result;
  }) };
}
