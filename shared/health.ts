export const HEALTH_SCHEMA_VERSION = 1 as const;

export const HEALTH_SOURCE_RECORDS_COLLECTION_ID = 'healthSourceRecords';
export const HEALTH_SAMPLE_CHUNKS_COLLECTION_ID = 'healthSampleChunks';
export const HEALTH_SYNC_STATE_COLLECTION_ID = 'healthSyncState';

export const HEALTH_MAX_METRICS_PER_SOURCE_RECORD = 128;
export const HEALTH_MAX_SAMPLE_POINTS_PER_CHUNK = 1_440;
export const HEALTH_MAX_SAMPLE_CHUNKS_PER_SOURCE_RECORD = 200;
export const HEALTH_MAX_SOURCE_RECORD_DOCUMENT_BYTES = 256 * 1024;
export const HEALTH_MAX_SAMPLE_CHUNK_DOCUMENT_BYTES = 900 * 1024;
// A replacement can include both the incoming revision and deletion of the
// previous revision. Keep each side below half Firestore's 10 MiB request cap,
// leaving headroom for document names, index entries, and protocol overhead.
export const HEALTH_MAX_WRITE_BYTES = 4 * 1024 * 1024;
export const HEALTH_DEFAULT_SOURCE_RECORD_PAGE_SIZE = 32;
export const HEALTH_MAX_SOURCE_RECORD_PAGE_SIZE = 32;
export const HEALTH_DEFAULT_CHUNK_PAGE_SIZE = 8;
export const HEALTH_MAX_CHUNK_PAGE_SIZE = 8;
export const HEALTH_DEFAULT_SAMPLE_POINT_LIMIT = 10_000;
export const HEALTH_MAX_SAMPLE_POINT_LIMIT = HEALTH_MAX_CHUNK_PAGE_SIZE * HEALTH_MAX_SAMPLE_POINTS_PER_CHUNK;
export const HEALTH_MAX_QUERY_FETCH_BYTES = (HEALTH_MAX_SOURCE_RECORD_PAGE_SIZE + 1) * HEALTH_MAX_SOURCE_RECORD_DOCUMENT_BYTES
  + (HEALTH_MAX_CHUNK_PAGE_SIZE + 1) * HEALTH_MAX_SAMPLE_CHUNK_DOCUMENT_BYTES;
export const HEALTH_MAX_SUMMARY_RANGE_DAYS = 366;
export const HEALTH_MAX_SAMPLE_RANGE_DAYS = 31;

export const HEALTH_PROVIDERS = {
  GarminAPI: 'GarminAPI',
  SuuntoApp: 'SuuntoApp',
  COROSAPI: 'COROSAPI',
  WahooAPI: 'WahooAPI',
  QuantifiedSelf: 'QuantifiedSelf',
} as const;

export type HealthProvider = typeof HEALTH_PROVIDERS[keyof typeof HEALTH_PROVIDERS];

export const HEALTH_SOURCE_RECORD_KINDS = {
  DailySummary: 'daily_summary',
  IntervalSummary: 'interval_summary',
  PointMeasurement: 'point_measurement',
  ProfileSnapshot: 'profile_snapshot',
} as const;

export type HealthSourceRecordKind = typeof HEALTH_SOURCE_RECORD_KINDS[keyof typeof HEALTH_SOURCE_RECORD_KINDS];

export const HEALTH_VALUE_ORIGINS = {
  Recorded: 'recorded',
  ProviderSummary: 'provider_summary',
  QuantifiedSelfDerived: 'quantified_self_derived',
} as const;

export type HealthValueOrigin = typeof HEALTH_VALUE_ORIGINS[keyof typeof HEALTH_VALUE_ORIGINS];

export const HEALTH_RECORDING_METHODS = {
  Device: 'device',
  Manual: 'manual',
  ProviderCalculated: 'provider_calculated',
  QuantifiedSelfCalculated: 'quantified_self_calculated',
  Unknown: 'unknown',
} as const;

export type HealthRecordingMethod = typeof HEALTH_RECORDING_METHODS[keyof typeof HEALTH_RECORDING_METHODS];

export const HEALTH_NORMALIZATION_STATUSES = {
  Canonical: 'canonical',
  NativeOnly: 'native_only',
  NotComparable: 'not_comparable',
} as const;

export type HealthNormalizationStatus = typeof HEALTH_NORMALIZATION_STATUSES[keyof typeof HEALTH_NORMALIZATION_STATUSES];

export const HEALTH_QUALITY_STATUSES = {
  Valid: 'valid',
  Estimated: 'estimated',
  Partial: 'partial',
  Unknown: 'unknown',
} as const;

export type HealthQualityStatus = typeof HEALTH_QUALITY_STATUSES[keyof typeof HEALTH_QUALITY_STATUSES];

export const HEALTH_COVERAGE_STATUSES = {
  Complete: 'complete',
  Partial: 'partial',
  Unknown: 'unknown',
} as const;

export type HealthCoverageStatus = typeof HEALTH_COVERAGE_STATUSES[keyof typeof HEALTH_COVERAGE_STATUSES];

export const HEALTH_VALUE_TYPES = {
  Number: 'number',
  Category: 'category',
  Boolean: 'boolean',
} as const;

export type HealthValueType = typeof HEALTH_VALUE_TYPES[keyof typeof HEALTH_VALUE_TYPES];
export type HealthScalar = number | string | boolean;
export type HealthQualifierValue = string | number | boolean | null;

export const HEALTH_UNITS = {
  Count: 'count',
  Meter: 'm',
  Second: 's',
  Kilocalorie: 'kcal',
  BeatsPerMinute: 'bpm',
  Millisecond: 'ms',
  Percent: 'percent',
  BreathsPerMinute: 'brpm',
  Kilogram: 'kg',
  KilogramsPerSquareMeter: 'kg_per_m2',
  MillimetersMercury: 'mmHg',
  Celsius: 'celsius',
  MillilitersPerKilogramPerMinute: 'ml_per_kg_per_min',
  Years: 'years',
  Score: 'score',
  Category: 'category',
} as const;

export type HealthUnit = typeof HEALTH_UNITS[keyof typeof HEALTH_UNITS];

export const HEALTH_METRIC_IDS = {
  Steps: 'steps',
  WheelchairPushes: 'wheelchair_pushes',
  Distance: 'distance',
  WheelchairPushDistance: 'wheelchair_push_distance',
  FloorsClimbed: 'floors_climbed',
  ActiveDuration: 'active_duration',
  ModerateIntensityDuration: 'moderate_intensity_duration',
  VigorousIntensityDuration: 'vigorous_intensity_duration',
  Altitude: 'altitude',
  ActiveEnergy: 'active_energy',
  BasalEnergy: 'basal_energy',
  TotalEnergy: 'total_energy',
  HeartRate: 'heart_rate',
  RestingHeartRate: 'resting_heart_rate',
  HeartRateVariability: 'heart_rate_variability',
  BloodOxygenSaturation: 'blood_oxygen_saturation',
  RespirationRate: 'respiration_rate',
  StressLevel: 'stress_level',
  StressState: 'stress_state',
  StressDuration: 'stress_duration',
  BodyEnergy: 'body_energy',
  BodyEnergyChange: 'body_energy_change',
  RecoveryScore: 'recovery_score',
  BodyWeight: 'body_weight',
  BodyMassIndex: 'body_mass_index',
  BodyFat: 'body_fat',
  BodyWater: 'body_water',
  MuscleMass: 'muscle_mass',
  BoneMass: 'bone_mass',
  BloodPressureSystolic: 'blood_pressure_systolic',
  BloodPressureDiastolic: 'blood_pressure_diastolic',
  PulseRate: 'pulse_rate',
  SkinTemperatureDeviation: 'skin_temperature_deviation',
  Vo2Max: 'vo2_max',
  FitnessAge: 'fitness_age',
  SleepDuration: 'sleep_duration',
  SleepScore: 'sleep_score',
} as const;

export type HealthMetricId = typeof HEALTH_METRIC_IDS[keyof typeof HEALTH_METRIC_IDS];

export interface HealthMetricDefinition {
  id: HealthMetricId;
  label: string;
  category: 'movement' | 'energy' | 'cardiovascular' | 'wellness' | 'body' | 'fitness' | 'sleep';
  valueType: HealthValueType;
  canonicalUnit: HealthUnit;
}

function metric(
  id: HealthMetricId,
  label: string,
  category: HealthMetricDefinition['category'],
  canonicalUnit: HealthUnit,
  valueType: HealthValueType = HEALTH_VALUE_TYPES.Number,
): Readonly<HealthMetricDefinition> {
  return Object.freeze({ id, label, category, canonicalUnit, valueType });
}

export const HEALTH_METRIC_CATALOG: Readonly<Record<HealthMetricId, Readonly<HealthMetricDefinition>>> = Object.freeze({
  [HEALTH_METRIC_IDS.Steps]: metric(HEALTH_METRIC_IDS.Steps, 'Steps', 'movement', HEALTH_UNITS.Count),
  [HEALTH_METRIC_IDS.WheelchairPushes]: metric(HEALTH_METRIC_IDS.WheelchairPushes, 'Wheelchair pushes', 'movement', HEALTH_UNITS.Count),
  [HEALTH_METRIC_IDS.Distance]: metric(HEALTH_METRIC_IDS.Distance, 'Distance', 'movement', HEALTH_UNITS.Meter),
  [HEALTH_METRIC_IDS.WheelchairPushDistance]: metric(HEALTH_METRIC_IDS.WheelchairPushDistance, 'Wheelchair push distance', 'movement', HEALTH_UNITS.Meter),
  [HEALTH_METRIC_IDS.FloorsClimbed]: metric(HEALTH_METRIC_IDS.FloorsClimbed, 'Floors climbed', 'movement', HEALTH_UNITS.Count),
  [HEALTH_METRIC_IDS.ActiveDuration]: metric(HEALTH_METRIC_IDS.ActiveDuration, 'Active duration', 'movement', HEALTH_UNITS.Second),
  [HEALTH_METRIC_IDS.ModerateIntensityDuration]: metric(HEALTH_METRIC_IDS.ModerateIntensityDuration, 'Moderate intensity duration', 'movement', HEALTH_UNITS.Second),
  [HEALTH_METRIC_IDS.VigorousIntensityDuration]: metric(HEALTH_METRIC_IDS.VigorousIntensityDuration, 'Vigorous intensity duration', 'movement', HEALTH_UNITS.Second),
  [HEALTH_METRIC_IDS.Altitude]: metric(HEALTH_METRIC_IDS.Altitude, 'Altitude', 'movement', HEALTH_UNITS.Meter),
  [HEALTH_METRIC_IDS.ActiveEnergy]: metric(HEALTH_METRIC_IDS.ActiveEnergy, 'Active energy', 'energy', HEALTH_UNITS.Kilocalorie),
  [HEALTH_METRIC_IDS.BasalEnergy]: metric(HEALTH_METRIC_IDS.BasalEnergy, 'Basal energy', 'energy', HEALTH_UNITS.Kilocalorie),
  [HEALTH_METRIC_IDS.TotalEnergy]: metric(HEALTH_METRIC_IDS.TotalEnergy, 'Total energy', 'energy', HEALTH_UNITS.Kilocalorie),
  [HEALTH_METRIC_IDS.HeartRate]: metric(HEALTH_METRIC_IDS.HeartRate, 'Heart rate', 'cardiovascular', HEALTH_UNITS.BeatsPerMinute),
  [HEALTH_METRIC_IDS.RestingHeartRate]: metric(HEALTH_METRIC_IDS.RestingHeartRate, 'Resting heart rate', 'cardiovascular', HEALTH_UNITS.BeatsPerMinute),
  [HEALTH_METRIC_IDS.HeartRateVariability]: metric(HEALTH_METRIC_IDS.HeartRateVariability, 'Heart rate variability', 'cardiovascular', HEALTH_UNITS.Millisecond),
  [HEALTH_METRIC_IDS.BloodOxygenSaturation]: metric(HEALTH_METRIC_IDS.BloodOxygenSaturation, 'Blood oxygen saturation', 'cardiovascular', HEALTH_UNITS.Percent),
  [HEALTH_METRIC_IDS.RespirationRate]: metric(HEALTH_METRIC_IDS.RespirationRate, 'Respiration rate', 'cardiovascular', HEALTH_UNITS.BreathsPerMinute),
  [HEALTH_METRIC_IDS.StressLevel]: metric(HEALTH_METRIC_IDS.StressLevel, 'Stress level', 'wellness', HEALTH_UNITS.Score),
  [HEALTH_METRIC_IDS.StressState]: metric(HEALTH_METRIC_IDS.StressState, 'Stress state', 'wellness', HEALTH_UNITS.Category, HEALTH_VALUE_TYPES.Category),
  [HEALTH_METRIC_IDS.StressDuration]: metric(HEALTH_METRIC_IDS.StressDuration, 'Stress duration', 'wellness', HEALTH_UNITS.Second),
  [HEALTH_METRIC_IDS.BodyEnergy]: metric(HEALTH_METRIC_IDS.BodyEnergy, 'Body energy', 'wellness', HEALTH_UNITS.Percent),
  [HEALTH_METRIC_IDS.BodyEnergyChange]: metric(HEALTH_METRIC_IDS.BodyEnergyChange, 'Body energy change', 'wellness', HEALTH_UNITS.Percent),
  [HEALTH_METRIC_IDS.RecoveryScore]: metric(HEALTH_METRIC_IDS.RecoveryScore, 'Recovery score', 'wellness', HEALTH_UNITS.Score),
  [HEALTH_METRIC_IDS.BodyWeight]: metric(HEALTH_METRIC_IDS.BodyWeight, 'Body weight', 'body', HEALTH_UNITS.Kilogram),
  [HEALTH_METRIC_IDS.BodyMassIndex]: metric(HEALTH_METRIC_IDS.BodyMassIndex, 'Body mass index', 'body', HEALTH_UNITS.KilogramsPerSquareMeter),
  [HEALTH_METRIC_IDS.BodyFat]: metric(HEALTH_METRIC_IDS.BodyFat, 'Body fat', 'body', HEALTH_UNITS.Percent),
  [HEALTH_METRIC_IDS.BodyWater]: metric(HEALTH_METRIC_IDS.BodyWater, 'Body water', 'body', HEALTH_UNITS.Percent),
  [HEALTH_METRIC_IDS.MuscleMass]: metric(HEALTH_METRIC_IDS.MuscleMass, 'Muscle mass', 'body', HEALTH_UNITS.Kilogram),
  [HEALTH_METRIC_IDS.BoneMass]: metric(HEALTH_METRIC_IDS.BoneMass, 'Bone mass', 'body', HEALTH_UNITS.Kilogram),
  [HEALTH_METRIC_IDS.BloodPressureSystolic]: metric(HEALTH_METRIC_IDS.BloodPressureSystolic, 'Systolic blood pressure', 'cardiovascular', HEALTH_UNITS.MillimetersMercury),
  [HEALTH_METRIC_IDS.BloodPressureDiastolic]: metric(HEALTH_METRIC_IDS.BloodPressureDiastolic, 'Diastolic blood pressure', 'cardiovascular', HEALTH_UNITS.MillimetersMercury),
  [HEALTH_METRIC_IDS.PulseRate]: metric(HEALTH_METRIC_IDS.PulseRate, 'Pulse rate', 'cardiovascular', HEALTH_UNITS.BeatsPerMinute),
  [HEALTH_METRIC_IDS.SkinTemperatureDeviation]: metric(HEALTH_METRIC_IDS.SkinTemperatureDeviation, 'Skin temperature deviation', 'body', HEALTH_UNITS.Celsius),
  [HEALTH_METRIC_IDS.Vo2Max]: metric(HEALTH_METRIC_IDS.Vo2Max, 'VO2 max', 'fitness', HEALTH_UNITS.MillilitersPerKilogramPerMinute),
  [HEALTH_METRIC_IDS.FitnessAge]: metric(HEALTH_METRIC_IDS.FitnessAge, 'Fitness age', 'fitness', HEALTH_UNITS.Years),
  [HEALTH_METRIC_IDS.SleepDuration]: metric(HEALTH_METRIC_IDS.SleepDuration, 'Sleep duration', 'sleep', HEALTH_UNITS.Second),
  [HEALTH_METRIC_IDS.SleepScore]: metric(HEALTH_METRIC_IDS.SleepScore, 'Sleep score', 'sleep', HEALTH_UNITS.Score),
});

export interface HealthDeviceAttribution {
  deviceKey?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  displayName?: string | null;
}

export interface HealthQuality {
  status: HealthQualityStatus;
  nativeCode?: string | null;
}

export interface HealthCoverage {
  status: HealthCoverageStatus;
  expectedStartTimeMs?: number | null;
  expectedEndTimeMs?: number | null;
  observedDurationSeconds?: number | null;
  expectedDurationSeconds?: number | null;
  sampleCount?: number | null;
  expectedSampleCount?: number | null;
  expectedUpdateIntervalMs?: number | null;
}

export interface HealthNativeValue {
  metric: string;
  value: HealthScalar;
  unit?: string | null;
  qualifiers?: Record<string, HealthQualifierValue> | null;
}

export interface HealthCanonicalValue {
  value: HealthScalar;
  unit: HealthUnit;
}

export interface HealthMetricGoal {
  native?: HealthNativeValue | null;
  canonical?: HealthCanonicalValue | null;
}

export interface HealthMetricBase {
  metricId: HealthMetricId;
  valueType: HealthValueType;
  aggregation: string;
  semanticVariant: string;
  origin: HealthValueOrigin;
  recordingMethod: HealthRecordingMethod;
  quality: HealthQuality;
  coverage?: HealthCoverage | null;
  device?: HealthDeviceAttribution | null;
}

export interface HealthMetricValue extends HealthMetricBase {
  kind: 'value';
  normalizationStatus: HealthNormalizationStatus;
  native: HealthNativeValue;
  canonical?: HealthCanonicalValue | null;
  goal?: HealthMetricGoal | null;
}

export const HEALTH_SLEEP_REFERENCE_FIELDS = {
  DurationSeconds: 'durationSeconds',
  Score: 'score.value',
  AverageHeartRate: 'vitals.averageHeartRateBpm',
  MinimumHeartRate: 'vitals.minimumHeartRateBpm',
  RestingHeartRate: 'vitals.restingHeartRateBpm',
  AverageHrv: 'vitals.averageHrvMs',
  OvernightHrv: 'vitals.overnightHrvMs',
  MaximumSpo2: 'vitals.maxSpo2Percent',
  AverageRespiration: 'vitals.averageRespirationBrpm',
} as const;

export type HealthSleepReferenceField = typeof HEALTH_SLEEP_REFERENCE_FIELDS[keyof typeof HEALTH_SLEEP_REFERENCE_FIELDS];

export const HEALTH_SLEEP_REFERENCE_METRIC_IDS: Readonly<Record<HealthSleepReferenceField, readonly HealthMetricId[]>> = Object.freeze({
  [HEALTH_SLEEP_REFERENCE_FIELDS.DurationSeconds]: Object.freeze([HEALTH_METRIC_IDS.SleepDuration]),
  [HEALTH_SLEEP_REFERENCE_FIELDS.Score]: Object.freeze([HEALTH_METRIC_IDS.SleepScore]),
  [HEALTH_SLEEP_REFERENCE_FIELDS.AverageHeartRate]: Object.freeze([HEALTH_METRIC_IDS.HeartRate]),
  [HEALTH_SLEEP_REFERENCE_FIELDS.MinimumHeartRate]: Object.freeze([HEALTH_METRIC_IDS.HeartRate]),
  [HEALTH_SLEEP_REFERENCE_FIELDS.RestingHeartRate]: Object.freeze([HEALTH_METRIC_IDS.RestingHeartRate]),
  [HEALTH_SLEEP_REFERENCE_FIELDS.AverageHrv]: Object.freeze([HEALTH_METRIC_IDS.HeartRateVariability]),
  [HEALTH_SLEEP_REFERENCE_FIELDS.OvernightHrv]: Object.freeze([HEALTH_METRIC_IDS.HeartRateVariability]),
  [HEALTH_SLEEP_REFERENCE_FIELDS.MaximumSpo2]: Object.freeze([HEALTH_METRIC_IDS.BloodOxygenSaturation]),
  [HEALTH_SLEEP_REFERENCE_FIELDS.AverageRespiration]: Object.freeze([HEALTH_METRIC_IDS.RespirationRate]),
});

export interface HealthSleepMetricReference extends HealthMetricBase {
  kind: 'sleep_reference';
  reference: {
    domain: 'sleep';
    documentId: string;
    field: HealthSleepReferenceField;
  };
}

export type HealthMetricEntry = HealthMetricValue | HealthSleepMetricReference;

export interface HealthSourceRecordRevision {
  order: number;
  /** Source-record-scoped opaque hash of the adapter's revision token. */
  token: string;
  digest: string;
}

export interface HealthSourceMetadata {
  provider: HealthProvider;
  accountKey: string;
  sourceRecordType: string;
  /** Account-scoped opaque hash of the adapter's source-record key. */
  sourceRecordKey: string;
  revision: HealthSourceRecordRevision;
  receivedAtMs: number;
}

export interface HealthSourceRecord {
  schemaVersion: typeof HEALTH_SCHEMA_VERSION;
  id: string;
  userID: string;
  kind: HealthSourceRecordKind;
  source: HealthSourceMetadata;
  calendarDate: string;
  startTimeMs: number;
  endTimeMs: number;
  timezoneOffsetSeconds?: number | null;
  metrics: HealthMetricEntry[];
  metricIds: HealthMetricId[];
  coverage: HealthCoverage;
  device?: HealthDeviceAttribution | null;
  sampleChunkIds: string[];
  createdAtMs: number;
  updatedAtMs: number;
}

export interface HealthSampleChunk {
  schemaVersion: typeof HEALTH_SCHEMA_VERSION;
  id: string;
  userID: string;
  parentSourceRecordId: string;
  provider: HealthProvider;
  accountKey: string;
  metricId: HealthMetricId;
  valueType: HealthValueType;
  aggregation: string;
  semanticVariant: string;
  origin: HealthValueOrigin;
  recordingMethod: HealthRecordingMethod;
  normalizationStatus: HealthNormalizationStatus;
  nativeMetric: string;
  nativeUnit?: string | null;
  canonicalUnit?: HealthUnit | null;
  calendarDate: string;
  startTimeMs: number;
  endTimeMs: number;
  receivedAtMs: number;
  timezoneOffsetSeconds?: number | null;
  seriesKey: string;
  chunkIndex: number;
  offsetMs: number[];
  nativeValues: HealthScalar[];
  canonicalValues?: HealthScalar[] | null;
  qualityCodes?: string[] | null;
  coverage: HealthCoverage;
  device?: HealthDeviceAttribution | null;
  revision: HealthSourceRecordRevision;
  createdAtMs: number;
  updatedAtMs: number;
}

export const HEALTH_SYNC_STATUSES = {
  Ready: 'ready',
  PermissionMissing: 'permission_missing',
  ReconnectRequired: 'reconnect_required',
  Failed: 'failed',
  Unsupported: 'unsupported',
  Disconnected: 'disconnected',
} as const;

export type HealthSyncStatus = typeof HEALTH_SYNC_STATUSES[keyof typeof HEALTH_SYNC_STATUSES];

export interface HealthSyncState {
  provider: HealthProvider;
  status: HealthSyncStatus;
  lastWebhookAtMs?: number | null;
  lastPollAtMs?: number | null;
  lastSyncedAtMs?: number | null;
  lastObservedAtMs?: number | null;
  lastErrorCode?: string | null;
  updatedAtMs: number;
}

export interface HealthQueryCursor {
  calendarDate: string;
  id: string;
}

export interface HealthRangeQuery {
  startDate: string;
  endDate: string;
  providers?: HealthProvider[];
  metricIds?: HealthMetricId[];
  includeSamples?: boolean;
  sourceRecordLimit?: number;
  chunkLimit?: number;
  samplePointLimit?: number;
  sourceRecordCursor?: HealthQueryCursor | null;
  chunkCursor?: HealthQueryCursor | null;
}

export interface NormalizedHealthRangeQuery extends HealthRangeQuery {
  providers: HealthProvider[];
  metricIds: HealthMetricId[];
  includeSamples: boolean;
  sourceRecordLimit: number;
  chunkLimit: number;
  samplePointLimit: number;
  sourceRecordCursor: HealthQueryCursor | null;
  chunkCursor: HealthQueryCursor | null;
}

export interface HealthObservation {
  id: string;
  sourceRecordId: string;
  provider: HealthProvider;
  accountKey: string;
  calendarDate: string;
  startTimeMs: number;
  endTimeMs: number;
  timezoneOffsetSeconds?: number | null;
  sourceRecordType: string;
  /** Account-scoped opaque hash; never the raw adapter source-record key. */
  sourceRecordKey: string;
  receivedAtMs: number;
  coverage: HealthCoverage;
  device: HealthDeviceAttribution | null;
  entry: HealthMetricEntry;
}

export interface HealthDailySummary {
  calendarDate: string;
  observationIds: string[];
  providers: HealthProvider[];
  sleepReferenceIds: string[];
}

export interface HealthMetricDiscovery {
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

export interface HealthMetricCoverageResult {
  metricId: HealthMetricId;
  provider: HealthProvider;
  accountKey: string;
  aggregation: string;
  semanticVariant: string;
  origin: HealthValueOrigin;
  recordingMethod: HealthRecordingMethod;
  requestedDays: number;
  recordedDays: number;
  missingDays: number;
  partialDays: number;
  unknownDays: number;
  latestDate: string;
}

export interface HealthFreshnessResult {
  metricId: HealthMetricId;
  provider: HealthProvider;
  accountKey: string;
  aggregation: string;
  semanticVariant: string;
  origin: HealthValueOrigin;
  recordingMethod: HealthRecordingMethod;
  lastObservedAtMs: number;
  lastReceivedAtMs: number;
  ageMs: number;
  staleAfterMs: number | null;
  status: 'fresh' | 'stale' | 'unknown';
}

export interface HealthConflict {
  metricId: HealthMetricId;
  calendarDate: string;
  aggregation: string;
  semanticVariant: string;
  origin: HealthValueOrigin;
  canonicalUnit: HealthUnit;
  observationIds: string[];
  providers: HealthProvider[];
  sources: Array<{
    provider: HealthProvider;
    accountKey: string;
  }>;
  recordingMethods: HealthRecordingMethod[];
}

export interface HealthRangePageInfo {
  sourceRecordsTruncated: boolean;
  samplesTruncated: boolean;
  sampleRevisionMismatchCount: number;
  sourceRecordAggregateComplete: boolean;
  sampleAggregateComplete: boolean;
  sourceRecordCursor: HealthQueryCursor | null;
  chunkCursor: HealthQueryCursor | null;
  returnedSamplePoints: number;
}

export interface HealthRangeResult {
  query: NormalizedHealthRangeQuery;
  observations: HealthObservation[];
  sampleChunks: HealthSampleChunk[];
  dailySummaries: HealthDailySummary[];
  discovery: HealthMetricDiscovery[];
  coverage: HealthMetricCoverageResult[];
  freshness: HealthFreshnessResult[];
  conflicts: HealthConflict[];
  pageInfo: HealthRangePageInfo;
}

export function isHealthProvider(value: unknown): value is HealthProvider {
  return typeof value === 'string' && Object.values(HEALTH_PROVIDERS).includes(value as HealthProvider);
}

export function isHealthMetricId(value: unknown): value is HealthMetricId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(HEALTH_METRIC_CATALOG, value);
}

export function getHealthMetricDefinition(metricId: HealthMetricId): Readonly<HealthMetricDefinition> {
  return HEALTH_METRIC_CATALOG[metricId];
}
