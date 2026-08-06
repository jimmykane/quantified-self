import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import {
  ActivityTypes,
  ActivityTypesHelper,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  DataActivityTypes,
  DataAscent,
  DataCadenceAvg,
  DataCadenceMax,
  DataDescent,
  DataDistance,
  DataDuration,
  DataEndPosition,
  DynamicDataLoader,
  DataEnergy,
  DataHeartRateAvg,
  DataHeartRateMax,
  DataJumpEvent,
  DataPowerAvg,
  DataPowerMax,
  DataSpeedAvg,
  DataSpeedMax,
  DataStartPosition,
  decodeRoutePolyline5,
  EventImporterJSON,
  EventInterface,
  EventJSONInterface,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import {
  OriginalFileMetaData,
} from '../../../shared/app-event.interface';
import {
  OriginalRouteFileMetaData,
  RouteBounds,
  RouteWaypointJSONInterface,
} from '../../../shared/app-route.interface';
import {
  DERIVED_METRIC_KINDS,
  DERIVED_METRIC_SCHEMA_VERSION,
  DERIVED_METRICS_ENTRY_TYPES,
  DerivedFormMetricPayload,
  DerivedFormNowMetricPayload,
  DerivedMetricKind,
  DerivedRampRateMetricPayload,
  DerivedTrainingReadinessMetricPayload,
  DerivedTrainingSummaryMetricPayload,
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
} from '../../../shared/sleep';
import {
  buildReadinessEvaluation,
  READINESS_FORMULA_VERSION,
  READINESS_SLEEP_LOOKBACK_MS,
  READINESS_TOTAL_SIGNAL_COUNT,
  ReadinessEvaluation,
  ReadinessRatioEvidence,
  ReadinessSleepEvidencePoint,
} from '../../../shared/readiness';
import {
  buildTrainingLoadPoints,
} from '../../../shared/training-load';
import {
  MCP_SLEEP_VITAL_DESCRIPTORS,
  MCP_SLEEP_VITAL_TYPES,
  McpSleepVitalDescriptor,
  McpSleepVitalType,
} from './sleep-vitals';
import {
  getMcpTrainingMetricDescriptors,
  McpTrainingMetricDescriptor,
} from './training-metric-catalog';
import {
  McpMetricDescriptor,
  projectSportsLibNumericMetricValue,
  resolveAvailableSportsLibMetrics,
  resolveSportsLibNumericMetric,
} from './metric-catalog';
import {
  getMcpMeasurementCatalog,
  isFirstClassMcpMeasurementMetric,
  isMcpMeasurementValueAllowed,
  McpMeasurementAggregation,
  McpMeasurementDescriptor,
  McpMeasurementInterval,
  resolveMcpMeasurementDefinition,
} from './measurement-catalog';
import {
  maybeDecompressPayloadForParsing,
  parseRoutePayload,
  resolveRouteSourceExtension,
  RouteProcessingHttpStatusError,
} from '../routes/route-processing';
import {
  forwardGeocodeMapbox,
  MapboxForwardGeocodingResult,
  MapboxGeocodingError,
  normalizeMapboxQuery,
} from '../shared/mapbox-geocoder';
import {
  consumeMcpGeocodingRateLimit,
  McpGeocodingRateLimitError,
} from './geocoding-rate-limit';
import {
  ActivityChartDataInput,
  ActivityChartServiceDependencies,
  ActivityChartSourceContext,
  getActivityChartDataFromSources,
  getUnsupportedActivityChartMetrics,
  listActivityChartMetrics,
  MCP_ACTIVITY_CHART_MAX_SOURCE_FILES,
} from './activity-chart.service';
import {
  consumeActivityChartRateLimit,
  McpActivityChartRateLimitError,
} from './activity-chart-rate-limit';
import { MCP_DERIVED_PAYLOAD_SCHEMAS } from './derived-output-schemas';
import { ActivityIdentityLike } from '../shared/activity-identity-matcher';
import {
  boundsMayBeWithinRadius,
  findNearestPointOnPolyline,
  haversineDistanceMeters,
  isValidSpatialPosition,
  SpatialPosition,
} from './spatial';

const MAX_EVENT_QUERY_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
const MAX_EVENT_QUERY_DOCUMENTS = 2000;
const EVENT_QUERY_PAGE_SIZE = 25;
const MAX_EVENT_QUERY_STATS_BYTES = 4 * 1024 * 1024;
const MAX_EVENT_QUERY_STAT_ENTRIES = 20_000;
const METRIC_DISCOVERY_EVENT_LIMIT = 500;
const MAX_MEASUREMENT_RESPONSE_BYTES = 128 * 1024;
const MAX_SLEEP_QUERY_DOCUMENTS = 1000;
const MAX_SLEEP_PAGE_SIZE = 100;
const DAILY_BRIEFING_SLEEP_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const DAILY_TRAINING_SUMMARY_CURRENT_WINDOW_DAYS = 28;
const DAILY_TRAINING_SUMMARY_BASELINE_WINDOW_DAYS = 84;
const DAILY_TRAINING_SUMMARY_DISCIPLINES = ['running', 'cycling', 'swimming'] as const;
const MAX_DAILY_BRIEFING_SLEEP_SESSIONS = 32;
const MAX_DAILY_BRIEFING_BASELINE_NIGHTS = 7;
const MIN_DAILY_BRIEFING_BASELINE_NIGHTS = 3;
const MAX_DAILY_BRIEFING_RESPONSE_BYTES = 16 * 1024;
const MAX_LIVE_READINESS_SLEEP_DOCUMENTS = 256;
const MAX_TODAY_READINESS_RESPONSE_BYTES = 16 * 1024;
const MAX_DAILY_REPORT_BASELINE_NIGHTS = 14;
const MIN_DAILY_REPORT_BASELINE_NIGHTS = 3;
const MAX_DAILY_REPORT_RESPONSE_BYTES = 16 * 1024;
const SLEEP_CURSOR_VERSION = 1;
const SLEEP_CURSOR_NONCE_BYTES = 12;
const SLEEP_CURSOR_AUTH_TAG_BYTES = 16;
const OPAQUE_VALUE_VERSION = 1;
const OPAQUE_VALUE_NONCE_BYTES = 12;
const OPAQUE_VALUE_AUTH_TAG_BYTES = 16;
const MAX_ACTIVITY_LIST_BYTES = 512 * 1024;
const MAX_ACTIVITY_PAGE_SIZE = 100;
const MAX_ACTIVITY_LIST_SCAN_DOCUMENTS = 100;
const RELATIVE_DAY_FORWARD_PROBE_MS = 36 * 60 * 60 * 1000;
const MAX_ACTIVITY_DETAIL_ENTRIES = 10_000;
const MAX_ACTIVITY_DETAIL_BYTES = 512 * 1024;
const MAX_ACTIVITY_DETAIL_RESPONSE_BYTES = 256 * 1024;
const MAX_ACTIVITY_DETAIL_PAGE_SIZE = 100;
export const MAX_ACTIVITY_METRICS_PER_REQUEST = 25;
const MAX_ACTIVITY_METRIC_DOCUMENT_BYTES = 64 * 1024;
const MAX_ACTIVITY_METRIC_RESPONSE_BYTES = 32 * 1024;
const MAX_MULTI_METRIC_SELECTORS = 4;
const MAX_MULTI_METRIC_RESPONSE_BYTES = 256 * 1024;
const MAX_ACTIVITY_OVERVIEW_DETAIL_ENTRIES = 10_000;
const MAX_ACTIVITY_OVERVIEW_DETAIL_BYTES = 512 * 1024;
const MAX_ACTIVITY_OVERVIEW_STATS_BYTES = 64 * 1024;
const MAX_ACTIVITY_OVERVIEW_RESPONSE_BYTES = 64 * 1024;
const MAX_ACTIVITY_RANKING_DOCUMENTS = 2_000;
const ACTIVITY_RANKING_PAGE_SIZE = 25;
const MAX_ACTIVITY_RANKING_DOCUMENT_BYTES = 512 * 1024;
const MAX_ACTIVITY_RANKING_RESPONSE_BYTES = 128 * 1024;
const MAX_TRAINING_METRIC_CATALOG_RESPONSE_BYTES = 64 * 1024;
const MAX_ROUTE_LIST_BYTES = 512 * 1024;
const MAX_ROUTE_PAGE_SIZE = 100;
const MAX_ROUTE_LIST_SCAN_DOCUMENTS = 100;
const MAX_ROUTE_PREVIEW_SEGMENTS = 20;
const MAX_ROUTE_PREVIEW_POINTS = 5_000;
const MAX_ROUTE_PREVIEW_BYTES = 256 * 1024;
const MAX_ROUTE_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_ROUTE_DECOMPRESSED_BYTES = 8 * 1024 * 1024;
const MAX_ROUTE_WAYPOINTS = 500;
const MAX_ROUTE_WAYPOINT_BYTES = 256 * 1024;
const MAX_NEARBY_ACTIVITY_SCAN_DOCUMENTS = 100;
const MAX_NEARBY_ACTIVITY_RESPONSE_BYTES = 256 * 1024;
const MAX_NEARBY_ROUTE_SCAN_DOCUMENTS = 50;
const MAX_NEARBY_ROUTE_DETAIL_LOADS = 12;
const MAX_NEARBY_ROUTE_DETAIL_BYTES = 1024 * 1024;
const MAX_NEARBY_ROUTE_DECODED_POINTS = 20_000;
const MAX_NEARBY_ROUTE_RESPONSE_BYTES = 256 * 1024;
const SAFE_SUMMARY_STAT_FIELDS = [
  new FieldPath('stats', DataDuration.type),
  new FieldPath('stats', DataDistance.type),
  new FieldPath('stats', DataAscent.type),
  new FieldPath('stats', DataDescent.type),
  new FieldPath('stats', DataSpeedAvg.type),
  new FieldPath('stats', DataSpeedMax.type),
  new FieldPath('stats', DataHeartRateAvg.type),
  new FieldPath('stats', DataHeartRateMax.type),
  new FieldPath('stats', DataPowerAvg.type),
  new FieldPath('stats', DataPowerMax.type),
  new FieldPath('stats', DataCadenceAvg.type),
  new FieldPath('stats', DataCadenceMax.type),
  new FieldPath('stats', DataEnergy.type),
] as const;
const SAFE_ACTIVITY_SUMMARY_FIELDS = [
  ...SAFE_SUMMARY_STAT_FIELDS,
  new FieldPath('stats', 'Jump Count'),
] as const;
export const SAFE_ACTIVITY_LOCATION_FIELDS = [
  new FieldPath('stats', DataStartPosition.type, 'latitudeDegrees'),
  new FieldPath('stats', DataStartPosition.type, 'longitudeDegrees'),
  new FieldPath('stats', DataEndPosition.type, 'latitudeDegrees'),
  new FieldPath('stats', DataEndPosition.type, 'longitudeDegrees'),
] as const;
const SAFE_SLEEP_VITAL_KEYS = MCP_SLEEP_VITAL_TYPES;

export type McpDataErrorCode =
  | 'invalid_request'
  | 'invalid_metric'
  | 'invalid_timezone'
  | 'metric_not_ready'
  | 'detail_not_available'
  | 'query_too_large'
  | 'temporarily_unavailable';

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
  cursor?: unknown;
}

interface SleepCursor {
  endTimeMs: number;
  id: string;
}

interface OrderedDocumentCursor {
  timeMs: number;
  id: string;
}

interface ActivityListCursor extends OrderedDocumentCursor {
  startTimeMs: number | null;
  endTimeMs: number | null;
  activityTypesHash?: string;
  relativePeriod?: McpActivityRelativePeriod | null;
  timeZone?: string | null;
}

interface RouteListCursor extends OrderedDocumentCursor {
  activityTypesHash?: string;
  searchHash?: string;
}

interface ResolvedActivityListQuery {
  startTimeMs?: number;
  endTimeMs?: number;
  activityTypes: string[];
  relativePeriod: McpActivityRelativePeriod | null;
  timeZone: string | null;
}

interface ResolvedRouteListQuery {
  activityTypes: string[];
  search: string | null;
}

type ActivityDetailKind = 'laps' | 'jumps' | 'swim_lengths';
type RouteDocumentKind = 'geometry' | 'source';
type OpaqueValueKind =
  | 'activity_ref'
  | 'route_ref'
  | 'activity_cursor'
  | 'route_cursor'
  | 'activity_detail_cursor'
  | 'activity_nearby_cursor'
  | 'route_nearby_cursor';

interface ActivityReference {
  activityId: string;
  eventId: string;
}

interface RouteReference {
  routeId: string;
}

interface ActivityDetailCursor {
  activityId: string;
  detailKind: ActivityDetailKind;
  offset: number;
}

interface NearbyCursor extends OrderedDocumentCursor {
  queryHash: string;
}

export function resolveMcpRouteSourcePath(
  uid: string,
  routeId: string,
  sourceFile: OriginalRouteFileMetaData,
  defaultBucketName: string,
): string {
  const path = `${sourceFile.path || ''}`.trim();
  const expectedPrefix = `users/${uid}/routes/${routeId}/`;
  if (
    !path.startsWith(expectedPrefix)
    || Buffer.byteLength(path, 'utf8') > 1_024
    || (sourceFile.bucket && sourceFile.bucket !== defaultBucketName)
  ) {
    throw new McpDataError(
      'detail_not_available',
      'The saved route source is unavailable.',
    );
  }
  return path;
}

export function resolveMcpActivitySourcePath(
  uid: string,
  eventId: string,
  sourceFile: OriginalFileMetaData,
  approvedBucketNames: readonly string[],
): string {
  const path = `${sourceFile.path || ''}`.trim();
  const expectedPrefix = `users/${uid}/events/${eventId}/`;
  const suffix = path.slice(expectedPrefix.length);
  const metadataBucket = `${sourceFile.bucket || ''}`.trim();
  if (
    !path.startsWith(expectedPrefix)
    || !suffix
    || suffix.split('/').some(segment => (
      !segment
      || segment === '.'
      || segment === '..'
      || /%(?:2e|2f|5c)/i.test(segment)
      || segment.includes('\\')
      || [...segment].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      })
    ))
    || Buffer.byteLength(path, 'utf8') > 1_024
    || (
      metadataBucket
      && !approvedBucketNames.includes(metadataBucket)
    )
  ) {
    throw new McpDataError(
      'detail_not_available',
      'The original activity source is unavailable.',
    );
  }
  return path;
}

interface ActivityChartContextDocuments {
  event: RawDocument;
  activities: RawDocument[];
}

export interface McpDataServiceDependencies {
  now: () => number;
  fetchMetricDiscoveryDocuments: (
    uid: string,
    limit: number,
  ) => Promise<RawDocument[]>;
  fetchEventDocuments: (
    uid: string,
    startTimeMs: number,
    endTimeMs: number,
    limit: number,
    cursor?: unknown,
  ) => Promise<RawDocument[]>;
  fetchDerivedSnapshot: (
    uid: string,
    metricKind: DerivedMetricKind,
  ) => Promise<Record<string, unknown> | null>;
  fetchDerivedSnapshotMetadataDocuments: (
    uid: string,
    metricKinds: readonly DerivedMetricKind[],
  ) => Promise<RawDocument[]>;
  fetchSleepDocuments: (
    uid: string,
    startTimeMs: number,
    endTimeMs: number,
    limit: number,
    cursor?: SleepCursor,
  ) => Promise<RawDocument[]>;
  fetchReadinessSleepDocuments: (
    uid: string,
    startTimeMs: number,
    endTimeMs: number,
    limit: number,
    includeDailyReportFields?: boolean,
  ) => Promise<RawDocument[]>;
  fetchActivityDocuments: (
    uid: string,
    startTimeMs: number | undefined,
    endTimeMs: number | undefined,
    limit: number,
    cursor?: OrderedDocumentCursor,
    includeLocation?: boolean,
  ) => Promise<RawDocument[]>;
  fetchNearbyActivityDocuments: (
    uid: string,
    startTimeMs: number | undefined,
    endTimeMs: number | undefined,
    limit: number,
    cursor?: OrderedDocumentCursor,
  ) => Promise<RawDocument[]>;
  fetchActivityDetailDocument: (
    uid: string,
    activityId: string,
    detailKind: ActivityDetailKind,
    includeLocation?: boolean,
  ) => Promise<RawDocument | null>;
  fetchActivityMetricDocument: (
    uid: string,
    activityId: string,
    metricTypes: readonly string[],
  ) => Promise<RawDocument | null>;
  fetchActivityOverviewDocument: (
    uid: string,
    activityId: string,
  ) => Promise<RawDocument | null>;
  hasActivityChartSource: (
    uid: string,
    eventId: string,
  ) => Promise<boolean>;
  fetchActivityRankingDocuments: (
    uid: string,
    startTimeMs: number | undefined,
    endTimeMs: number | undefined,
    metricType: string,
    activityTypes: readonly string[],
    limit: number,
    cursor?: unknown,
  ) => Promise<RawDocument[]>;
  fetchActivityChartContext: (
    uid: string,
    eventId: string,
  ) => Promise<ActivityChartContextDocuments | null>;
  downloadActivityChartSource: (
    uid: string,
    eventId: string,
    sourceFile: OriginalFileMetaData,
    maxBytes: number,
  ) => Promise<Buffer>;
  consumeActivityChartRateLimit: (
    uid: string,
    connectionId: string,
  ) => Promise<void>;
  buildActivityChartData: (
    context: ActivityChartSourceContext,
    input: ActivityChartDataInput,
    dependencies: ActivityChartServiceDependencies,
  ) => ReturnType<typeof getActivityChartDataFromSources>;
  fetchRouteDocuments: (
    uid: string,
    limit: number,
    cursor?: OrderedDocumentCursor,
    includeLocation?: boolean,
  ) => Promise<RawDocument[]>;
  fetchRouteDocument: (
    uid: string,
    routeId: string,
    kind: RouteDocumentKind,
  ) => Promise<RawDocument | null>;
  downloadRouteSource: (
    uid: string,
    routeId: string,
    sourceFile: OriginalRouteFileMetaData,
    maxBytes: number,
  ) => Promise<Buffer>;
  parseRouteWaypoints: (
    payload: Buffer,
    resolvedExtension: string,
  ) => Promise<RouteWaypointJSONInterface[]>;
  forwardGeocodeLocation: (
    query: string,
  ) => Promise<MapboxForwardGeocodingResult>;
  consumeGeocodingRateLimit: (
    uid: string,
    connectionId: string,
  ) => Promise<void>;
  importEvent: (data: EventJSONInterface, id: string) => EventInterface;
}

async function readStorageFileWithinLimit(
  bucketName: string,
  path: string,
  maximumBytes: number,
  generation?: string,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let settled = false;
    const stream = admin.storage().bucket(bucketName).file(path, {
      ...(generation ? { generation } : {}),
    }).createReadStream();
    const fail = (error: unknown) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    stream.on('data', (chunk: Buffer | Uint8Array) => {
      if (settled) {
        return;
      }
      const buffer = Buffer.from(chunk);
      byteLength += buffer.byteLength;
      if (byteLength > maximumBytes) {
        stream.destroy();
        fail(new McpDataError(
          'query_too_large',
          'The original activity sources exceed the raw size limit.',
        ));
        return;
      }
      chunks.push(buffer);
    });
    stream.once('error', fail);
    stream.once('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks, byteLength));
      }
    });
  });
}

const defaultDependencies: McpDataServiceDependencies = {
  now: () => Date.now(),
  fetchMetricDiscoveryDocuments: async (uid, limit) => {
    const snapshot = await admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('events')
      .orderBy('startDate', 'desc')
      .limit(limit)
      .select('stats', 'mergeType', 'isMerge')
      .get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    }));
  },
  fetchEventDocuments: async (uid, startTimeMs, endTimeMs, limit, cursor) => {
    let query = admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('events')
      .where('startDate', '>=', startTimeMs)
      .where('startDate', '<=', endTimeMs)
      .orderBy('startDate', 'asc')
      .limit(limit)
      .select('startDate', 'endDate', 'stats', 'mergeType', 'isMerge');
    if (cursor) {
      query = query.startAfter(cursor as admin.firestore.QueryDocumentSnapshot);
    }
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
      cursor: doc,
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
  fetchDerivedSnapshotMetadataDocuments: async (uid, metricKinds) => {
    if (metricKinds.length === 0) {
      return [];
    }
    const snapshot = await admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('derivedMetrics')
      .where(FieldPath.documentId(), 'in', [...metricKinds])
      .select(
        'entryType',
        'metricKind',
        'status',
        'schemaVersion',
        'updatedAtMs',
        'sourceEventCount',
      )
      .get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    }));
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
      .limit(limit)
      .select(
        new FieldPath('source', 'provider'),
        'sleepDate',
        'startTimeMs',
        'endTimeMs',
        'durationSeconds',
        'inBedDurationSeconds',
        'timezoneOffsetSeconds',
        'isNap',
        ...Object.values(SLEEP_STAGES)
          .map(stage => new FieldPath('stageDurationsSeconds', stage)),
        new FieldPath('score', 'value'),
        new FieldPath('score', 'qualifier'),
        ...SAFE_SLEEP_VITAL_KEYS.map(key => new FieldPath('vitals', key)),
      );
    if (cursor) {
      query = query.startAfter(cursor.endTimeMs, cursor.id);
    }
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    }));
  },
  fetchReadinessSleepDocuments: async (
    uid,
    startTimeMs,
    endTimeMs,
    limit,
    includeDailyReportFields = false,
  ) => {
    const snapshot = await admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('sleepSessions')
      .where('endTimeMs', '>=', startTimeMs)
      .where('endTimeMs', '<=', endTimeMs)
      .orderBy('endTimeMs', 'desc')
      .orderBy(FieldPath.documentId(), 'desc')
      .limit(limit)
      .select(
        new FieldPath('source', 'provider'),
        'sleepDate',
        'startTimeMs',
        'endTimeMs',
        'durationSeconds',
        'timezoneOffsetSeconds',
        'isNap',
        new FieldPath('score', 'value'),
        new FieldPath('vitals', 'averageHrvMs'),
        new FieldPath('vitals', 'overnightHrvMs'),
        new FieldPath('vitals', 'averageHeartRateBpm'),
        new FieldPath('vitals', 'minimumHeartRateBpm'),
        ...(includeDailyReportFields
          ? [
              'inBedDurationSeconds',
              new FieldPath('score', 'qualifier'),
            ]
          : []),
      )
      .get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    }));
  },
  fetchActivityDocuments: async (
    uid,
    startTimeMs,
    endTimeMs,
    limit,
    cursor,
    includeLocation,
  ) => {
    let query = admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('activities') as admin.firestore.Query;
    if (startTimeMs !== undefined && endTimeMs !== undefined) {
      query = query
        .where('eventStartDate', '>=', new Date(startTimeMs))
        .where('eventStartDate', '<=', new Date(endTimeMs));
    }
    query = query
      .orderBy('eventStartDate', 'desc')
      .orderBy(FieldPath.documentId(), 'desc')
      .limit(limit)
      .select(
        'eventID',
        'eventStartDate',
        'startDate',
        'endDate',
        'type',
        'powerMeter',
        'trainer',
        ...SAFE_ACTIVITY_SUMMARY_FIELDS,
        ...(includeLocation ? SAFE_ACTIVITY_LOCATION_FIELDS : []),
      );
    if (cursor) {
      query = query.startAfter(new Date(cursor.timeMs), cursor.id);
    }
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    }));
  },
  fetchNearbyActivityDocuments: async (
    uid,
    startTimeMs,
    endTimeMs,
    limit,
    cursor,
  ) => {
    let query = admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('activities') as admin.firestore.Query;
    if (startTimeMs !== undefined && endTimeMs !== undefined) {
      query = query
        .where('eventStartDate', '>=', new Date(startTimeMs))
        .where('eventStartDate', '<=', new Date(endTimeMs));
    }
    query = query
      .orderBy('eventStartDate', 'desc')
      .orderBy(FieldPath.documentId(), 'desc')
      .limit(limit)
      .select(
        'eventID',
        'eventStartDate',
        'startDate',
        'endDate',
        'type',
        'powerMeter',
        'trainer',
        ...SAFE_ACTIVITY_SUMMARY_FIELDS,
        ...SAFE_ACTIVITY_LOCATION_FIELDS,
      );
    if (cursor) {
      query = query.startAfter(new Date(cursor.timeMs), cursor.id);
    }
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    }));
  },
  fetchActivityDetailDocument: async (uid, activityId, detailKind) => {
    const detailField = detailKind === 'swim_lengths'
      ? 'swimLengths'
      : detailKind === 'jumps'
        ? 'events'
        : 'laps';
    const snapshot = await admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('activities')
      .where(FieldPath.documentId(), '==', activityId)
      .limit(1)
      .select('eventID', detailField)
      .get();
    const doc = snapshot.docs[0];
    return doc ? {
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    } : null;
  },
  fetchActivityMetricDocument: async (uid, activityId, metricTypes) => {
    const snapshot = await admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('activities')
      .where(FieldPath.documentId(), '==', activityId)
      .limit(1)
      .select(
        'eventID',
        ...metricTypes.map(metricType => new FieldPath('stats', metricType)),
      )
      .get();
    const doc = snapshot.docs[0];
    return doc ? {
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    } : null;
  },
  fetchActivityOverviewDocument: async (uid, activityId) => {
    const snapshot = await admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('activities')
      .where(FieldPath.documentId(), '==', activityId)
      .limit(1)
      .select(
        'eventID',
        'type',
        'stats',
        'laps',
        'events',
        'swimLengths',
      )
      .get();
    const doc = snapshot.docs[0];
    return doc ? {
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    } : null;
  },
  hasActivityChartSource: async (uid, eventId) => {
    const snapshot = await admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('events')
      .where(FieldPath.documentId(), '==', eventId)
      .limit(1)
      .select('originalFile', 'originalFiles')
      .get();
    const doc = snapshot.docs[0];
    return Boolean(
      doc
      && extractActivityChartSourceFiles(
        doc.data() as Record<string, unknown>,
      ).length > 0
    );
  },
  fetchActivityRankingDocuments: async (
    uid,
    startTimeMs,
    endTimeMs,
    metricType,
    activityTypes,
    limit,
    cursor,
  ) => {
    let query = admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('activities') as admin.firestore.Query;
    if (startTimeMs !== undefined && endTimeMs !== undefined) {
      query = query
        .where('eventStartDate', '>=', new Date(startTimeMs))
        .where('eventStartDate', '<=', new Date(endTimeMs))
        .orderBy('eventStartDate', 'desc')
        .orderBy(FieldPath.documentId(), 'desc');
    } else if (activityTypes.length > 0) {
      query = query
        .where('type', 'in', activityTypes)
        .orderBy(FieldPath.documentId(), 'desc');
    } else {
      query = query
        .orderBy('eventStartDate', 'desc')
        .orderBy(FieldPath.documentId(), 'desc');
    }
    query = query
      .limit(limit)
      .select(
        'eventID',
        'eventStartDate',
        'startDate',
        'endDate',
        'type',
        new FieldPath('stats', metricType),
      );
    if (cursor) {
      query = query.startAfter(cursor as admin.firestore.QueryDocumentSnapshot);
    }
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
      cursor: doc,
    }));
  },
  fetchActivityChartContext: async (uid, eventId) => {
    const db = admin.firestore();
    const [eventQuerySnapshot, activitiesSnapshot] = await Promise.all([
      db.collection('users')
        .doc(uid)
        .collection('events')
        .where(FieldPath.documentId(), '==', eventId)
        .limit(1)
        .select('originalFile', 'originalFiles')
        .get(),
      db.collection('users')
        .doc(uid)
        .collection('activities')
        .where('eventID', '==', eventId)
        .limit(101)
        .select(
          'eventID',
          'startDate',
          'endDate',
          'type',
          'sourceActivityKey',
          new FieldPath('stats', DataDuration.type),
          new FieldPath('stats', DataDistance.type),
        )
        .get(),
    ]);
    const eventSnapshot = eventQuerySnapshot.docs[0];
    if (!eventSnapshot || activitiesSnapshot.empty) {
      return null;
    }
    return {
      event: {
        id: eventSnapshot.id,
        data: eventSnapshot.data() as Record<string, unknown>,
      },
      activities: activitiesSnapshot.docs.map(doc => ({
        id: doc.id,
        data: doc.data() as Record<string, unknown>,
      })),
    };
  },
  downloadActivityChartSource: async (
    uid,
    eventId,
    sourceFile,
    maxBytes,
  ) => {
    const defaultBucketName = admin.storage().bucket().name;
    const projectId = `${process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || ''}`
      .trim();
    const approvedBuckets = [
      defaultBucketName,
      ...(projectId ? [projectId, `${projectId}.appspot.com`] : []),
    ];
    const path = resolveMcpActivitySourcePath(
      uid,
      eventId,
      sourceFile,
      approvedBuckets,
    );
    const bucketName = `${sourceFile.bucket || ''}`.trim() || defaultBucketName;
    return readStorageFileWithinLimit(
      bucketName,
      path,
      maxBytes,
      sourceFile.generation,
    );
  },
  consumeActivityChartRateLimit,
  buildActivityChartData: getActivityChartDataFromSources,
  fetchRouteDocuments: async (uid, limit, cursor, includeLocation) => {
    let query = admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('routes')
      .orderBy('importedAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc')
      .limit(limit)
      .select(
        'name',
        'createdAt',
        'importedAt',
        'updatedAt',
        'activityTypes',
        'routeCount',
        'waypointCount',
        'pointCount',
        ...(includeLocation ? ['bounds'] : []),
        ...SAFE_SUMMARY_STAT_FIELDS,
      );
    if (cursor) {
      query = query.startAfter(new Date(cursor.timeMs), cursor.id);
    }
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    }));
  },
  fetchRouteDocument: async (uid, routeId, kind) => {
    const fields = kind === 'geometry'
      ? ['preview']
      : ['srcFileType', 'originalFile', 'originalFiles'];
    const snapshot = await admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('routes')
      .where(FieldPath.documentId(), '==', routeId)
      .limit(1)
      .select(...fields)
      .get();
    const doc = snapshot.docs[0];
    return doc ? {
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    } : null;
  },
  downloadRouteSource: async (uid, routeId, sourceFile, maxBytes) => {
    const defaultBucket = admin.storage().bucket();
    const path = resolveMcpRouteSourcePath(
      uid,
      routeId,
      sourceFile,
      defaultBucket.name,
    );
    const chunks: Buffer[] = [];
    let bytes = 0;
    await new Promise<void>((resolve, reject) => {
      const stream = defaultBucket.file(path).createReadStream({
        start: 0,
        end: maxBytes,
      });
      stream.on('data', (chunk: Buffer | Uint8Array) => {
        const data = Buffer.from(chunk);
        bytes += data.length;
        if (bytes > maxBytes) {
          stream.destroy(new McpDataError(
            'query_too_large',
            'The saved route source exceeds the MCP size limit.',
          ));
          return;
        }
        chunks.push(data);
      });
      stream.once('error', reject);
      stream.once('end', resolve);
    });
    return Buffer.concat(chunks);
  },
  parseRouteWaypoints: async (payload, resolvedExtension) => {
    const decompressed = maybeDecompressPayloadForParsing(
      payload,
      resolvedExtension,
      {
        maxOutputLength: MAX_ROUTE_DECOMPRESSED_BYTES,
        maxOutputLengthLabel: '8MB',
      },
    );
    const routeFile = await parseRoutePayload(decompressed, resolvedExtension);
    return routeFile.getWaypoints();
  },
  forwardGeocodeLocation: query => forwardGeocodeMapbox(query),
  consumeGeocodingRateLimit: (uid, connectionId) => (
    consumeMcpGeocodingRateLimit(uid, connectionId)
  ),
  importEvent: (data, id) => EventImporterJSON.getEventFromJSON(data).setID(id),
};

function asFiniteNumber(value: unknown): number | null {
  if (
    typeof value !== 'number'
    && (typeof value !== 'string' || !value.trim())
  ) {
    return null;
  }
  const numeric = typeof value === 'number' ? value : Number(value.trim());
  return Number.isFinite(numeric) ? numeric : null;
}

function asSafeOperationalTimestampMs(value: unknown): number | null {
  const numeric = asFiniteNumber(value);
  return numeric !== null && Number.isSafeInteger(numeric) && numeric >= 0
    ? numeric
    : null;
}

function asNonNegativeNumber(value: unknown): number | null {
  const numeric = asFiniteNumber(value);
  return numeric !== null && numeric >= 0 ? numeric : null;
}

function normalizeCalendarDate(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }
  const dayMs = Date.parse(`${normalized}T00:00:00.000Z`);
  return Number.isFinite(dayMs) && new Date(dayMs).toISOString().slice(0, 10) === normalized
    ? normalized
    : null;
}

function isValidFirestoreDocumentId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !/^__.*__$/.test(value)
    && Buffer.byteLength(value, 'utf8') <= 1_500;
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

function validateOptionalBoundedRange(
  startTimeMs: number | undefined,
  endTimeMs: number | undefined,
): void {
  const hasStartTime = startTimeMs !== undefined;
  const hasEndTime = endTimeMs !== undefined;
  if (hasStartTime !== hasEndTime) {
    throw new McpDataError(
      'invalid_request',
      'start and end must either both be provided or both be omitted.',
    );
  }
  if (hasStartTime && hasEndTime) {
    validateBoundedRange(startTimeMs, endTimeMs);
  }
}

export const MCP_ACTIVITY_RELATIVE_PERIODS = [
  'today',
  'yesterday',
] as const;
export type McpActivityRelativePeriod =
  typeof MCP_ACTIVITY_RELATIVE_PERIODS[number];

function requireTimeZone(timeZone: string): string {
  const normalized = `${timeZone || ''}`.trim();
  if (!isValidIanaTimeZone(normalized)) {
    throw new McpDataError('invalid_timezone', 'A valid IANA timezone is required.');
  }
  return normalized;
}

function deriveSleepCursorKey(uid: string, connectionId: string): Buffer {
  return createHash('sha256')
    .update('quantified-self:mcp:sleep-cursor:v1\0', 'utf8')
    .update(uid, 'utf8')
    .update('\0', 'utf8')
    .update(connectionId, 'utf8')
    .digest();
}

function encodeCursor(cursor: SleepCursor, uid: string, connectionId: string): string {
  const nonce = randomBytes(SLEEP_CURSOR_NONCE_BYTES);
  const cipher = createCipheriv(
    'aes-256-gcm',
    deriveSleepCursorKey(uid, connectionId),
    nonce,
  );
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(cursor), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.from([SLEEP_CURSOR_VERSION]),
    nonce,
    cipher.getAuthTag(),
    ciphertext,
  ]).toString('base64url');
}

function decodeCursor(
  cursor: string | undefined,
  uid: string,
  connectionId: string,
): SleepCursor | undefined {
  if (!cursor) {
    return undefined;
  }
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
      throw new Error('invalid cursor encoding');
    }
    const encoded = Buffer.from(cursor, 'base64url');
    const minimumLength = 1 + SLEEP_CURSOR_NONCE_BYTES + SLEEP_CURSOR_AUTH_TAG_BYTES + 1;
    if (encoded.length < minimumLength || encoded[0] !== SLEEP_CURSOR_VERSION) {
      throw new Error('invalid cursor envelope');
    }
    const nonceStart = 1;
    const authTagStart = nonceStart + SLEEP_CURSOR_NONCE_BYTES;
    const ciphertextStart = authTagStart + SLEEP_CURSOR_AUTH_TAG_BYTES;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveSleepCursorKey(uid, connectionId),
      encoded.subarray(nonceStart, authTagStart),
    );
    decipher.setAuthTag(encoded.subarray(authTagStart, ciphertextStart));
    const plaintext = Buffer.concat([
      decipher.update(encoded.subarray(ciphertextStart)),
      decipher.final(),
    ]);
    const parsed = JSON.parse(plaintext.toString('utf8')) as Partial<SleepCursor>;
    if (
      !Number.isSafeInteger(parsed.endTimeMs)
      || !isValidFirestoreDocumentId(parsed.id)
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

function deriveOpaqueValueKey(
  kind: OpaqueValueKind,
  uid: string,
  connectionId: string,
): Buffer {
  return createHash('sha256')
    .update(`quantified-self:mcp:${kind}:v1\0`, 'utf8')
    .update(uid, 'utf8')
    .update('\0', 'utf8')
    .update(connectionId, 'utf8')
    .digest();
}

function encodeOpaqueValue(
  kind: OpaqueValueKind,
  value: Record<string, unknown>,
  uid: string,
  connectionId: string,
): string {
  const nonce = randomBytes(OPAQUE_VALUE_NONCE_BYTES);
  const cipher = createCipheriv(
    'aes-256-gcm',
    deriveOpaqueValueKey(kind, uid, connectionId),
    nonce,
  );
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.from([OPAQUE_VALUE_VERSION]),
    nonce,
    cipher.getAuthTag(),
    ciphertext,
  ]).toString('base64url');
}

function decodeOpaqueValue(
  kind: OpaqueValueKind,
  encodedValue: string | undefined,
  uid: string,
  connectionId: string,
  fieldLabel: string,
): Record<string, unknown> {
  try {
    if (!encodedValue || !/^[A-Za-z0-9_-]+$/.test(encodedValue)) {
      throw new Error('invalid encoding');
    }
    const encoded = Buffer.from(encodedValue, 'base64url');
    const minimumLength = 1 + OPAQUE_VALUE_NONCE_BYTES + OPAQUE_VALUE_AUTH_TAG_BYTES + 2;
    if (encoded.length < minimumLength || encoded[0] !== OPAQUE_VALUE_VERSION) {
      throw new Error('invalid envelope');
    }
    const nonceStart = 1;
    const authTagStart = nonceStart + OPAQUE_VALUE_NONCE_BYTES;
    const ciphertextStart = authTagStart + OPAQUE_VALUE_AUTH_TAG_BYTES;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveOpaqueValueKey(kind, uid, connectionId),
      encoded.subarray(nonceStart, authTagStart),
    );
    decipher.setAuthTag(encoded.subarray(authTagStart, ciphertextStart));
    const plaintext = Buffer.concat([
      decipher.update(encoded.subarray(ciphertextStart)),
      decipher.final(),
    ]);
    const parsed = JSON.parse(plaintext.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid payload');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new McpDataError('invalid_request', `The ${fieldLabel} is invalid.`);
  }
}

function decodeRouteListCursor(
  cursor: string | undefined,
  input: Pick<ListRoutesInput, 'uid' | 'connectionId'>,
  query: ResolvedRouteListQuery,
): OrderedDocumentCursor | undefined {
  if (!cursor) {
    return undefined;
  }
  const parsed = decodeOpaqueValue(
    'route_cursor',
    cursor,
    input.uid,
    input.connectionId,
    'pagination cursor',
  ) as unknown as Partial<RouteListCursor>;
  const cursorActivityTypesHash = parsed.activityTypesHash
    ?? buildActivityTypesHash([]);
  const cursorSearchHash = parsed.searchHash
    ?? buildRouteSearchHash(null);
  if (
    !Number.isSafeInteger(parsed.timeMs)
    || !isValidFirestoreDocumentId(parsed.id)
    || typeof cursorActivityTypesHash !== 'string'
    || cursorActivityTypesHash !== buildActivityTypesHash(query.activityTypes)
    || typeof cursorSearchHash !== 'string'
    || cursorSearchHash !== buildRouteSearchHash(query.search)
  ) {
    throw new McpDataError('invalid_request', 'The pagination cursor is invalid.');
  }
  return {
    timeMs: Number(parsed.timeMs),
    id: parsed.id,
  };
}

function encodeRouteListCursor(
  cursor: OrderedDocumentCursor,
  input: Pick<ListRoutesInput, 'uid' | 'connectionId'>,
  query: ResolvedRouteListQuery,
): string {
  return encodeOpaqueValue('route_cursor', {
    ...cursor,
    activityTypesHash: buildActivityTypesHash(query.activityTypes),
    searchHash: buildRouteSearchHash(query.search),
  }, input.uid, input.connectionId);
}

function decodeNearbyCursor(
  kind: 'activity_nearby_cursor' | 'route_nearby_cursor',
  cursor: string | undefined,
  uid: string,
  connectionId: string,
  queryHash: string,
): OrderedDocumentCursor | undefined {
  if (!cursor) {
    return undefined;
  }
  const parsed = decodeOpaqueValue(
    kind,
    cursor,
    uid,
    connectionId,
    'pagination cursor',
  ) as unknown as Partial<NearbyCursor>;
  if (
    !Number.isSafeInteger(parsed.timeMs)
    || !isValidFirestoreDocumentId(parsed.id)
    || parsed.queryHash !== queryHash
  ) {
    throw new McpDataError('invalid_request', 'The pagination cursor is invalid.');
  }
  return {
    timeMs: Number(parsed.timeMs),
    id: parsed.id,
  };
}

function encodeNearbyCursor(
  kind: 'activity_nearby_cursor' | 'route_nearby_cursor',
  cursor: OrderedDocumentCursor,
  uid: string,
  connectionId: string,
  queryHash: string,
): string {
  return encodeOpaqueValue(kind, {
    ...cursor,
    queryHash,
  }, uid, connectionId);
}

function buildActivityTypesHash(activityTypes: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify([...activityTypes].sort()), 'utf8')
    .digest('base64url');
}

function buildRouteSearchHash(search: string | null): string {
  return createHash('sha256')
    .update(search ?? '', 'utf8')
    .digest('base64url');
}

function decodeActivityListCursor(
  cursor: string | undefined,
  input: Pick<
    ListActivitiesInput,
    | 'uid'
    | 'connectionId'
    | 'startTimeMs'
    | 'endTimeMs'
    | 'relativePeriod'
    | 'timeZone'
  >,
  activityTypes: readonly string[],
): {
  cursor: OrderedDocumentCursor;
  query: ResolvedActivityListQuery;
} | undefined {
  if (!cursor) {
    return undefined;
  }
  const parsed = decodeOpaqueValue(
    'activity_cursor',
    cursor,
    input.uid,
    input.connectionId,
    'pagination cursor',
  ) as unknown as Partial<ActivityListCursor>;
  const cursorStartTimeMs = parsed.startTimeMs ?? null;
  const cursorEndTimeMs = parsed.endTimeMs ?? null;
  const cursorActivityTypesHash = parsed.activityTypesHash
    ?? buildActivityTypesHash([]);
  const cursorRelativePeriod = parsed.relativePeriod ?? null;
  const cursorTimeZone = parsed.timeZone ?? null;
  const requestedRelativePeriod = input.relativePeriod ?? null;
  const requestedTimeZone = input.timeZone ?? null;
  const relativeCursor = requestedRelativePeriod !== null;
  if (
    !Number.isSafeInteger(parsed.timeMs)
    || !isValidFirestoreDocumentId(parsed.id)
    || (
      cursorStartTimeMs !== null
      && !Number.isSafeInteger(cursorStartTimeMs)
    )
    || (
      cursorEndTimeMs !== null
      && !Number.isSafeInteger(cursorEndTimeMs)
    )
    || cursorActivityTypesHash !== buildActivityTypesHash(activityTypes)
    || cursorRelativePeriod !== requestedRelativePeriod
    || cursorTimeZone !== requestedTimeZone
    || (
      relativeCursor
      && (
        cursorStartTimeMs === null
        || cursorEndTimeMs === null
        || cursorStartTimeMs > cursorEndTimeMs
        || cursorEndTimeMs - cursorStartTimeMs > MAX_EVENT_QUERY_RANGE_MS
      )
    )
    || (
      !relativeCursor
      && (
        cursorStartTimeMs !== (input.startTimeMs ?? null)
        || cursorEndTimeMs !== (input.endTimeMs ?? null)
      )
    )
  ) {
    throw new McpDataError('invalid_request', 'The pagination cursor is invalid.');
  }
  return {
    cursor: {
      timeMs: Number(parsed.timeMs),
      id: parsed.id,
    },
    query: {
      startTimeMs: cursorStartTimeMs ?? undefined,
      endTimeMs: cursorEndTimeMs ?? undefined,
      activityTypes: [...activityTypes],
      relativePeriod: requestedRelativePeriod,
      timeZone: requestedTimeZone,
    },
  };
}

function encodeActivityListCursor(
  cursor: OrderedDocumentCursor,
  input: Pick<ListActivitiesInput, 'uid' | 'connectionId'>,
  query: ResolvedActivityListQuery,
): string {
  return encodeOpaqueValue('activity_cursor', {
    ...cursor,
    startTimeMs: query.startTimeMs ?? null,
    endTimeMs: query.endTimeMs ?? null,
    activityTypesHash: buildActivityTypesHash(query.activityTypes),
    relativePeriod: query.relativePeriod,
    timeZone: query.timeZone,
  }, input.uid, input.connectionId);
}

function decodeActivityReference(
  activityRef: string,
  uid: string,
  connectionId: string,
): ActivityReference {
  const parsed = decodeOpaqueValue(
    'activity_ref',
    activityRef,
    uid,
    connectionId,
    'activity reference',
  );
  if (
    !isValidFirestoreDocumentId(parsed.activityId)
    || !isValidFirestoreDocumentId(parsed.eventId)
  ) {
    throw new McpDataError('invalid_request', 'The activity reference is invalid.');
  }
  return {
    activityId: parsed.activityId,
    eventId: parsed.eventId,
  };
}

function decodeRouteReference(
  routeRef: string,
  uid: string,
  connectionId: string,
): RouteReference {
  const parsed = decodeOpaqueValue(
    'route_ref',
    routeRef,
    uid,
    connectionId,
    'route reference',
  );
  if (!isValidFirestoreDocumentId(parsed.routeId)) {
    throw new McpDataError('invalid_request', 'The route reference is invalid.');
  }
  return {
    routeId: parsed.routeId,
  };
}

function decodeActivityDetailOffset(
  cursor: string | undefined,
  reference: ActivityReference,
  detailKind: ActivityDetailKind,
  uid: string,
  connectionId: string,
): number {
  if (!cursor) {
    return 0;
  }
  const parsed = decodeOpaqueValue(
    'activity_detail_cursor',
    cursor,
    uid,
    connectionId,
    'pagination cursor',
  ) as unknown as Partial<ActivityDetailCursor>;
  if (
    parsed.activityId !== reference.activityId
    || parsed.detailKind !== detailKind
    || !Number.isSafeInteger(parsed.offset)
    || Number(parsed.offset) < 0
    || Number(parsed.offset) > MAX_ACTIVITY_DETAIL_ENTRIES
  ) {
    throw new McpDataError('invalid_request', 'The pagination cursor is invalid.');
  }
  return Number(parsed.offset);
}

function encodeActivityDetailOffset(
  reference: ActivityReference,
  detailKind: ActivityDetailKind,
  offset: number,
  uid: string,
  connectionId: string,
): string {
  return encodeOpaqueValue('activity_detail_cursor', {
    activityId: reference.activityId,
    detailKind,
    offset,
  }, uid, connectionId);
}

function asTimestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (
    value
    && typeof value === 'object'
    && typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    const time = Number((value as { toMillis: () => unknown }).toMillis());
    return Number.isFinite(time) ? time : null;
  }
  return asFiniteNumber(value);
}

function asBoundedString(
  value: unknown,
  maximumLength: number,
  pattern?: RegExp,
): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (
    !normalized
    || normalized.length > maximumLength
    || (pattern && !pattern.test(normalized))
  ) {
    return null;
  }
  return normalized;
}

function asSafeInteger(value: unknown): number | null {
  const numeric = asNonNegativeNumber(value);
  return numeric !== null && Number.isSafeInteger(numeric) ? numeric : null;
}

function asLatitude(value: unknown): number | null {
  const numeric = asFiniteNumber(value);
  return numeric !== null && numeric >= -90 && numeric <= 90 ? numeric : null;
}

function asLongitude(value: unknown): number | null {
  const numeric = asFiniteNumber(value);
  return numeric !== null && numeric >= -180 && numeric <= 180 ? numeric : null;
}

function measureJsonBytes(value: unknown, message: string): number {
  try {
    const serialized = JSON.stringify(value);
    return Buffer.byteLength(typeof serialized === 'string' ? serialized : 'null', 'utf8');
  } catch {
    throw new McpDataError('query_too_large', message);
  }
}

function requireJsonBudget(value: unknown, maximumBytes: number, message: string): void {
  if (measureJsonBytes(value, message) > maximumBytes) {
    throw new McpDataError('query_too_large', message);
  }
}

interface SafeActivityStats {
  durationSeconds: number | null;
  distanceMeters: number | null;
  ascentMeters: number | null;
  descentMeters: number | null;
  averageSpeedMetersPerSecond: number | null;
  maximumSpeedMetersPerSecond: number | null;
  averageHeartRateBpm: number | null;
  maximumHeartRateBpm: number | null;
  averagePowerWatts: number | null;
  maximumPowerWatts: number | null;
  averageCadenceRpm: number | null;
  maximumCadenceRpm: number | null;
  energyKilocalories: number | null;
}

interface SafePosition {
  latitudeDegrees: number;
  longitudeDegrees: number;
}

function projectActivityStats(value: unknown): SafeActivityStats {
  const stats = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    durationSeconds: asNonNegativeNumber(stats[DataDuration.type]),
    distanceMeters: asNonNegativeNumber(stats[DataDistance.type]),
    ascentMeters: asNonNegativeNumber(stats[DataAscent.type]),
    descentMeters: asNonNegativeNumber(stats[DataDescent.type]),
    averageSpeedMetersPerSecond: asNonNegativeNumber(stats[DataSpeedAvg.type]),
    maximumSpeedMetersPerSecond: asNonNegativeNumber(stats[DataSpeedMax.type]),
    averageHeartRateBpm: asNonNegativeNumber(stats[DataHeartRateAvg.type]),
    maximumHeartRateBpm: asNonNegativeNumber(stats[DataHeartRateMax.type]),
    averagePowerWatts: asNonNegativeNumber(stats[DataPowerAvg.type]),
    maximumPowerWatts: asNonNegativeNumber(stats[DataPowerMax.type]),
    averageCadenceRpm: asNonNegativeNumber(stats[DataCadenceAvg.type]),
    maximumCadenceRpm: asNonNegativeNumber(stats[DataCadenceMax.type]),
    energyKilocalories: asNonNegativeNumber(stats[DataEnergy.type]),
  };
}

function projectPosition(value: unknown): SafePosition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const position = value as Record<string, unknown>;
  const latitudeDegrees = asLatitude(position.latitudeDegrees);
  const longitudeDegrees = asLongitude(position.longitudeDegrees);
  return latitudeDegrees !== null && longitudeDegrees !== null
    ? { latitudeDegrees, longitudeDegrees }
    : null;
}

function normalizeActivityType(value: unknown): string | null {
  const candidate = asBoundedString(value, 120);
  if (!candidate) {
    return null;
  }
  return ActivityTypesHelper.resolveActivityType(candidate) || null;
}

function normalizeActivityTypes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.flatMap((candidate) => {
    const activityType = normalizeActivityType(candidate);
    return activityType ? [activityType] : [];
  }))].slice(0, 20);
}

function toAppUrl(baseUrl: string, path: string): string {
  const base = new URL(baseUrl);
  if (
    !['https:', 'http:'].includes(base.protocol)
    || base.username
    || base.password
  ) {
    throw new Error('Invalid MCP application base URL.');
  }
  return new URL(path, `${base.origin}/`).toString();
}

function projectBounds(value: unknown): RouteBounds | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const bounds = value as Record<string, unknown>;
  const minLatitudeDegrees = asLatitude(bounds.minLatitudeDegrees);
  const maxLatitudeDegrees = asLatitude(bounds.maxLatitudeDegrees);
  const minLongitudeDegrees = asLongitude(bounds.minLongitudeDegrees);
  const maxLongitudeDegrees = asLongitude(bounds.maxLongitudeDegrees);
  if (
    minLatitudeDegrees === null
    || maxLatitudeDegrees === null
    || minLongitudeDegrees === null
    || maxLongitudeDegrees === null
    || minLatitudeDegrees > maxLatitudeDegrees
    || minLongitudeDegrees > maxLongitudeDegrees
  ) {
    return null;
  }
  return {
    minLatitudeDegrees,
    maxLatitudeDegrees,
    minLongitudeDegrees,
    maxLongitudeDegrees,
  };
}

function projectLap(value: unknown, index: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const lap = value as Record<string, unknown>;
  const startTimeMs = asTimestampMs(lap.startDate);
  const endTimeMs = asTimestampMs(lap.endDate);
  if (
    startTimeMs === null
    || endTimeMs === null
    || endTimeMs < startTimeMs
  ) {
    return null;
  }
  return {
    index,
    lapNumber: asSafeInteger(lap.lapId),
    type: asBoundedString(lap.type, 80),
    startTimeMs,
    endTimeMs,
    startSampleIndex: asSafeInteger(lap.startIndex),
    endSampleIndex: asSafeInteger(lap.endIndex),
    stats: projectActivityStats(lap.stats),
  };
}

function projectJump(value: unknown, index: number, includeLocation: boolean) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const event = (value as Record<string, unknown>)[DataJumpEvent.type];
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return null;
  }
  const rawEvent = event as Record<string, unknown>;
  const jumpData = rawEvent.jumpData;
  if (!jumpData || typeof jumpData !== 'object' || Array.isArray(jumpData)) {
    return null;
  }
  const rawJump = jumpData as Record<string, unknown>;
  const timestampMs = asTimestampMs(rawEvent.timestamp);
  const distanceMeters = asNonNegativeNumber(rawJump.distance);
  const score = asNonNegativeNumber(rawJump.score);
  if (timestampMs === null || distanceMeters === null || score === null) {
    return null;
  }
  return {
    index,
    timestampMs,
    distanceMeters,
    heightMeters: asNonNegativeNumber(rawJump.height),
    hangTimeSeconds: asNonNegativeNumber(rawJump.hang_time),
    speedMetersPerSecond: asNonNegativeNumber(rawJump.speed),
    rotations: asNonNegativeNumber(rawJump.rotations),
    score,
    ...(includeLocation ? {
      latitudeDegrees: asLatitude(rawJump.position_lat),
      longitudeDegrees: asLongitude(rawJump.position_long),
    } : {}),
    locationRedacted: !includeLocation,
  };
}

function projectSwimLength(value: unknown, index: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const length = value as Record<string, unknown>;
  const startTimeMs = asTimestampMs(length.startDate);
  const endTimeMs = asTimestampMs(length.endDate);
  if (
    startTimeMs === null
    || endTimeMs === null
    || endTimeMs < startTimeMs
  ) {
    return null;
  }
  return {
    index,
    sourceIndex: asSafeInteger(length.index),
    lapIndex: asSafeInteger(length.lapIndex),
    startTimeMs,
    endTimeMs,
    type: asBoundedString(length.type, 40, /^[\p{L}\p{N}_ -]+$/u),
    stroke: asBoundedString(length.stroke, 40, /^[\p{L}\p{N}_ -]+$/u),
    strokeCount: asSafeInteger(length.strokes),
    elapsedTimeSeconds: asNonNegativeNumber(length.elapsedTime),
    timerTimeSeconds: asNonNegativeNumber(length.timerTime),
    distanceMeters: asNonNegativeNumber(length.distance),
    poolLengthMeters: asNonNegativeNumber(length.poolLength),
    averageSpeedMetersPerSecond: asNonNegativeNumber(length.avgSpeed),
    averageCadenceRpm: asNonNegativeNumber(length.avgCadence),
    averageHeartRateBpm: asNonNegativeNumber(length.avgHeartRate),
    maximumHeartRateBpm: asNonNegativeNumber(length.maxHeartRate),
    swolf: asNonNegativeNumber(length.swolf),
    energyKilocalories: asNonNegativeNumber(length.calories),
  };
}

function projectRoutePreviewDetails(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpDataError(
      'detail_not_available',
      'Route preview geometry is not available.',
    );
  }
  const preview = value as Record<string, unknown>;
  const sourcePointCount = asSafeInteger(preview.sourcePointCount);
  const pointCount = asSafeInteger(preview.pointCount);
  const segments = Array.isArray(preview.segments) ? preview.segments : [];
  if (
    preview.version !== 1
    || preview.encoding !== 'polyline5'
    || preview.precision !== 5
    || sourcePointCount === null
    || pointCount === null
    || pointCount <= 0
    || pointCount > MAX_ROUTE_PREVIEW_POINTS
    || segments.length === 0
    || segments.length > MAX_ROUTE_PREVIEW_SEGMENTS
  ) {
    throw new McpDataError(
      pointCount !== null && pointCount > MAX_ROUTE_PREVIEW_POINTS
        ? 'query_too_large'
        : 'detail_not_available',
      pointCount !== null && pointCount > MAX_ROUTE_PREVIEW_POINTS
        ? 'Route preview geometry exceeds the MCP point limit.'
        : 'Route preview geometry is not available.',
    );
  }
  const declaredSegmentPointCount = segments.reduce((sum, candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return Number.NaN;
    }
    const segmentPointCount = asSafeInteger(
      (candidate as Record<string, unknown>).pointCount,
    );
    return segmentPointCount === null ? Number.NaN : sum + segmentPointCount;
  }, 0);
  const declaredSegmentSourcePointCount = segments.reduce((sum, candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return Number.NaN;
    }
    const segment = candidate as Record<string, unknown>;
    const segmentSourcePointCount = asSafeInteger(segment.sourcePointCount);
    const segmentPointCount = asSafeInteger(segment.pointCount);
    return (
      segmentSourcePointCount === null
      || segmentPointCount === null
      || segmentSourcePointCount < segmentPointCount
    )
      ? Number.NaN
      : sum + segmentSourcePointCount;
  }, 0);
  if (
    !Number.isSafeInteger(declaredSegmentPointCount)
    || declaredSegmentPointCount !== pointCount
    || sourcePointCount < pointCount
    || !Number.isSafeInteger(declaredSegmentSourcePointCount)
    || declaredSegmentSourcePointCount !== sourcePointCount
  ) {
    throw new McpDataError(
      'detail_not_available',
      'Route preview geometry is not available.',
    );
  }
  const projectedSegments: Array<{
    segmentIndex: number;
    activityType: string | null;
    sourcePointCount: number;
    pointCount: number;
    bounds: RouteBounds | null;
    startPosition: SpatialPosition;
    endPosition: SpatialPosition;
    encodedPolyline: string;
  }> = [];
  const decodedSegments: SpatialPosition[][] = [];
  segments.forEach((candidate, segmentIndex) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return;
    }
    const segment = candidate as Record<string, unknown>;
    const segmentSourcePointCount = asSafeInteger(segment.sourcePointCount);
    const segmentPointCount = asSafeInteger(segment.pointCount);
    const encodedPolyline = segmentPointCount === null
      ? null
      : asBoundedString(
          segment.encodedPolyline,
          Math.min(MAX_ROUTE_PREVIEW_BYTES, segmentPointCount * 12),
          /^[\x3f-\x7e]+$/,
        );
    const encodedPointCountMatches = encodedPolyline !== null
      && segmentPointCount !== null
      && hasExactEncodedPolylinePointCount(
        encodedPolyline,
        segmentPointCount,
      );
    const decoded = encodedPointCountMatches
      ? decodeRoutePolyline5(encodedPolyline)
      : [];
    if (
      !encodedPolyline
      || !encodedPointCountMatches
      || segmentSourcePointCount === null
      || segmentPointCount === null
      || segmentPointCount <= 0
      || decoded.length !== segmentPointCount
      || decoded.some(point => !isValidSpatialPosition(point))
    ) {
      return;
    }
    projectedSegments.push({
      segmentIndex,
      activityType: normalizeActivityType(segment.activityType),
      sourcePointCount: segmentSourcePointCount,
      pointCount: segmentPointCount,
      bounds: projectBounds(segment.bounds),
      startPosition: decoded[0],
      endPosition: decoded[decoded.length - 1],
      encodedPolyline,
    });
    decodedSegments.push(decoded);
  });
  if (projectedSegments.length !== segments.length) {
    throw new McpDataError(
      'detail_not_available',
      'Route preview geometry is not available.',
    );
  }
  const projected = {
    version: 1 as const,
    encoding: 'polyline5' as const,
    precision: 5 as const,
    sourcePointCount,
    pointCount,
    bounds: projectBounds(preview.bounds),
    segments: projectedSegments,
  };
  requireJsonBudget(
    projected,
    MAX_ROUTE_PREVIEW_BYTES,
    'Route preview geometry exceeds the MCP response limit.',
  );
  return {
    geometry: projected,
    decodedSegments,
  };
}

function hasExactEncodedPolylinePointCount(
  encodedPolyline: string,
  expectedPointCount: number,
): boolean {
  const expectedComponentCount = expectedPointCount * 2;
  let componentCount = 0;
  let index = 0;
  while (index < encodedPolyline.length) {
    let componentComplete = false;
    for (let chunkCount = 0; chunkCount < 6; chunkCount += 1) {
      if (index >= encodedPolyline.length) {
        return false;
      }
      const chunk = encodedPolyline.charCodeAt(index) - 63;
      index += 1;
      if (chunk < 0 || chunk > 63) {
        return false;
      }
      if (chunk < 0x20) {
        componentComplete = true;
        break;
      }
    }
    if (!componentComplete) {
      return false;
    }
    componentCount += 1;
    if (componentCount > expectedComponentCount) {
      return false;
    }
  }
  return componentCount === expectedComponentCount;
}

function projectRoutePreview(value: unknown) {
  return projectRoutePreviewDetails(value).geometry;
}

function projectRouteWaypoint(value: unknown, index: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const waypoint = value as Record<string, unknown>;
  const latitudeDegrees = asLatitude(waypoint.latitudeDegrees);
  const longitudeDegrees = asLongitude(waypoint.longitudeDegrees);
  if (latitudeDegrees === null || longitudeDegrees === null) {
    return null;
  }
  return {
    index,
    latitudeDegrees,
    longitudeDegrees,
    altitudeMeters: asFiniteNumber(waypoint.altitude),
    distanceMeters: asNonNegativeNumber(waypoint.distance),
    routeIndex: asSafeInteger(waypoint.routeIndex),
    routePointIndex: asSafeInteger(waypoint.routePointIndex),
    type: asBoundedString(waypoint.type, 40, /^[A-Za-z0-9_-]+$/),
  };
}

function getPrimaryRouteSource(
  data: Record<string, unknown>,
): OriginalRouteFileMetaData | null {
  if (Array.isArray(data.originalFiles)) {
    const source = data.originalFiles.find(candidate => (
      candidate
      && typeof candidate === 'object'
      && !Array.isArray(candidate)
      && typeof (candidate as { path?: unknown }).path === 'string'
      && Boolean((candidate as { path: string }).path.trim())
    ));
    if (source) {
      return source as OriginalRouteFileMetaData;
    }
  }
  if (
    data.originalFile
    && typeof data.originalFile === 'object'
    && !Array.isArray(data.originalFile)
    && typeof (data.originalFile as { path?: unknown }).path === 'string'
    && Boolean((data.originalFile as { path: string }).path.trim())
  ) {
    return data.originalFile as OriginalRouteFileMetaData;
  }
  return null;
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

function resolveMeasurementTimeInterval(
  interval: McpMeasurementInterval,
): TimeIntervals {
  switch (interval) {
    case 'day':
      return TimeIntervals.Daily;
    case 'week':
      return TimeIntervals.Weekly;
    case 'month':
      return TimeIntervals.Monthly;
    default:
      throw new McpDataError('invalid_request', 'Unsupported measurement interval.');
  }
}

function aggregateMeasurementBucket(
  measurements: readonly { recordedAtMs: number; value: number }[],
  aggregation: McpMeasurementAggregation,
): number {
  const values = measurements.map(measurement => measurement.value);
  switch (aggregation) {
    case 'median': {
      const sorted = [...values].sort((left, right) => left - right);
      const middle = Math.floor(sorted.length / 2);
      if (sorted.length % 2 !== 0) {
        return sorted[middle];
      }
      const lower = sorted[middle - 1];
      const upper = sorted[middle];
      return lower < 0 && upper > 0
        ? (lower + upper) / 2
        : lower + ((upper - lower) / 2);
    }
    case 'average':
      return values.reduce((average, value, index) => (
        average + ((value - average) / (index + 1))
      ), 0);
    case 'minimum':
      return Math.min(...values);
    case 'maximum':
      return Math.max(...values);
    case 'latest':
      return measurements.reduce((latest, measurement) => (
        measurement.recordedAtMs >= latest.recordedAtMs ? measurement : latest
      )).value;
    default:
      throw new McpDataError('invalid_request', 'Unsupported measurement aggregation.');
  }
}

function buildMeasurementPoints(
  measurements: readonly { recordedAtMs: number; value: number }[],
  interval: McpMeasurementInterval,
  aggregation: McpMeasurementAggregation,
  timeZone: string,
): McpMeasurementPoint[] {
  const timeInterval = resolveMeasurementTimeInterval(interval);
  const buckets = new Map<number, Array<{ recordedAtMs: number; value: number }>>();
  measurements.forEach((measurement) => {
    const bucketStartTimeMs = resolveDateAggregationBucketStart(
      new Date(measurement.recordedAtMs),
      timeInterval,
      timeZone,
    );
    const bucket = buckets.get(bucketStartTimeMs) || [];
    bucket.push(measurement);
    buckets.set(bucketStartTimeMs, bucket);
  });

  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bucketStartTimeMs, bucketMeasurements]) => ({
      bucketStartTimeMs,
      value: aggregateMeasurementBucket(bucketMeasurements, aggregation),
      measurementCount: bucketMeasurements.length,
    }));
}

function resolveActivityTypes(activityTypes: readonly string[] | undefined): ActivityTypes[] {
  if ((activityTypes || []).length > 20) {
    throw new McpDataError(
      'invalid_request',
      'At most 20 activity types can be requested.',
    );
  }
  return (activityTypes || []).map((activityType) => {
    const resolved = ActivityTypesHelper.resolveActivityType(activityType);
    if (!resolved) {
      throw new McpDataError('invalid_request', `Unknown activity type: ${activityType}`);
    }
    return resolved;
  });
}

function resolveCanonicalActivityTypes(
  activityTypes: readonly string[] | undefined,
): string[] {
  return [
    ...new Set(resolveActivityTypes(activityTypes).map(String)),
  ].sort();
}

function normalizeRouteSearch(search: string | undefined): string | null {
  const normalized = `${search || ''}`.trim().toLowerCase();
  if (normalized.length > 120) {
    throw new McpDataError(
      'invalid_request',
      'Route search text must not exceed 120 characters.',
    );
  }
  return normalized || null;
}

function resolveRouteListQuery(input: ListRoutesInput): {
  cursor?: OrderedDocumentCursor;
  query: ResolvedRouteListQuery;
} {
  const query: ResolvedRouteListQuery = {
    activityTypes: resolveCanonicalActivityTypes(input.activityTypes),
    search: normalizeRouteSearch(input.search),
  };
  return {
    cursor: decodeRouteListCursor(input.cursor, input, query),
    query,
  };
}

function resolveRelativeActivityRange(
  relativePeriod: McpActivityRelativePeriod,
  timeZone: string,
  nowTimeMs: number,
): {
  startTimeMs: number;
  endTimeMs: number;
} {
  if (!Number.isSafeInteger(nowTimeMs)) {
    throw new McpDataError(
      'temporarily_unavailable',
      'The current activity date could not be resolved.',
    );
  }
  const todayStartTimeMs = resolveDateAggregationBucketStart(
    new Date(nowTimeMs),
    TimeIntervals.Daily,
    timeZone,
  );
  if (relativePeriod === 'yesterday') {
    const startTimeMs = resolveDateAggregationBucketStart(
      new Date(todayStartTimeMs - 1),
      TimeIntervals.Daily,
      timeZone,
    );
    return {
      startTimeMs,
      endTimeMs: todayStartTimeMs - 1,
    };
  }
  const nextDayStartTimeMs = resolveDateAggregationBucketStart(
    new Date(todayStartTimeMs + RELATIVE_DAY_FORWARD_PROBE_MS),
    TimeIntervals.Daily,
    timeZone,
  );
  return {
    startTimeMs: todayStartTimeMs,
    endTimeMs: nextDayStartTimeMs - 1,
  };
}

function resolveActivityListQuery(
  dependencies: Pick<McpDataServiceDependencies, 'now'>,
  input: Omit<
    ListActivitiesInput,
    'appBaseUrl' | 'includeLocation' | 'limit'
  >,
): {
  cursor?: OrderedDocumentCursor;
  query: ResolvedActivityListQuery;
} {
  const activityTypes = resolveCanonicalActivityTypes(input.activityTypes);
  const relativePeriod = input.relativePeriod ?? null;
  if (
    relativePeriod !== null
    && !MCP_ACTIVITY_RELATIVE_PERIODS.includes(relativePeriod)
  ) {
    throw new McpDataError(
      'invalid_request',
      'relativePeriod must be today or yesterday.',
    );
  }
  if (
    relativePeriod !== null
    && (input.startTimeMs !== undefined || input.endTimeMs !== undefined)
  ) {
    throw new McpDataError(
      'invalid_request',
      'relativePeriod cannot be combined with start or end.',
    );
  }
  if (relativePeriod === null && input.timeZone !== undefined) {
    throw new McpDataError(
      'invalid_request',
      'timeZone is allowed only with relativePeriod.',
    );
  }
  const timeZone = relativePeriod === null
    ? null
    : requireTimeZone(input.timeZone || '');
  if (relativePeriod === null) {
    validateOptionalBoundedRange(input.startTimeMs, input.endTimeMs);
  }

  const decoded = decodeActivityListCursor(
    input.cursor,
    {
      ...input,
      relativePeriod: relativePeriod ?? undefined,
      timeZone: timeZone ?? undefined,
    },
    activityTypes,
  );
  if (decoded) {
    return decoded;
  }
  if (relativePeriod !== null && timeZone !== null) {
    return {
      query: {
        ...resolveRelativeActivityRange(
          relativePeriod,
          timeZone,
          dependencies.now(),
        ),
        activityTypes,
        relativePeriod,
        timeZone,
      },
    };
  }
  return {
    query: {
      startTimeMs: input.startTimeMs,
      endTimeMs: input.endTimeMs,
      activityTypes,
      relativePeriod: null,
      timeZone: null,
    },
  };
}

function eventMatchesActivityFilter(event: EventInterface, activityTypes: readonly ActivityTypes[]): boolean {
  if (!activityTypes.length) {
    return true;
  }
  const eventActivityTypes = event.getActivityTypesAsArray?.() || [];
  return activityTypes.some(activityType => eventActivityTypes.includes(activityType));
}

function buildMetricAggregationEventJson(
  data: Record<string, unknown>,
  metricTypes: readonly string[],
): EventJSONInterface {
  const rawStats = data.stats && typeof data.stats === 'object' && !Array.isArray(data.stats)
    ? data.stats as Record<string, unknown>
    : {};
  const stats = Object.fromEntries(
    [...new Set([...metricTypes, DataActivityTypes.type])].flatMap((type) => {
      const value = rawStats[type];
      if (value === undefined) {
        return [];
      }
      try {
        DynamicDataLoader.getDataInstanceFromDataType(type, value);
        return [[type, value]];
      } catch {
        return [];
      }
    }),
  );

  return {
    ...data,
    stats,
    // Only the requested metric stats and activity type cross the Sports Lib
    // import boundary after the cumulative query budgets have passed.
    activities: [],
    powerCurve: null,
  } as unknown as EventJSONInterface;
}

function measureStatsWork(data: Record<string, unknown>): {
  byteLength: number;
  entryCount: number;
} {
  const stats = data.stats;
  let serialized: string;
  try {
    const encoded = JSON.stringify(stats ?? null);
    serialized = typeof encoded === 'string' ? encoded : 'null';
  } catch {
    throw new McpDataError(
      'query_too_large',
      'The query contains event stats that cannot be processed safely.',
    );
  }
  return {
    byteLength: Buffer.byteLength(serialized, 'utf8'),
    entryCount: stats && typeof stats === 'object' && !Array.isArray(stats)
      ? Object.keys(stats).length
      : 0,
  };
}

async function fetchBoundedEventDocuments(
  dependencies: McpDataServiceDependencies,
  input: Pick<QueryMetricInput, 'uid' | 'startTimeMs' | 'endTimeMs'>,
): Promise<RawDocument[]> {
  const documents: RawDocument[] = [];
  let cursor: unknown;
  let statsBytes = 0;
  let statEntries = 0;

  while (documents.length <= MAX_EVENT_QUERY_DOCUMENTS) {
    const pageLimit = Math.min(
      EVENT_QUERY_PAGE_SIZE,
      MAX_EVENT_QUERY_DOCUMENTS + 1 - documents.length,
    );
    const page = await dependencies.fetchEventDocuments(
      input.uid,
      input.startTimeMs,
      input.endTimeMs,
      pageLimit,
      cursor,
    );
    if (page.length > pageLimit) {
      throw new McpDataError(
        'query_too_large',
        `The query matches more than ${MAX_EVENT_QUERY_DOCUMENTS} events. Narrow the date range.`,
      );
    }

    for (const document of page) {
      const work = measureStatsWork(document.data);
      statsBytes += work.byteLength;
      statEntries += work.entryCount;
      if (
        statsBytes > MAX_EVENT_QUERY_STATS_BYTES
        || statEntries > MAX_EVENT_QUERY_STAT_ENTRIES
      ) {
        throw new McpDataError(
          'query_too_large',
          'The query contains too much event metric data. Narrow the date range.',
        );
      }
      documents.push({
        id: document.id,
        data: document.data,
      });
      if (documents.length > MAX_EVENT_QUERY_DOCUMENTS) {
        throw new McpDataError(
          'query_too_large',
          `The query matches more than ${MAX_EVENT_QUERY_DOCUMENTS} events. Narrow the date range.`,
        );
      }
    }

    if (page.length < pageLimit) {
      return documents;
    }
    cursor = page[page.length - 1]?.cursor;
    if (cursor === undefined) {
      throw new Error('The MCP event query page did not provide a pagination cursor.');
    }
  }

  return documents;
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
  aggregation: McpMetricAggregation;
  groupBy: 'date' | 'activity_type';
  interval: 'auto' | 'hourly' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semesterly' | 'yearly';
  timeZone: string;
  activityTypes?: readonly string[];
}

export type McpMetricAggregation =
  | 'total'
  | 'average'
  | 'minimum'
  | 'maximum';

export interface McpMetricSelectorInput {
  metric: string;
  aggregation: McpMetricAggregation;
}

export interface QueryMetricsInput
  extends Omit<QueryMetricInput, 'metric' | 'aggregation'> {
  metrics: readonly McpMetricSelectorInput[];
}

export interface ListTrainingMetricsInput {
  uid: string;
  search?: string;
}

export type McpTrainingMetricAvailability =
  | 'ready'
  | 'building'
  | 'failed'
  | 'stale'
  | 'missing'
  | 'schema_mismatch';

export interface McpTrainingMetricAvailabilityDescriptor
  extends McpTrainingMetricDescriptor {
  status: McpTrainingMetricAvailability;
  updatedAtMs: number | null;
  sourceEventCount: number | null;
}

export interface ListTrainingMetricsResult {
  metrics: McpTrainingMetricAvailabilityDescriptor[];
}

interface ResolvedMetricSelector {
  metric: McpMetricDescriptor;
  aggregation: McpMetricAggregation;
}

function resolveMetricSelectors(
  selectors: readonly McpMetricSelectorInput[],
): ResolvedMetricSelector[] {
  if (
    !Array.isArray(selectors)
    || selectors.length === 0
    || selectors.length > MAX_MULTI_METRIC_SELECTORS
  ) {
    throw new McpDataError(
      'invalid_request',
      `Choose between 1 and ${MAX_MULTI_METRIC_SELECTORS} metric selections.`,
    );
  }
  const resolved = selectors.map((selector) => {
    if (
      !selector
      || typeof selector !== 'object'
      || Array.isArray(selector)
    ) {
      throw new McpDataError(
        'invalid_metric',
        'Each metric selection must identify a supported numeric Sports Lib type.',
      );
    }
    const metric = resolveSportsLibNumericMetric(selector.metric);
    if (!metric || isFirstClassMcpMeasurementMetric(metric.type)) {
      throw new McpDataError(
        'invalid_metric',
        'Each metric selection must identify a supported numeric Sports Lib type.',
      );
    }
    resolveValueType(selector.aggregation);
    return {
      metric,
      aggregation: selector.aggregation,
    };
  });
  return [...new Map(resolved.map(selector => [
    `${selector.metric.type}\0${selector.aggregation}`,
    selector,
  ])).values()];
}

async function querySelectedMetrics(
  dependencies: McpDataServiceDependencies,
  input: QueryMetricsInput,
) {
  validateBoundedRange(input.startTimeMs, input.endTimeMs);
  const timeZone = requireTimeZone(input.timeZone);
  const selectors = resolveMetricSelectors(input.metrics);
  const activityTypes = resolveActivityTypes(input.activityTypes);
  const docs = await fetchBoundedEventDocuments(dependencies, input);
  const metricTypes = [...new Set(
    selectors.map(selector => selector.metric.type),
  )];
  const events = docs.flatMap((doc) => {
    if (isBenchmarkEventForTrainingMetrics(doc.data)) {
      return [];
    }
    try {
      const event = dependencies.importEvent(
        buildMetricAggregationEventJson(doc.data, metricTypes),
        doc.id,
      );
      return eventMatchesActivityFilter(event, activityTypes) ? [event] : [];
    } catch {
      return [];
    }
  });
  const results = selectors.map(selector => ({
    metric: selector.metric,
    matchedEventCount: events.length,
    aggregation: buildEventStatAggregation(events, {
      dataType: selector.metric.type,
      valueType: resolveValueType(selector.aggregation),
      categoryType: resolveCategoryType(input.groupBy),
      requestedTimeInterval: resolveTimeInterval(input.interval),
      timeZone,
    }),
  }));
  const result = {
    results,
  };
  requireJsonBudget(
    result,
    MAX_MULTI_METRIC_RESPONSE_BYTES,
    'The multi-metric query exceeds the MCP response limit.',
  );
  return result;
}

export interface ListMeasurementTypesResult {
  measurementTypes: McpMeasurementDescriptor[];
}

export interface QueryMeasurementsInput {
  uid: string;
  measurementType: string;
  startTimeMs: number;
  endTimeMs: number;
  aggregation: McpMeasurementAggregation;
  interval: McpMeasurementInterval;
  timeZone: string;
}

export interface McpMeasurementPoint {
  bucketStartTimeMs: number;
  value: number;
  measurementCount: number;
}

export interface QueryMeasurementsResult {
  measurementType: McpMeasurementDescriptor;
  startTimeMs: number;
  endTimeMs: number;
  timeZone: string;
  aggregation: McpMeasurementAggregation;
  interval: McpMeasurementInterval;
  measurementCount: number;
  points: McpMeasurementPoint[];
  summary: {
    firstPoint: McpMeasurementPoint;
    latestPoint: McpMeasurementPoint;
    absoluteChange: number;
  } | null;
}

function redactDerivedPayload(
  value: unknown,
  parentKey = '',
  inheritedEventIdentityContext = false,
): unknown {
  if (Array.isArray(value)) {
    return value.map(child => redactDerivedPayload(
      child,
      parentKey,
      inheritedEventIdentityContext,
    ));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const redactedKeys = /(?:event|activity).*(?:id|name|label)s?$/i;
  const compositeIdentityKeys = /^(?:selectionKey|sourceFingerprint|sourceKey|previousSourceKey)$/i;
  const nestedIdentityKeys = /^(?:id|name|label)s?$/i;
  const parentIsEventIdentity = /(?:event|activity)/i.test(parentKey);
  const objectHasEventIdentity = entries.some(([key]) => /(?:event|activity).*ids?$/i.test(key));
  const objectIsEventIdentity = entries.some(([key]) => /^(?:event|activity)Ids?$/i.test(key));
  const eventIdentityContext = inheritedEventIdentityContext
    || parentIsEventIdentity
    || objectIsEventIdentity;
  return Object.fromEntries(
    entries
      .filter(([key]) => (
        !redactedKeys.test(key)
        && !compositeIdentityKeys.test(key)
        && !((eventIdentityContext || objectHasEventIdentity) && nestedIdentityKeys.test(key))
      ))
      .map(([key, child]) => [
        key,
        redactDerivedPayload(child, key, eventIdentityContext),
      ]),
  );
}

function normalizeSleepProvider(value: unknown): SleepProvider | null {
  return Object.values(SLEEP_PROVIDERS).includes(value as SleepProvider)
    ? value as SleepProvider
    : null;
}

type McpSafeSleepVitals = Partial<Record<McpSleepVitalType, number>>;

function normalizeSleepVitals(value: unknown): McpSafeSleepVitals | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const entries: Array<[typeof SAFE_SLEEP_VITAL_KEYS[number], number]> = [];
  SAFE_SLEEP_VITAL_KEYS.forEach((key) => {
    const numeric = asNonNegativeNumber(raw[key]);
    if (
      numeric !== null
      && (
        (key === 'hrvSampleCount' && Number.isSafeInteger(numeric))
        || (key !== 'hrvSampleCount' && numeric > 0)
      )
    ) {
      entries.push([key, numeric]);
    }
  });
  const normalized = Object.fromEntries(entries) as McpSafeSleepVitals;
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
  vitals: McpSafeSleepVitals | null;
}

function toSafeSleepSession(data: Record<string, unknown>): SafeSleepSession | null {
  const source = data.source && typeof data.source === 'object'
    ? data.source as Record<string, unknown>
    : {};
  const provider = normalizeSleepProvider(source.provider);
  const startTimeMs = asFiniteNumber(data.startTimeMs);
  const endTimeMs = asFiniteNumber(data.endTimeMs);
  const durationSeconds = asNonNegativeNumber(data.durationSeconds);
  const sleepDate = normalizeCalendarDate(data.sleepDate);
  if (
    !provider
    || startTimeMs === null
    || endTimeMs === null
    || endTimeMs <= startTimeMs
    || durationSeconds === null
    || durationSeconds <= 0
    || sleepDate === null
  ) {
    return null;
  }

  const rawScore = data.score && typeof data.score === 'object'
    ? data.score as Record<string, unknown>
    : null;
  const scoreValue = rawScore ? asNonNegativeNumber(rawScore.value) : null;
  const scoreQualifier = typeof rawScore?.qualifier === 'string'
    && rawScore.qualifier.trim()
    && rawScore.qualifier.trim().length <= 120
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
  connectionId: string;
  startTimeMs: number;
  endTimeMs: number;
  includeNaps?: boolean;
  provider?: SleepProvider;
  cursor?: string;
  limit?: number;
}

export interface ListSleepVitalsInput {
  uid: string;
  startTimeMs: number;
  endTimeMs: number;
  includeNaps?: boolean;
  provider?: SleepProvider;
}

export interface McpSleepVitalAvailability extends McpSleepVitalDescriptor {
  sessionCount: number;
}

export interface ListSleepVitalsResult {
  matchedSessionCount: number;
  vitals: McpSleepVitalAvailability[];
}

export type McpSleepSummaryGroupBy = 'day' | 'week' | 'month';

export interface QuerySleepSummaryInput {
  uid: string;
  startTimeMs: number;
  endTimeMs: number;
  includeNaps?: boolean;
  provider?: SleepProvider;
  groupBy: McpSleepSummaryGroupBy;
  timeZone: string;
}

export interface McpSleepSummaryBucket {
  bucketStartMs: number;
  sessionCount: number;
  providers: SleepProvider[];
  totalDurationSeconds: number;
  averageDurationSeconds: number;
  averageInBedDurationSeconds: number | null;
  averageScore: number | null;
  stageDurationsSeconds: Partial<Record<SleepStage, number>>;
  averageVitals: McpSafeSleepVitals;
}

export interface QuerySleepSummaryResult {
  timeZone: string;
  groupBy: McpSleepSummaryGroupBy;
  matchedSessionCount: number;
  buckets: McpSleepSummaryBucket[];
}

export type GetSleepTrendInput = QuerySleepSummaryInput;

export interface GetSleepTrendResult extends QuerySleepSummaryResult {
  rangeStartTimeMs: number;
  rangeEndTimeMs: number;
  availableVitals: McpSleepVitalAvailability[];
}

export interface GetDailyBriefingInput {
  uid: string;
  timeZone: string;
}

export type GetDailyReportInput = GetDailyBriefingInput;

export interface GetTodayReadinessInput {
  uid: string;
  timeZone: string;
}

type TodayReadinessAvailability = 'available' | 'no_signal';
type TodayReadinessMetricStatus =
  | 'available'
  | 'insufficient_baseline'
  | 'not_recorded';

interface TodayReadinessLoadDriver {
  status: 'available' | 'not_ready';
  weightPercent: 40;
  form: number | null;
  rampRate: number | null;
  asOfDayMs: number | null;
  sourceUpdatedAtMs: number | null;
}

interface TodayReadinessSleepDriver {
  status: 'available' | 'no_recent_session';
  weightPercent: 25;
  score: number | null;
  scoreSource: 'recorded' | 'duration' | null;
  latestSleepAtMs: number | null;
  sleepDate: string | null;
  durationSeconds: number | null;
  recordedScore: number | null;
}

interface TodayReadinessHrvDriver {
  status: TodayReadinessMetricStatus;
  weightPercent: 20;
  latestMs: number | null;
  baselineMedianMs: number | null;
  baselineNightCount: number;
  ratio: number | null;
}

interface TodayReadinessHeartRateDriver {
  status: TodayReadinessMetricStatus;
  latestBpm: number | null;
  baselineMedianBpm: number | null;
  baselineNightCount: number;
  ratio: number | null;
}

interface TodayReadinessOvernightHeartRateDriver {
  status: TodayReadinessMetricStatus;
  weightPercent: 15;
  combinedRatio: number | null;
  average: TodayReadinessHeartRateDriver;
  minimum: TodayReadinessHeartRateDriver;
}

export interface GetTodayReadinessResult {
  asOfTimeMs: number;
  timeZone: string;
  localDayStartTimeMs: number;
  localDayEndTimeMs: number;
  dayBoundary: 'UTC';
  asOfDayMs: number;
  formulaVersion: typeof READINESS_FORMULA_VERSION;
  status: TodayReadinessAvailability;
  score: number | null;
  label: 'Ready' | 'Mixed' | 'Recover' | null;
  confidence: 'high' | 'medium' | 'low' | null;
  availableSignalCount: number;
  availableWeightPercent: number;
  baselineEvidenceCount: number;
  totalSignalCount: typeof READINESS_TOTAL_SIGNAL_COUNT;
  drivers: {
    load: TodayReadinessLoadDriver;
    sleep: TodayReadinessSleepDriver;
    hrv: TodayReadinessHrvDriver;
    overnightHeartRate: TodayReadinessOvernightHeartRateDriver;
  };
}

interface DailyBriefingSleepSession {
  sleepDate: string;
  startTimeMs: number;
  endTimeMs: number;
  durationSeconds: number;
  inBedDurationSeconds: number | null;
  score: {
    value: number | null;
    qualifier: string | null;
  } | null;
}

interface DailyReportSleepVitals {
  averageHrvMs: number | null;
  overnightHrvMs: number | null;
  averageHeartRateBpm: number | null;
  minimumHeartRateBpm: number | null;
}

interface DailyReportSleepSession extends DailyBriefingSleepSession {
  vitals: DailyReportSleepVitals;
}

interface DailyReportSleepNight {
  id: string;
  provider: SleepProvider;
  sleepDate: string;
  startTimeMs: number;
  endTimeMs: number;
  durationSeconds: number;
  session: DailyReportSleepSession;
  evidence: ReadinessSleepEvidencePoint;
}

interface DailyBriefingReadiness {
  status: 'available' | 'no_signal' | 'not_ready' | 'stale';
  dayBoundary: 'UTC';
  asOfDayMs: number | null;
  generatedAtMs: number | null;
  updatedAtMs: number | null;
  score: number | null;
  label: 'Ready' | 'Mixed' | 'Recover' | null;
  confidence: 'high' | 'medium' | 'low' | null;
  availableSignalCount: number | null;
  baselineEvidenceCount: number | null;
}

interface DailyTrainingSummaryWindow {
  equivalentPeriodDays: number;
  activityCount: number;
  durationSeconds: number;
  intensitySeconds: {
    easy: number;
    moderate: number;
    hard: number;
  };
}

interface DailyTrainingSummaryDiscipline {
  discipline: 'running' | 'cycling' | 'swimming';
  current28d: DailyTrainingSummaryWindow;
  usual28d: DailyTrainingSummaryWindow;
}

interface DailyTrainingSummary {
  status: 'available' | 'not_ready' | 'stale';
  dayBoundary: 'UTC';
  asOfDayMs: number | null;
  updatedAtMs: number | null;
  baselineSourceWindowDays: number | null;
  current28d: DailyTrainingSummaryWindow | null;
  usual28d: DailyTrainingSummaryWindow | null;
  disciplines: DailyTrainingSummaryDiscipline[];
}

function projectDailyBriefingSleepSession(
  session: SafeSleepSession,
): DailyBriefingSleepSession {
  return {
    sleepDate: session.sleepDate,
    startTimeMs: session.startTimeMs,
    endTimeMs: session.endTimeMs,
    durationSeconds: session.durationSeconds,
    inBedDurationSeconds: session.inBedDurationSeconds,
    score: session.score,
  };
}

function unavailableDailyBriefingReadiness(
  status: 'no_signal' | 'not_ready',
): DailyBriefingReadiness {
  return {
    status,
    dayBoundary: 'UTC',
    asOfDayMs: null,
    generatedAtMs: null,
    updatedAtMs: null,
    score: null,
    label: null,
    confidence: null,
    availableSignalCount: null,
    baselineEvidenceCount: null,
  };
}

function projectDailyBriefingReadiness(
  snapshot: Record<string, unknown> | null,
  nowTimeMs: number,
): DailyBriefingReadiness {
  const schemaVersion = asFiniteNumber(snapshot?.schemaVersion);
  if (
    !snapshot
    || snapshot.status !== 'ready'
    || snapshot.payload == null
    || schemaVersion !== DERIVED_METRIC_SCHEMA_VERSION
  ) {
    return unavailableDailyBriefingReadiness('not_ready');
  }

  const parsed = MCP_DERIVED_PAYLOAD_SCHEMAS[
    DERIVED_METRIC_KINDS.TrainingReadiness
  ].safeParse(snapshot.payload);
  if (!parsed.success) {
    return unavailableDailyBriefingReadiness('not_ready');
  }
  const payload = parsed.data as DerivedTrainingReadinessMetricPayload;
  const now = new Date(nowTimeMs);
  const currentUtcDayMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const common = {
    dayBoundary: 'UTC' as const,
    asOfDayMs: payload.asOfDayMs,
    generatedAtMs: payload.generatedAtMs,
    updatedAtMs: asFiniteNumber(snapshot.updatedAtMs),
  };
  if (payload.asOfDayMs !== currentUtcDayMs) {
    return {
      status: 'stale',
      ...common,
      score: null,
      label: null,
      confidence: null,
      availableSignalCount: null,
      baselineEvidenceCount: null,
    };
  }

  const point = payload.points.find(candidate => candidate.dayMs === payload.asOfDayMs);
  if (
    !point
    || point.score === null
    || point.label === null
    || point.confidence === null
  ) {
    return {
      status: 'no_signal',
      ...common,
      score: null,
      label: null,
      confidence: null,
      availableSignalCount: null,
      baselineEvidenceCount: null,
    };
  }

  return {
    status: 'available',
    ...common,
    score: point.score,
    label: point.label,
    confidence: point.confidence,
    availableSignalCount: point.availableSignalCount,
    baselineEvidenceCount: point.baselineEvidenceCount,
  };
}

function projectDailyTrainingSummaryWindow(
  window: DerivedTrainingSummaryMetricPayload['disciplines'][number]['current28d'],
): DailyTrainingSummaryWindow {
  return {
    equivalentPeriodDays: window.periodDays,
    activityCount: window.activityCount,
    durationSeconds: window.durationSeconds,
    intensitySeconds: {
      easy: window.easySeconds,
      moderate: window.moderateSeconds,
      hard: window.hardSeconds,
    },
  };
}

function unavailableDailyTrainingSummary(
  status: 'not_ready' | 'stale',
  snapshot?: Record<string, unknown> | null,
  asOfDayMs?: number,
): DailyTrainingSummary {
  return {
    status,
    dayBoundary: 'UTC',
    asOfDayMs: asOfDayMs ?? null,
    updatedAtMs: status === 'stale'
      ? asSafeOperationalTimestampMs(snapshot?.updatedAtMs)
      : null,
    baselineSourceWindowDays: null,
    current28d: null,
    usual28d: null,
    disciplines: [],
  };
}

function projectDailyTrainingSummary(
  snapshot: Record<string, unknown> | null,
  nowTimeMs: number,
): DailyTrainingSummary {
  const schemaVersion = asFiniteNumber(snapshot?.schemaVersion);
  if (
    !snapshot
    || snapshot.status !== 'ready'
    || snapshot.payload == null
    || schemaVersion !== DERIVED_METRIC_SCHEMA_VERSION
  ) {
    return unavailableDailyTrainingSummary('not_ready');
  }
  const parsed = MCP_DERIVED_PAYLOAD_SCHEMAS[
    DERIVED_METRIC_KINDS.TrainingSummary
  ].safeParse(snapshot.payload);
  if (!parsed.success) {
    return unavailableDailyTrainingSummary('not_ready');
  }
  const payload = parsed.data as DerivedTrainingSummaryMetricPayload;
  const now = new Date(nowTimeMs);
  const currentUtcDayMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  if (payload.asOfDayMs !== currentUtcDayMs) {
    return unavailableDailyTrainingSummary(
      'stale',
      snapshot,
      payload.asOfDayMs,
    );
  }
  const hasExpectedWindowContract = payload.excludesMergedEvents
    && payload.currentWindowDays === DAILY_TRAINING_SUMMARY_CURRENT_WINDOW_DAYS
    && payload.baselineWindowDays === DAILY_TRAINING_SUMMARY_BASELINE_WINDOW_DAYS;
  const hasExpectedDisciplines = payload.disciplines.length
    === DAILY_TRAINING_SUMMARY_DISCIPLINES.length
    && DAILY_TRAINING_SUMMARY_DISCIPLINES.every(expectedDiscipline => (
      payload.disciplines.filter(
        discipline => discipline.discipline === expectedDiscipline,
      ).length === 1
    ))
    && payload.disciplines.every(discipline => (
      discipline.current28d.periodDays === DAILY_TRAINING_SUMMARY_CURRENT_WINDOW_DAYS
      && discipline.baseline28d.periodDays === DAILY_TRAINING_SUMMARY_CURRENT_WINDOW_DAYS
    ));
  if (!hasExpectedWindowContract || !hasExpectedDisciplines) {
    return unavailableDailyTrainingSummary('not_ready');
  }
  const disciplines = payload.disciplines.map(discipline => ({
    discipline: discipline.discipline,
    current28d: projectDailyTrainingSummaryWindow(discipline.current28d),
    usual28d: projectDailyTrainingSummaryWindow(discipline.baseline28d),
  }));
  const total = (window: 'current28d' | 'usual28d') => {
    const windows = disciplines.map(discipline => discipline[window]);
    return {
      equivalentPeriodDays: payload.currentWindowDays,
      activityCount: windows.reduce((sum, entry) => sum + entry.activityCount, 0),
      durationSeconds: windows.reduce((sum, entry) => sum + entry.durationSeconds, 0),
      intensitySeconds: {
        easy: windows.reduce((sum, entry) => sum + entry.intensitySeconds.easy, 0),
        moderate: windows.reduce((sum, entry) => sum + entry.intensitySeconds.moderate, 0),
        hard: windows.reduce((sum, entry) => sum + entry.intensitySeconds.hard, 0),
      },
    };
  };
  return {
    status: 'available',
    dayBoundary: 'UTC',
    asOfDayMs: payload.asOfDayMs,
    updatedAtMs: asSafeOperationalTimestampMs(snapshot.updatedAtMs),
    baselineSourceWindowDays: payload.baselineWindowDays,
    current28d: total('current28d'),
    usual28d: total('usual28d'),
    disciplines,
  };
}

interface TodayReadinessLoadContext {
  form: number | null;
  rampRate: number | null;
  asOfDayMs: number | null;
  sourceUpdatedAtMs: number | null;
}

function resolveTodayReadinessLoadContext(
  formSnapshot: Record<string, unknown> | null,
  formNowSnapshot: Record<string, unknown> | null,
  rampRateSnapshot: Record<string, unknown> | null,
  nowTimeMs: number,
): TodayReadinessLoadContext {
  const asOfDayMs = resolveUtcDayStartTimeMs(nowTimeMs);
  const readyForm = parseReadyDerivedPayload<DerivedFormMetricPayload>(
    formSnapshot,
    DERIVED_METRIC_KINDS.Form,
  );
  const readyFormNow = parseReadyDerivedPayload<DerivedFormNowMetricPayload>(
    formNowSnapshot,
    DERIVED_METRIC_KINDS.FormNow,
  );
  const readyRampRate = parseReadyDerivedPayload<DerivedRampRateMetricPayload>(
    rampRateSnapshot,
    DERIVED_METRIC_KINDS.RampRate,
  );
  const loadPoints = buildTrainingLoadPoints(
    (readyForm?.payload.dailyLoads || []).filter(load => load.dayMs <= asOfDayMs),
    asOfDayMs,
  );
  const currentPoint = loadPoints[loadPoints.length - 1] || null;
  const priorPoint = currentPoint
    ? loadPoints.find(point => point.dayMs === currentPoint.dayMs - (7 * 24 * 60 * 60 * 1000)) || null
    : null;
  const formFromSeries = currentPoint
    ? roundMetricValue(currentPoint.formSameDay)
    : null;
  const rampRateFromSeries = currentPoint && priorPoint
    ? roundMetricValue(currentPoint.ctl - priorPoint.ctl)
    : null;
  const fallbackForm = readyFormNow?.payload.asOfDayMs === asOfDayMs
    && readyFormNow.payload.latestDayMs === asOfDayMs
    ? asFiniteNumber(readyFormNow.payload.value)
    : null;
  const fallbackRampRate = readyRampRate?.payload.asOfDayMs === asOfDayMs
    && readyRampRate.payload.latestDayMs === asOfDayMs
    ? asFiniteNumber(readyRampRate.payload.rampRate)
    : null;
  const form = formFromSeries ?? fallbackForm;
  const rampRate = rampRateFromSeries ?? fallbackRampRate;
  const formSourceUpdatedAtMs = formFromSeries !== null
    ? readyForm?.updatedAtMs
    : fallbackForm !== null
      ? readyFormNow?.updatedAtMs
      : null;
  const rampRateSourceUpdatedAtMs = rampRateFromSeries !== null
    ? readyForm?.updatedAtMs
    : fallbackRampRate !== null
      ? readyRampRate?.updatedAtMs
      : null;
  const selectedSourceUpdatedAtMs = [
    formSourceUpdatedAtMs,
    rampRateSourceUpdatedAtMs,
  ].filter((value): value is number => value !== null && value !== undefined);

  return {
    form,
    rampRate,
    asOfDayMs: form !== null || rampRate !== null ? asOfDayMs : null,
    sourceUpdatedAtMs: selectedSourceUpdatedAtMs.length
      ? Math.min(...selectedSourceUpdatedAtMs)
      : null,
  };
}

function parseReadyDerivedPayload<T>(
  snapshot: Record<string, unknown> | null,
  metricKind: DerivedMetricKind,
): { payload: T; updatedAtMs: number | null } | null {
  if (
    !snapshot
    || snapshot.status !== 'ready'
    || snapshot.payload == null
    || asFiniteNumber(snapshot.schemaVersion) !== DERIVED_METRIC_SCHEMA_VERSION
  ) {
    return null;
  }
  const parsed = MCP_DERIVED_PAYLOAD_SCHEMAS[metricKind].safeParse(snapshot.payload);
  return parsed.success
    ? {
        payload: parsed.data as T,
        updatedAtMs: asSafeOperationalTimestampMs(snapshot.updatedAtMs),
      }
    : null;
}

function buildTodayReadinessSleepNights(
  documents: readonly RawDocument[],
): DailyReportSleepNight[] {
  const grouped = new Map<string, Array<{
    session: SafeSleepSession;
    evidence: ReadinessSleepEvidencePoint;
  }>>();
  for (const document of documents) {
    const session = toSafeSleepSession(document.data);
    if (!session || session.isNap) {
      continue;
    }
    const evidence: ReadinessSleepEvidencePoint = {
      id: document.id,
      sleepDate: resolveTodayReadinessSleepDate(document.data, session),
      provider: session.provider,
      startTimeMs: session.startTimeMs,
      endTimeMs: session.endTimeMs,
      totalSeconds: session.durationSeconds,
      score: session.score?.value ?? null,
      averageHrvMs: session.vitals?.averageHrvMs
        ?? session.vitals?.overnightHrvMs
        ?? null,
      averageHeartRateBpm: session.vitals?.averageHeartRateBpm ?? null,
      minimumHeartRateBpm: session.vitals?.minimumHeartRateBpm ?? null,
    };
    const key = `${evidence.sleepDate}:${evidence.provider}`;
    grouped.set(key, [
      ...(grouped.get(key) || []),
      {
        session,
        evidence,
      },
    ]);
  }

  return [...grouped.values()].map((entries) => {
    const sorted = [...entries].sort((left, right) => (
      (left.evidence.endTimeMs || 0) - (right.evidence.endTimeMs || 0)
      || (left.evidence.startTimeMs || 0) - (right.evidence.startTimeMs || 0)
      || left.evidence.id.localeCompare(right.evidence.id)
    ));
    const latest = sorted[sorted.length - 1];
    const averageHrvValues = positiveValues(
      entries.map(entry => entry.session.vitals?.averageHrvMs ?? null),
    );
    const overnightHrvValues = positiveValues(
      entries.map(entry => entry.session.vitals?.overnightHrvMs ?? null),
    );
    const selectedHrvValues = positiveValues(
      entries.map(entry => (
        entry.session.vitals?.averageHrvMs
        ?? entry.session.vitals?.overnightHrvMs
        ?? null
      )),
    );
    const averageHeartRateValues = positiveValues(
      entries.map(entry => entry.session.vitals?.averageHeartRateBpm ?? null),
    );
    const minimumHeartRateValues = positiveValues(
      entries.map(entry => entry.session.vitals?.minimumHeartRateBpm ?? null),
    );
    const inBedDurationValues = entries
      .map(entry => entry.session.inBedDurationSeconds)
      .filter((value): value is number => value !== null);
    const id = sorted.map(entry => entry.evidence.id).join('|');
    const startTimeMs = Math.min(
      ...entries.map(entry => entry.evidence.startTimeMs as number),
    );
    const endTimeMs = Math.max(
      ...entries.map(entry => entry.evidence.endTimeMs as number),
    );
    const durationSeconds = entries.reduce(
      (total, entry) => total + Math.max(0, entry.evidence.totalSeconds || 0),
      0,
    );
    const evidence: ReadinessSleepEvidencePoint = {
      ...latest.evidence,
      id,
      startTimeMs,
      endTimeMs,
      totalSeconds: durationSeconds,
      averageHrvMs: average(selectedHrvValues),
      averageHeartRateBpm: average(averageHeartRateValues),
      minimumHeartRateBpm: minimumHeartRateValues.length
        ? Math.min(...minimumHeartRateValues)
        : null,
    };
    return {
      id,
      provider: latest.session.provider,
      sleepDate: evidence.sleepDate,
      startTimeMs,
      endTimeMs,
      durationSeconds,
      session: {
        sleepDate: evidence.sleepDate,
        startTimeMs,
        endTimeMs,
        durationSeconds,
        inBedDurationSeconds: inBedDurationValues.length === entries.length
          ? inBedDurationValues.reduce((total, value) => total + value, 0)
          : null,
        score: latest.session.score,
        vitals: {
          averageHrvMs: average(averageHrvValues),
          overnightHrvMs: average(overnightHrvValues),
          averageHeartRateBpm: average(averageHeartRateValues),
          minimumHeartRateBpm: minimumHeartRateValues.length
            ? Math.min(...minimumHeartRateValues)
            : null,
        },
      },
      evidence,
    };
  }).sort((left, right) => (
    right.endTimeMs - left.endTimeMs
    || right.startTimeMs - left.startTimeMs
    || right.provider.localeCompare(left.provider)
    || right.sleepDate.localeCompare(left.sleepDate)
    || right.id.localeCompare(left.id)
  ));
}

function resolveTodayReadinessSleepDate(
  data: Record<string, unknown>,
  session: SafeSleepSession,
): string {
  if (session.provider !== SLEEP_PROVIDERS.SuuntoApp) {
    return session.sleepDate;
  }
  const offsetSeconds = asFiniteNumber(data.timezoneOffsetSeconds);
  const safeOffsetSeconds = offsetSeconds !== null
    && Math.abs(offsetSeconds) <= 18 * 60 * 60
    ? offsetSeconds
    : 0;
  const localEndDate = new Date(
    session.endTimeMs + (safeOffsetSeconds * 1000),
  ).toISOString().slice(0, 10);
  return normalizeCalendarDate(localEndDate) || session.sleepDate;
}

function projectTodayReadinessMetric(
  evidence: ReadinessRatioEvidence,
  unit: 'hrv' | 'heart_rate',
): TodayReadinessHrvDriver | TodayReadinessHeartRateDriver {
  const status: TodayReadinessMetricStatus = evidence.latestValue === null
    ? 'not_recorded'
    : evidence.ratio === null
      ? 'insufficient_baseline'
      : 'available';
  if (unit === 'hrv') {
    return {
      status,
      weightPercent: 20,
      latestMs: evidence.latestValue,
      baselineMedianMs: evidence.baselineMedian,
      baselineNightCount: evidence.baselineValueCount,
      ratio: evidence.ratio,
    };
  }
  return {
    status,
    latestBpm: evidence.latestValue,
    baselineMedianBpm: evidence.baselineMedian,
    baselineNightCount: evidence.baselineValueCount,
    ratio: evidence.ratio,
  };
}

function projectTodayReadiness(
  input: {
    nowTimeMs: number;
    timeZone: string;
    localDayStartTimeMs: number;
    localDayEndTimeMs: number;
    load: TodayReadinessLoadContext;
    evaluation: ReadinessEvaluation | null;
  },
): GetTodayReadinessResult {
  const signals = input.evaluation?.signals ?? null;
  const latestSleep = input.evaluation?.latestSleep ?? null;
  const hrv = input.evaluation?.hrv ?? emptyReadinessRatioEvidence();
  const averageHeartRate = input.evaluation?.averageHeartRate
    ?? emptyReadinessRatioEvidence();
  const minimumHeartRate = input.evaluation?.minimumHeartRate
    ?? emptyReadinessRatioEvidence();
  const averageHeartRateDriver = projectTodayReadinessMetric(
    averageHeartRate,
    'heart_rate',
  ) as TodayReadinessHeartRateDriver;
  const minimumHeartRateDriver = projectTodayReadinessMetric(
    minimumHeartRate,
    'heart_rate',
  ) as TodayReadinessHeartRateDriver;
  const combinedHeartRateStatus: TodayReadinessMetricStatus =
    signals?.overnightHeartRateRatio !== null
    && signals?.overnightHeartRateRatio !== undefined
      ? 'available'
      : averageHeartRate.latestValue !== null || minimumHeartRate.latestValue !== null
        ? 'insufficient_baseline'
        : 'not_recorded';
  const recordedScore = latestSleep
    ? asFiniteNumber(latestSleep.score)
    : null;
  const availableWeightPercent = (
    input.load.form !== null || input.load.rampRate !== null ? 40 : 0
  ) + (latestSleep ? 25 : 0)
    + (hrv.ratio !== null ? 20 : 0)
    + (signals?.overnightHeartRateRatio !== null
      && signals?.overnightHeartRateRatio !== undefined ? 15 : 0);

  return {
    asOfTimeMs: input.nowTimeMs,
    timeZone: input.timeZone,
    localDayStartTimeMs: input.localDayStartTimeMs,
    localDayEndTimeMs: input.localDayEndTimeMs,
    dayBoundary: 'UTC',
    asOfDayMs: resolveUtcDayStartTimeMs(input.nowTimeMs),
    formulaVersion: READINESS_FORMULA_VERSION,
    status: signals ? 'available' : 'no_signal',
    score: signals?.score ?? null,
    label: signals?.label ?? null,
    confidence: signals?.confidence ?? null,
    availableSignalCount: signals?.availableSignalCount ?? 0,
    availableWeightPercent,
    baselineEvidenceCount: signals?.baselineEvidenceCount ?? 0,
    totalSignalCount: READINESS_TOTAL_SIGNAL_COUNT,
    drivers: {
      load: {
        status: input.load.form !== null || input.load.rampRate !== null
          ? 'available'
          : 'not_ready',
        weightPercent: 40,
        form: input.load.form,
        rampRate: input.load.rampRate,
        asOfDayMs: input.load.asOfDayMs,
        sourceUpdatedAtMs: input.load.sourceUpdatedAtMs,
      },
      sleep: {
        status: latestSleep ? 'available' : 'no_recent_session',
        weightPercent: 25,
        score: signals?.sleepScore ?? null,
        scoreSource: latestSleep
          ? recordedScore !== null ? 'recorded' : 'duration'
          : null,
        latestSleepAtMs: signals?.latestSleepAtMs ?? null,
        sleepDate: latestSleep?.sleepDate ?? null,
        durationSeconds: latestSleep?.totalSeconds ?? null,
        recordedScore,
      },
      hrv: projectTodayReadinessMetric(
        hrv,
        'hrv',
      ) as TodayReadinessHrvDriver,
      overnightHeartRate: {
        status: combinedHeartRateStatus,
        weightPercent: 15,
        combinedRatio: signals?.overnightHeartRateRatio ?? null,
        average: averageHeartRateDriver,
        minimum: minimumHeartRateDriver,
      },
    },
  };
}

interface LoadedTodayReadiness {
  result: GetTodayReadinessResult;
  sleepNights: DailyReportSleepNight[];
}

async function loadTodayReadiness(
  dependencies: McpDataServiceDependencies,
  input: GetTodayReadinessInput,
  options: {
    includeDailyReportFields?: boolean;
  } = {},
): Promise<LoadedTodayReadiness> {
  const timeZone = requireTimeZone(input.timeZone);
  const nowTimeMs = dependencies.now();
  const localDay = resolveRelativeActivityRange(
    'today',
    timeZone,
    nowTimeMs,
  );
  const sleepDocumentsPromise = options.includeDailyReportFields
    ? dependencies.fetchReadinessSleepDocuments(
        input.uid,
        nowTimeMs - READINESS_SLEEP_LOOKBACK_MS,
        nowTimeMs,
        MAX_LIVE_READINESS_SLEEP_DOCUMENTS + 1,
        true,
      )
    : dependencies.fetchReadinessSleepDocuments(
        input.uid,
        nowTimeMs - READINESS_SLEEP_LOOKBACK_MS,
        nowTimeMs,
        MAX_LIVE_READINESS_SLEEP_DOCUMENTS + 1,
      );
  const [
    sleepDocuments,
    formSnapshot,
    formNowSnapshot,
    rampRateSnapshot,
  ] = await Promise.all([
    sleepDocumentsPromise,
    dependencies.fetchDerivedSnapshot(
      input.uid,
      DERIVED_METRIC_KINDS.Form,
    ),
    dependencies.fetchDerivedSnapshot(
      input.uid,
      DERIVED_METRIC_KINDS.FormNow,
    ),
    dependencies.fetchDerivedSnapshot(
      input.uid,
      DERIVED_METRIC_KINDS.RampRate,
    ),
  ]);
  if (sleepDocuments.length > MAX_LIVE_READINESS_SLEEP_DOCUMENTS) {
    throw new McpDataError(
      'query_too_large',
      `The readiness query matches more than ${MAX_LIVE_READINESS_SLEEP_DOCUMENTS} sleep sessions.`,
    );
  }
  const load = resolveTodayReadinessLoadContext(
    formSnapshot,
    formNowSnapshot,
    rampRateSnapshot,
    nowTimeMs,
  );
  const sleepNights = buildTodayReadinessSleepNights(sleepDocuments);
  const evaluation = buildReadinessEvaluation({
    form: load.form,
    rampRate: load.rampRate,
    sleepPoints: sleepNights.map(night => night.evidence),
    nowMs: nowTimeMs,
  });
  return {
    result: projectTodayReadiness({
      nowTimeMs,
      timeZone,
      localDayStartTimeMs: localDay.startTimeMs,
      localDayEndTimeMs: localDay.endTimeMs,
      load,
      evaluation,
    }),
    sleepNights,
  };
}

function projectDailyReportSleep(
  sleepNights: readonly DailyReportSleepNight[],
) {
  const latestNight = sleepNights[0] || null;
  const baseline = latestNight
    ? sleepNights.filter(night => (
      night.provider === latestNight.provider
      && night.sleepDate !== latestNight.sleepDate
      && night.endTimeMs < latestNight.endTimeMs
    )).slice(0, MAX_DAILY_REPORT_BASELINE_NIGHTS)
    : [];
  const averageDurationSeconds = baseline.length >= MIN_DAILY_REPORT_BASELINE_NIGHTS
    ? baseline.reduce((total, night) => total + night.durationSeconds, 0)
      / baseline.length
    : null;
  return {
    status: latestNight ? 'available' as const : 'no_completed_session' as const,
    latestSession: latestNight?.session ?? null,
    comparison: {
      sameProviderNightCount: baseline.length,
      averageDurationSeconds,
      durationDeltaSeconds: latestNight && averageDurationSeconds !== null
        ? latestNight.durationSeconds - averageDurationSeconds
        : null,
    },
  };
}

function emptyReadinessRatioEvidence(): ReadinessRatioEvidence {
  return {
    latestValue: null,
    baselineMedian: null,
    baselineValueCount: 0,
    ratio: null,
  };
}

function resolveUtcDayStartTimeMs(timeMs: number): number {
  const date = new Date(timeMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function roundMetricValue(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function positiveValues(values: readonly (number | null)[]): number[] {
  return values.filter(
    (value): value is number => value !== null && Number.isFinite(value) && value > 0,
  );
}

function average(values: readonly number[]): number | null {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;
}

export interface ListActivitiesInput {
  uid: string;
  connectionId: string;
  appBaseUrl: string;
  startTimeMs?: number;
  endTimeMs?: number;
  activityTypes?: readonly string[];
  relativePeriod?: McpActivityRelativePeriod;
  timeZone?: string;
  includeLocation?: boolean;
  cursor?: string;
  limit?: number;
}

export type McpNearbyLocation =
  | {
    query: string;
  }
  | SpatialPosition;

interface FindNearbyInputBase {
  uid: string;
  connectionId: string;
  appBaseUrl: string;
  location: McpNearbyLocation;
  radiusMeters?: number;
  activityTypes?: readonly string[];
  cursor?: string;
  limit?: number;
}

export interface FindNearbyActivitiesInput extends FindNearbyInputBase {
  startTimeMs?: number;
  endTimeMs?: number;
}

export type FindNearbyRoutesInput = FindNearbyInputBase;

export interface ListActivityDetailsInput {
  uid: string;
  connectionId: string;
  activityRef: string;
  includeLocation?: boolean;
  cursor?: string;
  limit?: number;
}

export interface GetActivityMetricsInput {
  uid: string;
  connectionId: string;
  activityRef: string;
  metrics: readonly string[];
}

export interface GetActivityOverviewInput {
  uid: string;
  connectionId: string;
  activityRef: string;
}

export interface RankActivitiesByMetricInput {
  uid: string;
  connectionId: string;
  metric: string;
  startTimeMs?: number;
  endTimeMs?: number;
  activityTypes?: readonly string[];
  order: 'highest' | 'lowest';
  limit?: number;
}

export interface GetActivityChartDataInput extends ActivityChartDataInput {
  uid: string;
  connectionId: string;
  activityRef: string;
}

export interface ListRoutesInput {
  uid: string;
  connectionId: string;
  appBaseUrl: string;
  activityTypes?: readonly string[];
  search?: string;
  includeLocation?: boolean;
  cursor?: string;
  limit?: number;
}

export interface RouteDetailInput {
  uid: string;
  connectionId: string;
  routeRef: string;
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
  stageDurationsSeconds: Partial<Record<SleepStage, number>>;
  vitalSums: McpSafeSleepVitals;
  vitalCounts: McpSafeSleepVitals;
}

function buildSleepVitalAvailability(
  sessions: readonly SafeSleepSession[],
): McpSleepVitalAvailability[] {
  const vitalSessionCounts = new Map<McpSleepVitalType, number>();
  sessions.forEach((session) => {
    MCP_SLEEP_VITAL_TYPES.forEach((type) => {
      if (session.vitals?.[type] !== undefined) {
        vitalSessionCounts.set(type, (vitalSessionCounts.get(type) || 0) + 1);
      }
    });
  });
  return MCP_SLEEP_VITAL_DESCRIPTORS.flatMap((descriptor) => {
    const sessionCount = vitalSessionCounts.get(descriptor.type);
    return sessionCount
      ? [{ ...descriptor, sessionCount }]
      : [];
  });
}

function buildSleepSummaryResult(
  sessions: readonly SafeSleepSession[],
  groupBy: McpSleepSummaryGroupBy,
  timeZone: string,
): QuerySleepSummaryResult {
  const interval = groupBy === 'day'
    ? TimeIntervals.Daily
    : groupBy === 'week'
      ? TimeIntervals.Weekly
      : TimeIntervals.Monthly;
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
    Object.values(SLEEP_STAGES).forEach((stage) => {
      const duration = session.stageDurationsSeconds[stage];
      if (duration !== undefined) {
        accumulator.stageDurationsSeconds[stage] =
          (accumulator.stageDurationsSeconds[stage] || 0) + duration;
      }
    });
    MCP_SLEEP_VITAL_TYPES.forEach((type) => {
      const numeric = asNonNegativeNumber(session.vitals?.[type]);
      if (numeric !== null) {
        accumulator.vitalSums[type] =
          (accumulator.vitalSums[type] || 0) + numeric;
        accumulator.vitalCounts[type] =
          (accumulator.vitalCounts[type] || 0) + 1;
      }
    });
    buckets.set(bucketStartMs, accumulator);
  });

  return {
    timeZone,
    groupBy,
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
          MCP_SLEEP_VITAL_TYPES.flatMap((type) => {
            const sum = bucket.vitalSums[type];
            const observations = bucket.vitalCounts[type];
            return sum !== undefined && observations
              ? [[type, sum / observations]]
              : [];
          }),
        ) as McpSafeSleepVitals,
      })),
  };
}

interface SafeActivityListEntry {
  id: string;
  sortTimeMs: number;
  summary: {
    activityRef: string;
    appUrl: string;
    startTimeMs: number;
    endTimeMs: number;
    activityType: string | null;
    powerMeter: boolean;
    trainer: boolean;
    jumpCount: number | null;
    startPosition?: SafePosition | null;
    endPosition?: SafePosition | null;
    locationRedacted: boolean;
    supportedDetailKinds: readonly ActivityDetailKind[];
    stats: SafeActivityStats;
  };
}

interface SafeRouteListEntry {
  id: string;
  sortTimeMs: number;
  summary: {
    routeRef: string;
    appUrl: string;
    name: string;
    createdAtMs: number | null;
    importedAtMs: number;
    updatedAtMs: number | null;
    activityTypes: string[];
    routeCount: number | null;
    waypointCount: number | null;
    pointCount: number | null;
    bounds?: RouteBounds | null;
    locationRedacted: boolean;
    stats: SafeActivityStats;
  };
}

interface ResolvedNearbyLocation {
  source: 'coordinates' | 'mapbox';
  resolvedLabel: string | null;
  position: SpatialPosition;
}

function validateNearbyRadius(value: number | undefined): number {
  const radiusMeters = value ?? 25_000;
  if (
    !Number.isFinite(radiusMeters)
    || radiusMeters < 100
    || radiusMeters > 500_000
  ) {
    throw new McpDataError(
      'invalid_request',
      'radiusMeters must be between 100 and 500000.',
    );
  }
  return radiusMeters;
}

async function resolveNearbyLocation(
  dependencies: McpDataServiceDependencies,
  input: Pick<FindNearbyInputBase, 'uid' | 'connectionId' | 'location'>,
): Promise<ResolvedNearbyLocation> {
  if (
    !input.location
    || typeof input.location !== 'object'
    || Array.isArray(input.location)
  ) {
    throw new McpDataError(
      'invalid_request',
      'Provide either a place query or a latitude/longitude pair.',
    );
  }
  const rawLocation = input.location as unknown as Record<string, unknown>;
  const hasQuery = Object.prototype.hasOwnProperty.call(rawLocation, 'query');
  const hasLatitude = Object.prototype.hasOwnProperty.call(
    rawLocation,
    'latitudeDegrees',
  );
  const hasLongitude = Object.prototype.hasOwnProperty.call(
    rawLocation,
    'longitudeDegrees',
  );
  if (
    (hasQuery && (hasLatitude || hasLongitude))
    || (!hasQuery && (!hasLatitude || !hasLongitude))
  ) {
    throw new McpDataError(
      'invalid_request',
      'Provide either a place query or a latitude/longitude pair.',
    );
  }
  if (hasLatitude && hasLongitude) {
    const position = {
      latitudeDegrees: rawLocation.latitudeDegrees,
      longitudeDegrees: rawLocation.longitudeDegrees,
    };
    if (!isValidSpatialPosition(position)) {
      throw new McpDataError(
        'invalid_request',
        'A valid latitude and longitude are required.',
      );
    }
    return {
      source: 'coordinates',
      resolvedLabel: null,
      position,
    };
  }
  if (typeof rawLocation.query !== 'string') {
    throw new McpDataError(
      'invalid_request',
      'A valid place query is required.',
    );
  }

  try {
    const normalizedQuery = normalizeMapboxQuery(rawLocation.query);
    await dependencies.consumeGeocodingRateLimit(
      input.uid,
      input.connectionId,
    );
    const resolved = await dependencies.forwardGeocodeLocation(
      normalizedQuery,
    );
    const resolvedLabel = asBoundedString(resolved.resolvedLabel, 240);
    if (!resolvedLabel || !isValidSpatialPosition(resolved.center)) {
      throw new McpDataError(
        'temporarily_unavailable',
        'Location lookup is temporarily unavailable.',
      );
    }
    return {
      source: 'mapbox',
      resolvedLabel,
      position: {
        latitudeDegrees: resolved.center.latitudeDegrees,
        longitudeDegrees: resolved.center.longitudeDegrees,
      },
    };
  } catch (error) {
    if (error instanceof McpGeocodingRateLimitError) {
      throw new McpDataError('temporarily_unavailable', error.message);
    }
    if (error instanceof MapboxGeocodingError) {
      if (error.code === 'invalid_query' || error.code === 'not_found') {
        throw new McpDataError('invalid_request', error.message);
      }
      throw new McpDataError(
        'temporarily_unavailable',
        'Location lookup is temporarily unavailable.',
      );
    }
    if (error instanceof McpDataError) {
      throw error;
    }
    throw new McpDataError(
      'temporarily_unavailable',
      'Location lookup is temporarily unavailable.',
    );
  }
}

function buildNearbyQueryHash(input: {
  location: ResolvedNearbyLocation;
  radiusMeters: number;
  activityTypes: readonly string[];
  startTimeMs?: number;
  endTimeMs?: number;
}): string {
  return createHash('sha256').update(JSON.stringify({
    latitudeDegrees: Number(input.location.position.latitudeDegrees.toFixed(6)),
    longitudeDegrees: Number(input.location.position.longitudeDegrees.toFixed(6)),
    radiusMeters: input.radiusMeters,
    activityTypes: [...input.activityTypes].sort(),
    startTimeMs: input.startTimeMs ?? null,
    endTimeMs: input.endTimeMs ?? null,
  }), 'utf8').digest('base64url');
}

function activityTypeMatches(
  candidate: string | null,
  filters: readonly string[],
): boolean {
  return filters.length === 0 || (candidate !== null && filters.includes(candidate));
}

function routeActivityTypesMatch(
  candidates: readonly string[],
  filters: readonly string[],
): boolean {
  return filters.length === 0 || filters.some(filter => candidates.includes(filter));
}

function routeNameMatches(candidate: string, search: string | null): boolean {
  return search === null || candidate.toLowerCase().includes(search);
}

function projectActivityListEntry(
  document: RawDocument,
  input: Pick<
    ListActivitiesInput,
    'uid' | 'connectionId' | 'appBaseUrl' | 'includeLocation'
  >,
): SafeActivityListEntry | null {
  const eventId = document.data.eventID;
  const sortTimeMs = asTimestampMs(document.data.eventStartDate);
  const startTimeMs = asTimestampMs(document.data.startDate);
  const endTimeMs = asTimestampMs(document.data.endDate);
  if (
    !isValidFirestoreDocumentId(document.id)
    || !isValidFirestoreDocumentId(eventId)
    || sortTimeMs === null
    || startTimeMs === null
    || endTimeMs === null
    || endTimeMs < startTimeMs
  ) {
    return null;
  }
  const stats = projectActivityStats(document.data.stats);
  const rawStats = document.data.stats
    && typeof document.data.stats === 'object'
    && !Array.isArray(document.data.stats)
    ? document.data.stats as Record<string, unknown>
    : {};
  return {
    id: document.id,
    sortTimeMs,
    summary: {
      activityRef: encodeOpaqueValue('activity_ref', {
        activityId: document.id,
        eventId,
      }, input.uid, input.connectionId),
      appUrl: toAppUrl(
        input.appBaseUrl,
        `/user/${encodeURIComponent(input.uid)}/event/${encodeURIComponent(eventId)}`,
      ),
      startTimeMs,
      endTimeMs,
      activityType: normalizeActivityType(document.data.type),
      powerMeter: document.data.powerMeter === true,
      trainer: document.data.trainer === true,
      jumpCount: asSafeInteger(rawStats['Jump Count']),
      ...(input.includeLocation ? {
        startPosition: projectPosition(rawStats[DataStartPosition.type]),
        endPosition: projectPosition(rawStats[DataEndPosition.type]),
      } : {}),
      locationRedacted: !input.includeLocation,
      supportedDetailKinds: ['laps', 'jumps', 'swim_lengths'],
      stats: {
        ...stats,
        durationSeconds: stats.durationSeconds ?? ((endTimeMs - startTimeMs) / 1000),
      },
    },
  };
}

function projectRouteListEntry(
  document: RawDocument,
  input: Pick<
    ListRoutesInput,
    'uid' | 'connectionId' | 'appBaseUrl' | 'includeLocation'
  >,
): SafeRouteListEntry | null {
  const importedAtMs = asTimestampMs(document.data.importedAt);
  const name = asBoundedString(document.data.name, 120);
  if (
    !isValidFirestoreDocumentId(document.id)
    || importedAtMs === null
    || !name
  ) {
    return null;
  }
  return {
    id: document.id,
    sortTimeMs: importedAtMs,
    summary: {
      routeRef: encodeOpaqueValue('route_ref', {
        routeId: document.id,
      }, input.uid, input.connectionId),
      appUrl: toAppUrl(
        input.appBaseUrl,
        `/user/${encodeURIComponent(input.uid)}/route/${encodeURIComponent(document.id)}`,
      ),
      name,
      createdAtMs: asTimestampMs(document.data.createdAt),
      importedAtMs,
      updatedAtMs: asTimestampMs(document.data.updatedAt),
      activityTypes: normalizeActivityTypes(document.data.activityTypes),
      routeCount: asSafeInteger(document.data.routeCount),
      waypointCount: asSafeInteger(document.data.waypointCount),
      pointCount: asSafeInteger(document.data.pointCount),
      ...(input.includeLocation ? {
        bounds: projectBounds(document.data.bounds),
      } : {}),
      locationRedacted: !input.includeLocation,
      stats: projectActivityStats(document.data.stats),
    },
  };
}

async function listActivityDetail(
  dependencies: McpDataServiceDependencies,
  input: ListActivityDetailsInput,
  detailKind: ActivityDetailKind,
) {
  const reference = decodeActivityReference(
    input.activityRef,
    input.uid,
    input.connectionId,
  );
  const offset = decodeActivityDetailOffset(
    input.cursor,
    reference,
    detailKind,
    input.uid,
    input.connectionId,
  );
  const document = await dependencies.fetchActivityDetailDocument(
    input.uid,
    reference.activityId,
    detailKind,
    input.includeLocation,
  );
  if (
    !document
    || document.id !== reference.activityId
    || document.data.eventID !== reference.eventId
  ) {
    throw new McpDataError(
      'detail_not_available',
      'The requested activity detail is not available.',
    );
  }
  const field = detailKind === 'swim_lengths'
    ? 'swimLengths'
    : detailKind === 'jumps'
      ? 'events'
      : 'laps';
  const rawItems = document.data[field];
  if (rawItems !== undefined && !Array.isArray(rawItems)) {
    throw new McpDataError(
      'detail_not_available',
      'The requested activity detail is not available.',
    );
  }
  const candidates = Array.isArray(rawItems) ? rawItems : [];
  if (candidates.length > MAX_ACTIVITY_DETAIL_ENTRIES) {
    throw new McpDataError(
      'query_too_large',
      'The activity contains too many detail records for MCP.',
    );
  }
  requireJsonBudget(
    candidates,
    MAX_ACTIVITY_DETAIL_BYTES,
    'The activity detail exceeds the MCP processing limit.',
  );
  const projected = candidates.flatMap((candidate, index) => {
    const item = detailKind === 'laps'
      ? projectLap(candidate, index)
      : detailKind === 'jumps'
        ? projectJump(candidate, index, input.includeLocation === true)
        : projectSwimLength(candidate, index);
    return item ? [item] : [];
  });
  if (offset > projected.length) {
    throw new McpDataError('invalid_request', 'The pagination cursor is invalid.');
  }
  const limit = Math.min(
    MAX_ACTIVITY_DETAIL_PAGE_SIZE,
    Math.max(1, Math.floor(input.limit || 50)),
  );
  const page = projected.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  const result = {
    items: page,
    nextCursor: nextOffset < projected.length
      ? encodeActivityDetailOffset(
          reference,
          detailKind,
          nextOffset,
          input.uid,
          input.connectionId,
        )
      : null,
  };
  requireJsonBudget(
    result,
    MAX_ACTIVITY_DETAIL_RESPONSE_BYTES,
    'The activity detail exceeds the MCP response limit.',
  );
  return result;
}

async function getActivityMetrics(
  dependencies: McpDataServiceDependencies,
  input: GetActivityMetricsInput,
) {
  if (
    !Array.isArray(input.metrics)
    || input.metrics.length === 0
    || input.metrics.length > MAX_ACTIVITY_METRICS_PER_REQUEST
  ) {
    throw new McpDataError(
      'invalid_request',
      `Choose between 1 and ${MAX_ACTIVITY_METRICS_PER_REQUEST} activity metrics.`,
    );
  }
  const metrics = [...new Map(input.metrics.map((requestedType) => {
    if (
      typeof requestedType !== 'string'
      || requestedType.length === 0
      || requestedType.length > 120
    ) {
      throw new McpDataError(
        'invalid_metric',
        'Each activity metric must be a supported numeric Sports Lib type.',
      );
    }
    const metric = resolveSportsLibNumericMetric(requestedType);
    if (!metric || isFirstClassMcpMeasurementMetric(metric.type)) {
      throw new McpDataError(
        'invalid_metric',
        'Each activity metric must be a supported numeric Sports Lib type.',
      );
    }
    return [metric.type, metric] as const;
  })).values()];
  const reference = decodeActivityReference(
    input.activityRef,
    input.uid,
    input.connectionId,
  );
  const document = await dependencies.fetchActivityMetricDocument(
    input.uid,
    reference.activityId,
    metrics.map(metric => metric.type),
  );
  if (
    !document
    || document.id !== reference.activityId
    || document.data.eventID !== reference.eventId
  ) {
    throw new McpDataError(
      'detail_not_available',
      'The requested activity metrics are not available.',
    );
  }
  requireJsonBudget(
    document.data,
    MAX_ACTIVITY_METRIC_DOCUMENT_BYTES,
    'The selected activity metrics exceed the MCP processing limit.',
  );
  const stats = document.data.stats;
  if (
    stats !== undefined
    && (
      !stats
      || typeof stats !== 'object'
      || Array.isArray(stats)
    )
  ) {
    throw new McpDataError(
      'detail_not_available',
      'The requested activity metrics are not available.',
    );
  }
  const persistedStats = stats as Record<string, unknown> | undefined;
  const projectedMetrics = metrics.map(metric => {
    const value = projectSportsLibNumericMetricValue(
      metric.type,
      persistedStats?.[metric.type],
    );
    return {
      ...metric,
      value,
      available: value !== null,
    };
  });
  const result = {
    selectedMetricCount: projectedMetrics.length,
    availableMetricCount: projectedMetrics.filter(metric => metric.available).length,
    metrics: projectedMetrics,
  };
  requireJsonBudget(
    result,
    MAX_ACTIVITY_METRIC_RESPONSE_BYTES,
    'The selected activity metrics exceed the MCP response limit.',
  );
  return result;
}

type McpActivityDetailAvailability = {
  status: 'available' | 'empty' | 'unavailable';
  count: number | null;
};

function projectActivityOverviewDetailAvailability(
  value: unknown,
  detailKind: ActivityDetailKind,
): McpActivityDetailAvailability {
  if (!Array.isArray(value)) {
    return {
      status: 'unavailable',
      count: null,
    };
  }
  if (value.length === 0) {
    return {
      status: 'empty',
      count: 0,
    };
  }
  const count = value.reduce((total, candidate, index) => {
    const projected = detailKind === 'laps'
      ? projectLap(candidate, index)
      : detailKind === 'jumps'
        ? projectJump(candidate, index, false)
        : projectSwimLength(candidate, index);
    return total + (projected ? 1 : 0);
  }, 0);
  return count > 0
    ? {
        status: 'available',
        count,
      }
    : {
        status: 'unavailable',
        count: null,
      };
}

async function getActivityOverview(
  dependencies: McpDataServiceDependencies,
  input: GetActivityOverviewInput,
) {
  const reference = decodeActivityReference(
    input.activityRef,
    input.uid,
    input.connectionId,
  );
  const document = await dependencies.fetchActivityOverviewDocument(
    input.uid,
    reference.activityId,
  );
  if (
    !document
    || document.id !== reference.activityId
    || document.data.eventID !== reference.eventId
  ) {
    throw new McpDataError(
      'detail_not_available',
      'The requested activity overview is not available.',
    );
  }
  const rawStats = document.data.stats;
  if (
    rawStats !== undefined
    && (
      !rawStats
      || typeof rawStats !== 'object'
      || Array.isArray(rawStats)
    )
  ) {
    throw new McpDataError(
      'detail_not_available',
      'The requested activity metrics are not available.',
    );
  }
  requireJsonBudget(
    rawStats,
    MAX_ACTIVITY_OVERVIEW_STATS_BYTES,
    'The activity metrics exceed the MCP overview processing limit.',
  );
  const detailValues = {
    laps: document.data.laps,
    jumps: document.data.events,
    swimLengths: document.data.swimLengths,
  };
  const detailEntryCount = Object.values(detailValues).reduce<number>(
    (total, value) => total + (Array.isArray(value) ? value.length : 0),
    0,
  );
  if (detailEntryCount > MAX_ACTIVITY_OVERVIEW_DETAIL_ENTRIES) {
    throw new McpDataError(
      'query_too_large',
      'The activity contains too many detail records for an MCP overview.',
    );
  }
  requireJsonBudget(
    detailValues,
    MAX_ACTIVITY_OVERVIEW_DETAIL_BYTES,
    'The activity details exceed the MCP overview processing limit.',
  );
  const safeStats = rawStats as Record<string, unknown> | undefined;
  const availableMetrics = resolveAvailableSportsLibMetrics([
    safeStats,
  ]).filter(metric => (
    !isFirstClassMcpMeasurementMetric(metric.type)
    && projectSportsLibNumericMetricValue(
      metric.type,
      safeStats?.[metric.type],
    ) !== null
  ));
  const activityType = normalizeActivityType(document.data.type);
  const chartSourceDeclared = await dependencies.hasActivityChartSource(
    input.uid,
    reference.eventId,
  );
  const chartMetrics = activityType
    ? listActivityChartMetrics(activityType).metrics
    : [];
  const result = {
    activityType,
    locationRedacted: true as const,
    availableMetrics,
    details: [
      {
        kind: 'laps' as const,
        ...projectActivityOverviewDetailAvailability(
          detailValues.laps,
          'laps',
        ),
      },
      {
        kind: 'jumps' as const,
        ...projectActivityOverviewDetailAvailability(
          detailValues.jumps,
          'jumps',
        ),
      },
      {
        kind: 'swim_lengths' as const,
        ...projectActivityOverviewDetailAvailability(
          detailValues.swimLengths,
          'swim_lengths',
        ),
      },
    ],
    chartData: {
      sourceDeclared: chartSourceDeclared,
      candidateMetrics: chartMetrics.map(metric => metric.metric),
    },
  };
  requireJsonBudget(
    result,
    MAX_ACTIVITY_OVERVIEW_RESPONSE_BYTES,
    'The activity overview exceeds the MCP response limit.',
  );
  return result;
}

async function fetchBoundedActivityRankingDocuments(
  dependencies: McpDataServiceDependencies,
  input: Pick<
    RankActivitiesByMetricInput,
    'uid' | 'startTimeMs' | 'endTimeMs' | 'activityTypes'
  >,
  metricType: string,
): Promise<RawDocument[]> {
  const documents: RawDocument[] = [];
  let cursor: unknown;
  let cumulativeBytes = 0;

  while (documents.length <= MAX_ACTIVITY_RANKING_DOCUMENTS) {
    const pageLimit = Math.min(
      ACTIVITY_RANKING_PAGE_SIZE,
      MAX_ACTIVITY_RANKING_DOCUMENTS + 1 - documents.length,
    );
    const page = await dependencies.fetchActivityRankingDocuments(
      input.uid,
      input.startTimeMs,
      input.endTimeMs,
      metricType,
      input.activityTypes || [],
      pageLimit,
      cursor,
    );
    if (page.length > pageLimit) {
      throw new McpDataError(
        'query_too_large',
        `The ranking query matches more than ${MAX_ACTIVITY_RANKING_DOCUMENTS} activities. Narrow the requested period or activity set.`,
      );
    }
    for (const document of page) {
      cumulativeBytes += measureJsonBytes(
        document.data,
        'The ranking query contains activity data that cannot be processed safely.',
      );
      if (cumulativeBytes > MAX_ACTIVITY_RANKING_DOCUMENT_BYTES) {
        throw new McpDataError(
          'query_too_large',
          'The ranking query contains too much activity metric data. Narrow the requested period or activity set.',
        );
      }
      documents.push({
        id: document.id,
        data: document.data,
      });
      if (documents.length > MAX_ACTIVITY_RANKING_DOCUMENTS) {
        throw new McpDataError(
          'query_too_large',
          `The ranking query matches more than ${MAX_ACTIVITY_RANKING_DOCUMENTS} activities. Narrow the requested period or activity set.`,
        );
      }
    }
    if (page.length < pageLimit) {
      return documents;
    }
    cursor = page[page.length - 1]?.cursor;
    if (cursor === undefined) {
      throw new Error(
        'The MCP activity ranking page did not provide a pagination cursor.',
      );
    }
  }
  return documents;
}

async function rankActivitiesByMetric(
  dependencies: McpDataServiceDependencies,
  input: RankActivitiesByMetricInput,
) {
  const { query } = resolveActivityListQuery(dependencies, input);
  const metric = resolveSportsLibNumericMetric(input.metric);
  if (!metric || isFirstClassMcpMeasurementMetric(metric.type)) {
    throw new McpDataError(
      'invalid_metric',
      'The ranking metric is not a supported numeric Sports Lib type.',
    );
  }
  if (input.order !== 'highest' && input.order !== 'lowest') {
    throw new McpDataError(
      'invalid_request',
      'Ranking order must be highest or lowest.',
    );
  }
  const limit = Math.min(25, Math.max(1, Math.floor(input.limit || 10)));
  const documents = await fetchBoundedActivityRankingDocuments(
    dependencies,
    {
      uid: input.uid,
      startTimeMs: query.startTimeMs,
      endTimeMs: query.endTimeMs,
      activityTypes: query.activityTypes,
    },
    metric.type,
  );
  const candidates = documents.flatMap((document) => {
    const eventId = document.data.eventID;
    const sortTimeMs = asTimestampMs(document.data.eventStartDate);
    const startTimeMs = asTimestampMs(document.data.startDate);
    const endTimeMs = asTimestampMs(document.data.endDate);
    const activityType = normalizeActivityType(document.data.type);
    const rawStats = document.data.stats;
    const value = rawStats && typeof rawStats === 'object' && !Array.isArray(rawStats)
      ? projectSportsLibNumericMetricValue(
          metric.type,
          (rawStats as Record<string, unknown>)[metric.type],
        )
      : null;
    if (
      !isValidFirestoreDocumentId(document.id)
      || !isValidFirestoreDocumentId(eventId)
      || sortTimeMs === null
      || (query.startTimeMs !== undefined && sortTimeMs < query.startTimeMs)
      || (query.endTimeMs !== undefined && sortTimeMs > query.endTimeMs)
      || startTimeMs === null
      || endTimeMs === null
      || endTimeMs < startTimeMs
      || value === null
      || !activityTypeMatches(activityType, query.activityTypes)
    ) {
      return [];
    }
    return [{
      id: document.id,
      activityRef: encodeOpaqueValue('activity_ref', {
        activityId: document.id,
        eventId,
      }, input.uid, input.connectionId),
      startTimeMs,
      endTimeMs,
      activityType,
      value,
    }];
  });
  candidates.sort((left, right) => {
    const valueOrder = input.order === 'highest'
      ? right.value - left.value
      : left.value - right.value;
    return valueOrder
      || right.startTimeMs - left.startTimeMs
      || left.id.localeCompare(right.id);
  });
  const result = {
    metric,
    order: input.order,
    scannedActivityCount: documents.length,
    matchedActivityCount: candidates.length,
    activities: candidates.slice(0, limit).map((candidate, index) => ({
      rank: index + 1,
      activityRef: candidate.activityRef,
      startTimeMs: candidate.startTimeMs,
      endTimeMs: candidate.endTimeMs,
      activityType: candidate.activityType,
      value: candidate.value,
    })),
  };
  requireJsonBudget(
    result,
    MAX_ACTIVITY_RANKING_RESPONSE_BYTES,
    'The activity ranking exceeds the MCP response limit.',
  );
  return result;
}

function extractActivityChartSourceFiles(
  eventData: Record<string, unknown>,
): OriginalFileMetaData[] {
  const values = Array.isArray(eventData.originalFiles)
    && eventData.originalFiles.length > 0
    ? eventData.originalFiles
    : eventData.originalFile
      ? [eventData.originalFile]
      : [];
  return values.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }
    const source = value as Record<string, unknown>;
    const path = asBoundedString(source.path, 1_024);
    const bucket = source.bucket === undefined
      ? undefined
      : asBoundedString(source.bucket, 200, /^[A-Za-z0-9._-]+$/);
    if (!path || (source.bucket !== undefined && !bucket)) {
      return [];
    }
    return [{
      path,
      ...(bucket ? { bucket } : {}),
      ...(asBoundedString(source.generation, 40, /^\d+$/)
        ? { generation: `${source.generation}` }
        : {}),
      startDate: new Date(0),
      ...(asBoundedString(source.originalFilename, 255)
        ? { originalFilename: `${source.originalFilename}` }
        : {}),
    }];
  });
}

function toActivityChartIdentity(document: RawDocument): ActivityIdentityLike {
  const stats = document.data.stats
    && typeof document.data.stats === 'object'
    && !Array.isArray(document.data.stats)
    ? document.data.stats as Record<string, unknown>
    : {};
  return {
    startDate: document.data.startDate,
    endDate: document.data.endDate,
    type: document.data.type,
    sourceActivityKey: asBoundedString(
      document.data.sourceActivityKey,
      256,
      /^[A-Za-z0-9:_-]+$/,
    ) || undefined,
    getStat: (type: string) => {
      const value = asFiniteNumber(stats[type]);
      return value === null ? null : { getValue: () => value };
    },
  };
}

async function getActivityChartData(
  dependencies: McpDataServiceDependencies,
  input: GetActivityChartDataInput,
) {
  const reference = decodeActivityReference(
    input.activityRef,
    input.uid,
    input.connectionId,
  );
  const context = await dependencies.fetchActivityChartContext(
    input.uid,
    reference.eventId,
  );
  if (
    !context
    || context.event.id !== reference.eventId
    || context.activities.length === 0
    || context.activities.length > 100
  ) {
    throw new McpDataError(
      'detail_not_available',
      'The original activity source is not available for charting.',
    );
  }
  const targetExistingIndex = context.activities.findIndex(document => (
    document.id === reference.activityId
    && document.data.eventID === reference.eventId
  ));
  if (targetExistingIndex < 0) {
    throw new McpDataError(
      'detail_not_available',
      'The referenced activity is not available for charting.',
    );
  }
  const targetActivityType = normalizeActivityType(
    context.activities[targetExistingIndex].data.type,
  );
  if (!targetActivityType) {
    throw new McpDataError(
      'detail_not_available',
      'The referenced activity type is not available for charting.',
    );
  }
  if (
    getUnsupportedActivityChartMetrics(input.metrics, targetActivityType)
      .length > 0
  ) {
    throw new McpDataError(
      'invalid_metric',
      'One or more chart metrics are not supported for this activity type.',
    );
  }
  const sourceFiles = extractActivityChartSourceFiles(context.event.data);
  if (
    sourceFiles.length === 0
    || sourceFiles.length > MCP_ACTIVITY_CHART_MAX_SOURCE_FILES
  ) {
    throw new McpDataError(
      'detail_not_available',
      'The activity does not have an available bounded original source.',
    );
  }

  try {
    await dependencies.consumeActivityChartRateLimit(
      input.uid,
      input.connectionId,
    );
    return await dependencies.buildActivityChartData({
      sourceFiles,
      existingActivities: context.activities.map(toActivityChartIdentity),
      targetExistingIndex,
    }, input, {
      loadSource: (sourceFile, maximumBytes) => dependencies.downloadActivityChartSource(
        input.uid,
        reference.eventId,
        sourceFile,
        maximumBytes,
      ),
    });
  } catch (error) {
    if (error instanceof McpDataError) {
      throw error;
    }
    if (error instanceof McpActivityChartRateLimitError) {
      throw new McpDataError(
        'temporarily_unavailable',
        'Activity chart parsing is temporarily rate limited. Retry later.',
      );
    }
    const message = error instanceof Error ? error.message : '';
    if (/limit|exceed|bounded/i.test(message)) {
      throw new McpDataError(
        'query_too_large',
        'The activity chart request exceeds a processing limit.',
      );
    }
    throw new McpDataError(
      'detail_not_available',
      'The original activity could not be charted.',
    );
  }
}

export function createMcpDataService(
  dependencies: McpDataServiceDependencies = defaultDependencies,
) {
  const fetchBoundedSafeSleepSessions = async (
    input: ListSleepVitalsInput,
  ): Promise<SafeSleepSession[]> => {
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
    return docs.flatMap((doc) => {
      const session = toSafeSleepSession(doc.data);
      return session
        && (input.includeNaps || !session.isNap)
        && (!input.provider || session.provider === input.provider)
        ? [session]
        : [];
    });
  };
  const loadSleepSummary = async (
    input: QuerySleepSummaryInput,
  ): Promise<{
    sessions: SafeSleepSession[];
    summary: QuerySleepSummaryResult;
  }> => {
    validateBoundedRange(input.startTimeMs, input.endTimeMs);
    const timeZone = requireTimeZone(input.timeZone);
    const sessions = await fetchBoundedSafeSleepSessions(input);
    return {
      sessions,
      summary: buildSleepSummaryResult(
        sessions,
        input.groupBy,
        timeZone,
      ),
    };
  };

  return {
    listActivityTypes() {
      const activityTypes = ActivityTypesHelper
        .getActivityTypesAsUniqueArray()
        .flatMap((activityType) => {
          const resolved = ActivityTypesHelper.resolveActivityType(activityType);
          return resolved
            ? [{
                activityType: resolved,
                activityGroup: String(
                  ActivityTypesHelper.getActivityGroupForActivityType(resolved),
                ),
                indoor: ActivityTypesHelper.isIndoorActivityType(resolved),
              }]
            : [];
        });
      return {
        activityTypeCount: activityTypes.length,
        activityTypes,
      };
    },
    listActivityChartMetrics(activityType?: string) {
      return listActivityChartMetrics(activityType);
    },
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
        scannedDocs
          .filter(doc => !isBenchmarkEventForTrainingMetrics(doc.data))
          .map(doc => doc.data.stats as Record<string, unknown> | undefined),
      ).filter(metric => !isFirstClassMcpMeasurementMetric(metric.type));
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

    async listTrainingMetrics(
      input: ListTrainingMetricsInput,
    ): Promise<ListTrainingMetricsResult> {
      const descriptors = getMcpTrainingMetricDescriptors(input.search);
      const snapshots = new Map(
        (await dependencies.fetchDerivedSnapshotMetadataDocuments(
          input.uid,
          descriptors.map(descriptor => descriptor.metricKind),
        )).map(document => [document.id, document.data]),
      );
      const metrics = descriptors.map(descriptor => {
        const snapshot = snapshots.get(descriptor.metricKind);
        const schemaVersion = asFiniteNumber(snapshot?.schemaVersion);
        const snapshotEntryType = snapshot?.entryType;
        const snapshotMetricKind = snapshot?.metricKind;
        const rawStatus = snapshot?.status;
        let status: McpTrainingMetricAvailability;
        if (!snapshot) {
          status = 'missing';
        } else if (
          schemaVersion !== DERIVED_METRIC_SCHEMA_VERSION
          || snapshotEntryType !== DERIVED_METRICS_ENTRY_TYPES.Snapshot
          || snapshotMetricKind !== descriptor.metricKind
        ) {
          status = 'schema_mismatch';
        } else if (
          rawStatus === 'ready'
          || rawStatus === 'building'
          || rawStatus === 'failed'
          || rawStatus === 'stale'
        ) {
          status = rawStatus;
        } else {
          status = 'schema_mismatch';
        }
        return {
          ...descriptor,
          status,
          updatedAtMs: asSafeInteger(snapshot?.updatedAtMs),
          sourceEventCount: asSafeInteger(snapshot?.sourceEventCount),
        };
      });
      const result = {
        metrics,
      };
      requireJsonBudget(
        result,
        MAX_TRAINING_METRIC_CATALOG_RESPONSE_BYTES,
        'The Training metric catalog exceeds the MCP response limit.',
      );
      return result;
    },

    async queryMetric(input: QueryMetricInput) {
      const result = await querySelectedMetrics(dependencies, {
        ...input,
        metrics: [{
          metric: input.metric,
          aggregation: input.aggregation,
        }],
      });
      return result.results[0];
    },

    async queryMetrics(input: QueryMetricsInput) {
      return querySelectedMetrics(dependencies, input);
    },

    async listMeasurementTypes(): Promise<ListMeasurementTypesResult> {
      return {
        measurementTypes: getMcpMeasurementCatalog(),
      };
    },

    async queryMeasurements(
      input: QueryMeasurementsInput,
    ): Promise<QueryMeasurementsResult> {
      validateBoundedRange(input.startTimeMs, input.endTimeMs);
      const timeZone = requireTimeZone(input.timeZone);
      const definition = resolveMcpMeasurementDefinition(input.measurementType);
      if (!definition) {
        throw new McpDataError(
          'invalid_metric',
          'The measurement type is not supported.',
        );
      }
      if (!definition.supportedAggregations.includes(input.aggregation)) {
        throw new McpDataError(
          'invalid_request',
          'The aggregation is not supported for this measurement type.',
        );
      }
      if (!definition.supportedIntervals.includes(input.interval)) {
        throw new McpDataError(
          'invalid_request',
          'The interval is not supported for this measurement type.',
        );
      }

      const measurementType = getMcpMeasurementCatalog()
        .find(candidate => candidate.id === definition.id);
      if (!measurementType) {
        throw new McpDataError(
          'invalid_metric',
          'The measurement type is not available in the current Sports Lib version.',
        );
      }

      const documents = await fetchBoundedEventDocuments(dependencies, input);
      const measurements = documents.flatMap((document) => {
        if (isBenchmarkEventForTrainingMetrics(document.data)) {
          return [];
        }
        const recordedAtMs = asTimestampMs(document.data.startDate);
        const stats = document.data.stats;
        if (
          recordedAtMs === null
          || !stats
          || typeof stats !== 'object'
          || Array.isArray(stats)
        ) {
          return [];
        }
        const value = projectSportsLibNumericMetricValue(
          definition.canonicalMetricType,
          (stats as Record<string, unknown>)[definition.canonicalMetricType],
        );
        if (
          value === null
          || !isMcpMeasurementValueAllowed(definition, value)
        ) {
          return [];
        }
        return [{
          recordedAtMs,
          value,
        }];
      });
      const points = buildMeasurementPoints(
        measurements,
        input.interval,
        input.aggregation,
        timeZone,
      );
      const firstPoint = points[0];
      const latestPoint = points[points.length - 1];
      const result: QueryMeasurementsResult = {
        measurementType,
        startTimeMs: input.startTimeMs,
        endTimeMs: input.endTimeMs,
        timeZone,
        aggregation: input.aggregation,
        interval: input.interval,
        measurementCount: measurements.length,
        points,
        summary: firstPoint && latestPoint
          ? {
            firstPoint,
            latestPoint,
            absoluteChange: latestPoint.value - firstPoint.value,
          }
          : null,
      };
      requireJsonBudget(
        result,
        MAX_MEASUREMENT_RESPONSE_BYTES,
        'The measurement query exceeds the MCP response limit.',
      );
      return result;
    },

    async getTrainingMetric(uid: string, metricKind: string) {
      if (!isDerivedMetricKind(metricKind)) {
        throw new McpDataError('invalid_metric', 'Unknown Training-derived metric kind.');
      }
      const snapshot = await dependencies.fetchDerivedSnapshot(uid, metricKind);
      const schemaVersion = asFiniteNumber(snapshot?.schemaVersion);
      if (
        !snapshot
        || snapshot.status !== 'ready'
        || snapshot.payload == null
        || schemaVersion === null
        || schemaVersion !== DERIVED_METRIC_SCHEMA_VERSION
      ) {
        throw new McpDataError('metric_not_ready', 'The requested Training-derived metric is not ready.');
      }

      return {
        metricKind,
        schemaVersion,
        updatedAtMs: asFiniteNumber(snapshot.updatedAtMs),
        sourceEventCount: asNonNegativeNumber(snapshot.sourceEventCount),
        payload: redactDerivedPayload(snapshot.payload),
      };
    },

    async getTodayReadiness(
      input: GetTodayReadinessInput,
    ): Promise<GetTodayReadinessResult> {
      const { result } = await loadTodayReadiness(dependencies, input);
      requireJsonBudget(
        result,
        MAX_TODAY_READINESS_RESPONSE_BYTES,
        'The current readiness response exceeds the MCP response limit.',
      );
      return result;
    },

    async getDailyReport(input: GetDailyReportInput) {
      const timeZone = requireTimeZone(input.timeZone);
      const [
        readiness,
        trainingSummarySnapshot,
      ] = await Promise.all([
        loadTodayReadiness(dependencies, {
          ...input,
          timeZone,
        }, {
          includeDailyReportFields: true,
        }),
        dependencies.fetchDerivedSnapshot(
          input.uid,
          DERIVED_METRIC_KINDS.TrainingSummary,
        ),
      ]);
      const result = {
        sleep: projectDailyReportSleep(readiness.sleepNights),
        readiness: readiness.result,
        trainingSummary: projectDailyTrainingSummary(
          trainingSummarySnapshot,
          readiness.result.asOfTimeMs,
        ),
      };
      requireJsonBudget(
        result,
        MAX_DAILY_REPORT_RESPONSE_BYTES,
        'The daily report exceeds the MCP response limit.',
      );
      return result;
    },

    async getDailyBriefing(input: GetDailyBriefingInput) {
      const timeZone = requireTimeZone(input.timeZone);
      const nowTimeMs = dependencies.now();
      const localDay = resolveRelativeActivityRange(
        'today',
        timeZone,
        nowTimeMs,
      );
      const docs = await dependencies.fetchSleepDocuments(
        input.uid,
        nowTimeMs - DAILY_BRIEFING_SLEEP_LOOKBACK_MS,
        nowTimeMs,
        MAX_DAILY_BRIEFING_SLEEP_SESSIONS + 1,
      );
      if (docs.length > MAX_DAILY_BRIEFING_SLEEP_SESSIONS + 1) {
        throw new McpDataError(
          'query_too_large',
          'The daily briefing sleep query returned more data than requested.',
        );
      }
      const sessions = docs
        .flatMap(doc => {
          const session = toSafeSleepSession(doc.data);
          return session && !session.isNap && session.endTimeMs <= nowTimeMs
            ? [session]
            : [];
        })
        .sort((left, right) => right.endTimeMs - left.endTimeMs)
        .slice(0, MAX_DAILY_BRIEFING_SLEEP_SESSIONS);
      const latestSession = sessions[0] || null;
      const baseline: SafeSleepSession[] = [];
      const baselineSleepDates = new Set<string>();
      if (latestSession) {
        for (const session of sessions) {
          if (
            session.provider !== latestSession.provider
            || session.sleepDate === latestSession.sleepDate
            || session.endTimeMs >= latestSession.endTimeMs
            || baselineSleepDates.has(session.sleepDate)
          ) {
            continue;
          }
          baseline.push(session);
          baselineSleepDates.add(session.sleepDate);
          if (baseline.length === MAX_DAILY_BRIEFING_BASELINE_NIGHTS) {
            break;
          }
        }
      }
      const baselineDurationSeconds = baseline.length >= MIN_DAILY_BRIEFING_BASELINE_NIGHTS
        ? baseline.reduce((total, session) => total + session.durationSeconds, 0) / baseline.length
        : null;
      const [trainingReadinessSnapshot, trainingSummarySnapshot] = await Promise.all([
        dependencies.fetchDerivedSnapshot(
          input.uid,
          DERIVED_METRIC_KINDS.TrainingReadiness,
        ),
        dependencies.fetchDerivedSnapshot(
          input.uid,
          DERIVED_METRIC_KINDS.TrainingSummary,
        ),
      ]);
      const result = {
        asOfTimeMs: nowTimeMs,
        timeZone,
        localDayStartTimeMs: localDay.startTimeMs,
        localDayEndTimeMs: localDay.endTimeMs,
        sleep: {
          status: latestSession ? 'available' as const : 'no_completed_session' as const,
          latestSession: latestSession
            ? projectDailyBriefingSleepSession(latestSession)
            : null,
          comparison: {
            sameProviderNightCount: baseline.length,
            averageDurationSeconds: baselineDurationSeconds,
            durationDeltaSeconds: latestSession && baselineDurationSeconds !== null
              ? latestSession.durationSeconds - baselineDurationSeconds
              : null,
          },
        },
        trainingReadiness: projectDailyBriefingReadiness(
          trainingReadinessSnapshot,
          nowTimeMs,
        ),
        trainingSummary: projectDailyTrainingSummary(
          trainingSummarySnapshot,
          nowTimeMs,
        ),
      };
      requireJsonBudget(
        result,
        MAX_DAILY_BRIEFING_RESPONSE_BYTES,
        'The daily briefing exceeds the MCP response limit.',
      );
      return result;
    },

    async listActivities(input: ListActivitiesInput) {
      const {
        cursor,
        query,
      } = resolveActivityListQuery(dependencies, input);
      const limit = Math.min(
        MAX_ACTIVITY_PAGE_SIZE,
        Math.max(1, Math.floor(input.limit || 25)),
      );
      const scanLimit = query.activityTypes.length
        ? MAX_ACTIVITY_LIST_SCAN_DOCUMENTS
        : limit;
      const documents = await dependencies.fetchActivityDocuments(
        input.uid,
        query.startTimeMs,
        query.endTimeMs,
        scanLimit + 1,
        cursor,
        input.includeLocation,
      );
      if (documents.length > scanLimit + 1) {
        throw new McpDataError(
          'query_too_large',
          'The activity query returned more data than requested.',
        );
      }

      const activities: SafeActivityListEntry['summary'][] = [];
      let scannedActivityCount = 0;
      let skippedActivityCount = 0;
      let cumulativeBytes = 0;
      let lastScannedDocument: RawDocument | undefined;
      for (const document of documents.slice(0, scanLimit)) {
        cumulativeBytes += measureJsonBytes(
          document.data,
          'The activity list contains data that cannot be processed safely.',
        );
        if (cumulativeBytes > MAX_ACTIVITY_LIST_BYTES) {
          throw new McpDataError(
            'query_too_large',
            'The activity list exceeds the MCP processing limit.',
          );
        }
        scannedActivityCount += 1;
        lastScannedDocument = document;
        const entry = projectActivityListEntry(document, input);
        if (
          !entry
          || !activityTypeMatches(entry.summary.activityType, query.activityTypes)
        ) {
          skippedActivityCount += 1;
          continue;
        }
        activities.push(entry.summary);
        if (activities.length >= limit) {
          break;
        }
      }
      const hasMore = scannedActivityCount < documents.length;
      const lastScannedTimeMs = asTimestampMs(lastScannedDocument?.data.eventStartDate);
      if (
        hasMore
        && (
          !lastScannedDocument
          || lastScannedTimeMs === null
          || !isValidFirestoreDocumentId(lastScannedDocument.id)
        )
      ) {
        throw new McpDataError(
          'temporarily_unavailable',
          'The activity query could not be paginated safely.',
        );
      }
      const nextCursor = hasMore && lastScannedDocument && lastScannedTimeMs !== null
        ? encodeActivityListCursor({
            timeMs: lastScannedTimeMs,
            id: lastScannedDocument.id,
          }, input, query)
        : null;

      return {
        scannedActivityCount,
        skippedActivityCount,
        activities,
        nextCursor,
        scanComplete: nextCursor === null,
      };
    },

    async findActivitiesNearLocation(input: FindNearbyActivitiesInput) {
      const hasStartTime = input.startTimeMs !== undefined;
      const hasEndTime = input.endTimeMs !== undefined;
      if (hasStartTime !== hasEndTime) {
        throw new McpDataError(
          'invalid_request',
          'start and end must either both be provided or both be omitted.',
        );
      }
      if (hasStartTime && hasEndTime) {
        validateBoundedRange(input.startTimeMs!, input.endTimeMs!);
      }
      const radiusMeters = validateNearbyRadius(input.radiusMeters);
      const activityTypes = [
        ...new Set(resolveActivityTypes(input.activityTypes).map(String)),
      ];
      const location = await resolveNearbyLocation(dependencies, input);
      const queryHash = buildNearbyQueryHash({
        location,
        radiusMeters,
        activityTypes,
        startTimeMs: input.startTimeMs,
        endTimeMs: input.endTimeMs,
      });
      const cursor = decodeNearbyCursor(
        'activity_nearby_cursor',
        input.cursor,
        input.uid,
        input.connectionId,
        queryHash,
      );
      const limit = Math.min(25, Math.max(1, Math.floor(input.limit || 10)));
      const documents = await dependencies.fetchNearbyActivityDocuments(
        input.uid,
        input.startTimeMs,
        input.endTimeMs,
        MAX_NEARBY_ACTIVITY_SCAN_DOCUMENTS + 1,
        cursor,
      );
      if (documents.length > MAX_NEARBY_ACTIVITY_SCAN_DOCUMENTS + 1) {
        throw new McpDataError(
          'query_too_large',
          'The nearby activity query returned more data than requested.',
        );
      }

      const matches: Array<Record<string, unknown>> = [];
      let processedDocumentCount = 0;
      let skippedActivityCount = 0;
      let cumulativeBytes = 0;
      let lastProcessedDocument: RawDocument | undefined;
      for (const document of documents.slice(0, MAX_NEARBY_ACTIVITY_SCAN_DOCUMENTS)) {
        cumulativeBytes += measureJsonBytes(
          document.data,
          'The nearby activity query contains data that cannot be processed safely.',
        );
        if (cumulativeBytes > MAX_ACTIVITY_LIST_BYTES) {
          throw new McpDataError(
            'query_too_large',
            'The nearby activity query exceeds the MCP processing limit.',
          );
        }
        processedDocumentCount += 1;
        lastProcessedDocument = document;
        const entry = projectActivityListEntry(document, {
          ...input,
          includeLocation: true,
        });
        if (
          !entry
          || !activityTypeMatches(entry.summary.activityType, activityTypes)
        ) {
          skippedActivityCount += 1;
          continue;
        }
        const positioned = [
          entry.summary.startPosition
            ? {
              kind: 'start' as const,
              position: entry.summary.startPosition,
              distanceMeters: haversineDistanceMeters(
                location.position,
                entry.summary.startPosition,
              ),
            }
            : null,
          entry.summary.endPosition
            ? {
              kind: 'end' as const,
              position: entry.summary.endPosition,
              distanceMeters: haversineDistanceMeters(
                location.position,
                entry.summary.endPosition,
              ),
            }
            : null,
        ].filter((candidate): candidate is NonNullable<typeof candidate> => (
          candidate !== null
        ));
        const nearbyPositions = positioned.filter(candidate => (
          candidate.distanceMeters <= radiusMeters
        ));
        if (nearbyPositions.length === 0) {
          skippedActivityCount += 1;
          continue;
        }
        const nearest = nearbyPositions.reduce((current, candidate) => (
          candidate.distanceMeters < current.distanceMeters ? candidate : current
        ));
        matches.push({
          ...entry.summary,
          nearestDistanceMeters: nearest.distanceMeters,
          nearestPosition: nearest.position,
          nearestPositionKind: nearest.kind,
          matchedPositionKinds: nearbyPositions.map(candidate => candidate.kind),
        });
        if (matches.length >= limit) {
          break;
        }
      }

      const hasMore = processedDocumentCount < documents.length;
      const lastProcessedTimeMs = asTimestampMs(
        lastProcessedDocument?.data.eventStartDate,
      );
      const nextCursor = hasMore
        && lastProcessedDocument
        && lastProcessedTimeMs !== null
        && isValidFirestoreDocumentId(lastProcessedDocument.id)
        ? encodeNearbyCursor(
            'activity_nearby_cursor',
            {
              timeMs: lastProcessedTimeMs,
              id: lastProcessedDocument.id,
            },
            input.uid,
            input.connectionId,
            queryHash,
          )
        : null;
      const result = {
        location: {
          source: location.source,
          resolvedLabel: location.resolvedLabel,
          ...location.position,
          radiusMeters,
        },
        scannedActivityCount: processedDocumentCount,
        skippedActivityCount,
        activities: matches,
        nextCursor,
        scanComplete: nextCursor === null,
      };
      requireJsonBudget(
        result,
        MAX_NEARBY_ACTIVITY_RESPONSE_BYTES,
        'The nearby activity results exceed the MCP response limit.',
      );
      return result;
    },

    async listActivityLaps(input: ListActivityDetailsInput) {
      return listActivityDetail(dependencies, input, 'laps');
    },

    async listActivityJumps(input: ListActivityDetailsInput) {
      return listActivityDetail(dependencies, input, 'jumps');
    },

    async listActivitySwimLengths(input: ListActivityDetailsInput) {
      return listActivityDetail(dependencies, input, 'swim_lengths');
    },

    async getActivityMetrics(input: GetActivityMetricsInput) {
      return getActivityMetrics(dependencies, input);
    },

    async getActivityOverview(input: GetActivityOverviewInput) {
      return getActivityOverview(dependencies, input);
    },

    async rankActivitiesByMetric(input: RankActivitiesByMetricInput) {
      return rankActivitiesByMetric(dependencies, input);
    },

    async getActivityChartData(input: GetActivityChartDataInput) {
      return getActivityChartData(dependencies, input);
    },

    async listRoutes(input: ListRoutesInput) {
      const {
        cursor,
        query,
      } = resolveRouteListQuery(input);
      const limit = Math.min(
        MAX_ROUTE_PAGE_SIZE,
        Math.max(1, Math.floor(input.limit || 25)),
      );
      const scanLimit = query.activityTypes.length || query.search !== null
        ? MAX_ROUTE_LIST_SCAN_DOCUMENTS
        : limit;
      const documents = await dependencies.fetchRouteDocuments(
        input.uid,
        scanLimit + 1,
        cursor,
        input.includeLocation,
      );
      if (documents.length > scanLimit + 1) {
        throw new McpDataError(
          'query_too_large',
          'The route query returned more data than requested.',
        );
      }
      const routes: SafeRouteListEntry['summary'][] = [];
      let scannedRouteCount = 0;
      let skippedRouteCount = 0;
      let cumulativeBytes = 0;
      let lastScannedDocument: RawDocument | undefined;
      for (const document of documents.slice(0, scanLimit)) {
        cumulativeBytes += measureJsonBytes(
          document.data,
          'The route list contains data that cannot be processed safely.',
        );
        if (cumulativeBytes > MAX_ROUTE_LIST_BYTES) {
          throw new McpDataError(
            'query_too_large',
            'The route list exceeds the MCP processing limit.',
          );
        }
        scannedRouteCount += 1;
        lastScannedDocument = document;
        const entry = projectRouteListEntry(document, input);
        if (
          !entry
          || !routeActivityTypesMatch(entry.summary.activityTypes, query.activityTypes)
          || !routeNameMatches(entry.summary.name, query.search)
        ) {
          skippedRouteCount += 1;
          continue;
        }
        routes.push(entry.summary);
        if (routes.length >= limit) {
          break;
        }
      }
      const hasMore = scannedRouteCount < documents.length;
      const lastScannedTimeMs = asTimestampMs(lastScannedDocument?.data.importedAt);
      if (
        hasMore
        && (
          !lastScannedDocument
          || lastScannedTimeMs === null
          || !isValidFirestoreDocumentId(lastScannedDocument.id)
        )
      ) {
        throw new McpDataError(
          'temporarily_unavailable',
          'The route query could not be paginated safely.',
        );
      }
      const nextCursor = hasMore && lastScannedDocument && lastScannedTimeMs !== null
        ? encodeRouteListCursor({
            timeMs: lastScannedTimeMs,
            id: lastScannedDocument.id,
          }, input, query)
        : null;

      return {
        scannedRouteCount,
        skippedRouteCount,
        routes,
        nextCursor,
        scanComplete: nextCursor === null,
      };
    },

    async findRoutesNearLocation(input: FindNearbyRoutesInput) {
      const radiusMeters = validateNearbyRadius(input.radiusMeters);
      const activityTypes = [
        ...new Set(resolveActivityTypes(input.activityTypes).map(String)),
      ];
      const location = await resolveNearbyLocation(dependencies, input);
      const queryHash = buildNearbyQueryHash({
        location,
        radiusMeters,
        activityTypes,
      });
      const cursor = decodeNearbyCursor(
        'route_nearby_cursor',
        input.cursor,
        input.uid,
        input.connectionId,
        queryHash,
      );
      const limit = Math.min(10, Math.max(1, Math.floor(input.limit || 10)));
      const documents = await dependencies.fetchRouteDocuments(
        input.uid,
        MAX_NEARBY_ROUTE_SCAN_DOCUMENTS + 1,
        cursor,
        true,
      );
      if (documents.length > MAX_NEARBY_ROUTE_SCAN_DOCUMENTS + 1) {
        throw new McpDataError(
          'query_too_large',
          'The nearby route query returned more data than requested.',
        );
      }

      const matches: Array<Record<string, unknown>> = [];
      let processedDocumentCount = 0;
      let skippedRouteCount = 0;
      let routeDetailLoadCount = 0;
      let routeDetailBytes = 0;
      let routePointWorkCount = 0;
      let decodedPointCount = 0;
      let summaryBytes = 0;
      let stoppedForDetailBudget = false;
      let lastProcessedDocument: RawDocument | undefined;
      for (const document of documents.slice(0, MAX_NEARBY_ROUTE_SCAN_DOCUMENTS)) {
        summaryBytes += measureJsonBytes(
          document.data,
          'The nearby route query contains data that cannot be processed safely.',
        );
        if (summaryBytes > MAX_ROUTE_LIST_BYTES) {
          throw new McpDataError(
            'query_too_large',
            'The nearby route query exceeds the MCP summary processing limit.',
          );
        }
        const entry = projectRouteListEntry(document, {
          ...input,
          includeLocation: true,
        });
        if (
          !entry
          || !routeActivityTypesMatch(entry.summary.activityTypes, activityTypes)
          || (
            entry.summary.bounds
            && !boundsMayBeWithinRadius(
              location.position,
              entry.summary.bounds,
              radiusMeters,
            )
          )
        ) {
          processedDocumentCount += 1;
          lastProcessedDocument = document;
          skippedRouteCount += 1;
          continue;
        }
        if (routeDetailLoadCount >= MAX_NEARBY_ROUTE_DETAIL_LOADS) {
          stoppedForDetailBudget = true;
          break;
        }

        const detail = await dependencies.fetchRouteDocument(
          input.uid,
          document.id,
          'geometry',
        );
        routeDetailLoadCount += 1;
        if (!detail || detail.id !== document.id) {
          processedDocumentCount += 1;
          lastProcessedDocument = document;
          skippedRouteCount += 1;
          continue;
        }
        const currentDetailBytes = measureJsonBytes(
          detail.data.preview,
          'The nearby route previews cannot be processed safely.',
        );
        if (currentDetailBytes > MAX_NEARBY_ROUTE_DETAIL_BYTES) {
          processedDocumentCount += 1;
          lastProcessedDocument = document;
          skippedRouteCount += 1;
          continue;
        }
        if (
          routeDetailBytes + currentDetailBytes
          > MAX_NEARBY_ROUTE_DETAIL_BYTES
        ) {
          stoppedForDetailBudget = true;
          break;
        }
        const rawPreview = detail.data.preview
          && typeof detail.data.preview === 'object'
          && !Array.isArray(detail.data.preview)
          ? detail.data.preview as Record<string, unknown>
          : null;
        const declaredPreviewPointCount = asSafeInteger(rawPreview?.pointCount);
        if (
          declaredPreviewPointCount !== null
          && declaredPreviewPointCount > 0
          && declaredPreviewPointCount <= MAX_ROUTE_PREVIEW_POINTS
          && routePointWorkCount + declaredPreviewPointCount
            > MAX_NEARBY_ROUTE_DECODED_POINTS
        ) {
          stoppedForDetailBudget = true;
          break;
        }
        routeDetailBytes += currentDetailBytes;
        if (
          declaredPreviewPointCount !== null
          && declaredPreviewPointCount > 0
          && declaredPreviewPointCount <= MAX_ROUTE_PREVIEW_POINTS
        ) {
          routePointWorkCount += declaredPreviewPointCount;
        }

        let preview: ReturnType<typeof projectRoutePreviewDetails>;
        try {
          preview = projectRoutePreviewDetails(detail.data.preview);
        } catch {
          processedDocumentCount += 1;
          lastProcessedDocument = document;
          skippedRouteCount += 1;
          continue;
        }
        const previewPointCount = preview.decodedSegments.reduce(
          (sum, segment) => sum + segment.length,
          0,
        );
        decodedPointCount += previewPointCount;
        processedDocumentCount += 1;
        lastProcessedDocument = document;

        const nearestBySegment = preview.decodedSegments.flatMap(
          (points, segmentIndex) => {
            const nearest = findNearestPointOnPolyline(location.position, points);
            return nearest ? [{
              ...nearest,
              segmentIndex,
              startPosition: points[0],
              endPosition: points[points.length - 1],
            }] : [];
          },
        );
        if (nearestBySegment.length === 0) {
          skippedRouteCount += 1;
          continue;
        }
        const nearest = nearestBySegment.reduce((current, candidate) => (
          candidate.distanceMeters < current.distanceMeters ? candidate : current
        ));
        if (nearest.distanceMeters > radiusMeters) {
          skippedRouteCount += 1;
          continue;
        }
        matches.push({
          ...entry.summary,
          nearestDistanceMeters: nearest.distanceMeters,
          nearestPosition: nearest.position,
          matchingSegmentIndex: nearest.segmentIndex,
          matchingSegmentStartPosition: nearest.startPosition,
          matchingSegmentEndPosition: nearest.endPosition,
        });
        if (matches.length >= limit) {
          break;
        }
      }

      const hasMore = stoppedForDetailBudget
        || processedDocumentCount < documents.length;
      const lastProcessedTimeMs = asTimestampMs(
        lastProcessedDocument?.data.importedAt,
      );
      const nextCursor = hasMore
        && lastProcessedDocument
        && lastProcessedTimeMs !== null
        && isValidFirestoreDocumentId(lastProcessedDocument.id)
        ? encodeNearbyCursor(
            'route_nearby_cursor',
            {
              timeMs: lastProcessedTimeMs,
              id: lastProcessedDocument.id,
            },
            input.uid,
            input.connectionId,
            queryHash,
          )
        : null;
      const result = {
        location: {
          source: location.source,
          resolvedLabel: location.resolvedLabel,
          ...location.position,
          radiusMeters,
        },
        scannedRouteCount: processedDocumentCount,
        loadedRoutePreviewCount: routeDetailLoadCount,
        decodedRoutePointCount: decodedPointCount,
        skippedRouteCount,
        routes: matches,
        nextCursor,
        scanComplete: nextCursor === null,
      };
      requireJsonBudget(
        result,
        MAX_NEARBY_ROUTE_RESPONSE_BYTES,
        'The nearby route results exceed the MCP response limit.',
      );
      return result;
    },

    async getRouteGeometry(input: RouteDetailInput) {
      const reference = decodeRouteReference(
        input.routeRef,
        input.uid,
        input.connectionId,
      );
      const document = await dependencies.fetchRouteDocument(
        input.uid,
        reference.routeId,
        'geometry',
      );
      if (!document || document.id !== reference.routeId) {
        throw new McpDataError(
          'detail_not_available',
          'Route preview geometry is not available.',
        );
      }
      return {
        geometry: projectRoutePreview(document.data.preview),
      };
    },

    async listRouteWaypoints(input: RouteDetailInput) {
      const reference = decodeRouteReference(
        input.routeRef,
        input.uid,
        input.connectionId,
      );
      const document = await dependencies.fetchRouteDocument(
        input.uid,
        reference.routeId,
        'source',
      );
      const sourceFile = document && document.id === reference.routeId
        ? getPrimaryRouteSource(document.data)
        : null;
      if (!document || !sourceFile) {
        throw new McpDataError(
          'detail_not_available',
          'Saved route waypoints are not available.',
        );
      }

      let resolvedExtension: string;
      try {
        resolvedExtension = resolveRouteSourceExtension(
          sourceFile,
          asBoundedString(document.data.srcFileType, 20) || undefined,
        );
      } catch {
        throw new McpDataError(
          'detail_not_available',
          'Saved route waypoints are not available.',
        );
      }

      let payload: Buffer;
      try {
        payload = await dependencies.downloadRouteSource(
          input.uid,
          reference.routeId,
          sourceFile,
          MAX_ROUTE_SOURCE_BYTES,
        );
      } catch (error) {
        if (error instanceof McpDataError) {
          throw error;
        }
        throw new McpDataError(
          'detail_not_available',
          'Saved route waypoints are not available.',
        );
      }
      if (payload.length > MAX_ROUTE_SOURCE_BYTES) {
        throw new McpDataError(
          'query_too_large',
          'The saved route source exceeds the MCP size limit.',
        );
      }

      let rawWaypoints: RouteWaypointJSONInterface[];
      try {
        rawWaypoints = await dependencies.parseRouteWaypoints(
          payload,
          resolvedExtension,
        );
      } catch (error) {
        if (error instanceof McpDataError) {
          throw error;
        }
        if (
          error instanceof RouteProcessingHttpStatusError
          && error.message.toLowerCase().includes('too large')
        ) {
          throw new McpDataError(
            'query_too_large',
            'The saved route source exceeds the MCP parsing limit.',
          );
        }
        throw new McpDataError(
          'detail_not_available',
          'Saved route waypoints are not available.',
        );
      }
      if (!Array.isArray(rawWaypoints)) {
        throw new McpDataError(
          'detail_not_available',
          'Saved route waypoints are not available.',
        );
      }
      if (rawWaypoints.length > MAX_ROUTE_WAYPOINTS) {
        throw new McpDataError(
          'query_too_large',
          'The saved route contains more than 500 waypoints.',
        );
      }
      const waypoints = rawWaypoints.flatMap((waypoint, index) => {
        const projected = projectRouteWaypoint(waypoint, index);
        return projected ? [projected] : [];
      });
      const result = {
        waypoints,
        waypointCount: waypoints.length,
      };
      requireJsonBudget(
        result,
        MAX_ROUTE_WAYPOINT_BYTES,
        'The saved route waypoints exceed the MCP response limit.',
      );
      return result;
    },

    async listSleepSessions(input: ListSleepSessionsInput) {
      validateBoundedRange(input.startTimeMs, input.endTimeMs);
      const limit = Math.min(MAX_SLEEP_PAGE_SIZE, Math.max(1, Math.floor(input.limit || 25)));
      const cursor = decodeCursor(input.cursor, input.uid, input.connectionId);
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
          }, input.uid, input.connectionId)
        : rawScanTruncated && lastScannedDoc && lastScannedEndTimeMs !== null
          ? encodeCursor({
              endTimeMs: lastScannedEndTimeMs,
              id: lastScannedDoc.id,
            }, input.uid, input.connectionId)
          : null;

      return {
        sessions: page.map(entry => entry.session),
        nextCursor,
      };
    },

    async listSleepVitals(input: ListSleepVitalsInput): Promise<ListSleepVitalsResult> {
      validateBoundedRange(input.startTimeMs, input.endTimeMs);
      const sessions = await fetchBoundedSafeSleepSessions(input);
      return {
        matchedSessionCount: sessions.length,
        vitals: buildSleepVitalAvailability(sessions),
      };
    },

    async getSleepTrend(input: GetSleepTrendInput): Promise<GetSleepTrendResult> {
      const {
        sessions,
        summary,
      } = await loadSleepSummary(input);
      return {
        rangeStartTimeMs: input.startTimeMs,
        rangeEndTimeMs: input.endTimeMs,
        availableVitals: buildSleepVitalAvailability(sessions),
        ...summary,
      };
    },

    async querySleepSummary(
      input: QuerySleepSummaryInput,
    ): Promise<QuerySleepSummaryResult> {
      return (await loadSleepSummary(input)).summary;
    },
  };
}
