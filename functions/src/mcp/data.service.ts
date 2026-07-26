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
  OriginalRouteFileMetaData,
  RouteBounds,
  RouteWaypointJSONInterface,
} from '../../../shared/app-route.interface';
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
  projectSportsLibNumericMetricValue,
  resolveAvailableSportsLibMetrics,
  resolveSportsLibNumericMetric,
} from './metric-catalog';
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
const MAX_SLEEP_QUERY_DOCUMENTS = 1000;
const MAX_SLEEP_PAGE_SIZE = 100;
const SLEEP_CURSOR_VERSION = 1;
const SLEEP_CURSOR_NONCE_BYTES = 12;
const SLEEP_CURSOR_AUTH_TAG_BYTES = 16;
const OPAQUE_VALUE_VERSION = 1;
const OPAQUE_VALUE_NONCE_BYTES = 12;
const OPAQUE_VALUE_AUTH_TAG_BYTES = 16;
const MAX_ACTIVITY_LIST_BYTES = 512 * 1024;
const MAX_ACTIVITY_PAGE_SIZE = 100;
const MAX_ACTIVITY_DETAIL_ENTRIES = 10_000;
const MAX_ACTIVITY_DETAIL_BYTES = 512 * 1024;
const MAX_ACTIVITY_DETAIL_RESPONSE_BYTES = 256 * 1024;
const MAX_ACTIVITY_DETAIL_PAGE_SIZE = 100;
export const MAX_ACTIVITY_METRICS_PER_REQUEST = 25;
const MAX_ACTIVITY_METRIC_DOCUMENT_BYTES = 64 * 1024;
const MAX_ACTIVITY_METRIC_RESPONSE_BYTES = 32 * 1024;
const MAX_ROUTE_LIST_BYTES = 512 * 1024;
const MAX_ROUTE_PAGE_SIZE = 100;
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
  new FieldPath('stats', DataStartPosition.type, 'latitudeDegrees'),
  new FieldPath('stats', DataStartPosition.type, 'longitudeDegrees'),
  new FieldPath('stats', DataEndPosition.type, 'latitudeDegrees'),
  new FieldPath('stats', DataEndPosition.type, 'longitudeDegrees'),
] as const;
const SAFE_SLEEP_VITAL_KEYS = [
  'averageHeartRateBpm',
  'minimumHeartRateBpm',
  'restingHeartRateBpm',
  'averageHrvMs',
  'hrvSampleCount',
  'overnightHrvMs',
  'maxSpo2Percent',
  'averageRespirationBrpm',
] as const satisfies readonly (keyof SleepVitals)[];

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
  startTimeMs: number;
  endTimeMs: number;
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
    cursor?: unknown,
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
  fetchActivityDocuments: (
    uid: string,
    startTimeMs: number,
    endTimeMs: number,
    limit: number,
    cursor?: OrderedDocumentCursor,
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
  ) => Promise<RawDocument | null>;
  fetchActivityMetricDocument: (
    uid: string,
    activityId: string,
    metricTypes: readonly string[],
  ) => Promise<RawDocument | null>;
  fetchRouteDocuments: (
    uid: string,
    limit: number,
    cursor?: OrderedDocumentCursor,
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

const defaultDependencies: McpDataServiceDependencies = {
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
  fetchActivityDocuments: async (uid, startTimeMs, endTimeMs, limit, cursor) => {
    let query = admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('activities')
      .where('eventStartDate', '>=', new Date(startTimeMs))
      .where('eventStartDate', '<=', new Date(endTimeMs))
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
  fetchRouteDocuments: async (uid, limit, cursor) => {
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
        'activityTypes',
        'routeCount',
        'waypointCount',
        'pointCount',
        'bounds',
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

function decodeOrderedCursor(
  kind: 'route_cursor',
  cursor: string | undefined,
  uid: string,
  connectionId: string,
): OrderedDocumentCursor | undefined {
  if (!cursor) {
    return undefined;
  }
  const parsed = decodeOpaqueValue(kind, cursor, uid, connectionId, 'pagination cursor');
  if (
    !Number.isSafeInteger(parsed.timeMs)
    || !isValidFirestoreDocumentId(parsed.id)
  ) {
    throw new McpDataError('invalid_request', 'The pagination cursor is invalid.');
  }
  return {
    timeMs: Number(parsed.timeMs),
    id: parsed.id,
  };
}

function encodeOrderedCursor(
  kind: 'route_cursor',
  cursor: OrderedDocumentCursor,
  uid: string,
  connectionId: string,
): string {
  return encodeOpaqueValue(kind, cursor as unknown as Record<string, unknown>, uid, connectionId);
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

function decodeActivityListCursor(
  cursor: string | undefined,
  input: Pick<
    ListActivitiesInput,
    'uid' | 'connectionId' | 'startTimeMs' | 'endTimeMs'
  >,
): OrderedDocumentCursor | undefined {
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
  if (
    !Number.isSafeInteger(parsed.timeMs)
    || !isValidFirestoreDocumentId(parsed.id)
    || parsed.startTimeMs !== input.startTimeMs
    || parsed.endTimeMs !== input.endTimeMs
  ) {
    throw new McpDataError('invalid_request', 'The pagination cursor is invalid.');
  }
  return {
    timeMs: Number(parsed.timeMs),
    id: parsed.id,
  };
}

function encodeActivityListCursor(
  cursor: OrderedDocumentCursor,
  input: Pick<
    ListActivitiesInput,
    'uid' | 'connectionId' | 'startTimeMs' | 'endTimeMs'
  >,
): string {
  return encodeOpaqueValue('activity_cursor', {
    ...cursor,
    startTimeMs: input.startTimeMs,
    endTimeMs: input.endTimeMs,
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

function projectJump(value: unknown, index: number) {
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
    latitudeDegrees: asLatitude(rawJump.position_lat),
    longitudeDegrees: asLongitude(rawJump.position_long),
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

function buildMetricAggregationEventJson(
  data: Record<string, unknown>,
  metricType: string,
): EventJSONInterface {
  const rawStats = data.stats && typeof data.stats === 'object' && !Array.isArray(data.stats)
    ? data.stats as Record<string, unknown>
    : {};
  const stats = Object.fromEntries(
    [metricType, DataActivityTypes.type].flatMap((type) => {
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
    // Only the requested metric and activity type cross the Sports Lib import
    // boundary after the cumulative query budgets have passed.
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
  aggregation: 'total' | 'average' | 'minimum' | 'maximum';
  groupBy: 'date' | 'activity_type';
  interval: 'auto' | 'hourly' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semesterly' | 'yearly';
  timeZone: string;
  activityTypes?: readonly string[];
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

function normalizeSleepVitals(value: unknown): Partial<SleepVitals> | null {
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
  const normalized = Object.fromEntries(entries) as Partial<SleepVitals>;
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

export interface QuerySleepSummaryInput {
  uid: string;
  startTimeMs: number;
  endTimeMs: number;
  includeNaps?: boolean;
  provider?: SleepProvider;
  groupBy: 'day' | 'week' | 'month';
  timeZone: string;
}

export interface ListActivitiesInput {
  uid: string;
  connectionId: string;
  appBaseUrl: string;
  startTimeMs: number;
  endTimeMs: number;
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
  cursor?: string;
  limit?: number;
}

export interface GetActivityMetricsInput {
  uid: string;
  connectionId: string;
  activityRef: string;
  metrics: readonly string[];
}

export interface ListRoutesInput {
  uid: string;
  connectionId: string;
  appBaseUrl: string;
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
  stageDurationsSeconds: Record<string, number>;
  vitalSums: Record<string, number>;
  vitalCounts: Record<string, number>;
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
    startPosition: SafePosition | null;
    endPosition: SafePosition | null;
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
    activityTypes: string[];
    routeCount: number | null;
    waypointCount: number | null;
    pointCount: number | null;
    bounds: RouteBounds | null;
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

function projectActivityListEntry(
  document: RawDocument,
  input: Pick<ListActivitiesInput, 'uid' | 'connectionId' | 'appBaseUrl'>,
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
      startPosition: projectPosition(rawStats[DataStartPosition.type]),
      endPosition: projectPosition(rawStats[DataEndPosition.type]),
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
  input: Pick<ListRoutesInput, 'uid' | 'connectionId' | 'appBaseUrl'>,
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
      activityTypes: normalizeActivityTypes(document.data.activityTypes),
      routeCount: asSafeInteger(document.data.routeCount),
      waypointCount: asSafeInteger(document.data.waypointCount),
      pointCount: asSafeInteger(document.data.pointCount),
      bounds: projectBounds(document.data.bounds),
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
        ? projectJump(candidate, index)
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
    if (!metric) {
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
        scannedDocs
          .filter(doc => !isBenchmarkEventForTrainingMetrics(doc.data))
          .map(doc => doc.data.stats as Record<string, unknown> | undefined),
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
      const docs = await fetchBoundedEventDocuments(dependencies, input);

      const events = docs.flatMap((doc) => {
        if (isBenchmarkEventForTrainingMetrics(doc.data)) {
          return [];
        }
        try {
          const event = dependencies.importEvent(
            buildMetricAggregationEventJson(doc.data, metric.type),
            doc.id,
          );
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

    async listActivities(input: ListActivitiesInput) {
      validateBoundedRange(input.startTimeMs, input.endTimeMs);
      const limit = Math.min(
        MAX_ACTIVITY_PAGE_SIZE,
        Math.max(1, Math.floor(input.limit || 25)),
      );
      const cursor = decodeActivityListCursor(input.cursor, input);
      const scanLimit = limit;
      const documents = await dependencies.fetchActivityDocuments(
        input.uid,
        input.startTimeMs,
        input.endTimeMs,
        scanLimit + 1,
        cursor,
      );
      if (documents.length > scanLimit + 1) {
        throw new McpDataError(
          'query_too_large',
          'The activity query returned more data than requested.',
        );
      }
      const scannedDocuments = documents.slice(0, scanLimit);
      let cumulativeBytes = 0;
      const entries = scannedDocuments.flatMap((document) => {
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
        const entry = projectActivityListEntry(document, input);
        return entry ? [entry] : [];
      });
      const page = entries.slice(0, limit);
      const scanTruncated = documents.length > scanLimit;
      const lastScannedDocument = scannedDocuments[scannedDocuments.length - 1];
      const lastScannedTimeMs = asTimestampMs(lastScannedDocument?.data.eventStartDate);
      const nextCursor = scanTruncated
        && lastScannedDocument
        && lastScannedTimeMs !== null
        && isValidFirestoreDocumentId(lastScannedDocument.id)
        ? encodeActivityListCursor({
            timeMs: lastScannedTimeMs,
            id: lastScannedDocument.id,
          }, input)
        : null;

      return {
        activities: page.map(entry => entry.summary),
        nextCursor,
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
        const entry = projectActivityListEntry(document, input);
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

    async listRoutes(input: ListRoutesInput) {
      const limit = Math.min(
        MAX_ROUTE_PAGE_SIZE,
        Math.max(1, Math.floor(input.limit || 25)),
      );
      const cursor = decodeOrderedCursor(
        'route_cursor',
        input.cursor,
        input.uid,
        input.connectionId,
      );
      const scanLimit = limit;
      const documents = await dependencies.fetchRouteDocuments(
        input.uid,
        scanLimit + 1,
        cursor,
      );
      if (documents.length > scanLimit + 1) {
        throw new McpDataError(
          'query_too_large',
          'The route query returned more data than requested.',
        );
      }
      const scannedDocuments = documents.slice(0, scanLimit);
      let cumulativeBytes = 0;
      const entries = scannedDocuments.flatMap((document) => {
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
        const entry = projectRouteListEntry(document, input);
        return entry ? [entry] : [];
      });
      const page = entries.slice(0, limit);
      const scanTruncated = documents.length > scanLimit;
      const lastScannedDocument = scannedDocuments[scannedDocuments.length - 1];
      const lastScannedTimeMs = asTimestampMs(lastScannedDocument?.data.importedAt);
      const nextCursor = scanTruncated
        && lastScannedDocument
        && lastScannedTimeMs !== null
        && isValidFirestoreDocumentId(lastScannedDocument.id)
        ? encodeOrderedCursor('route_cursor', {
            timeMs: lastScannedTimeMs,
            id: lastScannedDocument.id,
          }, input.uid, input.connectionId)
        : null;

      return {
        routes: page.map(entry => entry.summary),
        nextCursor,
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
        const entry = projectRouteListEntry(document, input);
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
