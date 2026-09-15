import { isDeepStrictEqual } from 'node:util';
import {
    DERIVED_METRICS_ACTIVITY_FIELDS, DERIVED_METRICS_EVENT_FIELDS,
    DERIVED_METRICS_TRAINING_READINESS_SLEEP_FIELDS, DERIVED_METRICS_TRAINING_SLEEP_FIELDS,
} from './derived-metrics-source-fields';

export type DerivedMetricSource = 'event' | 'activity' | 'sleep' | 'health';

const fieldsBySource: Record<DerivedMetricSource, readonly string[]> = {
    event: DERIVED_METRICS_EVENT_FIELDS,
    activity: [...DERIVED_METRICS_ACTIVITY_FIELDS, 'swimLengths'],
    sleep: [...new Set([...DERIVED_METRICS_TRAINING_SLEEP_FIELDS, ...DERIVED_METRICS_TRAINING_READINESS_SLEEP_FIELDS])],
    // Identity, eligibility and source semantics used by Weight, VO2 and nightly HRV.
    // Ingestion timestamps, digests and revision watermarks are not calculation inputs.
    health: ['userID', 'schemaVersion', 'kind', 'metricIds', 'source.provider', 'source.accountKey',
        'source.sourceRecordType', 'calendarDate', 'startTimeMs', 'endTimeMs', 'metrics'],
};

function field(data: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object'
        ? (value as Record<string, unknown>)[key] : undefined, data);
}

export function hasDerivedMetricSourceChange(source: DerivedMetricSource, before: unknown, after: unknown): boolean {
    // Missing/unreadable snapshots must not suppress a create, delete or repair.
    if (!before || !after) return true;
    return fieldsBySource[source].some(path => !isDeepStrictEqual(field(before, path), field(after, path)));
}
