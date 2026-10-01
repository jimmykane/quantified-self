import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { WorkoutStructureV1 } from './planned-workout';

/** Plan families, not recorded-activity support. Walking/Hiking use the
 * account-tested outdoor family 9; Gym uses the tested indoor type 42.
 * Never substitute Yoga (66) or infer another sport from the activity catalog. */
export const WAHOO_PLANNED_WORKOUT_SPORTS_V1 = [
  ActivityTypes.Running,
  ActivityTypes.Cycling,
  ActivityTypes.Walking,
  ActivityTypes.Hiking,
  ActivityTypes.StrengthTraining,
] as const;

export interface WahooWorkoutSportProfileV1 {
  family: 0 | 1 | 6 | 9;
  workoutType: 0 | 1 | 6 | 9 | 42;
}

export function wahooWorkoutSportProfileV1(sport: ActivityTypes): WahooWorkoutSportProfileV1 | null {
  switch (sport) {
    case ActivityTypes.Cycling: return { family: 0, workoutType: 0 };
    case ActivityTypes.Running: return { family: 1, workoutType: 1 };
    case ActivityTypes.Walking: return { family: 9, workoutType: 6 };
    case ActivityTypes.Hiking: return { family: 9, workoutType: 9 };
    case ActivityTypes.StrengthTraining: return { family: 6, workoutType: 42 };
    default: return null;
  }
}

export function isWahooWalkingWorkoutSportV1(sport: ActivityTypes): boolean {
  return sport === ActivityTypes.Walking || sport === ActivityTypes.Hiking;
}

/** Exact time only; repeat counts are total passes. Never infer duration from distance or reps. */
export function wahooDurationSeconds(structure: WorkoutStructureV1): number | null {
  let total = 0;
  for (const node of structure.nodes) {
    for (const step of node.kind === 'step' ? [node] : node.steps) {
      if (step.ending.kind !== 'time') return null;
      total += step.ending.seconds * (node.kind === 'step' ? 1 : node.count);
    }
  }
  return Number.isFinite(total) && total > 0 ? total : null;
}
