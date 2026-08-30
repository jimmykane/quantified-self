import {
  HEALTH_COVERAGE_STATUSES,
  HEALTH_DEFAULT_CHUNK_PAGE_SIZE,
  HEALTH_DEFAULT_SOURCE_RECORD_PAGE_SIZE,
  HEALTH_DEFAULT_SAMPLE_POINT_LIMIT,
  HEALTH_MAX_CHUNK_PAGE_SIZE,
  HEALTH_MAX_SOURCE_RECORD_PAGE_SIZE,
  HEALTH_MAX_SAMPLE_POINT_LIMIT,
  HEALTH_MAX_SAMPLE_POINTS_PER_CHUNK,
  HEALTH_MAX_SAMPLE_RANGE_DAYS,
  HEALTH_MAX_SUMMARY_RANGE_DAYS,
  HEALTH_NORMALIZATION_STATUSES,
  HealthConflict,
  HealthCoverageStatus,
  HealthDailySummary,
  HealthFreshnessResult,
  HealthMetricCoverageResult,
  HealthMetricDiscovery,
  HealthMetricEntry,
  HealthMetricId,
  HealthMetricValue,
  HealthObservation,
  HealthProvider,
  HealthQueryCursor,
  HealthRangeQuery,
  HealthRangeResult,
  HealthRecordingMethod,
  HealthSampleChunk,
  HealthSourceRecord,
  HealthUnit,
  HealthValueOrigin,
  HealthValueType,
  NormalizedHealthRangeQuery,
  getHealthMetricDefinition,
  isHealthMetricId,
  isHealthProvider,
} from './health';
import { decodeHealthSourceRecordSportsLibData } from './sports-lib-health-data';

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export class HealthQueryValidationError extends Error {
  public readonly name = 'HealthQueryValidationError';

  constructor(message: string) {
    super(message);
  }
}

function parseCalendarDate(value: unknown, field: string): number {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    throw new HealthQueryValidationError(`${field} must use YYYY-MM-DD.`);
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new HealthQueryValidationError(`${field} must be a valid calendar date.`);
  }
  return timestamp;
}

function normalizeLimit(value: unknown, fallback: number, maximum: number, field: string, minimum = 1): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new HealthQueryValidationError(`${field} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(value);
}

function normalizeCursor(value: unknown, field: string): HealthQueryCursor | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HealthQueryValidationError(`${field} must be a cursor object.`);
  }
  const cursor = value as Record<string, unknown>;
  parseCalendarDate(cursor.calendarDate, `${field}.calendarDate`);
  if (typeof cursor.id !== 'string'
    || cursor.id !== cursor.id.trim()
    || !SAFE_DOCUMENT_ID_PATTERN.test(cursor.id)) {
    throw new HealthQueryValidationError(`${field}.id must be a safe bounded document ID.`);
  }
  return { calendarDate: cursor.calendarDate as string, id: cursor.id };
}

function normalizeProviders(value: unknown): HealthProvider[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new HealthQueryValidationError('providers must contain at most five supported providers.');
  }
  const providers = Array.from(value);
  if (providers.length > 5 || providers.some(provider => !isHealthProvider(provider))) {
    throw new HealthQueryValidationError('providers must contain at most five supported providers.');
  }
  return [...new Set(providers as HealthProvider[])];
}

function normalizeMetricIds(value: unknown): HealthMetricId[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new HealthQueryValidationError('metricIds must contain at most 30 supported metric IDs.');
  }
  const metricIds = Array.from(value);
  if (metricIds.length > 30 || metricIds.some(metricId => !isHealthMetricId(metricId))) {
    throw new HealthQueryValidationError('metricIds must contain at most 30 supported metric IDs.');
  }
  return [...new Set(metricIds as HealthMetricId[])];
}

export function normalizeHealthRangeQuery(value: HealthRangeQuery | unknown): NormalizedHealthRangeQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HealthQueryValidationError('Health range query must be an object.');
  }
  const query = value as Record<string, unknown>;
  const startMs = parseCalendarDate(query.startDate, 'startDate');
  const endMs = parseCalendarDate(query.endDate, 'endDate');
  if (endMs < startMs) {
    throw new HealthQueryValidationError('endDate must be on or after startDate.');
  }
  const requestedDays = Math.floor((endMs - startMs) / DAY_MS) + 1;
  const includeSamples = query.includeSamples === true;
  const maximumDays = includeSamples ? HEALTH_MAX_SAMPLE_RANGE_DAYS : HEALTH_MAX_SUMMARY_RANGE_DAYS;
  if (requestedDays > maximumDays) {
    throw new HealthQueryValidationError(`Requested range exceeds the ${maximumDays}-day limit.`);
  }
  if (query.includeSamples !== undefined && typeof query.includeSamples !== 'boolean') {
    throw new HealthQueryValidationError('includeSamples must be a boolean.');
  }

  return {
    startDate: query.startDate as string,
    endDate: query.endDate as string,
    providers: normalizeProviders(query.providers),
    metricIds: normalizeMetricIds(query.metricIds),
    includeSamples,
    sourceRecordLimit: normalizeLimit(
      query.sourceRecordLimit,
      HEALTH_DEFAULT_SOURCE_RECORD_PAGE_SIZE,
      HEALTH_MAX_SOURCE_RECORD_PAGE_SIZE,
      'sourceRecordLimit',
    ),
    chunkLimit: normalizeLimit(query.chunkLimit, HEALTH_DEFAULT_CHUNK_PAGE_SIZE, HEALTH_MAX_CHUNK_PAGE_SIZE, 'chunkLimit'),
    samplePointLimit: normalizeLimit(
      query.samplePointLimit,
      HEALTH_DEFAULT_SAMPLE_POINT_LIMIT,
      HEALTH_MAX_SAMPLE_POINT_LIMIT,
      'samplePointLimit',
      HEALTH_MAX_SAMPLE_POINTS_PER_CHUNK,
    ),
    sourceRecordCursor: normalizeCursor(query.sourceRecordCursor, 'sourceRecordCursor'),
    chunkCursor: normalizeCursor(query.chunkCursor, 'chunkCursor'),
  };
}

function compareDateAndId(
  left: Pick<HealthSourceRecord | HealthSampleChunk, 'calendarDate' | 'id'>,
  right: Pick<HealthSourceRecord | HealthSampleChunk, 'calendarDate' | 'id'>,
): number {
  return compareText(left.calendarDate, right.calendarDate) || compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isAfterCursor(
  value: Pick<HealthSourceRecord | HealthSampleChunk, 'calendarDate' | 'id'>,
  cursor: HealthQueryCursor | null,
): boolean {
  return !cursor || compareDateAndId(value, cursor as Pick<HealthSourceRecord, 'calendarDate' | 'id'>) > 0;
}

function providerMatches(provider: HealthProvider, providers: readonly HealthProvider[]): boolean {
  return providers.length === 0 || providers.includes(provider);
}

function metricMatches(metricId: HealthMetricId, metricIds: readonly HealthMetricId[]): boolean {
  return metricIds.length === 0 || metricIds.includes(metricId);
}

function chunkMatchesKnownParentRevision(
  chunk: HealthSampleChunk,
  sourceRecordsById: ReadonlyMap<string, HealthSourceRecord>,
): boolean {
  const parent = sourceRecordsById.get(chunk.parentSourceRecordId);
  if (!parent) {
    return true;
  }
  return chunk.revision.order === parent.source.revision.order
    && chunk.revision.token === parent.source.revision.token
    && chunk.revision.digest === parent.source.revision.digest;
}

function entryCanonicalUnit(entry: HealthMetricEntry): HealthUnit | null {
  if (entry.kind === 'sleep_reference') {
    return getHealthMetricDefinition(entry.metricId).canonicalUnit;
  }
  return entry.canonical ? entry.canonical.unit : null;
}

function observationSort(left: HealthObservation, right: HealthObservation): number {
  return compareText(left.calendarDate, right.calendarDate)
    || left.startTimeMs - right.startTimeMs
    || compareText(left.provider, right.provider)
    || compareText(left.id, right.id);
}

function addUnique<T>(values: T[], value: T): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

interface DiscoveryAccumulator {
  metricId: HealthMetricId;
  providers: HealthProvider[];
  valueTypes: HealthValueType[];
  canonicalUnits: HealthUnit[];
  aggregations: string[];
  semanticVariants: string[];
  origins: HealthValueOrigin[];
  recordingMethods: HealthRecordingMethod[];
  firstDate: string;
  lastDate: string;
  hasSamples: boolean;
}

function addDiscoveryEntry(
  target: Map<HealthMetricId, DiscoveryAccumulator>,
  input: {
    metricId: HealthMetricId;
    provider: HealthProvider;
    valueType: HealthValueType;
    canonicalUnit: HealthUnit | null;
    aggregation: string;
    semanticVariant: string;
    origin: HealthValueOrigin;
    recordingMethod: HealthRecordingMethod;
    calendarDate: string;
    hasSamples: boolean;
  },
): void {
  const current = target.get(input.metricId) || {
    metricId: input.metricId,
    providers: [],
    valueTypes: [],
    canonicalUnits: [],
    aggregations: [],
    semanticVariants: [],
    origins: [],
    recordingMethods: [],
    firstDate: input.calendarDate,
    lastDate: input.calendarDate,
    hasSamples: false,
  };
  addUnique(current.providers, input.provider);
  addUnique(current.valueTypes, input.valueType);
  if (input.canonicalUnit) {
    addUnique(current.canonicalUnits, input.canonicalUnit);
  }
  addUnique(current.aggregations, input.aggregation);
  addUnique(current.semanticVariants, input.semanticVariant);
  addUnique(current.origins, input.origin);
  addUnique(current.recordingMethods, input.recordingMethod);
  current.firstDate = current.firstDate < input.calendarDate ? current.firstDate : input.calendarDate;
  current.lastDate = current.lastDate > input.calendarDate ? current.lastDate : input.calendarDate;
  current.hasSamples ||= input.hasSamples;
  target.set(input.metricId, current);
}

interface CoverageAccumulator {
  metricId: HealthMetricId;
  provider: HealthProvider;
  accountKey: string;
  aggregation: string;
  semanticVariant: string;
  origin: HealthValueOrigin;
  recordingMethod: HealthRecordingMethod;
  dates: Set<string>;
  partialDates: Set<string>;
  unknownDates: Set<string>;
  latestDate: string;
}

function metricSeriesKey(input: {
  metricId: HealthMetricId;
  provider: HealthProvider;
  accountKey: string;
  aggregation: string;
  semanticVariant: string;
  origin: HealthValueOrigin;
  recordingMethod: HealthRecordingMethod;
}): string {
  return JSON.stringify([
    input.metricId,
    input.provider,
    input.accountKey,
    input.aggregation,
    input.semanticVariant,
    input.origin,
    input.recordingMethod,
  ]);
}

function addCoverage(
  target: Map<string, CoverageAccumulator>,
  input: {
    metricId: HealthMetricId;
    provider: HealthProvider;
    accountKey: string;
    aggregation: string;
    semanticVariant: string;
    origin: HealthValueOrigin;
    recordingMethod: HealthRecordingMethod;
    calendarDate: string;
    status: HealthCoverageStatus;
  },
): void {
  const key = metricSeriesKey(input);
  const current = target.get(key) || {
    metricId: input.metricId,
    provider: input.provider,
    accountKey: input.accountKey,
    aggregation: input.aggregation,
    semanticVariant: input.semanticVariant,
    origin: input.origin,
    recordingMethod: input.recordingMethod,
    dates: new Set<string>(),
    partialDates: new Set<string>(),
    unknownDates: new Set<string>(),
    latestDate: input.calendarDate,
  };
  current.dates.add(input.calendarDate);
  if (input.status === HEALTH_COVERAGE_STATUSES.Partial) {
    current.partialDates.add(input.calendarDate);
    current.unknownDates.delete(input.calendarDate);
  } else if (input.status === HEALTH_COVERAGE_STATUSES.Unknown
    && !current.partialDates.has(input.calendarDate)) {
    current.unknownDates.add(input.calendarDate);
  }
  current.latestDate = current.latestDate > input.calendarDate ? current.latestDate : input.calendarDate;
  target.set(key, current);
}

interface FreshnessAccumulator {
  metricId: HealthMetricId;
  provider: HealthProvider;
  accountKey: string;
  aggregation: string;
  semanticVariant: string;
  origin: HealthValueOrigin;
  recordingMethod: HealthRecordingMethod;
  lastObservedAtMs: number;
  lastReceivedAtMs: number;
  staleAfterMs: number | null;
}

function addFreshness(
  target: Map<string, FreshnessAccumulator>,
  input: FreshnessAccumulator,
): void {
  const key = metricSeriesKey(input);
  const current = target.get(key);
  if (!current || input.lastObservedAtMs > current.lastObservedAtMs) {
    target.set(key, input);
    return;
  }
  if (input.lastObservedAtMs === current.lastObservedAtMs) {
    current.lastReceivedAtMs = Math.max(current.lastReceivedAtMs, input.lastReceivedAtMs);
    current.staleAfterMs = input.staleAfterMs ?? current.staleAfterMs;
  }
}

function scalarEqual(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') {
    const tolerance = Math.max(1e-6, Math.abs(left) * 1e-9, Math.abs(right) * 1e-9);
    return Math.abs(left - right) <= tolerance;
  }
  return left === right;
}

function intervalsOverlap(left: HealthObservation, right: HealthObservation): boolean {
  return left.startTimeMs <= right.endTimeMs && right.startTimeMs <= left.endTimeMs;
}

export function findHealthConflicts(observations: readonly HealthObservation[]): HealthConflict[] {
  const candidates = new Map<string, HealthObservation[]>();
  for (const observation of observations) {
    const entry = observation.entry;
    if (
      entry.kind !== 'value'
      || entry.normalizationStatus !== HEALTH_NORMALIZATION_STATUSES.Canonical
      || !entry.canonical
    ) {
      continue;
    }
    const key = JSON.stringify([
      entry.metricId,
      observation.calendarDate,
      entry.aggregation,
      entry.semanticVariant,
      entry.origin,
      entry.canonical.unit,
    ]);
    candidates.set(key, [...(candidates.get(key) || []), observation]);
  }

  const conflicts: HealthConflict[] = [];
  for (const group of candidates.values()) {
    const conflictingIds = new Set<string>();
    for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
        const left = group[leftIndex];
        const right = group[rightIndex];
        const sameSource = left.provider === right.provider && left.accountKey === right.accountKey;
        if (sameSource || !intervalsOverlap(left, right)) {
          continue;
        }
        const leftValue = (left.entry as HealthMetricValue).canonical?.value;
        const rightValue = (right.entry as HealthMetricValue).canonical?.value;
        if (!scalarEqual(leftValue, rightValue)) {
          conflictingIds.add(left.id);
          conflictingIds.add(right.id);
        }
      }
    }
    if (conflictingIds.size < 2) {
      continue;
    }
    const conflicting = group.filter(item => conflictingIds.has(item.id));
    const first = conflicting[0];
    const firstEntry = first.entry as HealthMetricValue;
    const sources = [...new Map(conflicting.map(item => [
      JSON.stringify([item.provider, item.accountKey]),
      { provider: item.provider, accountKey: item.accountKey },
    ])).values()].sort((left, right) => compareText(left.provider, right.provider)
      || compareText(left.accountKey, right.accountKey));
    conflicts.push({
      metricId: firstEntry.metricId,
      calendarDate: first.calendarDate,
      aggregation: firstEntry.aggregation,
      semanticVariant: firstEntry.semanticVariant,
      origin: firstEntry.origin,
      canonicalUnit: firstEntry.canonical!.unit,
      observationIds: conflicting.map(item => item.id).sort(compareText),
      providers: [...new Set(conflicting.map(item => item.provider))].sort(compareText),
      sources,
      recordingMethods: [...new Set(conflicting.map(item => item.entry.recordingMethod))].sort(compareText),
    });
  }
  return conflicts.sort((left, right) => compareText(left.calendarDate, right.calendarDate)
    || compareText(left.metricId, right.metricId)
    || compareText(left.aggregation, right.aggregation)
    || compareText(left.semanticVariant, right.semanticVariant)
    || compareText(left.origin, right.origin)
    || compareText(left.canonicalUnit, right.canonicalUnit)
    || compareText(left.observationIds.join('\u0000'), right.observationIds.join('\u0000')));
}

function cursorForLast(values: readonly Pick<HealthSourceRecord | HealthSampleChunk, 'calendarDate' | 'id'>[]): HealthQueryCursor | null {
  const last = values[values.length - 1];
  return last ? { calendarDate: last.calendarDate, id: last.id } : null;
}

function requestedDayCount(query: NormalizedHealthRangeQuery): number {
  const startMs = Date.parse(`${query.startDate}T00:00:00.000Z`);
  const endMs = Date.parse(`${query.endDate}T00:00:00.000Z`);
  return Math.floor((endMs - startMs) / DAY_MS) + 1;
}

export function projectHealthRange(
  sourceRecords: readonly HealthSourceRecord[],
  chunks: readonly HealthSampleChunk[],
  queryValue: HealthRangeQuery | NormalizedHealthRangeQuery,
  nowMs = Date.now(),
): HealthRangeResult {
  return projectHealthRangeInternal(sourceRecords, chunks, queryValue, nowMs, {
    aggregateAllPages: false,
    sourceRecordsComplete: true,
    samplesComplete: true,
    sourceRecordCursor: null,
    chunkCursor: null,
  });
}

export interface LoadedHealthRangeProjectionOptions {
  sourceRecordsComplete: boolean;
  samplesComplete: boolean;
  sourceRecordCursor?: HealthQueryCursor | null;
  chunkCursor?: HealthQueryCursor | null;
}

/**
 * Projects a bounded set that has already been collected across Firestore
 * pages. Unlike `projectHealthRange`, this does not apply the per-page limits
 * a second time. That lets clients recompute revision filtering, coverage,
 * freshness, and conflicts over the complete loaded aggregate.
 */
export function projectLoadedHealthRange(
  sourceRecords: readonly HealthSourceRecord[],
  chunks: readonly HealthSampleChunk[],
  queryValue: HealthRangeQuery | NormalizedHealthRangeQuery,
  options: LoadedHealthRangeProjectionOptions,
  nowMs = Date.now(),
): HealthRangeResult {
  return projectHealthRangeInternal(sourceRecords, chunks, queryValue, nowMs, {
    aggregateAllPages: true,
    sourceRecordsComplete: options.sourceRecordsComplete,
    samplesComplete: options.samplesComplete,
    sourceRecordCursor: options.sourceRecordCursor ?? null,
    chunkCursor: options.chunkCursor ?? null,
  });
}

interface HealthRangeProjectionMode {
  aggregateAllPages: boolean;
  sourceRecordsComplete: boolean;
  samplesComplete: boolean;
  sourceRecordCursor: HealthQueryCursor | null;
  chunkCursor: HealthQueryCursor | null;
}

function projectHealthRangeInternal(
  sourceRecords: readonly HealthSourceRecord[],
  chunks: readonly HealthSampleChunk[],
  queryValue: HealthRangeQuery | NormalizedHealthRangeQuery,
  nowMs: number,
  mode: HealthRangeProjectionMode,
): HealthRangeResult {
  const query = normalizeHealthRangeQuery(queryValue);
  const decodedSourceRecords = sourceRecords.map(decodeHealthSourceRecordSportsLibData);
  const matchingSourceRecords = decodedSourceRecords
    .filter(sourceRecord => sourceRecord.calendarDate >= query.startDate && sourceRecord.calendarDate <= query.endDate)
    .filter(sourceRecord => providerMatches(sourceRecord.source.provider, query.providers))
    .filter(sourceRecord => query.providers.length > 0
      || query.metricIds.length === 0
      || sourceRecord.metricIds.some(metricId => metricMatches(metricId, query.metricIds)))
    .filter(sourceRecord => isAfterCursor(sourceRecord, query.sourceRecordCursor))
    .sort(compareDateAndId);
  const sourceRecordsTruncated = mode.aggregateAllPages
    ? !mode.sourceRecordsComplete
    : matchingSourceRecords.length > query.sourceRecordLimit;
  const selectedSourceRecords = mode.aggregateAllPages
    ? matchingSourceRecords
    : matchingSourceRecords.slice(0, query.sourceRecordLimit);

  const primaryMatchingChunks = query.includeSamples
    ? chunks
      .filter(chunk => chunk.calendarDate >= query.startDate && chunk.calendarDate <= query.endDate)
      .filter(chunk => providerMatches(chunk.provider, query.providers))
      .filter(chunk => query.providers.length > 0 || metricMatches(chunk.metricId, query.metricIds))
      .filter(chunk => isAfterCursor(chunk, query.chunkCursor))
      .sort(compareDateAndId)
    : [];
  const chunkPageTruncated = mode.aggregateAllPages
    ? !mode.samplesComplete
    : primaryMatchingChunks.length > query.chunkLimit;
  const selectedChunkPage = mode.aggregateAllPages
    ? primaryMatchingChunks
    : primaryMatchingChunks.slice(0, query.chunkLimit);
  const sourceRecordsById = new Map(decodedSourceRecords.map(sourceRecord => [sourceRecord.id, sourceRecord]));
  const selectedChunks: HealthSampleChunk[] = [];
  let returnedSamplePoints = 0;
  let pointLimitTruncated = false;
  let sampleRevisionMismatchCount = 0;
  let lastConsumedChunk: HealthSampleChunk | null = null;
  for (const chunk of selectedChunkPage) {
    if (!metricMatches(chunk.metricId, query.metricIds)) {
      lastConsumedChunk = chunk;
      continue;
    }
    if (!chunkMatchesKnownParentRevision(chunk, sourceRecordsById)) {
      sampleRevisionMismatchCount += 1;
      lastConsumedChunk = chunk;
      continue;
    }
    const pointCount = chunk.offsetMs.length;
    if (!mode.aggregateAllPages && returnedSamplePoints + pointCount > query.samplePointLimit) {
      pointLimitTruncated = true;
      break;
    }
    selectedChunks.push(chunk);
    returnedSamplePoints += pointCount;
    lastConsumedChunk = chunk;
  }

  const observations: HealthObservation[] = [];
  const discovery = new Map<HealthMetricId, DiscoveryAccumulator>();
  const coverage = new Map<string, CoverageAccumulator>();
  const freshness = new Map<string, FreshnessAccumulator>();

  for (const sourceRecord of selectedSourceRecords) {
    sourceRecord.metrics.forEach((entry, index) => {
      if (!metricMatches(entry.metricId, query.metricIds)) {
        return;
      }
      const entryCoverage = entry.coverage || sourceRecord.coverage;
      const observation: HealthObservation = {
        id: `${sourceRecord.id}:${index}`,
        sourceRecordId: sourceRecord.id,
        provider: sourceRecord.source.provider,
        accountKey: sourceRecord.source.accountKey,
        calendarDate: sourceRecord.calendarDate,
        startTimeMs: sourceRecord.startTimeMs,
        endTimeMs: sourceRecord.endTimeMs,
        timezoneOffsetSeconds: sourceRecord.timezoneOffsetSeconds,
        sourceRecordType: sourceRecord.source.sourceRecordType,
        sourceRecordKey: sourceRecord.source.sourceRecordKey,
        receivedAtMs: sourceRecord.source.receivedAtMs,
        coverage: entryCoverage,
        device: entry.device === undefined ? sourceRecord.device ?? null : entry.device,
        entry,
      };
      observations.push(observation);
      addDiscoveryEntry(discovery, {
        metricId: entry.metricId,
        provider: sourceRecord.source.provider,
        valueType: entry.valueType,
        canonicalUnit: entryCanonicalUnit(entry),
        aggregation: entry.aggregation,
        semanticVariant: entry.semanticVariant,
        origin: entry.origin,
        recordingMethod: entry.recordingMethod,
        calendarDate: sourceRecord.calendarDate,
        hasSamples: false,
      });
      addCoverage(coverage, {
        metricId: entry.metricId,
        provider: sourceRecord.source.provider,
        accountKey: sourceRecord.source.accountKey,
        aggregation: entry.aggregation,
        semanticVariant: entry.semanticVariant,
        origin: entry.origin,
        recordingMethod: entry.recordingMethod,
        calendarDate: sourceRecord.calendarDate,
        status: entryCoverage.status,
      });
      const expectedUpdateIntervalMs = entryCoverage.expectedUpdateIntervalMs;
      addFreshness(freshness, {
        metricId: entry.metricId,
        provider: sourceRecord.source.provider,
        accountKey: sourceRecord.source.accountKey,
        aggregation: entry.aggregation,
        semanticVariant: entry.semanticVariant,
        origin: entry.origin,
        recordingMethod: entry.recordingMethod,
        lastObservedAtMs: sourceRecord.endTimeMs,
        lastReceivedAtMs: sourceRecord.source.receivedAtMs,
        staleAfterMs: typeof expectedUpdateIntervalMs === 'number' && expectedUpdateIntervalMs > 0
          ? expectedUpdateIntervalMs
          : null,
      });
    });
  }
  observations.sort(observationSort);

  for (const chunk of selectedChunks) {
    addDiscoveryEntry(discovery, {
      metricId: chunk.metricId,
      provider: chunk.provider,
      valueType: chunk.valueType,
      canonicalUnit: chunk.canonicalUnit || null,
      aggregation: chunk.aggregation,
      semanticVariant: chunk.semanticVariant,
      origin: chunk.origin,
      recordingMethod: chunk.recordingMethod,
      calendarDate: chunk.calendarDate,
      hasSamples: true,
    });
    addCoverage(coverage, {
      metricId: chunk.metricId,
      provider: chunk.provider,
      accountKey: chunk.accountKey,
      aggregation: chunk.aggregation,
      semanticVariant: chunk.semanticVariant,
      origin: chunk.origin,
      recordingMethod: chunk.recordingMethod,
      calendarDate: chunk.calendarDate,
      status: chunk.coverage.status,
    });
    const expectedUpdateIntervalMs = chunk.coverage.expectedUpdateIntervalMs;
    addFreshness(freshness, {
      metricId: chunk.metricId,
      provider: chunk.provider,
      accountKey: chunk.accountKey,
      aggregation: chunk.aggregation,
      semanticVariant: chunk.semanticVariant,
      origin: chunk.origin,
      recordingMethod: chunk.recordingMethod,
      lastObservedAtMs: chunk.endTimeMs,
      lastReceivedAtMs: chunk.receivedAtMs,
      staleAfterMs: typeof expectedUpdateIntervalMs === 'number' && expectedUpdateIntervalMs > 0
        ? expectedUpdateIntervalMs
        : null,
    });
  }

  const daily = new Map<string, HealthDailySummary>();
  for (const observation of observations) {
    const current = daily.get(observation.calendarDate) || {
      calendarDate: observation.calendarDate,
      observationIds: [],
      providers: [],
      sleepReferenceIds: [],
    };
    current.observationIds.push(observation.id);
    addUnique(current.providers, observation.provider);
    if (observation.entry.kind === 'sleep_reference') {
      addUnique(current.sleepReferenceIds, observation.entry.reference.documentId);
    }
    daily.set(observation.calendarDate, current);
  }

  const days = requestedDayCount(query);
  const coverageResult: HealthMetricCoverageResult[] = [...coverage.values()].map(item => ({
    metricId: item.metricId,
    provider: item.provider,
    accountKey: item.accountKey,
    aggregation: item.aggregation,
    semanticVariant: item.semanticVariant,
    origin: item.origin,
    recordingMethod: item.recordingMethod,
    requestedDays: days,
    recordedDays: item.dates.size,
    missingDays: Math.max(0, days - item.dates.size),
    partialDays: item.partialDates.size,
    unknownDays: item.unknownDates.size,
    latestDate: item.latestDate,
  })).sort((left, right) => compareText(left.metricId, right.metricId)
    || compareText(left.provider, right.provider)
    || compareText(left.accountKey, right.accountKey)
    || compareText(left.aggregation, right.aggregation)
    || compareText(left.origin, right.origin)
    || compareText(left.recordingMethod, right.recordingMethod)
    || compareText(left.semanticVariant, right.semanticVariant));

  const freshnessResult: HealthFreshnessResult[] = [...freshness.values()].map((item): HealthFreshnessResult => {
    const ageMs = Math.max(0, nowMs - item.lastObservedAtMs);
    return {
      ...item,
      ageMs,
      status: item.staleAfterMs === null
        ? 'unknown'
        : ageMs > item.staleAfterMs ? 'stale' : 'fresh',
    };
  }).sort((left, right) => compareText(left.metricId, right.metricId)
    || compareText(left.provider, right.provider)
    || compareText(left.accountKey, right.accountKey)
    || compareText(left.aggregation, right.aggregation)
    || compareText(left.origin, right.origin)
    || compareText(left.recordingMethod, right.recordingMethod)
    || compareText(left.semanticVariant, right.semanticVariant));

  const discoveryResult: HealthMetricDiscovery[] = [...discovery.values()].map(item => ({
    ...item,
    providers: item.providers.sort(compareText),
    valueTypes: item.valueTypes.sort(compareText),
    canonicalUnits: item.canonicalUnits.sort(compareText),
    aggregations: item.aggregations.sort(compareText),
    semanticVariants: item.semanticVariants.sort(compareText),
    origins: item.origins.sort(compareText),
    recordingMethods: item.recordingMethods.sort(compareText),
  })).sort((left, right) => compareText(left.metricId, right.metricId));

  const samplesTruncated = chunkPageTruncated || pointLimitTruncated;
  return {
    query,
    observations,
    sampleChunks: selectedChunks,
    dailySummaries: [...daily.values()].sort((left, right) => compareText(left.calendarDate, right.calendarDate)),
    discovery: discoveryResult,
    coverage: coverageResult,
    freshness: freshnessResult,
    conflicts: findHealthConflicts(observations),
    pageInfo: {
      sourceRecordsTruncated,
      samplesTruncated,
      sampleRevisionMismatchCount,
      sourceRecordAggregateComplete: mode.aggregateAllPages
        ? mode.sourceRecordsComplete
        : query.sourceRecordCursor === null && !sourceRecordsTruncated,
      sampleAggregateComplete: !query.includeSamples
        || (mode.aggregateAllPages
          ? mode.samplesComplete && sampleRevisionMismatchCount === 0
          : query.chunkCursor === null && !samplesTruncated && sampleRevisionMismatchCount === 0),
      sourceRecordCursor: sourceRecordsTruncated
        ? mode.sourceRecordCursor || cursorForLast(selectedSourceRecords)
        : null,
      chunkCursor: samplesTruncated
        ? mode.chunkCursor || (lastConsumedChunk ? cursorForLast([lastConsumedChunk]) : null)
        : null,
      returnedSamplePoints,
    },
  };
}

export function canonicalUnitForMetric(metricId: HealthMetricId): HealthUnit {
  return getHealthMetricDefinition(metricId).canonicalUnit;
}
