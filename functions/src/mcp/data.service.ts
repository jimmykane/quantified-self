import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import {
  ActivityTypes,
  ActivityTypesHelper,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  EventImporterJSON,
  EventInterface,
  EventJSONInterface,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import {
  DERIVED_METRIC_KINDS,
  DERIVED_METRIC_SCHEMA_VERSION,
  DerivedMetricKind,
  isDerivedMetricKind,
} from '../../../shared/derived-metrics';
import {
  buildEventStatAggregation,
  isValidIanaTimeZone,
  resolveDateAggregationBucketStart,
} from '../../../shared/event-stat-aggregation';
import { isBenchmarkEventForTrainingMetrics } from '../../../shared/event-classification';
import {
  SLEEP_PROVIDERS,
  SLEEP_STAGES,
  SleepProvider,
  SleepStage,
  SleepVitals,
} from '../../../shared/sleep';
import {
  McpMetricDescriptor,
  resolveAvailableSportsLibMetrics,
  resolveSportsLibNumericMetric,
} from './metric-catalog';

const MAX_EVENT_QUERY_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
const MAX_EVENT_QUERY_DOCUMENTS = 2000;
const METRIC_DISCOVERY_EVENT_LIMIT = 500;
const MAX_SLEEP_QUERY_DOCUMENTS = 1000;
const MAX_SLEEP_PAGE_SIZE = 100;

export type McpDataErrorCode =
  | 'invalid_request'
  | 'invalid_metric'
  | 'invalid_timezone'
  | 'metric_not_ready'
  | 'query_too_large';

export class McpDataError extends Error {
  constructor(
    readonly code: McpDataErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'McpDataError';
  }
}

interface RawDocument {
  id: string;
  data: Record<string, unknown>;
}

interface SleepCursor {
  endTimeMs: number;
  id: string;
}

export interface McpDataServiceDependencies {
  fetchMetricDiscoveryDocuments: (
    uid: string,
    limit: number,
  ) => Promise<RawDocument[]>;
  fetchEventDocuments: (
    uid: string,
    startTimeMs: number,
    endTimeMs: number,
    limit: number,
  ) => Promise<RawDocument[]>;
  fetchDerivedSnapshot: (
    uid: string,
    metricKind: DerivedMetricKind,
  ) => Promise<Record<string, unknown> | null>;
  fetchSleepDocuments: (
    uid: string,
    startTimeMs: number,
    endTimeMs: number,
    limit: number,
    cursor?: SleepCursor,
  ) => Promise<RawDocument[]>;
  importEvent: (data: EventJSONInterface, id: string) => EventInterface;
}

const defaultDependencies: McpDataServiceDependencies = {
  fetchMetricDiscoveryDocuments: async (uid, limit) => {
    const snapshot = await admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('events')
      .orderBy('startDate', 'desc')
      .limit(limit)
      .select('stats')
      .get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    }));
  },
  fetchEventDocuments: async (uid, startTimeMs, endTimeMs, limit) => {
    const snapshot = await admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('events')
      .where('startDate', '>=', startTimeMs)
      .where('startDate', '<=', endTimeMs)
      .orderBy('startDate', 'asc')
      .limit(limit)
      .get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    }));
  },
  fetchDerivedSnapshot: async (uid, metricKind) => {
    const snapshot = await admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('derivedMetrics')
      .doc(metricKind)
      .get();
    return snapshot.exists ? snapshot.data() as Record<string, unknown> : null;
  },
  fetchSleepDocuments: async (uid, startTimeMs, endTimeMs, limit, cursor) => {
    let query = admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('sleepSessions')
      .where('endTimeMs', '>=', startTimeMs)
      .where('endTimeMs', '<=', endTimeMs)
      .orderBy('endTimeMs', 'desc')
      .orderBy(FieldPath.documentId(), 'desc')
      .limit(limit);
    if (cursor) {
      query = query.startAfter(cursor.endTimeMs, cursor.id);
    }
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    }));
  },
  importEvent: (data, id) => EventImporterJSON.getEventFromJSON(data).setID(id),
};

function asFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asNonNegativeNumber(value: unknown): number | null {
  const numeric = asFiniteNumber(value);
  return numeric !== null && numeric >= 0 ? numeric : null;
}

function validateBoundedRange(startTimeMs: number, endTimeMs: number): void {
  if (
    !Number.isFinite(startTimeMs)
    || !Number.isFinite(endTimeMs)
    || startTimeMs > endTimeMs
  ) {
    throw new McpDataError('invalid_request', 'A valid start and end time are required.');
  }
  if (endTimeMs - startTimeMs > MAX_EVENT_QUERY_RANGE_MS) {
    throw new McpDataError('query_too_large', 'The requested date range exceeds 366 days.');
  }
}

function requireTimeZone(timeZone: string): string {
  const normalized = `${timeZone || ''}`.trim();
  if (!isValidIanaTimeZone(normalized)) {
    throw new McpDataError('invalid_timezone', 'A valid IANA timezone is required.');
  }
  return normalized;
}

function encodeCursor(cursor: SleepCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): SleepCursor | undefined {
  if (!cursor) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<SleepCursor>;
    if (
      !Number.isFinite(parsed.endTimeMs)
      || typeof parsed.id !== 'string'
      || !parsed.id
    ) {
      throw new Error('invalid cursor');
    }
    return {
      endTimeMs: Number(parsed.endTimeMs),
      id: parsed.id,
    };
  } catch {
    throw new McpDataError('invalid_request', 'The pagination cursor is invalid.');
  }
}

function resolveValueType(aggregation: string): ChartDataValueTypes {
  switch (`${aggregation || ''}`.toLowerCase()) {
    case 'total':
      return ChartDataValueTypes.Total;
    case 'average':
      return ChartDataValueTypes.Average;
    case 'minimum':
      return ChartDataValueTypes.Minimum;
    case 'maximum':
      return ChartDataValueTypes.Maximum;
    default:
      throw new McpDataError('invalid_request', 'Unsupported aggregation.');
  }
}

function resolveCategoryType(groupBy: string): ChartDataCategoryTypes {
  switch (`${groupBy || ''}`.toLowerCase()) {
    case 'date':
      return ChartDataCategoryTypes.DateType;
    case 'activity_type':
      return ChartDataCategoryTypes.ActivityType;
    default:
      throw new McpDataError('invalid_request', 'Unsupported grouping.');
  }
}

function resolveTimeInterval(interval: string): TimeIntervals {
  const intervals: Record<string, TimeIntervals> = {
    auto: TimeIntervals.Auto,
    hourly: TimeIntervals.Hourly,
    daily: TimeIntervals.Daily,
    weekly: TimeIntervals.Weekly,
    biweekly: TimeIntervals.BiWeekly,
    monthly: TimeIntervals.Monthly,
    quarterly: TimeIntervals.Quarterly,
    semesterly: TimeIntervals.Semesterly,
    yearly: TimeIntervals.Yearly,
  };
  const resolved = intervals[`${interval || ''}`.toLowerCase()];
  if (resolved === undefined) {
    throw new McpDataError('invalid_request', 'Unsupported date interval.');
  }
  return resolved;
}

function resolveActivityTypes(activityTypes: readonly string[] | undefined): ActivityTypes[] {
  return (activityTypes || []).map((activityType) => {
    const resolved = ActivityTypesHelper.resolveActivityType(activityType);
    if (!resolved) {
      throw new McpDataError('invalid_request', `Unknown activity type: ${activityType}`);
    }
    return resolved;
  });
}

function eventMatchesActivityFilter(event: EventInterface, activityTypes: readonly ActivityTypes[]): boolean {
  if (!activityTypes.length) {
    return true;
  }
  const eventActivityTypes = event.getActivityTypesAsArray?.() || [];
  return activityTypes.some(activityType => eventActivityTypes.includes(activityType));
}

export interface ListMetricsInput {
  uid: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface ListMetricsResult {
  eventMetrics: McpMetricDescriptor[];
  nextCursor: string | null;
  scannedEventCount: number;
  eventScanTruncated: boolean;
  derivedMetricKinds: readonly DerivedMetricKind[];
  sleepCapabilities: {
    providers: readonly SleepProvider[];
    sessionSummaries: true;
    aggregateGroupings: readonly ['day', 'week', 'month'];
  };
}

export interface QueryMetricInput {
  uid: string;
  metric: string;
  startTimeMs: number;
  endTimeMs: number;
  aggregation: 'total' | 'average' | 'minimum' | 'maximum';
  groupBy: 'date' | 'activity_type';
  interval: 'auto' | 'hourly' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semesterly' | 'yearly';
  timeZone: string;
  activityTypes?: readonly string[];
}

function redactDerivedPayload(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) {
    return value.map(child => redactDerivedPayload(child, parentKey));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const redactedKeys = /(?:event|activity).*(?:id|name|label)s?$/i;
  const nestedIdentityKeys = /^(?:id|name|label)s?$/i;
  const parentIsEventIdentity = /(?:event|activity)/i.test(parentKey);
  const objectHasEventIdentity = entries.some(([key]) => /(?:event|activity).*ids?$/i.test(key));
  return Object.fromEntries(
    entries
      .filter(([key]) => (
        !redactedKeys.test(key)
        && !((parentIsEventIdentity || objectHasEventIdentity) && nestedIdentityKeys.test(key))
      ))
      .map(([key, child]) => [key, redactDerivedPayload(child, key)]),
  );
}

function normalizeSleepProvider(value: unknown): SleepProvider | null {
  return Object.values(SLEEP_PROVIDERS).includes(value as SleepProvider)
    ? value as SleepProvider
    : null;
}

function normalizeSleepVitals(value: unknown): Partial<SleepVitals> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const keys: Array<keyof SleepVitals> = [
    'averageHeartRateBpm',
    'minimumHeartRateBpm',
    'restingHeartRateBpm',
    'averageHrvMs',
    'hrvSampleCount',
    'overnightHrvMs',
    'maxSpo2Percent',
    'averageRespirationBrpm',
  ];
  const normalized = Object.fromEntries(
    keys.flatMap((key) => {
      const numeric = asNonNegativeNumber(raw[key]);
      return numeric === null ? [] : [[key, numeric]];
    }),
  ) as Partial<SleepVitals>;
  return Object.keys(normalized).length ? normalized : null;
}

function normalizeStageDurations(value: unknown): Partial<Record<SleepStage, number>> {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(
    Object.values(SLEEP_STAGES).flatMap((stage) => {
      const duration = asNonNegativeNumber(raw[stage]);
      return duration === null ? [] : [[stage, duration]];
    }),
  );
}

export interface SafeSleepSession {
  provider: SleepProvider;
  sleepDate: string;
  startTimeMs: number;
  endTimeMs: number;
  durationSeconds: number;
  inBedDurationSeconds: number | null;
  isNap: boolean;
  stageDurationsSeconds: Partial<Record<SleepStage, number>>;
  score: {
    value: number | null;
    qualifier: string | null;
  } | null;
  vitals: Partial<SleepVitals> | null;
}

function toSafeSleepSession(data: Record<string, unknown>): SafeSleepSession | null {
  const source = data.source && typeof data.source === 'object'
    ? data.source as Record<string, unknown>
    : {};
  const provider = normalizeSleepProvider(source.provider);
  const startTimeMs = asFiniteNumber(data.startTimeMs);
  const endTimeMs = asFiniteNumber(data.endTimeMs);
  const durationSeconds = asNonNegativeNumber(data.durationSeconds);
  const sleepDate = typeof data.sleepDate === 'string' ? data.sleepDate : '';
  if (!provider || startTimeMs === null || endTimeMs === null || durationSeconds === null || !sleepDate) {
    return null;
  }

  const rawScore = data.score && typeof data.score === 'object'
    ? data.score as Record<string, unknown>
    : null;
  const scoreValue = rawScore ? asNonNegativeNumber(rawScore.value) : null;
  const scoreQualifier = typeof rawScore?.qualifier === 'string' && rawScore.qualifier.trim()
    ? rawScore.qualifier.trim()
    : null;

  return {
    provider,
    sleepDate,
    startTimeMs,
    endTimeMs,
    durationSeconds,
    inBedDurationSeconds: asNonNegativeNumber(data.inBedDurationSeconds),
    isNap: data.isNap === true,
    stageDurationsSeconds: normalizeStageDurations(data.stageDurationsSeconds),
    score: rawScore ? {
      value: scoreValue,
      qualifier: scoreQualifier,
    } : null,
    vitals: normalizeSleepVitals(data.vitals),
  };
}

export interface ListSleepSessionsInput {
  uid: string;
  startTimeMs: number;
  endTimeMs: number;
  includeNaps?: boolean;
  provider?: SleepProvider;
  cursor?: string;
  limit?: number;
}

export interface QuerySleepSummaryInput {
  uid: string;
  startTimeMs: number;
  endTimeMs: number;
  includeNaps?: boolean;
  provider?: SleepProvider;
  groupBy: 'day' | 'week' | 'month';
  timeZone: string;
}

interface SleepSummaryAccumulator {
  bucketStartMs: number;
  sessionCount: number;
  providers: Set<SleepProvider>;
  durationSeconds: number;
  inBedDurationSeconds: number;
  inBedCount: number;
  score: number;
  scoreCount: number;
  stageDurationsSeconds: Record<string, number>;
  vitalSums: Record<string, number>;
  vitalCounts: Record<string, number>;
}

export function createMcpDataService(
  dependencies: McpDataServiceDependencies = defaultDependencies,
) {
  return {
    async listMetrics(input: ListMetricsInput): Promise<ListMetricsResult> {
      const rawLimit = Math.floor(input.limit || 50);
      const limit = Math.min(100, Math.max(1, rawLimit));
      const docs = await dependencies.fetchMetricDiscoveryDocuments(
        input.uid,
        METRIC_DISCOVERY_EVENT_LIMIT + 1,
      );
      const eventScanTruncated = docs.length > METRIC_DISCOVERY_EVENT_LIMIT;
      const scannedDocs = docs.slice(0, METRIC_DISCOVERY_EVENT_LIMIT);
      const available = resolveAvailableSportsLibMetrics(
        scannedDocs.map(doc => doc.data.stats as Record<string, unknown> | undefined),
      );
      const search = `${input.search || ''}`.trim().toLowerCase();
      const filtered = available.filter(metric => (
        (!search || `${metric.type} ${metric.displayType} ${metric.unit}`.toLowerCase().includes(search))
        && (!input.cursor || metric.type.localeCompare(input.cursor) > 0)
      ));
      const page = filtered.slice(0, limit);

      return {
        eventMetrics: page,
        nextCursor: filtered.length > page.length ? page[page.length - 1]?.type || null : null,
        scannedEventCount: scannedDocs.length,
        eventScanTruncated,
        derivedMetricKinds: Object.values(DERIVED_METRIC_KINDS),
        sleepCapabilities: {
          providers: Object.values(SLEEP_PROVIDERS),
          sessionSummaries: true,
          aggregateGroupings: ['day', 'week', 'month'],
        },
      };
    },

    async queryMetric(input: QueryMetricInput) {
      validateBoundedRange(input.startTimeMs, input.endTimeMs);
      const timeZone = requireTimeZone(input.timeZone);
      const metric = resolveSportsLibNumericMetric(input.metric);
      if (!metric) {
        throw new McpDataError('invalid_metric', 'The metric is not a supported numeric Sports Lib type.');
      }
      const activityTypes = resolveActivityTypes(input.activityTypes);
      const docs = await dependencies.fetchEventDocuments(
        input.uid,
        input.startTimeMs,
        input.endTimeMs,
        MAX_EVENT_QUERY_DOCUMENTS + 1,
      );
      if (docs.length > MAX_EVENT_QUERY_DOCUMENTS) {
        throw new McpDataError(
          'query_too_large',
          `The query matches more than ${MAX_EVENT_QUERY_DOCUMENTS} events. Narrow the date range.`,
        );
      }

      const events = docs.flatMap((doc) => {
        if (isBenchmarkEventForTrainingMetrics(doc.data)) {
          return [];
        }
        try {
          const event = dependencies.importEvent(doc.data as unknown as EventJSONInterface, doc.id);
          return eventMatchesActivityFilter(event, activityTypes) ? [event] : [];
        } catch {
          return [];
        }
      });

      const aggregation = buildEventStatAggregation(events, {
        dataType: metric.type,
        valueType: resolveValueType(input.aggregation),
        categoryType: resolveCategoryType(input.groupBy),
        requestedTimeInterval: resolveTimeInterval(input.interval),
        timeZone,
      });

      return {
        metric,
        matchedEventCount: events.length,
        aggregation,
      };
    },

    async getTrainingMetric(uid: string, metricKind: string) {
      if (!isDerivedMetricKind(metricKind)) {
        throw new McpDataError('invalid_metric', 'Unknown Training-derived metric kind.');
      }
      const snapshot = await dependencies.fetchDerivedSnapshot(uid, metricKind);
      if (!snapshot || snapshot.status !== 'ready' || snapshot.payload == null) {
        throw new McpDataError('metric_not_ready', 'The requested Training-derived metric is not ready.');
      }

      return {
        metricKind,
        schemaVersion: asFiniteNumber(snapshot.schemaVersion) ?? DERIVED_METRIC_SCHEMA_VERSION,
        updatedAtMs: asFiniteNumber(snapshot.updatedAtMs),
        sourceEventCount: asNonNegativeNumber(snapshot.sourceEventCount),
        payload: redactDerivedPayload(snapshot.payload),
      };
    },

    async listSleepSessions(input: ListSleepSessionsInput) {
      validateBoundedRange(input.startTimeMs, input.endTimeMs);
      const limit = Math.min(MAX_SLEEP_PAGE_SIZE, Math.max(1, Math.floor(input.limit || 25)));
      const cursor = decodeCursor(input.cursor);
      const scanLimit = Math.min(MAX_SLEEP_QUERY_DOCUMENTS, limit * 5);
      const docs = await dependencies.fetchSleepDocuments(
        input.uid,
        input.startTimeMs,
        input.endTimeMs,
        scanLimit + 1,
        cursor,
      );
      const scannedDocs = docs.slice(0, scanLimit);
      const matches = scannedDocs.flatMap((doc) => {
        const session = toSafeSleepSession(doc.data);
        if (
          !session
          || (!input.includeNaps && session.isNap)
          || (input.provider && session.provider !== input.provider)
        ) {
          return [];
        }
        return [{ id: doc.id, session }];
      });
      const page = matches.slice(0, limit);
      const lastPageEntry = page[page.length - 1];
      const rawScanTruncated = docs.length > scanLimit;
      const lastScannedDoc = scannedDocs[scannedDocs.length - 1];
      const lastScannedEndTimeMs = asFiniteNumber(lastScannedDoc?.data.endTimeMs);
      const nextCursor = matches.length > page.length && lastPageEntry
        ? encodeCursor({
            endTimeMs: lastPageEntry.session.endTimeMs,
            id: lastPageEntry.id,
          })
        : rawScanTruncated && lastScannedDoc && lastScannedEndTimeMs !== null
          ? encodeCursor({
              endTimeMs: lastScannedEndTimeMs,
              id: lastScannedDoc.id,
            })
          : null;

      return {
        sessions: page.map(entry => entry.session),
        nextCursor,
      };
    },

    async querySleepSummary(input: QuerySleepSummaryInput) {
      validateBoundedRange(input.startTimeMs, input.endTimeMs);
      const timeZone = requireTimeZone(input.timeZone);
      const docs = await dependencies.fetchSleepDocuments(
        input.uid,
        input.startTimeMs,
        input.endTimeMs,
        MAX_SLEEP_QUERY_DOCUMENTS + 1,
      );
      if (docs.length > MAX_SLEEP_QUERY_DOCUMENTS) {
        throw new McpDataError(
          'query_too_large',
          `The query matches more than ${MAX_SLEEP_QUERY_DOCUMENTS} sleep sessions. Narrow the date range.`,
        );
      }
      const interval = input.groupBy === 'day'
        ? TimeIntervals.Daily
        : input.groupBy === 'week'
          ? TimeIntervals.Weekly
          : TimeIntervals.Monthly;
      const sessions = docs.flatMap((doc) => {
        const session = toSafeSleepSession(doc.data);
        return session
          && (input.includeNaps || !session.isNap)
          && (!input.provider || session.provider === input.provider)
          ? [session]
          : [];
      });
      const buckets = new Map<number, SleepSummaryAccumulator>();

      sessions.forEach((session) => {
        const bucketStartMs = resolveDateAggregationBucketStart(
          new Date(session.endTimeMs),
          interval,
          timeZone,
        );
        const accumulator = buckets.get(bucketStartMs) || {
          bucketStartMs,
          sessionCount: 0,
          providers: new Set<SleepProvider>(),
          durationSeconds: 0,
          inBedDurationSeconds: 0,
          inBedCount: 0,
          score: 0,
          scoreCount: 0,
          stageDurationsSeconds: {},
          vitalSums: {},
          vitalCounts: {},
        };
        accumulator.sessionCount += 1;
        accumulator.providers.add(session.provider);
        accumulator.durationSeconds += session.durationSeconds;
        if (session.inBedDurationSeconds !== null) {
          accumulator.inBedDurationSeconds += session.inBedDurationSeconds;
          accumulator.inBedCount += 1;
        }
        if (session.score?.value !== null && session.score?.value !== undefined) {
          accumulator.score += session.score.value;
          accumulator.scoreCount += 1;
        }
        Object.entries(session.stageDurationsSeconds).forEach(([stage, duration]) => {
          accumulator.stageDurationsSeconds[stage] =
            (accumulator.stageDurationsSeconds[stage] || 0) + Number(duration);
        });
        Object.entries(session.vitals || {}).forEach(([key, value]) => {
          const numeric = asNonNegativeNumber(value);
          if (numeric !== null) {
            accumulator.vitalSums[key] = (accumulator.vitalSums[key] || 0) + numeric;
            accumulator.vitalCounts[key] = (accumulator.vitalCounts[key] || 0) + 1;
          }
        });
        buckets.set(bucketStartMs, accumulator);
      });

      return {
        timeZone,
        groupBy: input.groupBy,
        matchedSessionCount: sessions.length,
        buckets: [...buckets.values()]
          .sort((left, right) => left.bucketStartMs - right.bucketStartMs)
          .map(bucket => ({
            bucketStartMs: bucket.bucketStartMs,
            sessionCount: bucket.sessionCount,
            providers: [...bucket.providers].sort(),
            totalDurationSeconds: bucket.durationSeconds,
            averageDurationSeconds: bucket.durationSeconds / bucket.sessionCount,
            averageInBedDurationSeconds: bucket.inBedCount
              ? bucket.inBedDurationSeconds / bucket.inBedCount
              : null,
            averageScore: bucket.scoreCount ? bucket.score / bucket.scoreCount : null,
            stageDurationsSeconds: bucket.stageDurationsSeconds,
            averageVitals: Object.fromEntries(
              Object.entries(bucket.vitalSums).map(([key, sum]) => [
                key,
                sum / bucket.vitalCounts[key],
              ]),
            ),
          })),
      };
    },
  };
}
