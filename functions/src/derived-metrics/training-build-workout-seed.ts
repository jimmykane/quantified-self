import { createHash } from 'node:crypto';
import {
    DERIVED_METRIC_KINDS, DERIVED_METRIC_SCHEMA_VERSION,
    type DerivedTrainingBuildComparisonMetricPayload,
} from '../../../shared/derived-metrics';
import { TRAINING_DISCIPLINES } from '../../../shared/training-disciplines';

// Internal snapshot metadata, not a second copy of workout history or a public metric payload.
// Bump when the workout projection changes independently of the global derived schema.
const WORKOUT_SEED_VERSION = 1;
const DAY_MS = 86_400_000;

export interface TrainingBuildWorkoutSeedMetadata {
    version: number;
    sourceVersion: number;
    settingsKey: string;
    builtAtMs: number;
    validUntilMs: number;
    workoutDigest: string;
    formSourceDocCount: number;
    activitySourceDocCount: number;
}

export interface TrainingBuildWorkoutSeed {
    payload: DerivedTrainingBuildComparisonMetricPayload;
    sourceEventCount: number;
    metadata: TrainingBuildWorkoutSeedMetadata;
}

export interface TrainingBuildWorkoutSeedContext {
    sourceVersion: number;
    eventMutationVersion: number;
    settingsKey: string;
    nowMs: number;
}

function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stableValue(child)]));
    }
    return value;
}

export function trainingBuildSettingsKey(normalizedSelections: unknown): string {
    return createHash('sha256').update(JSON.stringify(stableValue(normalizedSelections))).digest('hex');
}

function workoutDigest(payload: DerivedTrainingBuildComparisonMetricPayload): string {
    // Recovery is deliberately rebuilt, including after a recovery formula upgrade.
    const { recovery: _recovery, recoveryVersion: _version, disciplines, ...workout } = payload;
    return trainingBuildSettingsKey({ ...workout, disciplines: disciplines.map(({ recovery: _sleep, ...d }) => d) });
}

const count = (value: unknown): value is number => typeof value === 'number'
    && Number.isSafeInteger(value) && value >= 0;

export function createTrainingBuildWorkoutSeedMetadata(
    payload: DerivedTrainingBuildComparisonMetricPayload,
    context: Omit<TrainingBuildWorkoutSeedContext, 'eventMutationVersion'>,
    activityStartTimes: readonly number[],
    formSourceDocCount: number,
    activitySourceDocCount: number,
): TrainingBuildWorkoutSeedMetadata {
    // A persisted future workout can become eligible without a Firestore mutation.
    const nextUtcDay = Math.floor(context.nowMs / DAY_MS) * DAY_MS + DAY_MS;
    const validUntilMs = activityStartTimes.reduce((until, start) => Number.isFinite(start) && start > context.nowMs
        ? Math.min(until, start) : until, nextUtcDay);
    return {
        version: WORKOUT_SEED_VERSION, sourceVersion: context.sourceVersion, settingsKey: context.settingsKey,
        builtAtMs: context.nowMs, validUntilMs, workoutDigest: workoutDigest(payload),
        formSourceDocCount, activitySourceDocCount,
    };
}

export function resolveTrainingBuildWorkoutSeed(
    snapshot: unknown,
    context: TrainingBuildWorkoutSeedContext,
): TrainingBuildWorkoutSeed | null {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const data = snapshot as Record<string, unknown>;
    const metadata = data.workoutInputsReuse as TrainingBuildWorkoutSeedMetadata | undefined;
    const payload = data.payload as DerivedTrainingBuildComparisonMetricPayload | undefined;
    if (data.entryType !== 'snapshot' || data.metricKind !== DERIVED_METRIC_KINDS.TrainingBuildComparison
        || data.status !== 'ready' || data.schemaVersion !== DERIVED_METRIC_SCHEMA_VERSION
        || data.builtFromEventMutationVersion !== context.eventMutationVersion
        || !count(context.sourceVersion) || !count(context.eventMutationVersion)
        || !count(data.sourceEventCount) || !metadata || metadata.version !== WORKOUT_SEED_VERSION
        || metadata.sourceVersion !== context.sourceVersion || metadata.settingsKey !== context.settingsKey
        || !count(metadata.formSourceDocCount) || !count(metadata.activitySourceDocCount)
        || !Number.isFinite(metadata.builtAtMs) || metadata.builtAtMs > context.nowMs
        || !Number.isFinite(metadata.validUntilMs) || metadata.validUntilMs <= context.nowMs
        || metadata.validUntilMs > Math.floor(metadata.builtAtMs / DAY_MS) * DAY_MS + DAY_MS
        || !payload || payload.dayBoundary !== 'UTC' || payload.excludesMergedEvents !== true
        || payload.asOfDayMs !== Math.floor(context.nowMs / DAY_MS) * DAY_MS
        || !Array.isArray(payload.disciplines) || payload.disciplines.length !== TRAINING_DISCIPLINES.length
        || new Set(payload.disciplines.map(d => d?.discipline)).size !== TRAINING_DISCIPLINES.length
        || !payload.disciplines.every(d => d && TRAINING_DISCIPLINES.includes(d.discipline)
            && ['ready', 'not-configured', 'invalid-selection'].includes(d.status)
            && (d.status !== 'ready' || (d.current && d.benchmark && d.selection)))
    ) return null;
    try {
        return workoutDigest(payload) === metadata.workoutDigest
            ? { payload, sourceEventCount: data.sourceEventCount, metadata } : null;
    } catch {
        return null;
    }
}
