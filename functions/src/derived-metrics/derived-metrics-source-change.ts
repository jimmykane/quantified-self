import { isDeepStrictEqual } from 'node:util';
import {
    DERIVED_METRICS_ACTIVITY_FIELDS, DERIVED_METRICS_EVENT_FIELDS,
    DERIVED_METRICS_TRAINING_READINESS_SLEEP_FIELDS, DERIVED_METRICS_TRAINING_SLEEP_FIELDS,
} from './derived-metrics-source-fields';

export type DerivedMetricSource = 'event' | 'activity' | 'sleep' | 'health' | 'training-load';

const fieldsBySource: Record<DerivedMetricSource, readonly string[]> = {
    'training-load': ['version', 'excluded', 'controls', 'legs', 'parentFingerprint', 'resetUnmatched'],
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

export function hasGarminSleepHeartRateSource(data: unknown): boolean {
    return field(data, 'source.provider') === 'GarminAPI' && field(data, 'source.sourceRecordType') === 'garmin_daily'
        && Array.isArray(field(data, 'metricIds')) && (field(data, 'metricIds') as unknown[]).includes('heart_rate')
        && Array.isArray(field(data, 'sampleChunkIds')) && (field(data, 'sampleChunkIds') as unknown[]).length > 0;
}

export function hasDerivedMetricSourceChange(source: DerivedMetricSource, before: unknown, after: unknown): boolean {
    // Missing/unreadable snapshots must not suppress a create, delete or repair.
    if (!before || !after) return true;
    if (source === 'health' && (hasGarminSleepHeartRateSource(before) || hasGarminSleepHeartRateSource(after))
        && (!isDeepStrictEqual(field(before, 'source.revision.digest'), field(after, 'source.revision.digest'))
            || !isDeepStrictEqual(field(before, 'sampleChunkIds'), field(after, 'sampleChunkIds')))) return true;
    return fieldsBySource[source].some(path => !isDeepStrictEqual(field(before, path), field(after, path)));
}
