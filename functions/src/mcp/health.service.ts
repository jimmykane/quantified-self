import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import { DataInterface, DynamicDataLoader, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { z } from 'zod';
import {
  HEALTH_METRIC_CATALOG, HEALTH_PROVIDERS, HEALTH_UNITS,
  HEALTH_VALUE_ORIGINS, HEALTH_RECORDING_METHODS, HealthMetricId, HealthMetricEntry,
  HealthSourceRecord, HealthSampleChunk,
} from '../../../shared/health';
import { normalizeHealthRangeQuery } from '../../../shared/health-query';
import {
  decodeHealthMetricSportsLibData, formatCanonicalHealthMetricSportsLibValue,
  sportsLibClassTypeForHealthMetric,
} from '../../../shared/sports-lib-health-data';

// Existing Weight and Sleep contracts remain authoritative and unchanged.
// Deliberate disclosure allowlist: adding a shared (for example reproductive
// health) metric must never silently grant MCP access to that new data family.
export const MCP_HEALTH_METRIC_IDS = [
  'steps', 'wheelchair_pushes', 'distance', 'wheelchair_push_distance', 'floors_climbed',
  'active_duration', 'moderate_intensity_duration', 'vigorous_intensity_duration', 'altitude',
  'active_energy', 'basal_energy', 'total_energy', 'heart_rate', 'resting_heart_rate',
  'heart_rate_variability', 'blood_oxygen_saturation', 'respiration_rate', 'stress_level',
  'stress_state', 'stress_duration', 'body_energy', 'body_energy_change', 'recovery_score',
  'body_mass_index', 'body_fat', 'body_water', 'muscle_mass', 'bone_mass',
  'blood_pressure_systolic', 'blood_pressure_diastolic', 'pulse_rate', 'skin_temperature_deviation',
  'vo2_max', 'fitness_age',
] as const satisfies readonly HealthMetricId[];
const BODY_METRICS = new Set<HealthMetricId>([
  'body_mass_index', 'body_fat', 'body_water', 'muscle_mass', 'bone_mass',
]);
export function isMcpHealthBodyMetric(id: unknown): boolean {
  return typeof id === 'string' && BODY_METRICS.has(id as HealthMetricId);
}
export const MCP_HEALTH_LIMITS = Object.freeze({
  records: 2_048, chunks: 256, samplePoints: 100_000, bytes: 16 * 1024 * 1024,
  series: 32, outputPoints: 400, responseBytes: 512 * 1024,
});
const date = z.iso.date();
const count = z.number().int().nonnegative();
const providerSchema = z.enum(Object.values(HEALTH_PROVIDERS));
const originSchema = z.enum(Object.values(HEALTH_VALUE_ORIGINS));
const recordingMethodSchema = z.enum(Object.values(HEALTH_RECORDING_METHODS));
const BODY_BATTERY_UNIT = 'garmin_body_battery_points' as const;
const bodyBatteryVariant = z.strictObject({
  provider: z.literal('GarminAPI'), semanticVariant: z.literal('garmin_body_battery'),
  unit: z.literal(BODY_BATTERY_UNIT),
});
const scalar = z.union([z.number(), z.enum([
  'relaxing', 'active', 'passive', 'stressful', 'rest', 'activity', 'unmeasurable', 'unknown',
])]);
const aggregation = z.enum([
  'total', 'average', 'minimum', 'maximum', 'latest', 'sample', 'measurement',
  'representative_sample', 'exact', 'summary', 'event', 'other',
]);
// Never serialize arbitrary provider strings. Unknown semantics remain separate
// internally but have a fixed public label, not their raw stored value.
const semanticVariant = z.enum([
  'daily_total', 'daily_resting', 'daily_average', 'daily_minimum', 'daily_maximum',
  'rolling_7_day_average', 'overnight_average', 'overnight_interval', 'hrv_interval_mean',
  'sleep_average', 'point', 'activity_interval', 'activity_interval_average',
  'activity_interval_minimum', 'activity_interval_maximum', 'activity_interval_accumulated',
  'recovery_balance', 'recovery_state', 'three_minute', 'daily_15_second',
  'garmin_body_battery', 'overnight_5_minute_rmssd', 'all_day', 'health_snapshot',
  'health_snapshot_rmssd', 'health_snapshot_sdrr', 'sleep_window_deviation', 'other',
]);
const descriptor = z.strictObject({
  id: z.enum(MCP_HEALTH_METRIC_IDS),
  label: z.string().min(1).max(100),
  category: z.string().min(1).max(100),
  sportsLibType: z.string().min(1).max(100),
  canonicalUnit: z.enum(Object.values(HEALTH_UNITS)),
  valueType: z.enum(['number', 'category', 'boolean']),
  requiredScopes: z.array(z.enum(['health:read', 'measurements:read'])).min(1).max(2),
  samplesAllowed: z.boolean(),
  nativeVariants: z.array(bodyBatteryVariant).max(1),
});
const display = z.strictObject({ value: z.string().max(100), unit: z.string().max(100) });
const point = z.strictObject({
  date,
  // Samples use UTC instants; dates always retain the provider's calendar day.
  timeMs: z.number().int().safe().nullable(),
  value: scalar,
  display,
});
export const MCP_HEALTH_CATALOG_SCHEMA = z.strictObject({
  metrics: z.array(descriptor).max(MCP_HEALTH_METRIC_IDS.length),
  summaryRangeDays: z.literal(366), sampleRangeDays: z.literal(31),
  weightTool: z.literal('query_measurements'), sleepTool: z.literal('get_sleep_trend'),
});
export const MCP_HEALTH_QUERY_SCHEMA = z.strictObject({
  metric: descriptor, startDate: date, endDate: date,
  mode: z.enum(['summaries', 'samples']),
  complete: z.boolean(),
  limitsReached: z.array(z.enum(['records', 'chunks', 'samplePoints', 'bytes'])).max(4),
  recordsRead: count, chunksRead: count, samplesRead: count,
  excludedValues: count, sleepReferencesExcluded: count, revisionMismatches: count,
  series: z.array(z.strictObject({
    seriesNumber: count.positive(),
    provider: providerSchema,
    accountNumber: count.positive(),
    aggregation, semanticVariant,
    normalizationStatus: z.enum(['canonical', 'native_only']),
    unit: z.enum([...Object.values(HEALTH_UNITS), BODY_BATTERY_UNIT]),
    origin: originSchema,
    recordingMethod: recordingMethodSchema,
    readingCount: count, returnedPointCount: count,
    downsampled: z.boolean(),
    recordedDays: count, partialDays: count, unknownDays: count,
    points: z.array(point).max(MCP_HEALTH_LIMITS.outputPoints),
  })).max(MCP_HEALTH_LIMITS.series),
  // Body composition is date-bucketed and identity/provenance-free. Individual
  // values are preserved, not averaged across providers or source semantics.
  measurementDays: z.array(z.strictObject({
    date, readings: z.array(z.strictObject({ value: z.number(), display })).max(2_048),
  })).max(366),
}).superRefine((result, context) => {
  const body = BODY_METRICS.has(result.metric.id);
  if ((body && (result.series.length > 0 || result.mode !== 'summaries'))
    || (!body && result.measurementDays.length > 0)) {
    context.addIssue({ code: 'custom', message: 'Health projection does not match its disclosure boundary.' });
  }
}).meta({
  allOf: [{
    if: { properties: { metric: z.toJSONSchema(descriptor.extend({
      id: z.enum([...BODY_METRICS]),
    }), { target: 'draft-7' }) } },
    then: { properties: { series: { type: 'array', maxItems: 0 }, mode: { const: 'summaries' } } },
    else: { properties: { measurementDays: { type: 'array', maxItems: 0 } } },
  }],
});
export type McpHealthResult = z.infer<typeof MCP_HEALTH_QUERY_SCHEMA>;
export interface McpHealthInput {
  uid: string;
  metricId: HealthMetricId;
  startDate: string;
  endDate: string;
  mode: 'summaries' | 'samples';
  maxPoints: number;
  measurementsAllowed: boolean;
}
interface Document { id: string; data: Record<string, unknown>; cursor?: unknown }
export interface McpHealthReadDependencies {
  fetchPage(input: Pick<McpHealthInput, 'uid' | 'metricId' | 'startDate' | 'endDate'>,
    collection: 'healthSourceRecords' | 'healthSampleChunks', limit: number, cursor?: unknown): Promise<Document[]>;
  fetchUnitSettings(uid: string): Promise<UserUnitSettingsInterface | null>;
}
export class McpHealthError extends Error {
  constructor(readonly code: 'invalid_request' | 'query_too_large' | 'temporarily_unavailable', message: string) {
    super(message);
  }
}
export const firestoreHealthReads: McpHealthReadDependencies = {
  async fetchPage(input, collection, limit, cursor) {
    const sourceRecords = collection === 'healthSourceRecords';
    let query = admin.firestore().collection('users').doc(input.uid).collection(collection)
      .where(sourceRecords ? 'metricIds' : 'metricId', sourceRecords ? 'array-contains' : '==', input.metricId)
      .where('calendarDate', '>=', input.startDate).where('calendarDate', '<=', input.endDate)
      .orderBy('calendarDate').orderBy(FieldPath.documentId()).limit(limit)
      .select(...(sourceRecords
        ? ['schemaVersion', 'userID', 'kind', 'calendarDate', 'source.provider', 'source.accountKey',
          'source.revision', 'metrics', 'sampleChunkIds', 'coverage']
        : ['schemaVersion', 'userID', 'parentSourceRecordId', 'provider', 'accountKey', 'metricId',
          'calendarDate', 'startTimeMs', 'endTimeMs', 'aggregation', 'semanticVariant', 'origin',
          'recordingMethod', 'normalizationStatus', 'canonicalUnit', 'offsetMs', 'canonicalValues',
          'revision', 'coverage', ...(input.metricId === 'body_energy' ? ['nativeMetric', 'nativeUnit', 'nativeValues'] : [])]));
    if (cursor) query = query.startAfter(cursor as admin.firestore.QueryDocumentSnapshot);
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, data: doc.data(), cursor: doc }));
  },
  async fetchUnitSettings(uid) {
    const snapshot = await admin.firestore().collection('users').doc(uid).get();
    return snapshot.get('settings.unitSettings') ?? null;
  },
};

export function getMcpHealthCatalog() {
  return MCP_HEALTH_CATALOG_SCHEMA.parse({
    metrics: MCP_HEALTH_METRIC_IDS.map(id => ({
      id, label: HEALTH_METRIC_CATALOG[id].label, category: HEALTH_METRIC_CATALOG[id].category,
      canonicalUnit: HEALTH_METRIC_CATALOG[id].canonicalUnit,
      valueType: HEALTH_METRIC_CATALOG[id].valueType, sportsLibType: sportsLibClassTypeForHealthMetric(id),
      requiredScopes: BODY_METRICS.has(id) ? ['health:read', 'measurements:read'] : ['health:read'],
      samplesAllowed: !BODY_METRICS.has(id),
      nativeVariants: id === 'body_energy'
        ? [{ provider: 'GarminAPI', semanticVariant: 'garmin_body_battery', unit: BODY_BATTERY_UNIT }] : [],
    })),
    summaryRangeDays: 366, sampleRangeDays: 31,
    weightTool: 'query_measurements', sleepTool: 'get_sleep_trend',
  });
}

function safeValue(metricId: HealthMetricId, value: unknown) {
  if (!scalar.safeParse(value).success) return null;
  const definition = HEALTH_METRIC_CATALOG[metricId];
  if (definition.valueType === 'number' && typeof value !== 'number') return null;
  if (definition.valueType === 'category' && typeof value !== 'string') return null;
  try {
    const DataClass = DynamicDataLoader.getDataClassFromDataType(
      sportsLibClassTypeForHealthMetric(metricId),
    ) as unknown as { new(value: unknown): DataInterface };
    const stat = new DataClass(value);
    return stat.getValue() === value && stat.isValueTypeValid(value) ? value as z.infer<typeof scalar> : null;
  } catch { return null; }
}
function safeSemantics(entry: Pick<HealthMetricEntry, 'aggregation' | 'semanticVariant' | 'origin' | 'recordingMethod'>) {
  const origin = originSchema.safeParse(entry.origin);
  const method = recordingMethodSchema.safeParse(entry.recordingMethod);
  if (!origin.success || !method.success
    || typeof entry.aggregation !== 'string' || entry.aggregation.length > 128
    || typeof entry.semanticVariant !== 'string' || entry.semanticVariant.length > 128) return null;
  return {
    aggregation: aggregation.safeParse(entry.aggregation).success ? entry.aggregation as z.infer<typeof aggregation> : 'other' as const,
    semanticVariant: semanticVariant.safeParse(entry.semanticVariant).success ? entry.semanticVariant as z.infer<typeof semanticVariant> : 'other' as const,
    origin: origin.data, recordingMethod: method.data,
  };
}

function isBodyBattery(entry: HealthMetricEntry | HealthSampleChunk, provider: unknown): boolean {
  if (provider !== 'GarminAPI' || entry.metricId !== 'body_energy'
    || entry.semanticVariant !== 'garmin_body_battery'
    || !['sample', 'latest'].includes(entry.aggregation)) return false;
  if ('kind' in entry) {
    return entry.kind === 'value' && entry.normalizationStatus === 'native_only' && !entry.canonical
      && entry.native?.metric === 'timeOffsetBodyBatteryValues' && entry.native.unit === BODY_BATTERY_UNIT;
  }
  return entry.normalizationStatus === 'native_only' && !entry.canonicalUnit && !entry.canonicalValues
    && entry.nativeMetric === 'timeOffsetBodyBatteryValues' && entry.nativeUnit === BODY_BATTERY_UNIT;
}

export async function queryMcpHealth(input: McpHealthInput, reads: McpHealthReadDependencies): Promise<McpHealthResult> {
  const metric = getMcpHealthCatalog().metrics.find(item => item.id === input.metricId);
  const bodyMeasurement = BODY_METRICS.has(input.metricId);
  if (!metric || !['summaries', 'samples'].includes(input.mode)
    || !Number.isInteger(input.maxPoints) || input.maxPoints < 2 || input.maxPoints > 400
    || (bodyMeasurement && (!input.measurementsAllowed || input.mode !== 'summaries'))) {
    throw new McpHealthError('invalid_request', bodyMeasurement
      ? 'Body composition requires Body measurements access and summary mode. Reconnect to grant access.'
      : 'Select a supported Health metric and query mode.');
  }
  try {
    normalizeHealthRangeQuery({ startDate: input.startDate, endDate: input.endDate,
      metricIds: [input.metricId], includeSamples: input.mode === 'samples' });
  } catch {
    throw new McpHealthError('invalid_request', 'Use valid inclusive calendar dates: at most 366 days for summaries or 31 days for samples.');
  }
  const unitSettings = await reads.fetchUnitSettings(input.uid);
  const canonicalUnit = metric.canonicalUnit;
  const result: McpHealthResult = {
    metric, startDate: input.startDate, endDate: input.endDate, mode: input.mode,
    complete: true, limitsReached: [], recordsRead: 0, chunksRead: 0, samplesRead: 0,
    excludedValues: 0, sleepReferencesExcluded: 0, revisionMismatches: 0, series: [], measurementDays: [],
  };
  let bytes = 0;
  let acceptedReadings = 0;
  const parents = new Map<string, HealthSourceRecord>();
  const accountNumbers = new Map<string, number>();
  type Series = McpHealthResult['series'][number] & { days: Map<string, string> };
  const series = new Map<string, Series>();
  const measurementDays = new Map<string, McpHealthResult['measurementDays'][number]>();
  type Reading = { value: z.infer<typeof scalar>; display: z.infer<typeof display> };
  // Repeated intraday values share conversion work only within this owner/metric
  // request. Bound both caches and isolate native units from canonical units.
  const canonicalReadings = new Map<number | string, Reading>();
  const nativeReadings = new Map<number | string, Reading>();
  function prepareReading(value: unknown, nativeBattery: boolean): Reading | null {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const cache = nativeBattery ? nativeReadings : canonicalReadings;
    const cached = cache.get(value);
    if (cached) return cached;
    const canonical = nativeBattery
      ? typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
      : safeValue(input.metricId, value);
    const formatted = canonical === null ? null
      : nativeBattery ? { value: String(canonical), unit: 'Garmin Body Battery points' }
        : formatCanonicalHealthMetricSportsLibValue(input.metricId, canonical, unitSettings);
    if (canonical === null || !formatted) return null;
    const reading = { value: canonical, display: { value: String(formatted.value), unit: String(formatted.unit) } };
    if (cache.size < 1_024) cache.set(value, reading);
    return reading;
  }
  const reachLimit = (limit: McpHealthResult['limitsReached'][number]) => {
    result.complete = false;
    if (!result.limitsReached.includes(limit)) result.limitsReached.push(limit);
  };
  function addReading(value: unknown, entry: HealthMetricEntry | HealthSampleChunk,
    record: { provider: unknown; accountKey: unknown; calendarDate: string; coverage?: { status: string } },
    timeMs: number | null) {
    const nativeBattery = isBodyBattery(entry, record.provider);
    const reading = prepareReading(value, nativeBattery);
    if (!reading) { result.excludedValues++; return; }
    const { value: canonical, display: displayValue } = reading;
    if (++acceptedReadings > (input.mode === 'samples' ? MCP_HEALTH_LIMITS.samplePoints : 8_192)) {
      throw new McpHealthError('query_too_large', 'Too many Health readings. Narrow the date range.');
    }
    if (bodyMeasurement) {
      if (typeof canonical !== 'number') { result.excludedValues++; return; }
      const day = measurementDays.get(record.calendarDate) ?? { date: record.calendarDate, readings: [] };
      if (day.readings.length >= 2_048) throw new McpHealthError('query_too_large', 'Too many measurements on one day.');
      day.readings.push({ value: canonical, display: displayValue });
      measurementDays.set(record.calendarDate, day);
      return;
    }
    const semantics = safeSemantics(entry);
    const provider = providerSchema.safeParse(record.provider);
    if (!semantics || !provider.success || typeof record.accountKey !== 'string'
      || record.accountKey.length === 0 || record.accountKey.length > 128) { result.excludedValues++; return; }
    const accountKey = JSON.stringify([record.provider, record.accountKey]);
    if (!accountNumbers.has(accountKey)) accountNumbers.set(accountKey,
      [...accountNumbers.keys()].filter(key => JSON.parse(key)[0] === record.provider).length + 1);
    const normalizationStatus = nativeBattery ? 'native_only' : 'canonical';
    const unit = nativeBattery ? BODY_BATTERY_UNIT : canonicalUnit;
    const key = JSON.stringify([accountKey, entry.aggregation, entry.semanticVariant, entry.origin, entry.recordingMethod, normalizationStatus, unit]);
    let target = series.get(key);
    if (!target) {
      if (series.size >= MCP_HEALTH_LIMITS.series) throw new McpHealthError('query_too_large', 'Too many Health series. Narrow the date range.');
      target = { seriesNumber: series.size + 1, provider: provider.data, accountNumber: accountNumbers.get(accountKey)!,
        ...semantics, normalizationStatus, unit, readingCount: 0, returnedPointCount: 0, downsampled: false,
        recordedDays: 0, partialDays: 0, unknownDays: 0, points: [], days: new Map() };
      series.set(key, target);
    }
    target.points.push({ date: record.calendarDate, timeMs, value: canonical, display: displayValue });
    const status = record.coverage?.status ?? 'unknown';
    const previous = target.days.get(record.calendarDate);
    target.days.set(record.calendarDate, previous === 'partial' || status === 'partial' ? 'partial'
      : previous === 'unknown' || status !== 'complete' ? 'unknown' : 'complete');
  }
  async function load(collection: 'healthSourceRecords' | 'healthSampleChunks') {
    const records = collection === 'healthSourceRecords';
    const cap = records ? MCP_HEALTH_LIMITS.records : MCP_HEALTH_LIMITS.chunks;
    const pageSize = records ? 32 : 8;
    let cursor: unknown;
    let consumed = 0;
    while (true) {
      const limit = Math.min(pageSize, cap - consumed + 1);
      const page = await reads.fetchPage(input, collection, limit, cursor);
      if (page.length > limit) throw new McpHealthError('temporarily_unavailable', 'Health data could not be read safely.');
      for (const doc of page) {
        if (consumed === cap) { reachLimit(records ? 'records' : 'chunks'); return; }
        const size = Buffer.byteLength(JSON.stringify(doc.data), 'utf8');
        if (bytes + size > MCP_HEALTH_LIMITS.bytes) { reachLimit('bytes'); return; }
        bytes += size; consumed++;
        if (records) result.recordsRead++; else result.chunksRead++;
        if (doc.data.userID !== input.uid || doc.data.schemaVersion !== 1
          || typeof doc.data.calendarDate !== 'string' || !date.safeParse(doc.data.calendarDate).success
          || doc.data.calendarDate < input.startDate
          || doc.data.calendarDate > input.endDate) { result.excludedValues++; continue; }
        if (records) {
          const record = doc.data as unknown as HealthSourceRecord;
          if (!record.source || !Array.isArray(record.metrics)) { result.excludedValues++; continue; }
          parents.set(doc.id, record);
          if (input.mode !== 'summaries') continue;
          for (const storedEntry of record.metrics) {
            if (storedEntry?.metricId !== input.metricId) continue;
            if (storedEntry.kind === 'sleep_reference') { result.sleepReferencesExcluded++; continue; }
            let entry: HealthMetricEntry;
            try { entry = decodeHealthMetricSportsLibData(storedEntry); }
            catch { result.excludedValues++; continue; }
            const nativeBattery = isBodyBattery(entry, record.source.provider);
            if (entry.kind !== 'value' || (!nativeBattery && (entry.normalizationStatus !== 'canonical'
              || entry.canonical?.unit !== canonicalUnit))
              || (bodyMeasurement && (record.kind !== 'point_measurement' || entry.aggregation !== 'measurement'
                || entry.semanticVariant !== 'point'))) { result.excludedValues++; continue; }
            addReading(nativeBattery ? entry.native.value : entry.canonical!.value, entry, { ...record.source, calendarDate: record.calendarDate,
              coverage: entry.coverage ?? record.coverage }, null);
          }
        } else {
          const chunk = doc.data as unknown as HealthSampleChunk;
          const parent = parents.get(chunk.parentSourceRecordId);
          // A missing parent is NOT permission to return a stale/orphaned chunk.
          if (!parent || !parent.sampleChunkIds?.includes(doc.id)
            || parent.source.provider !== chunk.provider || parent.source.accountKey !== chunk.accountKey
            || !parent.source.revision || !chunk.revision
            || parent.source.revision.order !== chunk.revision.order
            || parent.source.revision.token !== chunk.revision.token
            || parent.source.revision.digest !== chunk.revision.digest) { result.revisionMismatches++; continue; }
          const nativeBattery = isBodyBattery(chunk, chunk.provider);
          const values = nativeBattery ? chunk.nativeValues : chunk.canonicalValues;
          if (chunk.metricId !== input.metricId || (!nativeBattery && (chunk.normalizationStatus !== 'canonical'
            || chunk.canonicalUnit !== canonicalUnit)) || !Array.isArray(chunk.offsetMs)
            || !Array.isArray(values) || chunk.offsetMs.length !== values.length
            || chunk.offsetMs.length > 1_440 || !Number.isSafeInteger(chunk.startTimeMs)) { result.excludedValues++; continue; }
          if (result.samplesRead + chunk.offsetMs.length > MCP_HEALTH_LIMITS.samplePoints) { reachLimit('samplePoints'); return; }
          result.samplesRead += chunk.offsetMs.length;
          chunk.offsetMs.forEach((offset, index) => {
            const timeMs = chunk.startTimeMs + offset;
            if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(timeMs)
              || timeMs > chunk.endTimeMs) { result.excludedValues++; return; }
            addReading(values[index], chunk, chunk, timeMs);
          });
        }
      }
      if (page.length < limit) return;
      const next = page[page.length - 1]?.cursor;
      if (!next || next === cursor) throw new McpHealthError('temporarily_unavailable', 'Health pagination could not advance safely.');
      cursor = next;
    }
  }
  await load('healthSourceRecords');
  if (input.mode === 'samples' && result.complete) await load('healthSampleChunks');
  for (const target of series.values()) {
    target.points.sort((a, b) => a.date.localeCompare(b.date) || (a.timeMs ?? 0) - (b.timeMs ?? 0));
    target.readingCount = target.points.length;
    target.downsampled = target.points.length > input.maxPoints;
    if (target.downsampled) {
      const points = target.points;
      target.points = Array.from({ length: input.maxPoints }, (_, i) => points[Math.floor(i * (points.length - 1) / (input.maxPoints - 1))]);
    }
    target.returnedPointCount = target.points.length;
    const { days, ...publicSeries } = target;
    publicSeries.recordedDays = days.size;
    publicSeries.partialDays = [...days.values()].filter(status => status === 'partial').length;
    publicSeries.unknownDays = [...days.values()].filter(status => status === 'unknown').length;
    result.series.push(publicSeries);
  }
  result.measurementDays = [...measurementDays.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MCP_HEALTH_LIMITS.responseBytes) {
    throw new McpHealthError('query_too_large', 'Health output is too large. Narrow the date range or reduce maxPoints.');
  }
  return MCP_HEALTH_QUERY_SCHEMA.parse(result);
}
