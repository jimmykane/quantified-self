import {
  HEALTH_METRIC_CATALOG,
  HEALTH_METRIC_IDS,
  HEALTH_NORMALIZATION_STATUSES,
  HEALTH_PROVIDERS,
  HEALTH_UNITS,
  HealthCoverageStatus,
  HealthMetricDefinition,
  HealthMetricId,
  HealthMetricValue,
  HealthObservation,
  HealthProvider,
  HealthRangeResult,
  HealthRecordingMethod,
  HealthSampleChunk,
  HealthSleepMetricReference,
  HealthSleepReferenceField,
  HealthValueOrigin,
  HealthValueType,
  getHealthMetricDefinition,
  isHealthMetricId,
} from '@shared/health';
import { SleepSession, normalizeSleepProvider } from '@shared/sleep';

export const HEALTH_WORKSPACE_RANGES = ['14d', '30d', '90d', '1y'] as const;
export type HealthWorkspaceRange = typeof HEALTH_WORKSPACE_RANGES[number];
export type HealthWorkspaceMetricSelection = 'sleep' | HealthMetricId;

export const HEALTH_WORKSPACE_DEFAULT_METRIC = HEALTH_METRIC_IDS.RestingHeartRate;
export const HEALTH_WORKSPACE_DEFAULT_RANGE: HealthWorkspaceRange = '30d';

export interface HealthWorkspaceRouteState {
  metric: HealthWorkspaceMetricSelection;
  range: HealthWorkspaceRange;
  endDate: string;
}

export interface HealthWorkspaceWindow extends HealthWorkspaceRouteState {
  startDate: string;
  startTimeMs: number;
  endTimeMs: number;
  dayCount: number;
  includeSamples: boolean;
  canNavigateNewer: boolean;
  label: string;
}

export interface HealthMetricCatalogGroup {
  id: HealthMetricDefinition['category'];
  label: string;
  metrics: ReadonlyArray<Readonly<HealthMetricDefinition>>;
}

export interface HealthWorkspaceSeriesPoint {
  timestampMs: number;
  calendarDate: string;
  value: number | string | boolean;
  qualityCode: string | null;
}

export type HealthWorkspaceChartKind = 'bar' | 'line' | 'point' | 'step';

export interface HealthWorkspaceSeries {
  id: string;
  provider: HealthProvider;
  providerLabel: string;
  sourceLabel: string;
  accountLabel: string | null;
  semanticLabel: string;
  aggregation: string;
  semanticVariant: string;
  origin: HealthValueOrigin;
  recordingMethod: HealthRecordingMethod;
  unit: string;
  normalizationStatus: string;
  nativeOnly: boolean;
  valueType: HealthValueType;
  chartKind: HealthWorkspaceChartKind;
  points: HealthWorkspaceSeriesPoint[];
  deviceLabel: string | null;
  coverageText: string;
  freshnessText: string;
  hasConflict: boolean;
}

export interface HealthObservationTableRow {
  id: string;
  dateText: string;
  sourceLabel: string;
  deviceLabel: string;
  valueText: string;
  semanticsText: string;
  coverageText: string;
  freshnessText: string;
  conflict: boolean;
}

export interface HealthMetricWorkspaceView {
  series: HealthWorkspaceSeries[];
  rows: HealthObservationTableRow[];
  totalRowCount: number;
  hasCanonicalSeries: boolean;
  hasNativeOnlySeries: boolean;
  conflictCount: number;
  providers: HealthProvider[];
}

export interface HealthPriorityRow {
  id: string;
  provider: HealthProvider;
  providerLabel: string;
  sourceLabel: string;
  valueText: string;
  contextText: string;
  observedAtMs: number;
}

export interface HealthSleepObservationRow {
  id: string;
  dateText: string;
  sourceLabel: string;
  durationText: string;
  scoreText: string;
  hrvText: string;
  heartRateText: string;
}

interface MetricDatum {
  provider: HealthProvider;
  accountKey: string;
  aggregation: string;
  semanticVariant: string;
  origin: HealthValueOrigin;
  recordingMethod: HealthRecordingMethod;
  unit: string;
  normalizationStatus: string;
  nativeOnly: boolean;
  valueType: HealthValueType;
  timestampMs: number;
  calendarDate: string;
  value: number | string | boolean;
  deviceLabel: string | null;
  qualityCode: string | null;
  observationId: string | null;
  rowId: string;
  rowKind: 'observation' | 'chunk';
  sampleCount: number;
  coverageStatus: HealthCoverageStatus;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TABLE_ROW_LIMIT = 250;
const CATEGORY_ORDER: readonly HealthMetricDefinition['category'][] = [
  'cardiovascular',
  'sleep',
  'wellness',
  'movement',
  'energy',
  'body',
  'fitness',
];
const CATEGORY_LABELS: Record<HealthMetricDefinition['category'], string> = {
  cardiovascular: 'Cardiovascular',
  sleep: 'Sleep',
  wellness: 'Wellness & recovery',
  movement: 'Movement',
  energy: 'Energy',
  body: 'Body',
  fitness: 'Fitness',
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseCalendarDate(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

export function localCalendarDate(nowMs = Date.now()): string {
  const date = new Date(nowMs);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeHealthWorkspaceRouteState(
  value: Partial<Record<'metric' | 'range' | 'end', string | null | undefined>>,
  todayDate = localCalendarDate(),
): HealthWorkspaceRouteState {
  const metricValue = value.metric;
  const todayMs = parseCalendarDate(todayDate) ?? Date.now();
  const requestedEndMs = parseCalendarDate(value.end);
  const metricValid = metricValue === 'sleep' || isHealthMetricId(metricValue);
  const rangeValid = HEALTH_WORKSPACE_RANGES.includes(value.range as HealthWorkspaceRange);
  const endValid = requestedEndMs !== null && requestedEndMs <= todayMs;
  if (!metricValid || !rangeValid || !endValid) {
    return {
      metric: HEALTH_WORKSPACE_DEFAULT_METRIC,
      range: HEALTH_WORKSPACE_DEFAULT_RANGE,
      endDate: todayDate,
    };
  }
  return {
    metric: metricValue,
    range: value.range as HealthWorkspaceRange,
    endDate: value.end as string,
  };
}

export function healthWorkspaceRangeDays(range: HealthWorkspaceRange): number {
  switch (range) {
    case '14d': return 14;
    case '30d': return 30;
    case '90d': return 90;
    case '1y': return 365;
  }
}

export function resolveHealthWorkspaceWindow(
  state: HealthWorkspaceRouteState,
  todayDate = localCalendarDate(),
): HealthWorkspaceWindow {
  const dayCount = healthWorkspaceRangeDays(state.range);
  const endDayMs = parseCalendarDate(state.endDate) ?? parseCalendarDate(todayDate) ?? Date.now();
  const startDayMs = endDayMs - ((dayCount - 1) * DAY_MS);
  const endTimeMs = endDayMs + DAY_MS - 1;
  return {
    ...state,
    startDate: new Date(startDayMs).toISOString().slice(0, 10),
    startTimeMs: startDayMs,
    endTimeMs,
    dayCount,
    includeSamples: dayCount <= 30,
    canNavigateNewer: state.endDate < todayDate,
    label: formatWindowLabel(startDayMs, endDayMs),
  };
}

export function navigateHealthWorkspaceWindow(
  state: HealthWorkspaceRouteState,
  direction: 'older' | 'newer',
  todayDate = localCalendarDate(),
): HealthWorkspaceRouteState {
  const endDayMs = parseCalendarDate(state.endDate) ?? parseCalendarDate(todayDate) ?? Date.now();
  const offset = healthWorkspaceRangeDays(state.range) * DAY_MS * (direction === 'older' ? -1 : 1);
  const todayMs = parseCalendarDate(todayDate) ?? Date.now();
  const nextEndMs = Math.min(todayMs, endDayMs + offset);
  return { ...state, endDate: new Date(nextEndMs).toISOString().slice(0, 10) };
}

export function buildHealthMetricCatalogGroups(): HealthMetricCatalogGroup[] {
  const definitions = Object.values(HEALTH_METRIC_CATALOG);
  return CATEGORY_ORDER.map(category => ({
    id: category,
    label: CATEGORY_LABELS[category],
    metrics: definitions
      .filter(definition => definition.category === category)
      .sort((left, right) => compareText(left.label, right.label)),
  })).filter(group => group.metrics.length > 0);
}

export function filterHealthRangeResultByProviders(
  result: HealthRangeResult,
  selectedProviders: readonly HealthProvider[],
): HealthRangeResult {
  if (selectedProviders.length === 0) {
    return result;
  }
  const allowed = new Set(selectedProviders);
  const observations = result.observations.filter(item => allowed.has(item.provider));
  const observationIds = new Set(observations.map(item => item.id));
  const sampleChunks = result.sampleChunks.filter(item => allowed.has(item.provider));
  const conflicts = result.conflicts.flatMap(conflict => {
    const sources = conflict.sources.filter(source => allowed.has(source.provider));
    const sourceKeys = new Set(sources.map(source => JSON.stringify([source.provider, source.accountKey])));
    if (sourceKeys.size < 2) {
      return [];
    }
    return [{
      ...conflict,
      observationIds: conflict.observationIds.filter(id => observationIds.has(id)),
      providers: conflict.providers.filter(provider => allowed.has(provider)),
      sources,
    }];
  });
  const dailySummaries = result.dailySummaries.flatMap(summary => {
    const summaryObservationIds = summary.observationIds.filter(id => observationIds.has(id));
    const providers = summary.providers.filter(provider => allowed.has(provider));
    if (!summaryObservationIds.length && !providers.length) {
      return [];
    }
    const sleepReferenceIds = observations
      .filter(item => item.calendarDate === summary.calendarDate && item.entry.kind === 'sleep_reference')
      .map(item => (item.entry as HealthSleepMetricReference).reference.documentId);
    return [{ ...summary, observationIds: summaryObservationIds, providers, sleepReferenceIds }];
  });
  return {
    ...result,
    observations,
    sampleChunks,
    conflicts,
    dailySummaries,
    discovery: result.discovery.flatMap(item => {
      const providers = item.providers.filter(provider => allowed.has(provider));
      return providers.length ? [{ ...item, providers }] : [];
    }),
    coverage: result.coverage.filter(item => allowed.has(item.provider)),
    freshness: result.freshness.filter(item => allowed.has(item.provider)),
  };
}

export function buildHealthMetricWorkspaceView(
  result: HealthRangeResult,
  sleepSessions: readonly SleepSession[] = [],
): HealthMetricWorkspaceView {
  const sleepById = new Map(sleepSessions.flatMap(session => session.id ? [[session.id, session] as const] : []));
  const datums: MetricDatum[] = [];
  for (const observation of result.observations) {
    const datum = observationDatum(observation, sleepById);
    if (datum) {
      datums.push(datum);
    }
  }
  for (const chunk of result.sampleChunks) {
    datums.push(...chunkDatums(chunk));
  }

  const accountLabels = buildAccountLabels(datums.map(item => ({
    provider: item.provider,
    accountKey: item.accountKey,
    timestampMs: item.timestampMs,
  })));
  const conflictingObservationIds = new Set(result.conflicts.flatMap(conflict => conflict.observationIds));
  const grouped = new Map<string, MetricDatum[]>();
  for (const datum of datums) {
    const key = JSON.stringify([
      datum.provider,
      datum.accountKey,
      datum.aggregation,
      datum.semanticVariant,
      datum.origin,
      datum.recordingMethod,
      datum.unit,
      datum.normalizationStatus,
      datum.valueType,
    ]);
    grouped.set(key, [...(grouped.get(key) || []), datum]);
  }

  const series = [...grouped.values()].map((items, index): HealthWorkspaceSeries => {
    const first = items[0];
    const sourceLabel = accountLabels.get(accountIdentity(first.provider, first.accountKey)) || providerLabel(first.provider);
    const deviceLabels = [...new Set(items.map(item => item.deviceLabel).filter((item): item is string => !!item))];
    const coverage = result.coverage.find(item => seriesIdentityMatches(first, item));
    const freshness = result.freshness.find(item => seriesIdentityMatches(first, item));
    const points = items
      .map(item => ({
        timestampMs: item.timestampMs,
        calendarDate: item.calendarDate,
        value: item.value,
        qualityCode: item.qualityCode,
      }))
      .sort((left, right) => left.timestampMs - right.timestampMs);
    return {
      id: `health-series-${index + 1}`,
      provider: first.provider,
      providerLabel: providerLabel(first.provider),
      sourceLabel,
      accountLabel: sourceLabel === providerLabel(first.provider) ? null : sourceLabel,
      semanticLabel: `${humanize(first.aggregation)} · ${humanize(first.semanticVariant)} · ${humanize(first.origin)} · ${humanize(first.recordingMethod)}`,
      aggregation: first.aggregation,
      semanticVariant: first.semanticVariant,
      origin: first.origin,
      recordingMethod: first.recordingMethod,
      unit: first.unit,
      normalizationStatus: first.normalizationStatus,
      nativeOnly: first.nativeOnly,
      valueType: first.valueType,
      chartKind: resolveChartKind(first, points.length),
      points,
      deviceLabel: deviceLabels.length === 1 ? deviceLabels[0] : deviceLabels.length > 1 ? 'Multiple devices' : null,
      coverageText: coverage
        ? `${coverage.recordedDays}/${coverage.requestedDays} days${coverage.partialDays ? ` · ${coverage.partialDays} partial` : ''}`
        : coverageStatusLabel(first.coverageStatus),
      freshnessText: freshness
        ? freshness.status === 'unknown' ? `Last observed ${formatDate(freshness.lastObservedAtMs)}` : `${humanize(freshness.status)} · ${formatDate(freshness.lastObservedAtMs)}`
        : `Observed ${formatDate(first.timestampMs)}`,
      hasConflict: items.some(item => !!item.observationId && conflictingObservationIds.has(item.observationId)),
    };
  }).sort((left, right) => compareText(left.providerLabel, right.providerLabel)
    || Number(left.nativeOnly) - Number(right.nativeOnly)
    || compareText(left.semanticLabel, right.semanticLabel)
    || compareText(left.unit, right.unit));

  const latestByRow = new Map<string, MetricDatum>();
  for (const datum of datums) {
    const current = latestByRow.get(datum.rowId);
    if (!current || datum.timestampMs > current.timestampMs) {
      latestByRow.set(datum.rowId, datum);
    }
  }
  const allRows = [...latestByRow.values()]
    .sort((left, right) => right.timestampMs - left.timestampMs
      || compareText(left.provider, right.provider)
      || compareText(left.rowId, right.rowId))
    .map((datum): HealthObservationTableRow => {
    const sourceLabel = accountLabels.get(accountIdentity(datum.provider, datum.accountKey)) || providerLabel(datum.provider);
    const freshness = result.freshness.find(item => seriesIdentityMatches(datum, item));
    return {
      id: datum.rowId,
      dateText: formatDateTime(datum.timestampMs),
      sourceLabel,
      deviceLabel: datum.deviceLabel || 'Not reported',
      valueText: datum.rowKind === 'chunk'
        ? `${datum.sampleCount.toLocaleString()} samples · latest ${formatHealthValue(datum.value, datum.unit)}`
        : formatHealthValue(datum.value, datum.unit),
      semanticsText: `${humanize(datum.aggregation)} · ${humanize(datum.semanticVariant)} · ${humanize(datum.origin)} · ${humanize(datum.recordingMethod)}${datum.nativeOnly ? ' · native only' : ''}`,
      coverageText: coverageStatusLabel(datum.coverageStatus),
      freshnessText: freshness ? humanize(freshness.status) : 'Unknown',
      conflict: !!datum.observationId && conflictingObservationIds.has(datum.observationId),
    };
    });

  return {
    series,
    rows: allRows.slice(0, TABLE_ROW_LIMIT),
    totalRowCount: allRows.length,
    hasCanonicalSeries: series.some(item => !item.nativeOnly),
    hasNativeOnlySeries: series.some(item => item.nativeOnly),
    conflictCount: result.conflicts.length,
    providers: [...new Set(series.map(item => item.provider))].sort((left, right) =>
      compareText(providerLabel(left), providerLabel(right))),
  };
}

export function buildHealthPriorityRows(
  result: HealthRangeResult | null | undefined,
  sleepSessions: readonly SleepSession[] = [],
): HealthPriorityRow[] {
  if (!result) {
    return [];
  }
  const view = buildHealthMetricWorkspaceView(result, sleepSessions);
  return view.series.flatMap((series, index) => {
    const latest = series.points.at(-1);
    if (!latest) {
      return [];
    }
    return [{
      id: `health-priority-${index + 1}`,
      provider: series.provider,
      providerLabel: series.providerLabel,
      sourceLabel: series.sourceLabel,
      valueText: formatHealthValue(latest.value, series.unit),
      contextText: `${formatDate(latest.timestampMs)} · ${humanize(series.aggregation)} · ${humanize(series.semanticVariant)}${series.nativeOnly ? ' · native only' : ''}`,
      observedAtMs: latest.timestampMs,
    }];
  });
}

export function buildSleepPriorityRows(sessions: readonly SleepSession[]): HealthPriorityRow[] {
  const normalized = sessions.flatMap(session => {
    const provider = normalizeSleepProvider(session.source?.provider);
    return provider ? [{ session, provider }] : [];
  });
  const accountLabels = buildAccountLabels(normalized.map(({ session, provider }) => ({
    provider,
    accountKey: `${session.source.providerUserId || 'default'}`,
    timestampMs: session.endTimeMs,
  })));
  const latestBySource = new Map<string, { session: SleepSession; provider: HealthProvider }>();
  for (const item of normalized) {
    const key = accountIdentity(item.provider, `${item.session.source.providerUserId || 'default'}`);
    const current = latestBySource.get(key);
    if (!current || item.session.endTimeMs > current.session.endTimeMs) {
      latestBySource.set(key, item);
    }
  }
  return [...latestBySource.entries()].map(([key, { session, provider }], index) => ({
    id: `sleep-priority-${index + 1}`,
    provider,
    providerLabel: providerLabel(provider),
    sourceLabel: accountLabels.get(key) || providerLabel(provider),
    valueText: formatDuration(session.durationSeconds),
    contextText: `${formatDate(session.endTimeMs)}${session.score?.value !== null && session.score?.value !== undefined ? ` · score ${Math.round(session.score.value)}` : ''}`,
    observedAtMs: session.endTimeMs,
  })).sort((left, right) => compareText(left.sourceLabel, right.sourceLabel));
}

export function buildSleepObservationRows(sessions: readonly SleepSession[]): HealthSleepObservationRow[] {
  const normalized = sessions.flatMap(session => {
    const provider = normalizeSleepProvider(session.source?.provider);
    return provider ? [{ session, provider }] : [];
  });
  const accountLabels = buildAccountLabels(normalized.map(({ session, provider }) => ({
    provider,
    accountKey: `${session.source.providerUserId || 'default'}`,
    timestampMs: session.endTimeMs,
  })));
  return normalized
    .sort((left, right) => right.session.endTimeMs - left.session.endTimeMs)
    .map(({ session, provider }, index) => ({
      id: `sleep-row-${index + 1}`,
      dateText: formatDateTime(session.endTimeMs),
      sourceLabel: accountLabels.get(accountIdentity(provider, `${session.source.providerUserId || 'default'}`))
        || providerLabel(provider),
      durationText: formatDuration(session.durationSeconds),
      scoreText: finiteMetricText(session.score?.value),
      hrvText: finiteMetricText(session.vitals?.averageHrvMs, ' ms'),
      heartRateText: finiteMetricText(session.vitals?.averageHeartRateBpm, ' bpm'),
    }));
}

export function resolveSleepReferenceValue(
  session: SleepSession | null | undefined,
  field: HealthSleepReferenceField,
): number | null {
  if (!session) {
    return null;
  }
  let value: unknown;
  switch (field) {
    case 'durationSeconds': value = session.durationSeconds; break;
    case 'score.value': value = session.score?.value; break;
    case 'vitals.averageHeartRateBpm': value = session.vitals?.averageHeartRateBpm; break;
    case 'vitals.minimumHeartRateBpm': value = session.vitals?.minimumHeartRateBpm; break;
    case 'vitals.restingHeartRateBpm': value = session.vitals?.restingHeartRateBpm; break;
    case 'vitals.averageHrvMs': value = session.vitals?.averageHrvMs; break;
    case 'vitals.overnightHrvMs': value = session.vitals?.overnightHrvMs; break;
    case 'vitals.maxSpo2Percent': value = session.vitals?.maxSpo2Percent; break;
    case 'vitals.averageRespirationBrpm': value = session.vitals?.averageRespirationBrpm; break;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function providerLabel(provider: HealthProvider): string {
  switch (provider) {
    case HEALTH_PROVIDERS.GarminAPI: return 'Garmin';
    case HEALTH_PROVIDERS.SuuntoApp: return 'Suunto';
    case HEALTH_PROVIDERS.COROSAPI: return 'COROS';
    case HEALTH_PROVIDERS.WahooAPI: return 'Wahoo';
    case HEALTH_PROVIDERS.QuantifiedSelf: return 'Quantified Self';
  }
}

export function formatHealthValue(value: number | string | boolean, unit: string): string {
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'string') {
    return humanize(value);
  }
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  switch (unit) {
    case HEALTH_UNITS.Second: return formatDuration(value);
    case HEALTH_UNITS.Percent: return `${rounded}%`;
    case HEALTH_UNITS.BeatsPerMinute: return `${rounded} bpm`;
    case HEALTH_UNITS.Millisecond: return `${rounded} ms`;
    case HEALTH_UNITS.Meter: return Math.abs(value) >= 1_000 ? `${Math.round((value / 1_000) * 10) / 10} km` : `${rounded} m`;
    case HEALTH_UNITS.Kilocalorie: return `${rounded.toLocaleString()} kcal`;
    case HEALTH_UNITS.Kilogram: return `${rounded} kg`;
    case HEALTH_UNITS.MillimetersMercury: return `${rounded} mmHg`;
    case HEALTH_UNITS.Celsius: return `${rounded} °C`;
    case HEALTH_UNITS.BreathsPerMinute: return `${rounded} brpm`;
    case HEALTH_UNITS.MillilitersPerKilogramPerMinute: return `${rounded} ml/kg/min`;
    case HEALTH_UNITS.Years: return `${rounded} years`;
    case HEALTH_UNITS.Count: return rounded.toLocaleString();
    default: return unit ? `${rounded} ${humanize(unit)}` : `${rounded}`;
  }
}

function observationDatum(
  observation: HealthObservation,
  sleepById: ReadonlyMap<string, SleepSession>,
): MetricDatum | null {
  const entry = observation.entry;
  let value: number | string | boolean;
  let unit: string;
  let normalizationStatus: string;
  let nativeOnly: boolean;
  if (entry.kind === 'sleep_reference') {
    const resolved = resolveSleepReferenceValue(sleepById.get(entry.reference.documentId), entry.reference.field);
    if (resolved === null) {
      return null;
    }
    value = resolved;
    unit = getHealthMetricDefinition(entry.metricId).canonicalUnit;
    normalizationStatus = HEALTH_NORMALIZATION_STATUSES.Canonical;
    nativeOnly = false;
  } else {
    const metricValue = entry as HealthMetricValue;
    const canonical = metricValue.normalizationStatus === HEALTH_NORMALIZATION_STATUSES.Canonical
      ? metricValue.canonical
      : null;
    value = canonical?.value ?? metricValue.native.value;
    unit = `${canonical?.unit || metricValue.native.unit || metricValue.native.metric || ''}`;
    normalizationStatus = metricValue.normalizationStatus;
    nativeOnly = metricValue.normalizationStatus !== HEALTH_NORMALIZATION_STATUSES.Canonical || !canonical;
  }
  return {
    provider: observation.provider,
    accountKey: observation.accountKey,
    aggregation: entry.aggregation,
    semanticVariant: entry.semanticVariant,
    origin: entry.origin,
    recordingMethod: entry.recordingMethod,
    unit,
    normalizationStatus,
    nativeOnly,
    valueType: entry.valueType,
    timestampMs: observation.endTimeMs,
    calendarDate: observation.calendarDate,
    value,
    deviceLabel: resolveDeviceLabel(observation.device),
    qualityCode: entry.quality.nativeCode || entry.quality.status,
    observationId: observation.id,
    rowId: `observation:${observation.id}`,
    rowKind: 'observation',
    sampleCount: 1,
    coverageStatus: observation.coverage.status,
  };
}

function chunkDatums(chunk: HealthSampleChunk): MetricDatum[] {
  const useCanonical = chunk.normalizationStatus === HEALTH_NORMALIZATION_STATUSES.Canonical
    && Array.isArray(chunk.canonicalValues)
    && !!chunk.canonicalUnit;
  const values = useCanonical ? chunk.canonicalValues || [] : chunk.nativeValues;
  const unit = `${useCanonical ? chunk.canonicalUnit : chunk.nativeUnit || chunk.nativeMetric || ''}`;
  return values.flatMap((value, index) => {
    if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') {
      return [];
    }
    return [{
      provider: chunk.provider,
      accountKey: chunk.accountKey,
      aggregation: chunk.aggregation,
      semanticVariant: chunk.semanticVariant,
      origin: chunk.origin,
      recordingMethod: chunk.recordingMethod,
      unit,
      normalizationStatus: chunk.normalizationStatus,
      nativeOnly: !useCanonical,
      valueType: chunk.valueType,
      timestampMs: chunk.startTimeMs + (Number(chunk.offsetMs[index]) || 0),
      calendarDate: chunk.calendarDate,
      value,
      deviceLabel: resolveDeviceLabel(chunk.device),
      qualityCode: chunk.qualityCodes?.[index] || null,
      observationId: null,
      rowId: `chunk:${chunk.id}`,
      rowKind: 'chunk',
      sampleCount: values.length,
      coverageStatus: chunk.coverage.status,
    } satisfies MetricDatum];
  });
}

function buildAccountLabels(
  values: readonly { provider: HealthProvider; accountKey: string; timestampMs: number }[],
): Map<string, string> {
  const sources = new Map<string, { provider: HealthProvider; accountKey: string; firstMs: number }>();
  for (const value of values) {
    const key = accountIdentity(value.provider, value.accountKey);
    const current = sources.get(key);
    if (!current || value.timestampMs < current.firstMs) {
      sources.set(key, { provider: value.provider, accountKey: value.accountKey, firstMs: value.timestampMs });
    }
  }
  const labels = new Map<string, string>();
  for (const provider of [...new Set([...sources.values()].map(item => item.provider))]) {
    const providerSources = [...sources.values()]
      .filter(item => item.provider === provider)
      .sort((left, right) => left.firstMs - right.firstMs || compareText(left.accountKey, right.accountKey));
    providerSources.forEach((source, index) => {
      labels.set(
        accountIdentity(source.provider, source.accountKey),
        providerSources.length > 1 ? `${providerLabel(provider)} account ${index + 1}` : providerLabel(provider),
      );
    });
  }
  return labels;
}

function accountIdentity(provider: HealthProvider, accountKey: string): string {
  return JSON.stringify([provider, accountKey]);
}

function seriesIdentityMatches(
  datum: Pick<MetricDatum, 'provider' | 'accountKey' | 'aggregation' | 'semanticVariant' | 'origin' | 'recordingMethod'>,
  value: {
    provider: HealthProvider;
    accountKey: string;
    aggregation: string;
    semanticVariant: string;
    origin: HealthValueOrigin;
    recordingMethod: HealthRecordingMethod;
  },
): boolean {
  return datum.provider === value.provider
    && datum.accountKey === value.accountKey
    && datum.aggregation === value.aggregation
    && datum.semanticVariant === value.semanticVariant
    && datum.origin === value.origin
    && datum.recordingMethod === value.recordingMethod;
}

function resolveChartKind(datum: MetricDatum, pointCount: number): HealthWorkspaceChartKind {
  if (datum.valueType === 'category' || typeof datum.value === 'string' || typeof datum.value === 'boolean') {
    return 'step';
  }
  if (/total/i.test(datum.aggregation)) {
    return 'bar';
  }
  return pointCount <= 1 ? 'point' : 'line';
}

function resolveDeviceLabel(device: HealthObservation['device'] | HealthSampleChunk['device']): string | null {
  const displayName = `${device?.displayName || ''}`.trim();
  if (displayName) {
    return displayName;
  }
  const manufacturer = `${device?.manufacturer || ''}`.trim();
  const model = `${device?.model || ''}`.trim();
  return [manufacturer, model].filter(Boolean).join(' ') || null;
}

function coverageStatusLabel(status: HealthCoverageStatus): string {
  switch (status) {
    case 'complete': return 'Complete';
    case 'partial': return 'Partial';
    case 'unknown': return 'Unknown';
  }
}

function humanize(value: string): string {
  const normalized = `${value || ''}`.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Unknown';
}

function formatWindowLabel(startMs: number, endMs: number): string {
  const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `${formatter.format(new Date(startMs))} – ${formatter.format(new Date(endMs))}`;
}

function formatDate(timestampMs: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(timestampMs));
}

function formatDateTime(timestampMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestampMs));
}

function formatDuration(secondsValue: number): string {
  const totalMinutes = Math.max(0, Math.round(Number(secondsValue) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes.toString().padStart(2, '0')}m` : `${minutes}m`;
}

function finiteMetricText(value: unknown, suffix = ''): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric * 10) / 10}${suffix}` : '—';
}
