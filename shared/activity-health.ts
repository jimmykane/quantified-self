import {
  HEALTH_METRIC_IDS,
  type HealthMetricId,
  type HealthProvider,
  type HealthUnit,
} from './health';
import type { TrainingDiscipline } from './training-disciplines';

export const ACTIVITY_HEALTH_METRIC_IDS = [
  HEALTH_METRIC_IDS.BodyWeight,
  HEALTH_METRIC_IDS.Vo2Max,
] as const;

export type ActivityHealthMetricId = typeof ACTIVITY_HEALTH_METRIC_IDS[number];

export const ACTIVITY_HEALTH_INCOMPLETE_REASONS = {
  CandidateLimit: 'candidate_limit',
  SerializedBytes: 'serialized_bytes',
} as const;

export type ActivityHealthIncompleteReason =
  typeof ACTIVITY_HEALTH_INCOMPLETE_REASONS[keyof typeof ACTIVITY_HEALTH_INCOMPLETE_REASONS];

export const ACTIVITY_HEALTH_SOURCE_KINDS = {
  WorkoutProfileContext: 'workout_profile_context',
  WorkoutImported: 'workout_imported',
} as const;

export type ActivityHealthSourceKind =
  typeof ACTIVITY_HEALTH_SOURCE_KINDS[keyof typeof ACTIVITY_HEALTH_SOURCE_KINDS];

export interface ActivityHealthRangeRequest {
  metricId: ActivityHealthMetricId;
  startTimeMs: number;
  endTimeMs: number;
}

/**
 * A deliberately narrow projection of a workout-backed Health observation.
 * Source keys are server-generated digests; persisted entity identifiers and
 * raw creator/provider account values never cross the callable boundary.
 */
export interface ActivityHealthObservation {
  id: string;
  metricId: ActivityHealthMetricId;
  observedAtMs: number;
  value: number;
  unit: HealthUnit;
  provider: HealthProvider;
  sourceAccountKey: string;
  sourceKind: ActivityHealthSourceKind;
  discipline: TrainingDiscipline | 'other' | null;
  semanticVariant: string;
}

export interface ActivityHealthRangeResult {
  observations: ActivityHealthObservation[];
  complete: boolean;
  incompleteReason: ActivityHealthIncompleteReason | null;
  candidateCount: number;
  serializedBytes: number;
}

export function isActivityHealthMetricId(value: unknown): value is ActivityHealthMetricId {
  return typeof value === 'string'
    && ACTIVITY_HEALTH_METRIC_IDS.includes(value as ActivityHealthMetricId);
}

export function isActivityHealthObservationMetric(
  metricId: HealthMetricId,
): metricId is ActivityHealthMetricId {
  return isActivityHealthMetricId(metricId);
}

/**
 * Workout VO2 observations are ordered before this function is called. Runs
 * are scoped independently by provider, opaque account, and discipline. The
 * latest timestamp in an identical-value run wins without merging sources.
 */
export function collapseConsecutiveWorkoutVo2Observations(
  observations: readonly ActivityHealthObservation[],
): ActivityHealthObservation[] {
  const grouped = new Map<string, ActivityHealthObservation[]>();
  observations.forEach((observation) => {
    const key = [
      observation.provider,
      observation.sourceAccountKey,
      observation.discipline || 'other',
      observation.sourceKind,
    ].join('\u0000');
    const group = grouped.get(key) || [];
    group.push(observation);
    grouped.set(key, group);
  });

  const collapsed: ActivityHealthObservation[] = [];
  grouped.forEach((group) => {
    group.sort((left, right) => left.observedAtMs - right.observedAtMs || left.id.localeCompare(right.id));
    group.forEach((observation) => {
      const previous = collapsed[collapsed.length - 1];
      const sameGroup = previous
        && previous.provider === observation.provider
        && previous.sourceAccountKey === observation.sourceAccountKey
        && previous.discipline === observation.discipline
        && previous.sourceKind === observation.sourceKind;
      if (sameGroup && previous.value === observation.value) {
        collapsed[collapsed.length - 1] = observation;
      } else {
        collapsed.push(observation);
      }
    });
  });

  return collapsed.sort((left, right) => left.observedAtMs - right.observedAtMs || left.id.localeCompare(right.id));
}
