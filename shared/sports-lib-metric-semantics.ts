import {
  DataActivityTypes,
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

const STROKE_RATE_PERSISTENCE_MAPPINGS: readonly MetricSemanticCompatibilityMapping[] = [
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

const STROKE_RATE_PERSISTENCE_MAPPING_BY_CANONICAL_TYPE = new Map(
  STROKE_RATE_PERSISTENCE_MAPPINGS.map(mapping => [mapping.canonicalType, mapping]),
);

/**
 * Returns the Firestore stat fields needed to read canonical metrics while retaining
 * compatibility with split documents written before Sports Lib introduced stroke rate.
 */
export function getPersistedSportsLibMetricReadTypes(metricTypes: readonly string[]): string[] {
  const readTypes: string[] = [];
  metricTypes.forEach((metricType) => {
    appendUnique(readTypes, metricType);
    const mapping = STROKE_RATE_PERSISTENCE_MAPPING_BY_CANONICAL_TYPE.get(metricType);
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

  STROKE_RATE_PERSISTENCE_MAPPINGS.forEach((mapping) => {
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
  const activityTypes = stats?.[DataActivityTypes.type];
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
  const activityTypesStat = event.getStat<unknown>(DataActivityTypes.type);
  const activityTypes = activityTypesStat ? activityTypesStat.getValue() : [];
  normalizeActivityMetricSemanticsForStats(
    event,
    Array.isArray(activityTypes) ? activityTypes : [],
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
