import {
  HEALTH_COVERAGE_STATUSES,
  HEALTH_DEFAULT_CHUNK_PAGE_SIZE,
  HEALTH_DEFAULT_RECORD_PAGE_SIZE,
  HEALTH_DEFAULT_SAMPLE_POINT_LIMIT,
  HEALTH_MAX_CHUNK_PAGE_SIZE,
  HEALTH_MAX_RECORD_PAGE_SIZE,
  HEALTH_MAX_SAMPLE_POINT_LIMIT,
  HEALTH_MAX_SAMPLE_POINTS_PER_CHUNK,
  HEALTH_MAX_SAMPLE_RANGE_DAYS,
  HEALTH_MAX_SUMMARY_RANGE_DAYS,
  HEALTH_NORMALIZATION_STATUSES,
  HealthConflict,
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
  HealthSampleChunk,
  HealthSourceRecord,
  HealthUnit,
  HealthValueType,
  NormalizedHealthRangeQuery,
  getHealthMetricDefinition,
  isHealthMetricId,
  isHealthProvider,
} from './health';

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
  if (!Array.isArray(value) || value.length > 5 || value.some(provider => !isHealthProvider(provider))) {
    throw new HealthQueryValidationError('providers must contain at most five supported providers.');
  }
  return [...new Set(value as HealthProvider[])];
}

function normalizeMetricIds(value: unknown): HealthMetricId[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 30 || value.some(metricId => !isHealthMetricId(metricId))) {
    throw new HealthQueryValidationError('metricIds must contain at most 30 supported metric IDs.');
  }
  return [...new Set(value as HealthMetricId[])];
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
    recordLimit: normalizeLimit(query.recordLimit, HEALTH_DEFAULT_RECORD_PAGE_SIZE, HEALTH_MAX_RECORD_PAGE_SIZE, 'recordLimit'),
    chunkLimit: normalizeLimit(query.chunkLimit, HEALTH_DEFAULT_CHUNK_PAGE_SIZE, HEALTH_MAX_CHUNK_PAGE_SIZE, 'chunkLimit'),
    samplePointLimit: normalizeLimit(
      query.samplePointLimit,
      HEALTH_DEFAULT_SAMPLE_POINT_LIMIT,
      HEALTH_MAX_SAMPLE_POINT_LIMIT,
      'samplePointLimit',
      HEALTH_MAX_SAMPLE_POINTS_PER_CHUNK,
    ),
    recordCursor: normalizeCursor(query.recordCursor, 'recordCursor'),
    chunkCursor: normalizeCursor(query.chunkCursor, 'chunkCursor'),
  };
}

function compareDateAndId(
  left: Pick<HealthSourceRecord | HealthSampleChunk, 'calendarDate' | 'id'>,
  right: Pick<HealthSourceRecord | HealthSampleChunk, 'calendarDate' | 'id'>,
): number {
  return left.calendarDate.localeCompare(right.calendarDate) || left.id.localeCompare(right.id);
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

function entryCanonicalUnit(entry: HealthMetricEntry): HealthUnit | null {
  return entry.kind === 'value' && entry.canonical ? entry.canonical.unit : null;
}

function observationSort(left: HealthObservation, right: HealthObservation): number {
  return left.calendarDate.localeCompare(right.calendarDate)
    || left.startTimeMs - right.startTimeMs
    || left.provider.localeCompare(right.provider)
    || left.id.localeCompare(right.id);
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
  semanticVariants: string[];
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
    semanticVariant: string;
    calendarDate: string;
    hasSamples: boolean;
  },
): void {
  const current = target.get(input.metricId) || {
    metricId: input.metricId,
    providers: [],
    valueTypes: [],
    canonicalUnits: [],
    semanticVariants: [],
    firstDate: input.calendarDate,
    lastDate: input.calendarDate,
    hasSamples: false,
  };
  addUnique(current.providers, input.provider);
  addUnique(current.valueTypes, input.valueType);
  if (input.canonicalUnit) {
    addUnique(current.canonicalUnits, input.canonicalUnit);
  }
  addUnique(current.semanticVariants, input.semanticVariant);
  current.firstDate = current.firstDate < input.calendarDate ? current.firstDate : input.calendarDate;
  current.lastDate = current.lastDate > input.calendarDate ? current.lastDate : input.calendarDate;
  current.hasSamples ||= input.hasSamples;
  target.set(input.metricId, current);
}

interface CoverageAccumulator {
  metricId: HealthMetricId;
  provider: HealthProvider;
  semanticVariant: string;
  dates: Set<string>;
  partialDates: Set<string>;
  latestDate: string;
}

function coverageKey(metricId: HealthMetricId, provider: HealthProvider, semanticVariant: string): string {
  return `${metricId}\u0000${provider}\u0000${semanticVariant}`;
}

function addCoverage(
  target: Map<string, CoverageAccumulator>,
  input: {
    metricId: HealthMetricId;
    provider: HealthProvider;
    semanticVariant: string;
    calendarDate: string;
    partial: boolean;
  },
): void {
  const key = coverageKey(input.metricId, input.provider, input.semanticVariant);
  const current = target.get(key) || {
    metricId: input.metricId,
    provider: input.provider,
    semanticVariant: input.semanticVariant,
    dates: new Set<string>(),
    partialDates: new Set<string>(),
    latestDate: input.calendarDate,
  };
  current.dates.add(input.calendarDate);
  if (input.partial) {
    current.partialDates.add(input.calendarDate);
  }
  current.latestDate = current.latestDate > input.calendarDate ? current.latestDate : input.calendarDate;
  target.set(key, current);
}

interface FreshnessAccumulator {
  metricId: HealthMetricId;
  provider: HealthProvider;
  semanticVariant: string;
  lastObservedAtMs: number;
  lastReceivedAtMs: number;
  staleAfterMs: number | null;
}

function addFreshness(
  target: Map<string, FreshnessAccumulator>,
  input: FreshnessAccumulator,
): void {
  const key = coverageKey(input.metricId, input.provider, input.semanticVariant);
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

function buildConflicts(observations: readonly HealthObservation[]): HealthConflict[] {
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
    const key = [
      entry.metricId,
      observation.calendarDate,
      entry.aggregation,
      entry.semanticVariant,
      entry.origin,
      entry.canonical.unit,
    ].join('\u0000');
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
    conflicts.push({
      metricId: firstEntry.metricId,
      calendarDate: first.calendarDate,
      aggregation: firstEntry.aggregation,
      semanticVariant: firstEntry.semanticVariant,
      canonicalUnit: firstEntry.canonical!.unit,
      observationIds: conflicting.map(item => item.id).sort(),
      providers: [...new Set(conflicting.map(item => item.provider))].sort(),
    });
  }
  return conflicts.sort((left, right) => left.calendarDate.localeCompare(right.calendarDate)
    || left.metricId.localeCompare(right.metricId)
    || left.semanticVariant.localeCompare(right.semanticVariant));
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
  records: readonly HealthSourceRecord[],
  chunks: readonly HealthSampleChunk[],
  queryValue: HealthRangeQuery | NormalizedHealthRangeQuery,
  nowMs = Date.now(),
): HealthRangeResult {
  const query = normalizeHealthRangeQuery(queryValue);
  const matchingRecords = records
    .filter(record => record.calendarDate >= query.startDate && record.calendarDate <= query.endDate)
    .filter(record => providerMatches(record.source.provider, query.providers))
    .filter(record => query.providers.length > 0
      || query.metricIds.length === 0
      || record.metricIds.some(metricId => metricMatches(metricId, query.metricIds)))
    .filter(record => isAfterCursor(record, query.recordCursor))
    .sort(compareDateAndId);
  const recordsTruncated = matchingRecords.length > query.recordLimit;
  const selectedRecords = matchingRecords.slice(0, query.recordLimit);

  const primaryMatchingChunks = query.includeSamples
    ? chunks
      .filter(chunk => chunk.calendarDate >= query.startDate && chunk.calendarDate <= query.endDate)
      .filter(chunk => providerMatches(chunk.provider, query.providers))
      .filter(chunk => query.providers.length > 0 || metricMatches(chunk.metricId, query.metricIds))
      .filter(chunk => isAfterCursor(chunk, query.chunkCursor))
      .sort(compareDateAndId)
    : [];
  const chunkPageTruncated = primaryMatchingChunks.length > query.chunkLimit;
  const selectedChunkPage = primaryMatchingChunks.slice(0, query.chunkLimit);
  const selectedChunks: HealthSampleChunk[] = [];
  let returnedSamplePoints = 0;
  let pointLimitTruncated = false;
  let lastConsumedChunk: HealthSampleChunk | null = null;
  for (const chunk of selectedChunkPage) {
    if (!metricMatches(chunk.metricId, query.metricIds)) {
      lastConsumedChunk = chunk;
      continue;
    }
    const pointCount = chunk.offsetMs.length;
    if (returnedSamplePoints + pointCount > query.samplePointLimit) {
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

  for (const record of selectedRecords) {
    record.metrics.forEach((entry, index) => {
      if (!metricMatches(entry.metricId, query.metricIds)) {
        return;
      }
      const observation: HealthObservation = {
        id: `${record.id}:${index}`,
        recordId: record.id,
        provider: record.source.provider,
        accountKey: record.source.accountKey,
        calendarDate: record.calendarDate,
        startTimeMs: record.startTimeMs,
        endTimeMs: record.endTimeMs,
        timezoneOffsetSeconds: record.timezoneOffsetSeconds,
        sourceRecordType: record.source.sourceRecordType,
        sourceRecordKey: record.source.sourceRecordKey,
        receivedAtMs: record.source.receivedAtMs,
        entry,
      };
      observations.push(observation);
      addDiscoveryEntry(discovery, {
        metricId: entry.metricId,
        provider: record.source.provider,
        valueType: entry.valueType,
        canonicalUnit: entryCanonicalUnit(entry),
        semanticVariant: entry.semanticVariant,
        calendarDate: record.calendarDate,
        hasSamples: false,
      });
      const entryCoverage = entry.coverage || record.coverage;
      addCoverage(coverage, {
        metricId: entry.metricId,
        provider: record.source.provider,
        semanticVariant: entry.semanticVariant,
        calendarDate: record.calendarDate,
        partial: entryCoverage.status === HEALTH_COVERAGE_STATUSES.Partial,
      });
      const expectedUpdateIntervalMs = entryCoverage.expectedUpdateIntervalMs;
      addFreshness(freshness, {
        metricId: entry.metricId,
        provider: record.source.provider,
        semanticVariant: entry.semanticVariant,
        lastObservedAtMs: record.endTimeMs,
        lastReceivedAtMs: record.source.receivedAtMs,
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
      semanticVariant: chunk.semanticVariant,
      calendarDate: chunk.calendarDate,
      hasSamples: true,
    });
    addCoverage(coverage, {
      metricId: chunk.metricId,
      provider: chunk.provider,
      semanticVariant: chunk.semanticVariant,
      calendarDate: chunk.calendarDate,
      partial: chunk.coverage.status === HEALTH_COVERAGE_STATUSES.Partial,
    });
    const expectedUpdateIntervalMs = chunk.coverage.expectedUpdateIntervalMs;
    addFreshness(freshness, {
      metricId: chunk.metricId,
      provider: chunk.provider,
      semanticVariant: chunk.semanticVariant,
      lastObservedAtMs: chunk.endTimeMs,
      lastReceivedAtMs: chunk.updatedAtMs,
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
    semanticVariant: item.semanticVariant,
    requestedDays: days,
    recordedDays: item.dates.size,
    partialDays: item.partialDates.size,
    latestDate: item.latestDate,
  })).sort((left, right) => left.metricId.localeCompare(right.metricId)
    || left.provider.localeCompare(right.provider)
    || left.semanticVariant.localeCompare(right.semanticVariant));

  const freshnessResult: HealthFreshnessResult[] = [...freshness.values()].map((item): HealthFreshnessResult => {
    const ageMs = Math.max(0, nowMs - item.lastObservedAtMs);
    return {
      ...item,
      ageMs,
      status: item.staleAfterMs === null
        ? 'unknown'
        : ageMs > item.staleAfterMs ? 'stale' : 'fresh',
    };
  }).sort((left, right) => left.metricId.localeCompare(right.metricId)
    || left.provider.localeCompare(right.provider)
    || left.semanticVariant.localeCompare(right.semanticVariant));

  const discoveryResult: HealthMetricDiscovery[] = [...discovery.values()].map(item => ({
    ...item,
    providers: item.providers.sort(),
    valueTypes: item.valueTypes.sort(),
    canonicalUnits: item.canonicalUnits.sort(),
    semanticVariants: item.semanticVariants.sort(),
  })).sort((left, right) => left.metricId.localeCompare(right.metricId));

  const samplesTruncated = chunkPageTruncated || pointLimitTruncated;
  return {
    query,
    observations,
    sampleChunks: selectedChunks,
    dailySummaries: [...daily.values()].sort((left, right) => left.calendarDate.localeCompare(right.calendarDate)),
    discovery: discoveryResult,
    coverage: coverageResult,
    freshness: freshnessResult,
    conflicts: buildConflicts(observations),
    pageInfo: {
      recordsTruncated,
      samplesTruncated,
      recordCursor: recordsTruncated ? cursorForLast(selectedRecords) : null,
      chunkCursor: samplesTruncated && lastConsumedChunk ? cursorForLast([lastConsumedChunk]) : null,
      returnedSamplePoints,
    },
  };
}

export function canonicalUnitForMetric(metricId: HealthMetricId): HealthUnit {
  return getHealthMetricDefinition(metricId).canonicalUnit;
}
