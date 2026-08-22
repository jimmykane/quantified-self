import {
  DataCadence,
  DataCadenceAvg,
  DataCadenceMax,
  DataCadenceMin,
  DataStrokeRate,
  DataStrokeRateAvg,
  DataStrokeRateMax,
  DataStrokeRateMin,
  type EventInterface,
  ActivityTypesHelper,
  normalizeActivityMetricSemanticsForStats,
} from '@sports-alliance/sports-lib';

interface MetricSemanticCompatibilityMapping {
  canonicalType: string;
  persistedCompatibilityType: string;
}

const PERSISTED_ACTIVITY_TYPES_STAT_TYPE = 'Activity Types';

function getStrokeRatePersistenceMappings(): readonly MetricSemanticCompatibilityMapping[] {
  return [
    {
      canonicalType: DataStrokeRate.type,
      persistedCompatibilityType: DataCadence.type,
    },
    {
      canonicalType: DataStrokeRateAvg.type,
      persistedCompatibilityType: DataCadenceAvg.type,
    },
    {
      canonicalType: DataStrokeRateMin.type,
      persistedCompatibilityType: DataCadenceMin.type,
    },
    {
      canonicalType: DataStrokeRateMax.type,
      persistedCompatibilityType: DataCadenceMax.type,
    },
  ];
}

/**
 * Returns the Firestore stat fields needed to read canonical metrics while retaining
 * compatibility with split documents written before Sports Lib introduced stroke rate.
 */
export function getPersistedSportsLibMetricReadTypes(metricTypes: readonly string[]): string[] {
  const readTypes: string[] = [];
  const mappingByCanonicalType = new Map(
    getStrokeRatePersistenceMappings().map(mapping => [mapping.canonicalType, mapping]),
  );
  metricTypes.forEach((metricType) => {
    appendUnique(readTypes, metricType);
    const mapping = mappingByCanonicalType.get(metricType);
    if (mapping) {
      appendUnique(readTypes, mapping.persistedCompatibilityType);
    }
  });
  return readTypes;
}

/**
 * Canonicalizes a raw persisted stat projection without mutating the Firestore object.
 * Cadence compatibility values move only when every represented activity type is a
 * Sports Lib stroke-rate activity. Explicit canonical values always win.
 */
export function canonicalizePersistedSportsLibStats(
  stats: Record<string, unknown> | null | undefined,
  activityTypes: readonly unknown[],
): Record<string, unknown> {
  const canonicalStats = { ...(stats || {}) };
  if (!usesStrokeRateSemantics(activityTypes)) {
    return canonicalStats;
  }

  getStrokeRatePersistenceMappings().forEach((mapping) => {
    if (!Object.prototype.hasOwnProperty.call(canonicalStats, mapping.persistedCompatibilityType)) {
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(canonicalStats, mapping.canonicalType)) {
      canonicalStats[mapping.canonicalType] = canonicalStats[mapping.persistedCompatibilityType];
    }
    delete canonicalStats[mapping.persistedCompatibilityType];
  });
  return canonicalStats;
}

export function getPersistedEventActivityTypes(
  stats: Record<string, unknown> | null | undefined,
): readonly unknown[] {
  const activityTypes = stats?.[PERSISTED_ACTIVITY_TYPES_STAT_TYPE];
  return Array.isArray(activityTypes) ? activityTypes : [];
}

/**
 * Applies Sports Lib's activity-aware summary semantics to a restored QS event.
 * QS stores event summaries separately from child activities, so the native
 * importer cannot infer those semantics from embedded activities alone.
 */
export function normalizePersistedEventMetricSemantics(
  event: EventInterface,
): EventInterface {
  const activityTypesStat = event.getStat<unknown>(PERSISTED_ACTIVITY_TYPES_STAT_TYPE);
  const activityTypes = activityTypesStat ? activityTypesStat.getValue() : [];
  if (!Array.isArray(activityTypes) || activityTypes.length === 0) {
    return event;
  }
  normalizeActivityMetricSemanticsForStats(
    event,
    activityTypes,
  );
  return event;
}

function usesStrokeRateSemantics(activityTypes: readonly unknown[]): boolean {
  if (!Array.isArray(activityTypes) || activityTypes.length === 0) {
    return false;
  }
  const resolvedTypes = activityTypes.map(activityType => (
    ActivityTypesHelper.resolveActivityType(activityType)
  ));
  return resolvedTypes.every(activityType => (
    activityType !== null && ActivityTypesHelper.usesStrokeRate(activityType)
  ));
}

function appendUnique(values: string[], value: string): void {
  if (value && !values.includes(value)) {
    values.push(value);
  }
}
