import { describe, expect, it } from 'vitest';
import {
  HEALTH_COVERAGE_STATUSES,
  HEALTH_METRIC_CATALOG,
  HEALTH_METRIC_IDS,
  HEALTH_NORMALIZATION_STATUSES,
  HEALTH_PROVIDERS,
  HEALTH_QUALITY_STATUSES,
  HEALTH_RECORDING_METHODS,
  HEALTH_SCHEMA_VERSION,
  HEALTH_SOURCE_RECORD_KINDS,
  HEALTH_UNITS,
  HEALTH_VALUE_ORIGINS,
  HEALTH_VALUE_TYPES,
  HealthMetricEntry,
  HealthMetricValue,
  HealthProvider,
  HealthSampleChunk,
  HealthSourceRecord,
} from '@shared/health';
import { SLEEP_PROVIDERS, SleepSession } from '@shared/sleep';
import { projectLoadedHealthRange } from '@shared/health-query';
import {
  buildHealthMetricCatalogGroups,
  buildHealthMetricWorkspaceView,
  buildSleepPriorityRows,
  filterHealthRangeResultByProviders,
  navigateHealthWorkspaceWindow,
  normalizeHealthWorkspaceRange,
  resolveHealthWorkspaceWindow,
  resolveSleepReferenceValue,
} from './health-workspace.helper';

const DAY_MS = 24 * 60 * 60 * 1000;

function valueEntry(overrides: Partial<HealthMetricValue> = {}): HealthMetricValue {
  return {
    kind: 'value',
    metricId: HEALTH_METRIC_IDS.RestingHeartRate,
    valueType: HEALTH_VALUE_TYPES.Number,
    aggregation: 'average',
    semanticVariant: 'daily_resting',
    origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
    recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
    quality: { status: HEALTH_QUALITY_STATUSES.Valid },
    normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
    native: { metric: 'restingHeartRate', value: 54, unit: 'bpm' },
    canonical: { value: 54, unit: HEALTH_UNITS.BeatsPerMinute },
    ...overrides,
  };
}

function sourceRecord(input: {
  id: string;
  provider: HealthProvider;
  accountKey: string;
  calendarDate?: string;
  metrics?: HealthMetricEntry[];
}): HealthSourceRecord {
  const calendarDate = input.calendarDate || '2026-08-01';
  const startTimeMs = Date.parse(`${calendarDate}T00:00:00.000Z`);
  const metrics = input.metrics || [valueEntry()];
  return {
    schemaVersion: HEALTH_SCHEMA_VERSION,
    id: input.id,
    userID: 'user-1',
    kind: HEALTH_SOURCE_RECORD_KINDS.DailySummary,
    source: {
      provider: input.provider,
      accountKey: input.accountKey,
      sourceRecordType: 'daily',
      sourceRecordKey: input.id,
      revision: { order: 1, token: 'one', digest: `digest-${input.id}` },
      receivedAtMs: startTimeMs + DAY_MS,
    },
    calendarDate,
    startTimeMs,
    endTimeMs: startTimeMs + DAY_MS - 1,
    metrics,
    metricIds: [...new Set(metrics.map(metric => metric.metricId))],
    coverage: { status: HEALTH_COVERAGE_STATUSES.Complete },
    device: { manufacturer: input.provider === HEALTH_PROVIDERS.GarminAPI ? 'Garmin' : 'COROS', model: 'Test watch' },
    sampleChunkIds: [],
    createdAtMs: startTimeMs,
    updatedAtMs: startTimeMs,
  };
}

function sampleChunk(input: {
  id: string;
  provider?: HealthProvider;
  accountKey?: string;
  values?: Array<number | string>;
  valueType?: 'number' | 'category';
  normalizationStatus?: 'canonical' | 'native_only';
}): HealthSampleChunk {
  const startTimeMs = Date.parse('2026-08-01T00:00:00.000Z');
  const values = input.values || [50, 51, 52];
  const valueType = input.valueType || HEALTH_VALUE_TYPES.Number;
  const normalizationStatus = input.normalizationStatus || HEALTH_NORMALIZATION_STATUSES.Canonical;
  return {
    schemaVersion: HEALTH_SCHEMA_VERSION,
    id: input.id,
    userID: 'user-1',
    parentSourceRecordId: 'sample-parent',
    provider: input.provider || HEALTH_PROVIDERS.GarminAPI,
    accountKey: input.accountKey || 'garmin-one',
    metricId: valueType === HEALTH_VALUE_TYPES.Category ? HEALTH_METRIC_IDS.StressState : HEALTH_METRIC_IDS.RestingHeartRate,
    valueType,
    aggregation: 'sample',
    semanticVariant: valueType === HEALTH_VALUE_TYPES.Category ? 'provider_state' : 'device_sample',
    origin: HEALTH_VALUE_ORIGINS.Recorded,
    recordingMethod: HEALTH_RECORDING_METHODS.Device,
    normalizationStatus,
    nativeMetric: valueType === HEALTH_VALUE_TYPES.Category ? 'stressState' : 'heartRate',
    nativeUnit: valueType === HEALTH_VALUE_TYPES.Category ? 'state' : 'bpm',
    canonicalUnit: normalizationStatus === HEALTH_NORMALIZATION_STATUSES.Canonical
      ? valueType === HEALTH_VALUE_TYPES.Category ? HEALTH_UNITS.Category : HEALTH_UNITS.BeatsPerMinute
      : null,
    calendarDate: '2026-08-01',
    startTimeMs,
    endTimeMs: startTimeMs + ((values.length - 1) * 60_000),
    receivedAtMs: startTimeMs + DAY_MS,
    seriesKey: input.id,
    chunkIndex: 0,
    offsetMs: values.map((_, index) => index * 60_000),
    nativeValues: values,
    canonicalValues: normalizationStatus === HEALTH_NORMALIZATION_STATUSES.Canonical ? values : null,
    coverage: { status: HEALTH_COVERAGE_STATUSES.Partial, sampleCount: values.length },
    revision: { order: 1, token: 'one', digest: 'unknown-parent' },
    createdAtMs: startTimeMs,
    updatedAtMs: startTimeMs,
  };
}

function sleepSession(overrides: Partial<SleepSession> = {}): SleepSession {
  const startTimeMs = Date.parse('2026-08-01T22:00:00.000Z');
  return {
    id: 'sleep-one',
    userID: 'user-1',
    source: {
      provider: SLEEP_PROVIDERS.GarminAPI,
      sourceSessionKey: 'opaque-source',
      providerUserId: 'raw-provider-user',
    },
    sleepDate: '2026-08-02',
    startTimeMs,
    endTimeMs: startTimeMs + (8 * 60 * 60 * 1000),
    durationSeconds: 8 * 60 * 60,
    isNap: false,
    stages: [],
    stageDurationsSeconds: {},
    score: { value: 88 },
    vitals: { restingHeartRateBpm: 51, averageHrvMs: 62 },
    createdAtMs: startTimeMs,
    updatedAtMs: startTimeMs,
    ...overrides,
  };
}

describe('Health workspace helpers', () => {
  it('normalizes saved Health ranges and falls back invalid settings to 30 days', () => {
    expect(normalizeHealthWorkspaceRange('14d')).toBe('14d');
    expect(normalizeHealthWorkspaceRange('1y')).toBe('1y');
    expect(normalizeHealthWorkspaceRange('forever')).toBe('30d');
    expect(normalizeHealthWorkspaceRange(null)).toBe('30d');
  });

  it('builds bounded windows and older/newer navigation without moving into the future', () => {
    const state = { metric: HEALTH_METRIC_IDS.HeartRate, range: '14d' as const, endDate: '2026-08-30' };
    expect(resolveHealthWorkspaceWindow(state, '2026-08-30')).toMatchObject({
      startDate: '2026-08-17',
      endDate: '2026-08-30',
      dayCount: 14,
      includeSamples: true,
      canNavigateNewer: false,
    });
    const older = navigateHealthWorkspaceWindow(state, 'older', '2026-08-30');
    expect(older.endDate).toBe('2026-08-16');
    expect(navigateHealthWorkspaceWindow(older, 'newer', '2026-08-30').endDate).toBe('2026-08-30');
    expect(resolveHealthWorkspaceWindow({ ...state, range: '90d' }, '2026-08-30').includeSamples).toBe(false);
  });

  it('publishes every catalog metric once in category groups', () => {
    const groups = buildHealthMetricCatalogGroups();
    const metricIds = groups.flatMap(group => group.metrics.map(metric => metric.id));
    expect(metricIds).toHaveLength(Object.keys(HEALTH_METRIC_CATALOG).length);
    expect(new Set(metricIds).size).toBe(metricIds.length);
  });

  it('keeps providers, accounts, semantics, native values, gaps, and conflicts isolated', () => {
    const records = [
      sourceRecord({ id: 'garmin-one', provider: HEALTH_PROVIDERS.GarminAPI, accountKey: 'secret-account-a' }),
      sourceRecord({ id: 'garmin-two', provider: HEALTH_PROVIDERS.GarminAPI, accountKey: 'secret-account-b', calendarDate: '2026-08-02' }),
      sourceRecord({
        id: 'coros-one',
        provider: HEALTH_PROVIDERS.COROSAPI,
        accountKey: 'secret-account-c',
        metrics: [valueEntry({
          native: { metric: 'restingHr', value: 61, unit: 'beats' },
          canonical: { value: 61, unit: HEALTH_UNITS.BeatsPerMinute },
        })],
      }),
      sourceRecord({
        id: 'native-one',
        provider: HEALTH_PROVIDERS.COROSAPI,
        accountKey: 'secret-account-c',
        calendarDate: '2026-08-03',
        metrics: [valueEntry({
          semanticVariant: 'native_vendor_variant',
          normalizationStatus: HEALTH_NORMALIZATION_STATUSES.NativeOnly,
          native: { metric: 'restingHrState', value: 'low', unit: 'state' },
          canonical: null,
          valueType: HEALTH_VALUE_TYPES.Category,
        })],
      }),
    ];
    const result = projectLoadedHealthRange(records, [], {
      startDate: '2026-08-01',
      endDate: '2026-08-04',
      metricIds: [HEALTH_METRIC_IDS.RestingHeartRate],
    }, { sourceRecordsComplete: true, samplesComplete: true }, Date.parse('2026-08-05T00:00:00.000Z'));

    const view = buildHealthMetricWorkspaceView(result);

    expect(view.series).toHaveLength(4);
    expect(view.hasCanonicalSeries).toBe(true);
    expect(view.hasNativeOnlySeries).toBe(true);
    expect(view.conflictCount).toBe(1);
    expect(view.series.filter(series => series.provider === HEALTH_PROVIDERS.GarminAPI).map(series => series.sourceLabel))
      .toEqual(['Garmin account 1', 'Garmin account 2']);
    expect(view.series.find(series => series.nativeOnly)?.chartKind).toBe('step');
    expect(view.series.map(series => JSON.stringify(series)).join(' ')).not.toContain('secret-account');
    expect(view.series[0].coverageText).toContain('/4 days');
  });

  it('keeps coverage and freshness scoped to unit and normalization-separated series', () => {
    const result = projectLoadedHealthRange([
      sourceRecord({
        id: 'canonical-day',
        provider: HEALTH_PROVIDERS.GarminAPI,
        accountKey: 'one',
        calendarDate: '2026-08-01',
        metrics: [valueEntry({
          coverage: {
            status: HEALTH_COVERAGE_STATUSES.Complete,
            expectedUpdateIntervalMs: DAY_MS,
          },
        })],
      }),
      sourceRecord({
        id: 'native-day',
        provider: HEALTH_PROVIDERS.GarminAPI,
        accountKey: 'one',
        calendarDate: '2026-08-02',
        metrics: [valueEntry({
          normalizationStatus: HEALTH_NORMALIZATION_STATUSES.NativeOnly,
          native: { metric: 'restingHeartRateState', value: 'low', unit: 'state' },
          canonical: null,
          valueType: HEALTH_VALUE_TYPES.Category,
          coverage: {
            status: HEALTH_COVERAGE_STATUSES.Complete,
            expectedUpdateIntervalMs: DAY_MS,
          },
        })],
      }),
    ], [], {
      startDate: '2026-08-01',
      endDate: '2026-08-02',
      metricIds: [HEALTH_METRIC_IDS.RestingHeartRate],
    }, { sourceRecordsComplete: true, samplesComplete: true }, Date.parse('2026-08-03T00:00:00.000Z'));

    const view = buildHealthMetricWorkspaceView(result);
    const canonical = view.series.find(series => !series.nativeOnly);
    const native = view.series.find(series => series.nativeOnly);

    expect(canonical?.coverageText).toBe('1/2 days');
    expect(native?.coverageText).toBe('1/2 days');
    expect(canonical?.freshnessText).toContain('Stale');
    expect(canonical?.freshnessText).toContain('Aug 1');
    expect(native?.freshnessText).toContain('Fresh');
    expect(native?.freshnessText).toContain('Aug 2');
  });

  it('renders canonical samples as lines and categorical samples as stepped series', () => {
    const result = projectLoadedHealthRange([], [
      sampleChunk({ id: 'numeric' }),
      sampleChunk({ id: 'category', values: ['rest', 'high', 'rest'], valueType: HEALTH_VALUE_TYPES.Category }),
      sampleChunk({ id: 'native', values: [1, 2], normalizationStatus: HEALTH_NORMALIZATION_STATUSES.NativeOnly }),
    ], {
      startDate: '2026-08-01',
      endDate: '2026-08-01',
      includeSamples: true,
    }, { sourceRecordsComplete: true, samplesComplete: true });

    const view = buildHealthMetricWorkspaceView(result);
    expect(view.series.map(series => series.chartKind).sort()).toEqual(['line', 'line', 'step']);
    expect(view.series.filter(series => series.nativeOnly)).toHaveLength(1);
    expect(view.rows.every(row => row.valueText.includes('samples'))).toBe(true);
  });

  it('filters providers locally and removes conflicts that no longer have two sources', () => {
    const result = projectLoadedHealthRange([
      sourceRecord({ id: 'garmin', provider: HEALTH_PROVIDERS.GarminAPI, accountKey: 'one' }),
      sourceRecord({
        id: 'coros',
        provider: HEALTH_PROVIDERS.COROSAPI,
        accountKey: 'two',
        metrics: [valueEntry({ canonical: { value: 62, unit: HEALTH_UNITS.BeatsPerMinute } })],
      }),
    ], [], {
      startDate: '2026-08-01',
      endDate: '2026-08-01',
      metricIds: [HEALTH_METRIC_IDS.RestingHeartRate],
    }, { sourceRecordsComplete: true, samplesComplete: true });

    const filtered = filterHealthRangeResultByProviders(result, [HEALTH_PROVIDERS.GarminAPI]);
    expect(filtered.observations).toHaveLength(1);
    expect(filtered.conflicts).toEqual([]);
  });

  it('resolves Sleep references against the normalized Sleep model', () => {
    const session = sleepSession();
    expect(resolveSleepReferenceValue(session, 'durationSeconds')).toBe(28_800);
    expect(resolveSleepReferenceValue(session, 'vitals.restingHeartRateBpm')).toBe(51);
    expect(resolveSleepReferenceValue(session, 'vitals.averageHrvMs')).toBe(62);
    expect(resolveSleepReferenceValue(session, 'vitals.maxSpo2Percent')).toBeNull();
  });

  it('uses local account ordinals for Sleep priority rows and never exposes provider IDs', () => {
    const rows = buildSleepPriorityRows([
      sleepSession(),
      sleepSession({
        id: 'sleep-two',
        source: {
          provider: SLEEP_PROVIDERS.GarminAPI,
          sourceSessionKey: 'other-secret',
          providerUserId: 'other-provider-user',
        },
        endTimeMs: Date.parse('2026-08-03T06:00:00.000Z'),
      }),
    ]);
    expect(rows.map(row => row.sourceLabel)).toEqual(['Garmin account 1', 'Garmin account 2']);
    expect(JSON.stringify(rows)).not.toContain('provider-user');
  });
});
