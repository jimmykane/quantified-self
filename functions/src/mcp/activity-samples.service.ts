import { createHash } from 'node:crypto';
import type { OriginalFileMetaData } from '../../../shared/app-event.interface';
import {
  ActivityChartSourceContext, ActivityChartServiceDependencies, ActivityChartBudgetError,
  MCP_ACTIVITY_CHART_MAX_SELECTED_SAMPLES, finiteValue, resolveMetric, loadActivityStreamsFromSources, assertRuntime,
} from './activity-stream.service';
import { ActivitySampleCache, ActivitySampleCacheBusyError } from './activity-sample-cache';

export const MCP_ACTIVITY_SAMPLES_LIMITS = Object.freeze({
  defaultRows: 2_000, maxRows: 10_000, responseBytes: 256 * 1024,
  cursorTtlMs: 30 * 60_000, maxOffsetSeconds: MCP_ACTIVITY_CHART_MAX_SELECTED_SAMPLES,
});
export interface ActivitySamplesInput {
  uid: string;
  connectionId: string;
  scopes: readonly string[];
  activityRef: string;
  metrics: readonly string[];
  startOffsetSeconds?: number;
  /** Exclusive end. Omit to include the remainder of the available streams. */
  endOffsetSeconds?: number;
  limit?: number;
  cursor?: string;
}
export interface ActivitySampleDataset {
  readonly activityType: string;
  readonly length: number;
  readonly digest: string;
  readonly series: readonly {
    readonly metric: string; readonly canonicalUnit: string; readonly values: readonly (number | null)[];
  }[];
}
export interface ActivitySampleContext extends ActivityChartSourceContext { identityFingerprint: string }
export interface ActivitySamplesDependencies {
  activeOwner(uid: string): Promise<boolean>;
  context(uid: string, eventId: string, activityId: string, metrics: readonly string[]): Promise<ActivitySampleContext>;
  /** Validates approved paths and returns existing immutable object generations. */
  sourceVersions(uid: string, eventId: string, sources: readonly OriginalFileMetaData[]): Promise<OriginalFileMetaData[]>;
  loadSource(uid: string, eventId: string, source: OriginalFileMetaData, maximumBytes: number): Promise<Buffer>;
  consumeParse(uid: string, connectionId: string): Promise<void>;
  parseSource?: ActivityChartServiceDependencies['parseSource'];
  cache: ActivitySampleCache;
  now(): number;
}
export interface ActivitySamplesCodec {
  reference(value: string, uid: string, connectionId: string): {activityId: string; eventId: string};
  encode(value: Record<string, unknown>, uid: string, connectionId: string): string;
  decode(value: string, uid: string, connectionId: string): Record<string, unknown>;
}
export class ActivitySamplesError extends Error {
  constructor(readonly code: 'invalid_request' | 'detail_not_available' | 'query_too_large' | 'temporarily_unavailable', message: string) { super(message); }
}
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function invalid(message: string): never { throw new ActivitySamplesError('invalid_request', message); }
function offset(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MCP_ACTIVITY_SAMPLES_LIMITS.maxOffsetSeconds;
}
function normalize(input: ActivitySamplesInput) {
  if (typeof input.activityRef !== 'string' || !input.activityRef.length || input.activityRef.length > 512) invalid('The activity reference is invalid.');
  if (!input.scopes?.includes('activity-details:read')) invalid('Activity samples require activity-details:read.');
  if (!Array.isArray(input.metrics) || input.metrics.length < 1 || input.metrics.length > 4) invalid('Choose one to four activity sample metrics.');
  const metrics = [...new Set(input.metrics.map(value => {
    const metric = typeof value === 'string' && value.length <= 120 ? resolveMetric(value) : null;
    if (!metric) invalid('An activity sample metric is unsupported.');
    return metric.id;
  }))].sort();
  const start = input.startOffsetSeconds ?? 0;
  const end = input.endOffsetSeconds;
  const limit = input.limit ?? MCP_ACTIVITY_SAMPLES_LIMITS.defaultRows;
  if (!offset(start) || (end !== undefined && (!offset(end) || end <= start))) invalid('Use a valid start and exclusive end in elapsed seconds.');
  if (!Number.isInteger(limit) || limit < 1 || limit > MCP_ACTIVITY_SAMPLES_LIMITS.maxRows) invalid('The activity sample page limit is invalid.');
  if (input.cursor !== undefined && (typeof input.cursor !== 'string' || !input.cursor.length || input.cursor.length > 512)) invalid('The activity sample cursor is invalid.');
  return { metrics, start, end, limit };
}

export async function buildActivitySampleDataset(
  context: ActivityChartSourceContext, metrics: readonly string[], dependencies: ActivityChartServiceDependencies,
): Promise<ActivitySampleDataset> {
  const parsed = await loadActivityStreamsFromSources(context, {metrics, xAxis: 'elapsed_time'}, dependencies);
  const series = parsed.metrics.map(metric => {
    const stream = parsed.activity.getAllStreams().find(candidate => candidate.type === metric.streamType);
    const values = Array.from(stream?.getData() || [], finiteValue);
    return Object.freeze({metric: metric.id, canonicalUnit: metric.unit, values: Object.freeze(values)});
  });
  const length = Math.max(0, ...series.map(row => row.values.length));
  const activityType = String(parsed.activity.type);
  const dataset = Object.freeze({activityType, length, series: Object.freeze(series), digest: hash([activityType, length, series])});
  assertRuntime(parsed.startedAtMs, parsed.now);
  return dataset;
}

export function activitySampleResultBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify({content: [{type: 'text', text: JSON.stringify(value)}], structuredContent: value}), 'utf8') + 1024;
}

interface Continuation { q: string; s: string; d: string; n: number; e: number }
function readCursor(input: ActivitySamplesInput, query: string, codec: ActivitySamplesCodec, now: number): Continuation | null {
  if (!input.cursor) return null;
  const value = codec.decode(input.cursor, input.uid, input.connectionId);
  if (Object.keys(value).sort().join(',') !== 'd,e,n,q,s' || value.q !== query
    || typeof value.s !== 'string' || !/^[a-f0-9]{64}$/.test(value.s)
    || typeof value.d !== 'string' || !/^[a-f0-9]{64}$/.test(value.d)
    || !offset(value.n) || !Number.isSafeInteger(value.e) || (value.e as number) <= now
    || (value.e as number) > now + MCP_ACTIVITY_SAMPLES_LIMITS.cursorTtlMs) invalid('The activity sample cursor expired or does not match this request. Restart the requested range.');
  return value as unknown as Continuation;
}

async function readSourceState(input: ActivitySamplesInput, reference: {eventId: string; activityId: string}, metrics: readonly string[], deps: ActivitySamplesDependencies) {
  const context = await deps.context(input.uid, reference.eventId, reference.activityId, metrics);
  const sources = await deps.sourceVersions(input.uid, reference.eventId, context.sourceFiles);
  if (sources.length !== context.sourceFiles.length || !sources.length
    || sources.some((source, index) => !source.generation || !/^\d{1,40}$/.test(source.generation)
      || source.path !== context.sourceFiles[index].path || source.bucket !== context.sourceFiles[index].bucket)) {
    throw new ActivitySamplesError('detail_not_available', 'The original activity revision is unavailable.');
  }
  return {context: {...context, sourceFiles: sources}, fingerprint: hash([context.identityFingerprint,
    sources.map(source => [source.bucket || null, source.path, source.generation])])};
}

/** Same grants and source loader as charts; full selected streams never reach a chart projection. */
export async function queryActivitySamples(input: ActivitySamplesInput, deps: ActivitySamplesDependencies, codec: ActivitySamplesCodec) {
  const request = normalize(input);
  const reference = codec.reference(input.activityRef, input.uid, input.connectionId);
  const queryKey = hash([reference.eventId, reference.activityId, request]);
  const now = deps.now();
  const continuation = readCursor(input, queryKey, codec, now);
  const assertOwner = async () => {
    if (!await deps.activeOwner(input.uid)) throw new ActivitySamplesError('detail_not_available', 'The activity is unavailable.');
  };
  await assertOwner();
  const source = await readSourceState(input, reference, request.metrics, deps);
  if (continuation && continuation.s !== source.fingerprint) invalid('The activity source changed. Restart the requested range.');
  const cacheKey = hash([input.uid, input.connectionId, reference.eventId, reference.activityId, request.metrics, source.fingerprint]);
  let dataset: ActivitySampleDataset;
  try {
    dataset = await deps.cache.load(cacheKey, async () => {
      await deps.consumeParse(input.uid, input.connectionId);
      const data = await buildActivitySampleDataset(source.context, request.metrics, {
        loadSource: (file, maximum) => deps.loadSource(input.uid, reference.eventId, file, maximum),
        parseSource: deps.parseSource, now: deps.now,
      });
      await assertOwner();
      return data;
    });
  } catch (error) {
    if (error instanceof ActivityChartBudgetError) throw new ActivitySamplesError('query_too_large', 'The activity exceeds the source processing limits.');
    if (error instanceof ActivitySampleCacheBusyError) throw new ActivitySamplesError('temporarily_unavailable', error.message);
    throw error;
  }
  if (continuation && continuation.d !== dataset.digest) invalid('The activity sample data changed. Restart the requested range.');
  const start = Math.min(request.start, dataset.length);
  const end = Math.min(request.end ?? dataset.length, dataset.length);
  const pageStart = continuation?.n ?? start;
  if (pageStart < start || pageStart > end || (continuation && pageStart === end)) invalid('The activity sample cursor is outside this range.');
  const expires = continuation?.e ?? now + MCP_ACTIVITY_SAMPLES_LIMITS.cursorTtlMs;
  let rows = Math.min(request.limit, end - pageStart);
  const makePage = () => {
    const pageEnd = pageStart + rows;
    const nextCursor = pageEnd < end ? codec.encode({q: queryKey, s: source.fingerprint, d: dataset.digest, n: pageEnd, e: expires}, input.uid, input.connectionId) : null;
    if (nextCursor && nextCursor.length > 512) throw new ActivitySamplesError('query_too_large', 'The activity sample continuation exceeds its size limit.');
    return {
      activityType: dataset.activityType, sampling: 'all_available' as const, timeUnit: 'seconds' as const, sampleIntervalSeconds: 1 as const,
      range: {startOffsetSeconds: start, endOffsetSeconds: end, totalSampleCount: end - start},
      page: {startOffsetSeconds: pageStart, endOffsetSeconds: pageEnd, returnedSampleCount: rows},
      elapsedTimeSeconds: Array.from({length: rows}, (_, index) => pageStart + index),
      series: dataset.series.map(series => {
        const values = Array.from({length: rows}, (_, index) => series.values[pageStart + index] ?? null);
        return {metric: series.metric, canonicalUnit: series.canonicalUnit, sourceSampleCount: series.values.length,
          missingSampleCount: values.filter(value => value === null).length, values};
      }),
      nextCursor,
    };
  };
  let result = makePage();
  while (activitySampleResultBytes(result) > MCP_ACTIVITY_SAMPLES_LIMITS.responseBytes) {
    if (rows <= 1) throw new ActivitySamplesError('query_too_large', 'The activity sample response exceeds its size limit.');
    rows = Math.max(1, Math.floor(rows / 2));
    result = makePage();
  }
  // Even a warm cache cannot bypass owner, event/activity, or Storage-revision checks.
  await assertOwner();
  const after = await readSourceState(input, reference, request.metrics, deps);
  if (after.fingerprint !== source.fingerprint) invalid('The activity source changed during the read. Restart the requested range.');
  await assertOwner();
  return result;
}
