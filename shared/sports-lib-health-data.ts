import {
  DataActiveDuration,
  DataActiveEnergy,
  DataAltitude,
  DataBasalEnergy,
  DataBloodOxygenSaturation,
  DataBloodPressureDiastolic,
  DataBloodPressureSystolic,
  DataBodyEnergy,
  DataBodyEnergyChange,
  DataBodyFat,
  DataBodyMassIndex,
  DataBodyWater,
  DataBoneMass,
  DataDistance,
  DataFitnessAge,
  DataFloorsClimbed,
  DataHeartRate,
  DataHeartRateVariability,
  DataModerateIntensityDuration,
  DataMuscleMass,
  DataPulseRate,
  DataRecoveryScore,
  DataRespirationRate,
  DataRestingHeartRate,
  DataSkinTemperatureDeviation,
  DataSleepAwakeDuration,
  DataSleepBloodOxygenSaturationMax,
  DataSleepDeepDuration,
  DataSleepDuration,
  DataSleepHeartRateAvg,
  DataSleepHeartRateMin,
  DataSleepHRVAvg,
  DataSleepHRVOvernight,
  DataSleepHRVSampleCount,
  DataSleepInBedDuration,
  DataSleepLightDuration,
  DataSleepRemDuration,
  DataSleepRespirationRateAvg,
  DataSleepRestingHeartRate,
  DataSleepScore,
  DataSleepUnknownDuration,
  DataSleepUnmeasurableDuration,
  DataSteps,
  DataStressDuration,
  DataStressLevel,
  DataStressState,
  DataTotalEnergy,
  DataVigorousIntensityDuration,
  DataVO2Max,
  DataWeight,
  DataWheelchairPushDistance,
  DataWheelchairPushes,
  type DataJSONInterface,
} from '@sports-alliance/sports-lib';
import {
  HEALTH_METRIC_CATALOG,
  HEALTH_METRIC_IDS,
  HEALTH_NORMALIZATION_STATUSES,
  isHealthMetricId,
  type HealthMetricEntry,
  type HealthMetricId,
  type HealthMetricValue,
  type HealthScalar,
  type HealthSourceRecord,
} from './health';
import {
  SLEEP_SPORTS_LIB_METRIC_FIELDS,
  SLEEP_STAGES,
  type SleepSession,
  type SleepSportsLibMetricField,
} from './sleep';
import {
  SPORTS_LIB_DATA_SCHEMA_VERSION,
  type SportsLibDataEnvelope,
} from './sports-lib-data';

interface SportsLibScalarData {
  getValue(): unknown;
  getDisplayUnit(): unknown;
  getDisplayValue(): unknown;
  toJSON(): DataJSONInterface;
}

interface SportsLibScalarDataClass {
  readonly type: string;
  readonly unit: string;
  new(value: never): SportsLibScalarData;
  fromJSON(json: DataJSONInterface): SportsLibScalarData;
}

function scalarDataClass(value: unknown): SportsLibScalarDataClass {
  return value as SportsLibScalarDataClass;
}

const HEALTH_SPORTS_LIB_CLASSES = {
  [HEALTH_METRIC_IDS.Steps]: scalarDataClass(DataSteps),
  [HEALTH_METRIC_IDS.WheelchairPushes]: scalarDataClass(DataWheelchairPushes),
  [HEALTH_METRIC_IDS.Distance]: scalarDataClass(DataDistance),
  [HEALTH_METRIC_IDS.WheelchairPushDistance]: scalarDataClass(DataWheelchairPushDistance),
  [HEALTH_METRIC_IDS.FloorsClimbed]: scalarDataClass(DataFloorsClimbed),
  [HEALTH_METRIC_IDS.ActiveDuration]: scalarDataClass(DataActiveDuration),
  [HEALTH_METRIC_IDS.ModerateIntensityDuration]: scalarDataClass(DataModerateIntensityDuration),
  [HEALTH_METRIC_IDS.VigorousIntensityDuration]: scalarDataClass(DataVigorousIntensityDuration),
  [HEALTH_METRIC_IDS.Altitude]: scalarDataClass(DataAltitude),
  [HEALTH_METRIC_IDS.ActiveEnergy]: scalarDataClass(DataActiveEnergy),
  [HEALTH_METRIC_IDS.BasalEnergy]: scalarDataClass(DataBasalEnergy),
  [HEALTH_METRIC_IDS.TotalEnergy]: scalarDataClass(DataTotalEnergy),
  [HEALTH_METRIC_IDS.HeartRate]: scalarDataClass(DataHeartRate),
  [HEALTH_METRIC_IDS.RestingHeartRate]: scalarDataClass(DataRestingHeartRate),
  [HEALTH_METRIC_IDS.HeartRateVariability]: scalarDataClass(DataHeartRateVariability),
  [HEALTH_METRIC_IDS.BloodOxygenSaturation]: scalarDataClass(DataBloodOxygenSaturation),
  [HEALTH_METRIC_IDS.RespirationRate]: scalarDataClass(DataRespirationRate),
  [HEALTH_METRIC_IDS.StressLevel]: scalarDataClass(DataStressLevel),
  [HEALTH_METRIC_IDS.StressState]: scalarDataClass(DataStressState),
  [HEALTH_METRIC_IDS.StressDuration]: scalarDataClass(DataStressDuration),
  [HEALTH_METRIC_IDS.BodyEnergy]: scalarDataClass(DataBodyEnergy),
  [HEALTH_METRIC_IDS.BodyEnergyChange]: scalarDataClass(DataBodyEnergyChange),
  [HEALTH_METRIC_IDS.RecoveryScore]: scalarDataClass(DataRecoveryScore),
  [HEALTH_METRIC_IDS.BodyWeight]: scalarDataClass(DataWeight),
  [HEALTH_METRIC_IDS.BodyMassIndex]: scalarDataClass(DataBodyMassIndex),
  [HEALTH_METRIC_IDS.BodyFat]: scalarDataClass(DataBodyFat),
  [HEALTH_METRIC_IDS.BodyWater]: scalarDataClass(DataBodyWater),
  [HEALTH_METRIC_IDS.MuscleMass]: scalarDataClass(DataMuscleMass),
  [HEALTH_METRIC_IDS.BoneMass]: scalarDataClass(DataBoneMass),
  [HEALTH_METRIC_IDS.BloodPressureSystolic]: scalarDataClass(DataBloodPressureSystolic),
  [HEALTH_METRIC_IDS.BloodPressureDiastolic]: scalarDataClass(DataBloodPressureDiastolic),
  [HEALTH_METRIC_IDS.PulseRate]: scalarDataClass(DataPulseRate),
  [HEALTH_METRIC_IDS.SkinTemperatureDeviation]: scalarDataClass(DataSkinTemperatureDeviation),
  [HEALTH_METRIC_IDS.Vo2Max]: scalarDataClass(DataVO2Max),
  [HEALTH_METRIC_IDS.FitnessAge]: scalarDataClass(DataFitnessAge),
  [HEALTH_METRIC_IDS.SleepDuration]: scalarDataClass(DataSleepDuration),
  [HEALTH_METRIC_IDS.SleepScore]: scalarDataClass(DataSleepScore),
} satisfies Record<HealthMetricId, SportsLibScalarDataClass>;

const SLEEP_SPORTS_LIB_CLASSES = {
  [SLEEP_SPORTS_LIB_METRIC_FIELDS.Duration]: scalarDataClass(DataSleepDuration),
  [SLEEP_SPORTS_LIB_METRIC_FIELDS.InBedDuration]: scalarDataClass(DataSleepInBedDuration),
  [SLEEP_SPORTS_LIB_METRIC_FIELDS.DeepDuration]: scalarDataClass(DataSleepDeepDuration),
  [SLEEP_SPORTS_LIB_METRIC_FIELDS.LightDuration]: scalarDataClass(DataSleepLightDuration),
  [SLEEP_SPORTS_LIB_METRIC_FIELDS.RemDuration]: scalarDataClass(DataSleepRemDuration),
  [SLEEP_SPORTS_LIB_METRIC_FIELDS.AwakeDuration]: scalarDataClass(DataSleepAwakeDuration),
  [SLEEP_SPORTS_LIB_METRIC_FIELDS.UnmeasurableDuration]: scalarDataClass(DataSleepUnmeasurableDuration),
  [SLEEP_SPORTS_LIB_METRIC_FIELDS.UnknownDuration]: scalarDataClass(DataSleepUnknownDuration),
  [SLEEP_SPORTS_LIB_METRIC_FIELDS.Score]: scalarDataClass(DataSleepScore),
  [SLEEP_SPORTS_LIB_METRIC_FIELDS.AverageHeartRate]: scalarDataClass(DataSleepHeartRateAvg),
  [SLEEP_SPORTS_LIB_METRIC_FIELDS.MinimumHeartRate]: scalarDataClass(DataSleepHeartRateMin),
  [SLEEP_SPORTS_LIB_METRIC_FIELDS.RestingHeartRate]: scalarDataClass(DataSleepRestingHeartRate),
  [SLEEP_SPORTS_LIB_METRIC_FIELDS.AverageHrv]: scalarDataClass(DataSleepHRVAvg),
  [SLEEP_SPORTS_LIB_METRIC_FIELDS.OvernightHrv]: scalarDataClass(DataSleepHRVOvernight),
  [SLEEP_SPORTS_LIB_METRIC_FIELDS.HrvSampleCount]: scalarDataClass(DataSleepHRVSampleCount),
  [SLEEP_SPORTS_LIB_METRIC_FIELDS.MaximumSpo2]: scalarDataClass(DataSleepBloodOxygenSaturationMax),
  [SLEEP_SPORTS_LIB_METRIC_FIELDS.AverageRespiration]: scalarDataClass(DataSleepRespirationRateAvg),
} satisfies Record<SleepSportsLibMetricField, SportsLibScalarDataClass>;

const HEALTH_ENVELOPE_KEYS = new Set(['value', 'goal']);
const SLEEP_ENVELOPE_KEYS = new Set(Object.values(SLEEP_SPORTS_LIB_METRIC_FIELDS));

export class SportsLibDataValidationError extends Error {
  public readonly name = 'SportsLibDataValidationError';
  public readonly code = 'invalid_sports_lib_data';

  constructor(message: string) {
    super(message);
  }
}

export interface HealthMetricSportsLibDisplay {
  value: string;
  unit: string;
}

/**
 * Formats a canonical Health metric with the same Sports Lib data class used
 * for its persisted representation. Provider-native values deliberately do
 * not pass through this function because their units are provider-specific.
 */
export function formatCanonicalHealthMetricSportsLibValue(
  metricId: HealthMetricId,
  value: HealthScalar,
): HealthMetricSportsLibDisplay | null {
  const dataClass = HEALTH_SPORTS_LIB_CLASSES[metricId];
  try {
    const data = new dataClass(value as never);
    const displayValue = data.getDisplayValue();
    const displayUnit = data.getDisplayUnit();
    if ((typeof displayValue !== 'string' && typeof displayValue !== 'number')
      || (typeof displayUnit !== 'string' && typeof displayUnit !== 'number')) {
      return null;
    }
    return { value: `${displayValue}`, unit: `${displayUnit}` };
  } catch {
    return null;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], context: string): void {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new SportsLibDataValidationError(`${context} has unknown or missing fields.`);
  }
}

function isScalar(value: unknown): value is HealthScalar {
  return (typeof value === 'number' && Number.isFinite(value))
    || typeof value === 'string'
    || typeof value === 'boolean';
}

function scalarsEqual(left: unknown, right: unknown): boolean {
  return typeof left === typeof right && left === right;
}

function decodeScalarJson(
  dataClass: SportsLibScalarDataClass,
  value: unknown,
  context: string,
): HealthScalar {
  if (!isPlainRecord(value)) {
    throw new SportsLibDataValidationError(`${context} must be canonical Sports Lib JSON.`);
  }
  assertExactKeys(value, [dataClass.type], context);
  const scalar = value[dataClass.type];
  if (!isScalar(scalar)) {
    throw new SportsLibDataValidationError(`${context} must contain a finite scalar.`);
  }

  try {
    const instance = dataClass.fromJSON(value as DataJSONInterface);
    const decoded = instance.getValue();
    if (!isScalar(decoded) || !scalarsEqual(decoded, scalar)) {
      throw new Error('Sports Lib scalar did not round-trip exactly.');
    }
    const roundTripJson = instance.toJSON() as Record<string, unknown>;
    if (!isPlainRecord(roundTripJson)
      || Object.keys(roundTripJson).length !== 1
      || !scalarsEqual(roundTripJson[dataClass.type], scalar)) {
      throw new Error('Sports Lib JSON did not round-trip exactly.');
    }
    return decoded;
  } catch {
    throw new SportsLibDataValidationError(`${context} failed strict Sports Lib rehydration.`);
  }
}

function encodeScalarJson(
  dataClass: SportsLibScalarDataClass,
  value: unknown,
  context: string,
): DataJSONInterface {
  if (!isScalar(value)) {
    throw new SportsLibDataValidationError(`${context} must be a finite scalar.`);
  }
  try {
    const json = new dataClass(value as never).toJSON();
    const decoded = decodeScalarJson(dataClass, json, context);
    if (!scalarsEqual(decoded, value)) {
      throw new Error('Sports Lib scalar changed during serialization.');
    }
    return json;
  } catch (error) {
    if (error instanceof SportsLibDataValidationError) throw error;
    throw new SportsLibDataValidationError(`${context} failed Sports Lib serialization.`);
  }
}

function decodeEnvelope<TKey extends string>(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  classes: Readonly<Record<TKey, SportsLibScalarDataClass>>,
  context: string,
): Partial<Record<TKey, HealthScalar>> {
  if (!isPlainRecord(value)) {
    throw new SportsLibDataValidationError(`${context} must be a versioned object.`);
  }
  assertExactKeys(value, ['schemaVersion', 'metrics'], context);
  if (value.schemaVersion !== SPORTS_LIB_DATA_SCHEMA_VERSION) {
    throw new SportsLibDataValidationError(`${context} has an unsupported schema version.`);
  }
  if (!isPlainRecord(value.metrics)) {
    throw new SportsLibDataValidationError(`${context}.metrics must be an object.`);
  }
  const metrics = value.metrics;
  const metricKeys = Object.keys(metrics);
  if (metricKeys.length === 0 || metricKeys.some(key => !allowedKeys.has(key))) {
    throw new SportsLibDataValidationError(`${context}.metrics contains no known metrics or an unknown metric.`);
  }

  return metricKeys.reduce<Partial<Record<TKey, HealthScalar>>>((decoded, key) => {
    const typedKey = key as TKey;
    decoded[typedKey] = decodeScalarJson(classes[typedKey], metrics[key], `${context}.${key}`);
    return decoded;
  }, {});
}

function assertLegacyScalar(
  legacyValue: unknown,
  decodedValue: HealthScalar,
  context: string,
): void {
  if (legacyValue !== undefined && legacyValue !== null && !scalarsEqual(legacyValue, decodedValue)) {
    throw new SportsLibDataValidationError(`${context} conflicts with its legacy scalar.`);
  }
}

export function encodeHealthMetricSportsLibData(entry: HealthMetricEntry): HealthMetricEntry {
  if (entry.kind !== 'value' || !entry.canonical) return entry;
  const definition = HEALTH_METRIC_CATALOG[entry.metricId];
  if (entry.normalizationStatus !== HEALTH_NORMALIZATION_STATUSES.Canonical
    || entry.valueType !== definition.valueType) {
    throw new SportsLibDataValidationError(`Health metric ${entry.metricId} has conflicting canonical semantics.`);
  }
  if (entry.canonical.unit !== definition.canonicalUnit) {
    throw new SportsLibDataValidationError(`Health metric ${entry.metricId} has a non-canonical unit.`);
  }
  const dataClass = HEALTH_SPORTS_LIB_CLASSES[entry.metricId];
  const metrics: SportsLibDataEnvelope<'value' | 'goal'>['metrics'] = {
    value: encodeScalarJson(dataClass, entry.canonical.value, `Health metric ${entry.metricId}.value`),
  };
  if (entry.goal?.canonical) {
    if (entry.goal.canonical.unit !== definition.canonicalUnit) {
      throw new SportsLibDataValidationError(`Health metric ${entry.metricId} goal has a non-canonical unit.`);
    }
    metrics.goal = encodeScalarJson(
      dataClass,
      entry.goal.canonical.value,
      `Health metric ${entry.metricId}.goal`,
    );
  }
  return {
    ...entry,
    sportsLibData: {
      schemaVersion: SPORTS_LIB_DATA_SCHEMA_VERSION,
      metrics,
    },
  };
}

export function decodeHealthMetricSportsLibData(entry: HealthMetricEntry): HealthMetricEntry {
  if (!isHealthMetricId(entry.metricId)) {
    throw new SportsLibDataValidationError('A Health metric has an unknown canonical identity.');
  }
  if (entry.kind !== 'value' && entry.kind !== 'sleep_reference') {
    throw new SportsLibDataValidationError('A Health metric has an unknown entry kind.');
  }
  if (entry.kind === 'sleep_reference') {
    if (Object.prototype.hasOwnProperty.call(entry, 'sportsLibData')) {
      throw new SportsLibDataValidationError('A Health sleep reference cannot contain Sports Lib scalar JSON.');
    }
    return entry;
  }
  if (entry.sportsLibData === undefined) return entry;
  const dataClass = HEALTH_SPORTS_LIB_CLASSES[entry.metricId];
  const definition = HEALTH_METRIC_CATALOG[entry.metricId];
  if (entry.normalizationStatus !== HEALTH_NORMALIZATION_STATUSES.Canonical
    || entry.valueType !== definition.valueType) {
    throw new SportsLibDataValidationError(`Health metric ${entry.metricId} has conflicting canonical semantics.`);
  }
  const decoded = decodeEnvelope(
    entry.sportsLibData,
    HEALTH_ENVELOPE_KEYS,
    { value: dataClass, goal: dataClass },
    `Health metric ${entry.metricId}.sportsLibData`,
  );
  if (decoded.value === undefined) {
    throw new SportsLibDataValidationError(`Health metric ${entry.metricId} is missing its canonical value.`);
  }
  if (entry.goal?.canonical && decoded.goal === undefined) {
    throw new SportsLibDataValidationError(`Health metric ${entry.metricId} is missing its canonical goal.`);
  }
  assertLegacyScalar(entry.canonical?.value, decoded.value, `Health metric ${entry.metricId}.value`);
  if (entry.canonical && entry.canonical.unit !== definition.canonicalUnit) {
    throw new SportsLibDataValidationError(`Health metric ${entry.metricId} has a conflicting legacy unit.`);
  }

  let goal = entry.goal;
  if (decoded.goal !== undefined) {
    assertLegacyScalar(entry.goal?.canonical?.value, decoded.goal, `Health metric ${entry.metricId}.goal`);
    if (entry.goal?.canonical && entry.goal.canonical.unit !== definition.canonicalUnit) {
      throw new SportsLibDataValidationError(`Health metric ${entry.metricId} goal has a conflicting legacy unit.`);
    }
    goal = {
      ...entry.goal,
      canonical: { value: decoded.goal, unit: definition.canonicalUnit },
    };
  }

  const decodedEntry: HealthMetricValue = {
    ...entry,
    canonical: { value: decoded.value, unit: definition.canonicalUnit },
    goal,
  };
  delete decodedEntry.sportsLibData;
  return decodedEntry;
}

export function encodeHealthSourceRecordSportsLibData(record: HealthSourceRecord): HealthSourceRecord {
  return {
    ...record,
    metrics: record.metrics.map(encodeHealthMetricSportsLibData),
  };
}

export function decodeHealthSourceRecordSportsLibData(record: HealthSourceRecord): HealthSourceRecord {
  return {
    ...record,
    metrics: record.metrics.map(decodeHealthMetricSportsLibData),
  };
}

type SleepMetricCarrier = Pick<
  SleepSession,
  'durationSeconds' | 'inBedDurationSeconds' | 'stageDurationsSeconds' | 'score' | 'vitals' | 'sportsLibData'
>;

function setSleepMetric(
  metrics: SportsLibDataEnvelope<SleepSportsLibMetricField>['metrics'],
  field: SleepSportsLibMetricField,
  value: unknown,
): void {
  if (value === undefined || value === null) return;
  metrics[field] = encodeScalarJson(SLEEP_SPORTS_LIB_CLASSES[field], value, `Sleep metric ${field}`);
}

export function encodeSleepSessionSportsLibData<T extends SleepMetricCarrier>(session: T): T {
  const metrics: SportsLibDataEnvelope<SleepSportsLibMetricField>['metrics'] = {
    [SLEEP_SPORTS_LIB_METRIC_FIELDS.Duration]: encodeScalarJson(
      SLEEP_SPORTS_LIB_CLASSES[SLEEP_SPORTS_LIB_METRIC_FIELDS.Duration],
      session.durationSeconds,
      `Sleep metric ${SLEEP_SPORTS_LIB_METRIC_FIELDS.Duration}`,
    ),
  };
  setSleepMetric(metrics, SLEEP_SPORTS_LIB_METRIC_FIELDS.InBedDuration, session.inBedDurationSeconds);
  setSleepMetric(metrics, SLEEP_SPORTS_LIB_METRIC_FIELDS.DeepDuration, session.stageDurationsSeconds?.[SLEEP_STAGES.Deep]);
  setSleepMetric(metrics, SLEEP_SPORTS_LIB_METRIC_FIELDS.LightDuration, session.stageDurationsSeconds?.[SLEEP_STAGES.Light]);
  setSleepMetric(metrics, SLEEP_SPORTS_LIB_METRIC_FIELDS.RemDuration, session.stageDurationsSeconds?.[SLEEP_STAGES.Rem]);
  setSleepMetric(metrics, SLEEP_SPORTS_LIB_METRIC_FIELDS.AwakeDuration, session.stageDurationsSeconds?.[SLEEP_STAGES.Awake]);
  setSleepMetric(metrics, SLEEP_SPORTS_LIB_METRIC_FIELDS.UnmeasurableDuration, session.stageDurationsSeconds?.[SLEEP_STAGES.Unmeasurable]);
  setSleepMetric(metrics, SLEEP_SPORTS_LIB_METRIC_FIELDS.UnknownDuration, session.stageDurationsSeconds?.[SLEEP_STAGES.Unknown]);
  setSleepMetric(metrics, SLEEP_SPORTS_LIB_METRIC_FIELDS.Score, session.score?.value);
  setSleepMetric(metrics, SLEEP_SPORTS_LIB_METRIC_FIELDS.AverageHeartRate, session.vitals?.averageHeartRateBpm);
  setSleepMetric(metrics, SLEEP_SPORTS_LIB_METRIC_FIELDS.MinimumHeartRate, session.vitals?.minimumHeartRateBpm);
  setSleepMetric(metrics, SLEEP_SPORTS_LIB_METRIC_FIELDS.RestingHeartRate, session.vitals?.restingHeartRateBpm);
  setSleepMetric(metrics, SLEEP_SPORTS_LIB_METRIC_FIELDS.AverageHrv, session.vitals?.averageHrvMs);
  setSleepMetric(metrics, SLEEP_SPORTS_LIB_METRIC_FIELDS.OvernightHrv, session.vitals?.overnightHrvMs);
  setSleepMetric(metrics, SLEEP_SPORTS_LIB_METRIC_FIELDS.HrvSampleCount, session.vitals?.hrvSampleCount);
  setSleepMetric(metrics, SLEEP_SPORTS_LIB_METRIC_FIELDS.MaximumSpo2, session.vitals?.maxSpo2Percent);
  setSleepMetric(metrics, SLEEP_SPORTS_LIB_METRIC_FIELDS.AverageRespiration, session.vitals?.averageRespirationBrpm);

  return {
    ...session,
    sportsLibData: {
      schemaVersion: SPORTS_LIB_DATA_SCHEMA_VERSION,
      metrics,
    },
  };
}

export function decodeSleepSessionSportsLibData<T extends SleepMetricCarrier>(session: T): T {
  if (session.sportsLibData === undefined) return session;
  const decoded = decodeEnvelope(
    session.sportsLibData,
    SLEEP_ENVELOPE_KEYS,
    SLEEP_SPORTS_LIB_CLASSES,
    'Sleep session sportsLibData',
  );
  if (decoded.duration === undefined) {
    throw new SportsLibDataValidationError('Sleep session is missing its canonical duration.');
  }

  const legacyValues: Partial<Record<SleepSportsLibMetricField, unknown>> = {
    duration: session.durationSeconds,
    inBedDuration: session.inBedDurationSeconds,
    deepDuration: session.stageDurationsSeconds?.[SLEEP_STAGES.Deep],
    lightDuration: session.stageDurationsSeconds?.[SLEEP_STAGES.Light],
    remDuration: session.stageDurationsSeconds?.[SLEEP_STAGES.Rem],
    awakeDuration: session.stageDurationsSeconds?.[SLEEP_STAGES.Awake],
    unmeasurableDuration: session.stageDurationsSeconds?.[SLEEP_STAGES.Unmeasurable],
    unknownDuration: session.stageDurationsSeconds?.[SLEEP_STAGES.Unknown],
    score: session.score?.value,
    averageHeartRate: session.vitals?.averageHeartRateBpm,
    minimumHeartRate: session.vitals?.minimumHeartRateBpm,
    restingHeartRate: session.vitals?.restingHeartRateBpm,
    averageHrv: session.vitals?.averageHrvMs,
    overnightHrv: session.vitals?.overnightHrvMs,
    hrvSampleCount: session.vitals?.hrvSampleCount,
    maximumSpo2: session.vitals?.maxSpo2Percent,
    averageRespiration: session.vitals?.averageRespirationBrpm,
  };
  for (const field of Object.values(SLEEP_SPORTS_LIB_METRIC_FIELDS)) {
    const legacyValue = legacyValues[field];
    if (legacyValue !== undefined && legacyValue !== null && decoded[field] === undefined) {
      throw new SportsLibDataValidationError(`Sleep metric ${field} is missing from Sports Lib JSON.`);
    }
  }
  for (const [field, decodedValue] of Object.entries(decoded)) {
    assertLegacyScalar(
      legacyValues[field as SleepSportsLibMetricField],
      decodedValue,
      `Sleep metric ${field}`,
    );
  }

  const stageDurationsSeconds = { ...(session.stageDurationsSeconds || {}) };
  if (decoded.deepDuration !== undefined) stageDurationsSeconds[SLEEP_STAGES.Deep] = decoded.deepDuration as number;
  if (decoded.lightDuration !== undefined) stageDurationsSeconds[SLEEP_STAGES.Light] = decoded.lightDuration as number;
  if (decoded.remDuration !== undefined) stageDurationsSeconds[SLEEP_STAGES.Rem] = decoded.remDuration as number;
  if (decoded.awakeDuration !== undefined) stageDurationsSeconds[SLEEP_STAGES.Awake] = decoded.awakeDuration as number;
  if (decoded.unmeasurableDuration !== undefined) stageDurationsSeconds[SLEEP_STAGES.Unmeasurable] = decoded.unmeasurableDuration as number;
  if (decoded.unknownDuration !== undefined) stageDurationsSeconds[SLEEP_STAGES.Unknown] = decoded.unknownDuration as number;

  const score = decoded.score === undefined
    ? session.score
    : { ...session.score, value: decoded.score as number };
  const hasDecodedVitals = [
    decoded.averageHeartRate,
    decoded.minimumHeartRate,
    decoded.restingHeartRate,
    decoded.averageHrv,
    decoded.overnightHrv,
    decoded.hrvSampleCount,
    decoded.maximumSpo2,
    decoded.averageRespiration,
  ].some(value => value !== undefined);
  let vitals = session.vitals;
  if (hasDecodedVitals) {
    const normalizedVitals = { ...(session.vitals || {}) };
    if (decoded.averageHeartRate !== undefined) normalizedVitals.averageHeartRateBpm = decoded.averageHeartRate as number;
    if (decoded.minimumHeartRate !== undefined) normalizedVitals.minimumHeartRateBpm = decoded.minimumHeartRate as number;
    if (decoded.restingHeartRate !== undefined) normalizedVitals.restingHeartRateBpm = decoded.restingHeartRate as number;
    if (decoded.averageHrv !== undefined) normalizedVitals.averageHrvMs = decoded.averageHrv as number;
    if (decoded.overnightHrv !== undefined) normalizedVitals.overnightHrvMs = decoded.overnightHrv as number;
    if (decoded.hrvSampleCount !== undefined) normalizedVitals.hrvSampleCount = decoded.hrvSampleCount as number;
    if (decoded.maximumSpo2 !== undefined) normalizedVitals.maxSpo2Percent = decoded.maximumSpo2 as number;
    if (decoded.averageRespiration !== undefined) normalizedVitals.averageRespirationBrpm = decoded.averageRespiration as number;
    vitals = normalizedVitals;
  }

  const decodedSession = {
    ...session,
    durationSeconds: decoded.duration as number,
    inBedDurationSeconds: decoded.inBedDuration === undefined
      ? session.inBedDurationSeconds
      : decoded.inBedDuration as number,
    stageDurationsSeconds,
    score,
    vitals,
  };
  delete decodedSession.sportsLibData;
  return decodedSession;
}

export function sportsLibClassTypeForHealthMetric(metricId: HealthMetricId): string {
  return HEALTH_SPORTS_LIB_CLASSES[metricId].type;
}

export function sportsLibClassTypeForSleepMetric(field: SleepSportsLibMetricField): string {
  return SLEEP_SPORTS_LIB_CLASSES[field].type;
}
