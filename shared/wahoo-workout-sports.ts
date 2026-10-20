import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { WorkoutStructureV1 } from './planned-workout';
import { plannedWorkoutAliasedSportsV1, plannedWorkoutSportAliasV1 } from './planned-workout-sport-aliases';

/** Explicit planning profiles, never a blanket admission of the activity catalog.
 * The 21 base profiles have owner-confirmed timed playback (#789). Additional
 * QS names alias those profiles; they add no native playback claim or proof
 * of distance/intensity support.
 * Yoga, Elliptical and Cardio Class additionally have authorized cloud
 * Plan/prescription/Workout readback; that is not app/watch playback proof.
 * https://cloud-api.wahooligan.com/#workout-types */
export const WAHOO_PLANNED_WORKOUT_SPORTS_V1 = [...new Set([
  ActivityTypes.Running,
  ActivityTypes.TrailRunning,
  ActivityTypes.Treadmill,
  ActivityTypes.IndoorRunning,
  ActivityTypes.VirtualRunning,
  ActivityTypes.Cycling,
  ActivityTypes.MountainBiking,
  ActivityTypes.IndoorCycling,
  ActivityTypes.VirtualCycling,
  ActivityTypes.EBiking,
  ActivityTypes.Handcycle,
  ActivityTypes.Velomobile,
  ActivityTypes['Enduro MTB'],
  ActivityTypes.DownhillCycling,
  ActivityTypes.Swimming,
  ActivityTypes.OpenWaterSwimming,
  ActivityTypes.Walking,
  ActivityTypes.Hiking,
  ActivityTypes.Rowing,
  ActivityTypes.IndoorRowing,
  ActivityTypes.StrengthTraining,
  ActivityTypes.Yoga,
  ActivityTypes.EllipticalTrainer,
  ActivityTypes.CardioTraining,
  ...plannedWorkoutAliasedSportsV1('wahoo'),
])] as const;

export interface WahooWorkoutSportProfileV1 {
  family: 0 | 1 | 2 | 3 | 6 | 9;
  workoutType: 0 | 1 | 4 | 5 | 6 | 9 | 12 | 13 | 20 | 22 | 25 | 26 | 39 | 42 | 43 | 64 | 66 | 68 | 70 | 71;
  location: 0 | 1;
  foldedTo?: string;
  untargetedTimeOnly?: true;
}

export function wahooWorkoutSportProfileV1(sport: ActivityTypes): WahooWorkoutSportProfileV1 | null {
  const mappedSport = plannedWorkoutSportAliasV1('wahoo', sport);
  if (mappedSport !== sport) {
    const profile = wahooWorkoutSportProfileV1(mappedSport);
    return profile ? { ...profile, foldedTo: profile.foldedTo ?? mappedSport } : null;
  }
  switch (sport) {
    case ActivityTypes.Cycling: return { family: 0, workoutType: 0, location: 1 };
    case ActivityTypes.MountainBiking: return { family: 0, workoutType: 13, location: 1 };
    case ActivityTypes.IndoorCycling: return { family: 0, workoutType: 12, location: 0 };
    case ActivityTypes.VirtualCycling: return { family: 0, workoutType: 68, location: 0 };
    case ActivityTypes.EBiking: return { family: 0, workoutType: 64, location: 1 };
    case ActivityTypes.Handcycle: return { family: 0, workoutType: 70, location: 1 };
    case ActivityTypes.Velomobile: return { family: 0, workoutType: 0, location: 1, foldedTo: 'Cycling' };
    case ActivityTypes['Enduro MTB']:
    case ActivityTypes.DownhillCycling: return { family: 0, workoutType: 13, location: 1, foldedTo: 'Mountain Biking' };
    case ActivityTypes.Running: return { family: 1, workoutType: 1, location: 1 };
    case ActivityTypes.TrailRunning: return { family: 1, workoutType: 4, location: 1 };
    case ActivityTypes.Treadmill: return { family: 1, workoutType: 5, location: 0 };
    case ActivityTypes.IndoorRunning: return { family: 1, workoutType: 5, location: 0, foldedTo: 'Treadmill' };
    case ActivityTypes.VirtualRunning: return { family: 1, workoutType: 71, location: 0 };
    case ActivityTypes.Walking: return { family: 9, workoutType: 6, location: 1, untargetedTimeOnly: true };
    case ActivityTypes.Hiking: return { family: 9, workoutType: 9, location: 1, untargetedTimeOnly: true };
    // Profile/timed-playback proof does not widen the untargeted prescription.
    case ActivityTypes.Swimming: return { family: 2, workoutType: 25, location: 0, untargetedTimeOnly: true };
    case ActivityTypes.OpenWaterSwimming: return { family: 2, workoutType: 26, location: 1, untargetedTimeOnly: true };
    case ActivityTypes.Rowing: return { family: 3, workoutType: 39, location: 1, untargetedTimeOnly: true };
    case ActivityTypes.IndoorRowing: return { family: 6, workoutType: 22, location: 0, untargetedTimeOnly: true };
    case ActivityTypes.StrengthTraining: return { family: 6, workoutType: 42, location: 0 };
    case ActivityTypes.Yoga: return { family: 6, workoutType: 66, location: 0, untargetedTimeOnly: true };
    case ActivityTypes.EllipticalTrainer: return { family: 6, workoutType: 20, location: 0, untargetedTimeOnly: true };
    case ActivityTypes.CardioTraining: return { family: 6, workoutType: 43, location: 0, untargetedTimeOnly: true,
      foldedTo: 'Cardio Class' };
    default: return null;
  }
}

export function isWahooWalkingWorkoutSportV1(sport: ActivityTypes): boolean {
  const mappedSport = plannedWorkoutSportAliasV1('wahoo', sport);
  return mappedSport === ActivityTypes.Walking || mappedSport === ActivityTypes.Hiking;
}

/** Prescription limits are independent of whether native-profile playback is proven. */
export function isWahooUntargetedWorkoutSportV1(sport: ActivityTypes): boolean {
  return wahooWorkoutSportProfileV1(sport)?.untargetedTimeOnly === true;
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
