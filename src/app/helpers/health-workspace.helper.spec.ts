import { describe, expect, it } from 'vitest';
import { DistanceUnits } from '@sports-alliance/sports-lib';
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
  HealthMetricId,
  HealthMetricValue,
  HealthProvider,
  HealthSampleChunk,
  HealthSourceRecord,
} from '@shared/health';
import { SLEEP_PROVIDERS, SleepSession } from '@shared/sleep';
import {
  ACTIVITY_HEALTH_SOURCE_KINDS,
  type ActivityHealthObservation,
} from '@shared/activity-health';
import { projectLoadedHealthRange } from '@shared/health-query';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import {
  buildHealthMetricCatalogGroups,
  buildHealthMetricWorkspaceView,
  buildHealthPriorityRows,
  buildSleepObservationRows,
  buildSleepPriorityRows,
  filterHealthRangeResultByProviders,
  formatHealthAxisValue,
  formatHealthUnit,
  formatHealthValue,
  isSleepHrvSemanticVariant,
  navigateHealthWorkspaceWindow,
  normalizeHealthWorkspaceMetric,
  normalizeHealthWorkspaceRange,
  resolveHealthWorkspaceWindow,
  resolveSleepReferenceValue,
  selectHealthPriorityTrendSeries,
  selectActivityHealthObservations,
  sleepSessionHasHrv,
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
  metricId?: HealthMetricId;
  semanticVariant?: string;
  values?: Array<number | string>;
  valueType?: 'number' | 'category';
  normalizationStatus?: 'canonical' | 'native_only';
}): HealthSampleChunk {
  const startTimeMs = Date.parse('2026-08-01T00:00:00.000Z');
  const values = input.values || [50, 51, 52];
  const valueType = input.valueType || HEALTH_VALUE_TYPES.Number;
  const normalizationStatus = input.normalizationStatus || HEALTH_NORMALIZATION_STATUSES.Canonical;
  const metricId = input.metricId || (valueType === HEALTH_VALUE_TYPES.Category
    ? HEALTH_METRIC_IDS.StressState
    : HEALTH_METRIC_IDS.RestingHeartRate);
  return {
    schemaVersion: HEALTH_SCHEMA_VERSION,
    id: input.id,
    userID: 'user-1',
    parentSourceRecordId: 'sample-parent',
    provider: input.provider || HEALTH_PROVIDERS.GarminAPI,
    accountKey: input.accountKey || 'garmin-one',
    metricId,
    valueType,
    aggregation: 'sample',
    semanticVariant: input.semanticVariant || (valueType === HEALTH_VALUE_TYPES.Category ? 'provider_state' : 'device_sample'),
    origin: HEALTH_VALUE_ORIGINS.Recorded,
    recordingMethod: HEALTH_RECORDING_METHODS.Device,
    normalizationStatus,
    nativeMetric: valueType === HEALTH_VALUE_TYPES.Category ? 'stressState' : 'heartRate',
    nativeUnit: valueType === HEALTH_VALUE_TYPES.Category ? 'state' : 'bpm',
    canonicalUnit: normalizationStatus === HEALTH_NORMALIZATION_STATUSES.Canonical
      ? valueType === HEALTH_VALUE_TYPES.Category
        ? HEALTH_UNITS.Category
        : metricId === HEALTH_METRIC_IDS.BodyEnergy ? HEALTH_UNITS.Percent : HEALTH_UNITS.BeatsPerMinute
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

function activityObservation(overrides: Partial<ActivityHealthObservation> = {}): ActivityHealthObservation {
  return {
    id: 'opaque-workout-observation',
    metricId: HEALTH_METRIC_IDS.BodyWeight,
    observedAtMs: Date.parse('2026-08-02T08:00:00.000Z'),
    value: 72,
    unit: HEALTH_UNITS.Kilogram,
    provider: HEALTH_PROVIDERS.COROSAPI,
    sourceAccountKey: 'opaque-workout-account',
    sourceKind: ACTIVITY_HEALTH_SOURCE_KINDS.WorkoutProfileContext,
    discipline: null,
    semanticVariant: 'workout_profile_context',
    ...overrides,
  };
}

describe('Health workspace helpers', () => {
  it('formats canonical values and units through Sports Lib while keeping native-only values provider-specific', () => {
    expect(formatHealthValue(
      HEALTH_METRIC_IDS.Vo2Max,
      52,
      HEALTH_UNITS.MillilitersPerKilogramPerMinute,
    )).toBe('52.00 ml/kg/min');
    expect(formatHealthValue(HEALTH_METRIC_IDS.ActiveDuration, 3_600, HEALTH_UNITS.Second))
      .toBe('01h 00m 00s');
    expect(formatHealthUnit(HEALTH_METRIC_IDS.Vo2Max, 52, HEALTH_UNITS.MillilitersPerKilogramPerMinute))
      .toBe('ml/kg/min');
    expect(formatHealthAxisValue(HEALTH_METRIC_IDS.Vo2Max, 52, HEALTH_UNITS.MillilitersPerKilogramPerMinute))
      .toBe('52.00');

    const miles = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
    expect(formatHealthValue(HEALTH_METRIC_IDS.Distance, 10_000, HEALTH_UNITS.Meter, false, miles))
      .toBe('6.22 mi');
    expect(formatHealthUnit(HEALTH_METRIC_IDS.Distance, 10_000, HEALTH_UNITS.Meter, false, miles))
      .toBe('mi');
    expect(formatHealthAxisValue(HEALTH_METRIC_IDS.Distance, 10_000, HEALTH_UNITS.Meter, false, miles))
      .toBe('6.22');

    expect(formatHealthValue(
      HEALTH_METRIC_IDS.BodyEnergy,
      55,
      'garmin_body_battery_points',
      true,
    )).toBe('55 Garmin body battery points');
  });

  it('normalizes saved Health ranges and falls back invalid settings to 30 days', () => {
    expect(normalizeHealthWorkspaceRange('today')).toBe('today');
    expect(normalizeHealthWorkspaceRange('14d')).toBe('14d');
    expect(normalizeHealthWorkspaceRange('1y')).toBe('1y');
    expect(normalizeHealthWorkspaceRange('forever')).toBe('30d');
    expect(normalizeHealthWorkspaceRange(null)).toBe('30d');
  });

  it('normalizes persisted Health metrics and falls back invalid settings to Resting heart rate', () => {
    expect(normalizeHealthWorkspaceMetric('sleep')).toBe('sleep');
    expect(normalizeHealthWorkspaceMetric(HEALTH_METRIC_IDS.Steps)).toBe(HEALTH_METRIC_IDS.Steps);
    expect(normalizeHealthWorkspaceMetric('unknown_metric')).toBe(HEALTH_METRIC_IDS.RestingHeartRate);
    expect(normalizeHealthWorkspaceMetric(null)).toBe(HEALTH_METRIC_IDS.RestingHeartRate);
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

  it('labels one-day history by its inspected date and pages it one day at a time', () => {
    const state = { metric: HEALTH_METRIC_IDS.HeartRate, range: 'today' as const, endDate: '2026-08-30' };
    const relativeDateFormatter = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    const explicitTodayLabel = relativeDateFormatter.format(new Date('2026-08-30T00:00:00.000Z'));

    expect(resolveHealthWorkspaceWindow(state, '2026-08-30')).toMatchObject({
      startDate: '2026-08-30',
      endDate: '2026-08-30',
      startTimeMs: new Date(2026, 7, 30).getTime(),
      endTimeMs: new Date(2026, 7, 31).getTime() - 1,
      dayCount: 1,
      includeSamples: true,
      canNavigateNewer: false,
      label: `Today · ${explicitTodayLabel}`,
    });
    const older = navigateHealthWorkspaceWindow(state, 'older', '2026-08-30');
    const explicitYesterdayLabel = relativeDateFormatter.format(new Date('2026-08-29T00:00:00.000Z'));
    expect(older.endDate).toBe('2026-08-29');
    expect(resolveHealthWorkspaceWindow(older, '2026-08-30')).toMatchObject({
      canNavigateNewer: true,
      label: `Yesterday · ${explicitYesterdayLabel}`,
    });
    const olderAgain = navigateHealthWorkspaceWindow(older, 'older', '2026-08-30');
    const explicitOlderLabel = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date('2026-08-28T00:00:00.000Z'));
    expect(resolveHealthWorkspaceWindow(olderAgain, '2026-08-30').label).toBe(explicitOlderLabel);
    expect(navigateHealthWorkspaceWindow(older, 'newer', '2026-08-30').endDate).toBe('2026-08-30');
  });

  it('publishes every catalog metric once in category groups', () => {
    const groups = buildHealthMetricCatalogGroups();
    const metricIds = groups.flatMap(group => group.metrics.map(metric => metric.id));
    expect(metricIds).toHaveLength(Object.keys(HEALTH_METRIC_CATALOG).length);
    expect(new Set(metricIds).size).toBe(metricIds.length);
  });

  it('keeps category ordering while hiding catalog metrics without stored data', () => {
    const groups = buildHealthMetricCatalogGroups([
      HEALTH_METRIC_IDS.Steps,
      HEALTH_METRIC_IDS.HeartRate,
      HEALTH_METRIC_IDS.BodyWeight,
    ]);

    expect(groups.map(group => group.id)).toEqual(['cardiovascular', 'movement', 'body']);
    expect(groups.flatMap(group => group.metrics.map(metric => metric.id))).toEqual([
      HEALTH_METRIC_IDS.HeartRate,
      HEALTH_METRIC_IDS.Steps,
      HEALTH_METRIC_IDS.BodyWeight,
    ]);
    expect(buildHealthMetricCatalogGroups([])).toEqual([]);
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

  it('puts the newest sample-backed Health highlight before older provider summaries', () => {
    const result = projectLoadedHealthRange([
      sourceRecord({
        id: 'garmin-summary',
        provider: HEALTH_PROVIDERS.GarminAPI,
        accountKey: 'garmin-one',
        calendarDate: '2026-07-31',
        metrics: [valueEntry({
          metricId: HEALTH_METRIC_IDS.HeartRate,
          semanticVariant: 'rolling_7_day_average',
          native: { metric: 'heartRate', value: 54, unit: 'bpm' },
          canonical: { value: 54, unit: HEALTH_UNITS.BeatsPerMinute },
        })],
      }),
    ], [
      sampleChunk({
        id: 'suunto-heart-rate',
        provider: HEALTH_PROVIDERS.SuuntoApp,
        accountKey: 'suunto-one',
        metricId: HEALTH_METRIC_IDS.HeartRate,
        values: [68, 69, 70],
      }),
    ], {
      startDate: '2026-07-31',
      endDate: '2026-08-01',
      metricIds: [HEALTH_METRIC_IDS.HeartRate],
      includeSamples: true,
    }, { sourceRecordsComplete: true, samplesComplete: true });

    const rows = buildHealthPriorityRows(result);

    expect(rows.map(row => row.sourceLabel)).toEqual(['Suunto', 'Garmin']);
    expect(rows[0]).toMatchObject({ valueText: '70 bpm', observedAtMs: Date.parse('2026-08-01T00:02:00.000Z') });

    const trendSeries = selectHealthPriorityTrendSeries(result);
    expect(trendSeries.map(series => [series.sourceLabel, series.aggregation])).toEqual([
      ['Suunto', 'sample'],
      ['Garmin', 'average'],
    ]);
  });

  it('renders provider-specific Body Energy scores as bars without changing other series', () => {
    const result = projectLoadedHealthRange([], [
      sampleChunk({
        id: 'suunto-recovery-balance',
        provider: HEALTH_PROVIDERS.SuuntoApp,
        metricId: HEALTH_METRIC_IDS.BodyEnergy,
        semanticVariant: 'recovery_balance',
        values: [30, 60, 85],
      }),
      sampleChunk({
        id: 'garmin-body-energy',
        provider: HEALTH_PROVIDERS.GarminAPI,
        metricId: HEALTH_METRIC_IDS.BodyEnergy,
        semanticVariant: 'garmin_body_battery',
        values: [30, 60, 85],
      }),
    ], {
      startDate: '2026-08-01',
      endDate: '2026-08-01',
      metricIds: [HEALTH_METRIC_IDS.BodyEnergy],
      includeSamples: true,
    }, { sourceRecordsComplete: true, samplesComplete: true });

    const view = buildHealthMetricWorkspaceView(result);
    expect(view.series.find(series => series.provider === HEALTH_PROVIDERS.SuuntoApp)?.chartKind).toBe('bar');
    expect(view.series.find(series => series.provider === HEALTH_PROVIDERS.GarminAPI)?.chartKind).toBe('bar');
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

  it('suppresses workout Weight only for sources with a real Weight measurement', () => {
    const directWeight = sourceRecord({
      id: 'health-weight',
      provider: HEALTH_PROVIDERS.GarminAPI,
      accountKey: 'garmin-health-account',
      metrics: [valueEntry({
        metricId: HEALTH_METRIC_IDS.BodyWeight,
        semanticVariant: 'provider_weight_measurement',
        native: { metric: 'weight', value: 71, unit: 'kg' },
        canonical: { value: 71, unit: HEALTH_UNITS.Kilogram },
      })],
    });
    const result = projectLoadedHealthRange([directWeight], [], {
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      metricIds: [HEALTH_METRIC_IDS.BodyWeight],
    }, { sourceRecordsComplete: true, samplesComplete: true });
    const workout = activityObservation();
    const garminWorkout = activityObservation({
      id: 'garmin-workout-weight',
      provider: HEALTH_PROVIDERS.GarminAPI,
    });

    expect(selectActivityHealthObservations(
      HEALTH_METRIC_IDS.BodyWeight,
      result,
      [garminWorkout, workout],
    )).toEqual([workout]);

    const allSourcesView = buildHealthMetricWorkspaceView(
      result,
      [],
      selectActivityHealthObservations(HEALTH_METRIC_IDS.BodyWeight, result, [garminWorkout, workout]),
    );
    expect(allSourcesView.series.map(series => series.provider)).toEqual([
      HEALTH_PROVIDERS.COROSAPI,
      HEALTH_PROVIDERS.GarminAPI,
    ]);

    const corosOnly = filterHealthRangeResultByProviders(result, [HEALTH_PROVIDERS.COROSAPI]);
    const fallback = selectActivityHealthObservations(
      HEALTH_METRIC_IDS.BodyWeight,
      corosOnly,
      [workout],
      [HEALTH_PROVIDERS.COROSAPI],
    );
    expect(fallback).toEqual([workout]);
    const view = buildHealthMetricWorkspaceView(corosOnly, [], fallback);
    expect(view.series).toHaveLength(1);
    expect(view.series[0]).toMatchObject({
      provider: HEALTH_PROVIDERS.COROSAPI,
      semanticVariant: 'workout_profile_context',
      coverageText: '1 workout date · coverage not applicable',
      deviceLabel: null,
    });
    expect(view.rows[0].semanticsText).toContain('Workout profile context');
    expect(view.rows[0]).toMatchObject({
      deviceLabel: 'Not reported',
      coverageText: 'Not applicable',
      freshnessText: 'Last observed Aug 2, 2026',
    });
    expect(JSON.stringify(view)).not.toContain('opaque-workout-account');
  });

  it('treats future manual Weight as a real measurement that suppresses workout fallback', () => {
    const manualWeight = sourceRecord({
      id: 'manual-weight',
      provider: HEALTH_PROVIDERS.QuantifiedSelf,
      accountKey: 'manual-account',
      metrics: [valueEntry({
        metricId: HEALTH_METRIC_IDS.BodyWeight,
        semanticVariant: 'manual_measurement',
        origin: HEALTH_VALUE_ORIGINS.Recorded,
        recordingMethod: HEALTH_RECORDING_METHODS.Manual,
        native: { metric: 'weight', value: 70, unit: 'kg' },
        canonical: { value: 70, unit: HEALTH_UNITS.Kilogram },
      })],
    });
    const result = projectLoadedHealthRange([manualWeight], [], {
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      metricIds: [HEALTH_METRIC_IDS.BodyWeight],
    }, { sourceRecordsComplete: true, samplesComplete: true });

    expect(selectActivityHealthObservations(
      HEALTH_METRIC_IDS.BodyWeight,
      result,
      [activityObservation({ provider: HEALTH_PROVIDERS.GarminAPI })],
    )).toEqual([]);
  });

  it('keeps workout VO2 separate from provider Health and manual series by discipline and origin', () => {
    const providerVo2 = sourceRecord({
      id: 'provider-vo2',
      provider: HEALTH_PROVIDERS.GarminAPI,
      accountKey: 'provider-account',
      metrics: [valueEntry({
        metricId: HEALTH_METRIC_IDS.Vo2Max,
        semanticVariant: 'user_metrics_vo2_max',
        native: { metric: 'vo2Max', value: 52, unit: 'ml/kg/min' },
        canonical: { value: 52, unit: HEALTH_UNITS.MillilitersPerKilogramPerMinute },
      })],
    });
    const manualVo2 = sourceRecord({
      id: 'manual-vo2',
      provider: HEALTH_PROVIDERS.QuantifiedSelf,
      accountKey: 'manual-account',
      metrics: [valueEntry({
        metricId: HEALTH_METRIC_IDS.Vo2Max,
        semanticVariant: 'manual_measurement',
        origin: HEALTH_VALUE_ORIGINS.Recorded,
        recordingMethod: HEALTH_RECORDING_METHODS.Manual,
        native: { metric: 'vo2Max', value: 50, unit: 'ml/kg/min' },
        canonical: { value: 50, unit: HEALTH_UNITS.MillilitersPerKilogramPerMinute },
      })],
    });
    const result = projectLoadedHealthRange([providerVo2, manualVo2], [], {
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      metricIds: [HEALTH_METRIC_IDS.Vo2Max],
    }, { sourceRecordsComplete: true, samplesComplete: true });
    const workouts = [
      activityObservation({
        id: 'run-vo2',
        metricId: HEALTH_METRIC_IDS.Vo2Max,
        value: 51,
        unit: HEALTH_UNITS.MillilitersPerKilogramPerMinute,
        provider: HEALTH_PROVIDERS.GarminAPI,
        sourceKind: ACTIVITY_HEALTH_SOURCE_KINDS.WorkoutImported,
        discipline: 'running',
        semanticVariant: 'workout_imported_running',
      }),
      activityObservation({
        id: 'bike-vo2',
        metricId: HEALTH_METRIC_IDS.Vo2Max,
        value: 49,
        unit: HEALTH_UNITS.MillilitersPerKilogramPerMinute,
        provider: HEALTH_PROVIDERS.GarminAPI,
        sourceKind: ACTIVITY_HEALTH_SOURCE_KINDS.WorkoutImported,
        discipline: 'cycling',
        semanticVariant: 'workout_imported_cycling',
      }),
    ];

    const selected = selectActivityHealthObservations(HEALTH_METRIC_IDS.Vo2Max, result, workouts);
    const view = buildHealthMetricWorkspaceView(result, [], selected);
    expect(view.series).toHaveLength(4);
    expect(view.series.map(series => series.semanticVariant)).toEqual(expect.arrayContaining([
      'user_metrics_vo2_max',
      'manual_measurement',
      'workout_imported_running',
      'workout_imported_cycling',
    ]));
    expect(view.series.filter(series => series.semanticVariant.startsWith('workout_imported_')))
      .toHaveLength(2);
  });

  it('resolves Sleep references against the normalized Sleep model', () => {
    const session = sleepSession();
    expect(resolveSleepReferenceValue(session, 'durationSeconds')).toBe(28_800);
    expect(resolveSleepReferenceValue(session, 'vitals.restingHeartRateBpm')).toBe(51);
    expect(resolveSleepReferenceValue(session, 'vitals.averageHrvMs')).toBe(62);
    expect(resolveSleepReferenceValue(session, 'vitals.maxSpo2Percent')).toBeNull();
    expect(resolveSleepReferenceValue(
      sleepSession({ vitals: { averageHrvMs: null } }),
      'vitals.averageHrvMs',
    )).toBeNull();
  });

  it('projects unreferenced Sleep HRV as a source-separated Health series', () => {
    const result = projectLoadedHealthRange([], [], {
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      metricIds: [HEALTH_METRIC_IDS.HeartRateVariability],
    }, { sourceRecordsComplete: true, samplesComplete: true });

    const view = buildHealthMetricWorkspaceView(result, [sleepSession()]);

    expect(view.series).toHaveLength(1);
    expect(view.series[0]).toMatchObject({
      metricId: HEALTH_METRIC_IDS.HeartRateVariability,
      provider: HEALTH_PROVIDERS.GarminAPI,
      sourceLabel: 'Garmin',
      semanticVariant: 'sleep_session_average_hrv',
      semanticLabel: 'Average HRV · Sleep session · Provider summary · Provider calculated',
      unit: HEALTH_UNITS.Millisecond,
      nativeOnly: false,
    });
    expect(view.series[0].points).toEqual([expect.objectContaining({ value: 62, calendarDate: '2026-08-02' })]);
    expect(view.rows[0]).toMatchObject({
      valueText: '62 ms',
      semanticsText: 'Average HRV · Sleep session · Provider summary · Provider calculated',
      coverageText: 'Sleep session',
    });
    expect(JSON.stringify(view)).not.toContain('raw-provider-user');

    const miles = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
    const preferredUnitView = buildHealthMetricWorkspaceView(result, [sleepSession()], [], miles);
    expect(preferredUnitView.rows[0]?.valueText).toBe('62 ms');
  });

  it('keeps average and overnight Sleep HRV as distinct semantic series', () => {
    const result = projectLoadedHealthRange([], [], {
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      metricIds: [HEALTH_METRIC_IDS.HeartRateVariability],
    }, { sourceRecordsComplete: true, samplesComplete: true });
    const session = sleepSession({
      vitals: { averageHrvMs: 62, overnightHrvMs: 59 },
    });

    const view = buildHealthMetricWorkspaceView(result, [session]);

    expect(view.series).toHaveLength(2);
    expect(view.series.map(series => series.semanticVariant)).toEqual([
      'sleep_session_average_hrv',
      'sleep_overnight_hrv',
    ]);
    expect(view.series.map(series => series.points[0]?.value)).toEqual([62, 59]);
  });

  it('does not advertise or project nap-only HRV', () => {
    const nap = sleepSession({ isNap: true });
    const result = projectLoadedHealthRange([], [], {
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      metricIds: [HEALTH_METRIC_IDS.HeartRateVariability],
    }, { sourceRecordsComplete: true, samplesComplete: true });

    expect(sleepSessionHasHrv(nap)).toBe(false);
    expect(buildHealthMetricWorkspaceView(result, [nap]).series).toEqual([]);
  });

  it('does not classify provider Health sleep averages as Sleep-session HRV', () => {
    expect(isSleepHrvSemanticVariant('sleep_session_average_hrv')).toBe(true);
    expect(isSleepHrvSemanticVariant('sleep_overnight_hrv')).toBe(true);
    expect(isSleepHrvSemanticVariant('sleep_average')).toBe(false);
    expect(isSleepHrvSemanticVariant('sleep_window_deviation')).toBe(false);
  });

  it('keeps standalone and Sleep HRV separate without duplicating typed Sleep references', () => {
    const session = sleepSession();
    const standalone = sourceRecord({
      id: 'standalone-hrv',
      provider: HEALTH_PROVIDERS.COROSAPI,
      accountKey: 'coros-account',
      calendarDate: '2026-08-02',
      metrics: [valueEntry({
        metricId: HEALTH_METRIC_IDS.HeartRateVariability,
        semanticVariant: 'overnight_summary',
        native: { metric: 'hrv', value: 55, unit: 'ms' },
        canonical: { value: 55, unit: HEALTH_UNITS.Millisecond },
      })],
    });
    const query = {
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      metricIds: [HEALTH_METRIC_IDS.HeartRateVariability],
    };
    const standaloneResult = projectLoadedHealthRange([standalone], [], query, {
      sourceRecordsComplete: true,
      samplesComplete: true,
    });

    const separateView = buildHealthMetricWorkspaceView(standaloneResult, [session]);
    expect(separateView.series).toHaveLength(2);
    expect(separateView.series.map(series => series.semanticVariant)).toEqual(expect.arrayContaining([
      'overnight_summary',
      'sleep_session_average_hrv',
    ]));

    const reference = sourceRecord({
      id: 'sleep-hrv-reference',
      provider: HEALTH_PROVIDERS.GarminAPI,
      accountKey: 'garmin-account',
      calendarDate: '2026-08-02',
      metrics: [{
        kind: 'sleep_reference',
        metricId: HEALTH_METRIC_IDS.HeartRateVariability,
        valueType: HEALTH_VALUE_TYPES.Number,
        aggregation: 'average',
        semanticVariant: 'sleep_session_average_hrv',
        origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
        recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
        quality: { status: HEALTH_QUALITY_STATUSES.Valid },
        reference: {
          domain: 'sleep',
          documentId: 'sleep-one',
          field: 'vitals.averageHrvMs',
        },
      }],
    });
    const referenceResult = projectLoadedHealthRange([reference], [], query, {
      sourceRecordsComplete: true,
      samplesComplete: true,
    });

    const referencedView = buildHealthMetricWorkspaceView(referenceResult, [session]);
    expect(referencedView.series).toHaveLength(1);
    expect(referencedView.series[0].points).toHaveLength(1);
  });

  it('uses local account ordinals for Sleep priority rows and never exposes provider IDs', () => {
    const rows = buildSleepPriorityRows([
      sleepSession({
        stageDurationsSeconds: {
          deep: 7_200,
          light: 14_400,
          rem: 5_400,
          awake: 1_800,
        },
      }),
      sleepSession({
        id: 'sleep-two',
        source: {
          provider: SLEEP_PROVIDERS.GarminAPI,
          sourceSessionKey: 'other-secret',
          providerUserId: 'other-provider-user',
        },
        endTimeMs: Date.parse('2026-08-03T06:00:00.000Z'),
      }),
    ], null, Date.parse('2026-08-03T12:00:00.000Z'));
    expect(rows.map(row => row.sourceLabel)).toEqual(['Garmin account 2', 'Garmin account 1']);
    expect(rows[0]).toMatchObject({
      contextText: 'Today',
      details: [
        { label: 'Score', valueText: '88' },
        { label: 'HRV', valueText: '62 ms' },
      ],
    });
    expect(rows[1].sleepPoint).toMatchObject({
      deepSeconds: 7_200,
      lightSeconds: 14_400,
      remSeconds: 5_400,
      awakeSeconds: 1_800,
      providerLabel: 'Garmin',
    });
    expect(JSON.stringify(rows)).not.toContain('provider-user');
  });

  it('uses the explicit Sports Lib Sleep classes for Health workspace session rows', () => {
    const [row] = buildSleepObservationRows([sleepSession({
      vitals: { averageHrvMs: 62.4, averageHeartRateBpm: 51.6 },
    })]);

    expect(row).toMatchObject({
      durationText: '08h 00m',
      scoreText: '88',
      hrvText: '62.4 ms',
      heartRateText: '52 bpm',
    });
  });

  it('preserves explicitly missing Sleep metrics in priority details and observation rows', () => {
    const session = sleepSession({
      score: { value: null },
      vitals: {
        averageHrvMs: null,
        overnightHrvMs: null,
        averageHeartRateBpm: null,
      },
    });

    expect(buildSleepPriorityRows([session])[0]?.details).toEqual([]);
    expect(buildSleepObservationRows([session])[0]).toMatchObject({
      scoreText: '—',
      hrvText: '—',
      heartRateText: '—',
    });
  });
});
