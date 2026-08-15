import type { AssistantMcpToolName } from './mcp-session';

/**
 * The public MCP metric tools deliberately accept at most 366 days per call.
 * The first-party Assistant may satisfy a broader history request by issuing
 * several of those same bounded calls and combining their schema-validated
 * results. This keeps the public contract and its per-call work budget intact.
 */
export const ASSISTANT_METRIC_QUERY_WINDOW_MS = 366 * 24 * 60 * 60 * 1_000;
const MAX_ASSISTANT_METRIC_QUERY_WINDOWS = 64;

type AssistantMetricValueType = 'Total' | 'Average' | 'Minimum' | 'Maximum';

interface AssistantMetricBucket {
  bucketKey: string | number;
  time?: number;
  totalCount: number;
  aggregateValue: number;
  seriesValues: Record<string, number>;
  seriesCounts: Record<string, number>;
}

interface AssistantMetricAggregation {
  dataType: string;
  valueType: AssistantMetricValueType;
  categoryType: string;
  resolvedTimeInterval: number;
  buckets: AssistantMetricBucket[];
}

interface AssistantMetricResult {
  metric: Record<string, unknown>;
  matchedEventCount: number;
  aggregation: AssistantMetricAggregation;
}

export class AssistantMetricHistoryQueryError extends Error {
  constructor() {
    super('The requested metric history exceeds the Assistant processing limit.');
    this.name = 'AssistantMetricHistoryQueryError';
  }
}

function isMetricQueryTool(
  name: AssistantMcpToolName,
): name is 'query_metric' | 'query_metrics' {
  return name === 'query_metric' || name === 'query_metrics';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asCount(value: unknown): number | null {
  const number = asFiniteNumber(value);
  return number !== null && Number.isSafeInteger(number) && number >= 0
    ? number
    : null;
}

function asNumberRecord(value: unknown, counts = false): Record<string, number> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const entries = Object.entries(record);
  if (entries.some(([, entryValue]) => (
    counts ? asCount(entryValue) === null : asFiniteNumber(entryValue) === null
  ))) {
    return null;
  }
  return Object.fromEntries(entries) as Record<string, number>;
}

function asMetricBucket(value: unknown): AssistantMetricBucket | null {
  const record = asRecord(value);
  if (!record || (typeof record.bucketKey !== 'string' && asFiniteNumber(record.bucketKey) === null)) {
    return null;
  }
  const time = record.time === undefined ? undefined : asFiniteNumber(record.time);
  const totalCount = asCount(record.totalCount);
  const aggregateValue = asFiniteNumber(record.aggregateValue);
  const seriesValues = asNumberRecord(record.seriesValues);
  const seriesCounts = asNumberRecord(record.seriesCounts, true);
  if (
    (record.time !== undefined && time === null)
    || totalCount === null
    || aggregateValue === null
    || seriesValues === null
    || seriesCounts === null
  ) {
    return null;
  }
  const normalizedTime = time === null ? undefined : time;
  return {
    bucketKey: record.bucketKey as string | number,
    ...(normalizedTime === undefined ? {} : { time: normalizedTime }),
    totalCount,
    aggregateValue,
    seriesValues,
    seriesCounts,
  };
}

function asAggregation(value: unknown): AssistantMetricAggregation | null {
  const record = asRecord(value);
  if (!record
    || typeof record.dataType !== 'string'
    || typeof record.categoryType !== 'string'
    || asFiniteNumber(record.resolvedTimeInterval) === null
    || !['Total', 'Average', 'Minimum', 'Maximum'].includes(String(record.valueType))
    || !Array.isArray(record.buckets)
  ) {
    return null;
  }
  const buckets = record.buckets.map(asMetricBucket);
  if (buckets.some(bucket => bucket === null)) {
    return null;
  }
  return {
    dataType: record.dataType,
    valueType: record.valueType as AssistantMetricValueType,
    categoryType: record.categoryType,
    resolvedTimeInterval: record.resolvedTimeInterval as number,
    buckets: buckets as AssistantMetricBucket[],
  };
}

function asMetricResult(value: unknown): AssistantMetricResult | null {
  const record = asRecord(value);
  const metric = asRecord(record?.metric);
  const matchedEventCount = asCount(record?.matchedEventCount);
  const aggregation = asAggregation(record?.aggregation);
  if (!metric || matchedEventCount === null || !aggregation) {
    return null;
  }
  return { metric, matchedEventCount, aggregation };
}

function mergeValue(
  valueType: AssistantMetricValueType,
  values: readonly { value: number; count: number }[],
): number {
  switch (valueType) {
    case 'Total':
      return values.reduce((sum, item) => sum + item.value, 0);
    case 'Average': {
      const count = values.reduce((sum, item) => sum + item.count, 0);
      return count === 0
        ? 0
        : values.reduce((sum, item) => sum + (item.value * item.count), 0) / count;
    }
    case 'Minimum':
      return Math.min(...values.map(item => item.value));
    case 'Maximum':
      return Math.max(...values.map(item => item.value));
  }
}

function bucketKey(bucket: AssistantMetricBucket): string {
  return `${typeof bucket.bucketKey}:${bucket.bucketKey}`;
}

function mergeBuckets(
  buckets: readonly AssistantMetricBucket[],
  valueType: AssistantMetricValueType,
): AssistantMetricBucket {
  const totalCount = buckets.reduce((sum, bucket) => sum + bucket.totalCount, 0);
  const seriesKeys = new Set(
    buckets.flatMap(bucket => Object.keys(bucket.seriesCounts)),
  );
  const seriesEntries = [...seriesKeys].flatMap((seriesKey) => {
    const values = buckets.flatMap(bucket => {
      const count = bucket.seriesCounts[seriesKey];
      const value = bucket.seriesValues[seriesKey];
      return count !== undefined && value !== undefined
        ? [{ value, count }]
        : [];
    });
    const count = values.reduce((sum, item) => sum + item.count, 0);
    return values.length > 0 && count > 0
      ? [[seriesKey, { count, value: mergeValue(valueType, values) }] as const]
      : [];
  });
  return {
    bucketKey: buckets[0].bucketKey,
    ...(buckets[0].time === undefined ? {} : { time: buckets[0].time }),
    totalCount,
    aggregateValue: mergeValue(valueType, buckets.map(bucket => ({
      value: bucket.aggregateValue,
      count: bucket.totalCount,
    }))),
    seriesValues: Object.fromEntries(
      seriesEntries.map(([seriesKey, value]) => [seriesKey, value.value]),
    ),
    seriesCounts: Object.fromEntries(
      seriesEntries.map(([seriesKey, value]) => [seriesKey, value.count]),
    ),
  };
}

function mergeMetricResults(results: readonly AssistantMetricResult[]): AssistantMetricResult {
  const first = results[0];
  const metricType = typeof first?.metric.type === 'string'
    ? first.metric.type
    : null;
  if (!first || results.some(result => (
    result.metric.type !== metricType
    || result.aggregation.dataType !== metricType
    || result.aggregation.dataType !== first.aggregation.dataType
    || result.aggregation.valueType !== first.aggregation.valueType
    || result.aggregation.categoryType !== first.aggregation.categoryType
    || result.aggregation.resolvedTimeInterval !== first.aggregation.resolvedTimeInterval
  ))) {
    throw new Error('The Assistant metric history responses could not be combined.');
  }
  const bucketsByKey = new Map<string, AssistantMetricBucket[]>();
  results.flatMap(result => result.aggregation.buckets).forEach((bucket) => {
    const key = bucketKey(bucket);
    const existing = bucketsByKey.get(key) || [];
    existing.push(bucket);
    bucketsByKey.set(key, existing);
  });
  const buckets = [...bucketsByKey.values()]
    .map(bucketsForKey => mergeBuckets(bucketsForKey, first.aggregation.valueType))
    .sort((left, right) => {
      if (first.aggregation.categoryType === 'Date') {
        return Number(left.time ?? 0) - Number(right.time ?? 0);
      }
      return `${left.bucketKey}`.localeCompare(`${right.bucketKey}`);
    });
  return {
    metric: first.metric,
    matchedEventCount: results.reduce((sum, result) => sum + result.matchedEventCount, 0),
    aggregation: {
      ...first.aggregation,
      buckets,
    },
  };
}

function parseMetricQueryResponse(
  name: 'query_metric' | 'query_metrics',
  value: Record<string, unknown>,
): AssistantMetricResult[] {
  if (name === 'query_metric') {
    const result = asMetricResult(value);
    if (!result) {
      throw new Error('The Assistant metric history response was invalid.');
    }
    return [result];
  }
  if (!Array.isArray(value.results)) {
    throw new Error('The Assistant metric history response was invalid.');
  }
  const results = value.results.map(asMetricResult);
  if (results.length === 0 || results.some(result => result === null)) {
    throw new Error('The Assistant metric history response was invalid.');
  }
  return results as AssistantMetricResult[];
}

/**
 * Returns the public-compatible slices for a long Assistant metric query.
 * A null result means no paging is needed (or the MCP server should surface
 * malformed date input through its normal validation path).
 */
export function splitAssistantMetricHistoryQuery(
  name: AssistantMcpToolName,
  args: Record<string, unknown>,
): Record<string, unknown>[] | null {
  if (!isMetricQueryTool(name) || typeof args.start !== 'string' || typeof args.end !== 'string') {
    return null;
  }
  const startTimeMs = Date.parse(args.start);
  const endTimeMs = Date.parse(args.end);
  if (!Number.isSafeInteger(startTimeMs)
    || !Number.isSafeInteger(endTimeMs)
    || startTimeMs >= endTimeMs
    || endTimeMs - startTimeMs <= ASSISTANT_METRIC_QUERY_WINDOW_MS
  ) {
    return null;
  }
  const pageCount = Math.floor(
    (endTimeMs - startTimeMs) / ASSISTANT_METRIC_QUERY_WINDOW_MS,
  ) + 1;
  if (pageCount > MAX_ASSISTANT_METRIC_QUERY_WINDOWS) {
    throw new AssistantMetricHistoryQueryError();
  }
  // The public tool defaults to daily. That is useful for short requests but
  // would create an unnecessarily large response when the model omits an
  // interval for a multi-year trend. Preserve every explicit resolution.
  const interval = args.interval === 'auto' || args.interval === undefined
    ? 'yearly'
    : args.interval;
  const pages: Record<string, unknown>[] = [];
  for (let pageStartTimeMs = startTimeMs; pageStartTimeMs <= endTimeMs;) {
    const pageEndTimeMs = Math.min(
      endTimeMs,
      pageStartTimeMs + ASSISTANT_METRIC_QUERY_WINDOW_MS,
    );
    pages.push({
      ...args,
      start: new Date(pageStartTimeMs).toISOString(),
      end: new Date(pageEndTimeMs).toISOString(),
      ...(interval === undefined ? {} : { interval }),
    });
    pageStartTimeMs = pageEndTimeMs + 1;
  }
  return pages;
}

/** Combines paged, public-schema metric responses into the same tool shape. */
export function mergeAssistantMetricHistoryResponses(
  name: AssistantMcpToolName,
  responses: readonly Record<string, unknown>[],
): Record<string, unknown> {
  if (!isMetricQueryTool(name) || responses.length === 0) {
    throw new Error('The Assistant metric history responses could not be combined.');
  }
  const parsed = responses.map(response => parseMetricQueryResponse(name, response));
  const resultCount = parsed[0]?.length ?? 0;
  if (resultCount === 0 || parsed.some(results => results.length !== resultCount)) {
    throw new Error('The Assistant metric history responses could not be combined.');
  }
  const results = Array.from({ length: resultCount }, (_, index) => (
    mergeMetricResults(parsed.map(page => page[index]))
  ));
  return name === 'query_metric'
    ? results[0] as unknown as Record<string, unknown>
    : { results } as unknown as Record<string, unknown>;
}
