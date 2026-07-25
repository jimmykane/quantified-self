import {
  DataLatitudeDegrees,
  DataLongitudeDegrees,
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

const SENSITIVE_NUMERIC_TYPES = new Set([
  DataLatitudeDegrees.type,
  DataLongitudeDegrees.type,
]);

function asNonEmptyString(value: unknown): string | null {
  const normalized = `${value ?? ''}`.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildNumericDescriptor(DataClass: SportsLibDataClass): McpMetricDescriptor | null {
  const type = asNonEmptyString(DataClass?.type);
  if (!type || SENSITIVE_NUMERIC_TYPES.has(type)) {
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
    if (!canonicalType || SENSITIVE_NUMERIC_TYPES.has(canonicalType)) {
      return null;
    }
    return catalogByType.get(canonicalType) || null;
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
