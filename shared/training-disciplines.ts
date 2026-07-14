import {
  ActivityTypeGroups,
  ActivityTypes,
  type ActivityTypes as ActivityType,
} from '@sports-alliance/sports-lib';
import { getActivityTypesForGroup } from './activity-type-group.metadata';

export const TRAINING_DISCIPLINES = ['running', 'cycling', 'swimming'] as const;
export type TrainingDiscipline = typeof TRAINING_DISCIPLINES[number];

export const POWER_CAPACITY_DISCIPLINES = ['running', 'cycling'] as const;
export type PowerCapacityDiscipline = typeof POWER_CAPACITY_DISCIPLINES[number];

export const TRAINING_DISCIPLINE_ACTIVITY_GROUPS = {
  running: [ActivityTypeGroups.RunningGroup, ActivityTypeGroups.TrailRunningGroup],
  cycling: [ActivityTypeGroups.CyclingGroup, ActivityTypeGroups.MountainBikingGroup],
  swimming: [ActivityTypeGroups.SwimmingGroup],
} as const;

const activityTypeByCanonicalValue = new Map<string, ActivityType>();
Object.values(ActivityTypes).forEach((activityType) => {
  const normalized = `${activityType || ''}`.trim();
  if (normalized) {
    activityTypeByCanonicalValue.set(normalized, activityType as ActivityType);
  }
});

const disciplineByActivityType = new Map<ActivityType, TrainingDiscipline>();
TRAINING_DISCIPLINES.forEach((discipline) => {
  TRAINING_DISCIPLINE_ACTIVITY_GROUPS[discipline].forEach((group) => {
    getActivityTypesForGroup(group).forEach(activityType => disciplineByActivityType.set(activityType, discipline));
  });
});

/**
 * Resolves stored provider aliases through sports-lib before applying the shared
 * Training group registry. Aggregate types such as Triathlon are intentionally
 * not classified; their normalized child activities are classified separately.
 */
export function resolveTrainingDisciplineFromActivityType(value: unknown): TrainingDiscipline | null {
  if (typeof value !== 'string') {
    return null;
  }
  const rawValue = value.trim();
  if (!rawValue) {
    return null;
  }
  const canonicalType = (ActivityTypes as Record<string, ActivityType>)[rawValue]
    || activityTypeByCanonicalValue.get(rawValue)
    || null;
  return canonicalType ? disciplineByActivityType.get(canonicalType) || null : null;
}

export function isTrainingDiscipline(value: unknown): value is TrainingDiscipline {
  return typeof value === 'string'
    && TRAINING_DISCIPLINES.includes(value as TrainingDiscipline);
}

export function isPowerCapacityDiscipline(value: unknown): value is PowerCapacityDiscipline {
  return typeof value === 'string'
    && POWER_CAPACITY_DISCIPLINES.includes(value as PowerCapacityDiscipline);
}
