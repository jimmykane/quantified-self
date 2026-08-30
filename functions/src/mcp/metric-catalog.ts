import {
  DataActiveDuration,
  DataActiveEnergy,
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
  DataFloorsClimbed,
  DataHeartRateVariability,
  DataLatitudeDegrees,
  DataLongitudeDegrees,
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
  DataStressDuration,
  DataStressLevel,
  DataStressState,
  DataTotalEnergy,
  DataVigorousIntensityDuration,
  DataWheelchairPushDistance,
  DataWheelchairPushes,
  DataStore,
  DynamicDataLoader,
  UnitSystem,
} from '@sports-alliance/sports-lib';

type SportsLibDataClass = {
  new(value: unknown): {
    getDisplayType?: () => unknown;
    getUnit?: () => unknown;
    getUnitSystem?: () => unknown;
    getValue?: () => unknown;
    isValueTypeValid?: (value: unknown) => boolean;
  };
  type?: unknown;
  displayType?: unknown;
  unit?: unknown;
  unitSystem?: unknown;
};

export interface McpMetricDescriptor {
  type: string;
  displayType: string;
  unit: string;
  unitSystem: 'metric' | 'imperial';
}

// Sports Lib 20.3 registers these normalized Health/Sleep classes in the
// global DataStore. Registration is not authorization to expose a same-named
// event stat through the activity-metrics scope.
export const MCP_NON_ACTIVITY_SPORTS_LIB_TYPES = Object.freeze([
  DataActiveDuration.type,
  DataActiveEnergy.type,
  DataBasalEnergy.type,
  DataBloodOxygenSaturation.type,
  DataBloodPressureDiastolic.type,
  DataBloodPressureSystolic.type,
  DataBodyEnergy.type,
  DataBodyEnergyChange.type,
  DataBodyFat.type,
  DataBodyMassIndex.type,
  DataBodyWater.type,
  DataBoneMass.type,
  DataFloorsClimbed.type,
  DataHeartRateVariability.type,
  DataModerateIntensityDuration.type,
  DataMuscleMass.type,
  DataPulseRate.type,
  DataRecoveryScore.type,
  DataRespirationRate.type,
  DataRestingHeartRate.type,
  DataSkinTemperatureDeviation.type,
  DataSleepAwakeDuration.type,
  DataSleepBloodOxygenSaturationMax.type,
  DataSleepDeepDuration.type,
  DataSleepDuration.type,
  DataSleepHeartRateAvg.type,
  DataSleepHeartRateMin.type,
  DataSleepHRVAvg.type,
  DataSleepHRVOvernight.type,
  DataSleepHRVSampleCount.type,
  DataSleepInBedDuration.type,
  DataSleepLightDuration.type,
  DataSleepRemDuration.type,
  DataSleepRespirationRateAvg.type,
  DataSleepRestingHeartRate.type,
  DataSleepScore.type,
  DataSleepUnknownDuration.type,
  DataSleepUnmeasurableDuration.type,
  DataStressDuration.type,
  DataStressLevel.type,
  DataStressState.type,
  DataTotalEnergy.type,
  DataVigorousIntensityDuration.type,
  DataWheelchairPushDistance.type,
  DataWheelchairPushes.type,
] as const);

const EXCLUDED_NUMERIC_TYPES = new Set([
  DataLatitudeDegrees.type,
  DataLongitudeDegrees.type,
  ...MCP_NON_ACTIVITY_SPORTS_LIB_TYPES,
]);

function asNonEmptyString(value: unknown): string | null {
  const normalized = `${value ?? ''}`.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildNumericDescriptor(DataClass: SportsLibDataClass): McpMetricDescriptor | null {
  const type = asNonEmptyString(DataClass?.type);
  if (!type || EXCLUDED_NUMERIC_TYPES.has(type)) {
    return null;
  }

  try {
    const instance = new DataClass(0);
    const value = instance.getValue?.();
    if (
      typeof value !== 'number'
      || !Number.isFinite(value)
      || instance.isValueTypeValid?.(0) === false
    ) {
      return null;
    }

    const displayType = asNonEmptyString(DataClass.displayType)
      || asNonEmptyString(instance.getDisplayType?.())
      || type;
    const unit = asNonEmptyString(DataClass.unit)
      || asNonEmptyString(instance.getUnit?.())
      || '';
    const unitSystem = DataClass.unitSystem ?? instance.getUnitSystem?.();

    return {
      type,
      displayType,
      unit,
      unitSystem: unitSystem === UnitSystem.Imperial ? 'imperial' : 'metric',
    };
  } catch {
    return null;
  }
}

export function buildSportsLibNumericMetricCatalog(
  dataStore: Record<string, SportsLibDataClass> = DataStore,
): McpMetricDescriptor[] {
  const byCanonicalType = new Map<string, McpMetricDescriptor>();

  Object.values(dataStore).forEach((DataClass) => {
    const descriptor = buildNumericDescriptor(DataClass);
    if (!descriptor || byCanonicalType.has(descriptor.type)) {
      return;
    }
    byCanonicalType.set(descriptor.type, descriptor);
  });

  return [...byCanonicalType.values()].sort((left, right) => left.type.localeCompare(right.type));
}

const defaultMetricCatalog = buildSportsLibNumericMetricCatalog();
const defaultMetricCatalogByType = new Map(defaultMetricCatalog.map(metric => [metric.type, metric]));

export function getSportsLibNumericMetricCatalog(): readonly McpMetricDescriptor[] {
  return defaultMetricCatalog;
}

export function resolveSportsLibNumericMetric(
  requestedType: string,
  catalogByType: ReadonlyMap<string, McpMetricDescriptor> = defaultMetricCatalogByType,
): McpMetricDescriptor | null {
  const normalized = asNonEmptyString(requestedType);
  if (!normalized) {
    return null;
  }

  const exact = catalogByType.get(normalized);
  if (exact) {
    return exact;
  }

  try {
    const DataClass = DynamicDataLoader.getDataClassFromDataType(normalized) as unknown as SportsLibDataClass;
    const canonicalType = asNonEmptyString(DataClass?.type);
    if (!canonicalType || EXCLUDED_NUMERIC_TYPES.has(canonicalType)) {
      return null;
    }
    return catalogByType.get(canonicalType) || null;
  } catch {
    return null;
  }
}

export function projectSportsLibNumericMetricValue(
  canonicalType: string,
  persistedValue: unknown,
): number | null {
  const descriptor = resolveSportsLibNumericMetric(canonicalType);
  if (!descriptor || descriptor.type !== canonicalType) {
    return null;
  }

  try {
    const DataClass = DynamicDataLoader.getDataClassFromDataType(
      canonicalType,
    ) as unknown as SportsLibDataClass;
    const instance = new DataClass(persistedValue);
    const value = instance.getValue?.();
    if (
      typeof value !== 'number'
      || !Number.isFinite(value)
      || instance.isValueTypeValid?.(value) === false
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function resolveAvailableSportsLibMetrics(
  persistedStatMaps: readonly (Record<string, unknown> | null | undefined)[],
  catalog: readonly McpMetricDescriptor[] = defaultMetricCatalog,
): McpMetricDescriptor[] {
  const byType = new Map(catalog.map(metric => [metric.type, metric]));
  const availableTypes = new Set<string>();

  persistedStatMaps.forEach((stats) => {
    Object.keys(stats || {}).forEach((persistedType) => {
      const descriptor = resolveSportsLibNumericMetric(persistedType, byType);
      if (descriptor) {
        availableTypes.add(descriptor.type);
      }
    });
  });

  return catalog.filter(metric => availableTypes.has(metric.type));
}
