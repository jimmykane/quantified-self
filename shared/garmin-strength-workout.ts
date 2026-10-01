import type { WorkoutStructureV1 } from './planned-workout';
import { parseStrengthWorkoutDetailsV1, strengthProjectionMatchesDetails, type StrengthWorkoutDetailsV1 } from './strength-workout';
import type { PlannedWorkoutProviderMappingAssessmentV1 } from './planned-workout-providers';

/** Small transport allowlist verified against Training API V2 1.0 Appendix B.
 * This is not a user exercise catalogue. No fuzzy matching or equipment substitution.
 * Keep the confidential source workbook out of Git. */
const EXERCISES = {
  BARBELL_BACK_SQUAT: 'SQUAT', BARBELL_FRONT_SQUAT: 'SQUAT', GOBLET_SQUAT: 'SQUAT', SQUAT: 'SQUAT',
  BARBELL_BENCH_PRESS: 'BENCH_PRESS', DUMBBELL_BENCH_PRESS: 'BENCH_PRESS',
  BARBELL_DEADLIFT: 'DEADLIFT', ROMANIAN_DEADLIFT: 'DEADLIFT',
  BARBELL_BICEPS_CURL: 'CURL', DUMBBELL_BICEPS_CURL: 'CURL',
  PLANK: 'PLANK', SIDE_PLANK: 'PLANK', PUSH_UP: 'PUSH_UP', PULL_UP: 'PULL_UP', LUNGE: 'LUNGE',
  SEATED_CABLE_ROW: 'ROW', BARBELL_ROW: 'ROW', DUMBBELL_ROW: 'ROW',
  BARBELL_SHOULDER_PRESS: 'SHOULDER_PRESS', DUMBBELL_SHOULDER_PRESS: 'SHOULDER_PRESS',
} as const;

export function garminStrengthExercise(name: string): { exerciseCategory: string; exerciseName: string } | null {
  const key = name.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!Object.prototype.hasOwnProperty.call(EXERCISES, key)) return null;
  return { exerciseCategory: EXERCISES[key as keyof typeof EXERCISES], exerciseName: key };
}

/** Recipe-only v1 summaries cannot establish complete strength compatibility. */
export function assessGarminStrengthWorkoutV1(structure: WorkoutStructureV1,
  value?: StrengthWorkoutDetailsV1 | null): PlannedWorkoutProviderMappingAssessmentV1 {
  let details: StrengthWorkoutDetailsV1;
  try {
    details = parseStrengthWorkoutDetailsV1(value);
    if (!strengthProjectionMatchesDetails(structure, details)) throw new Error('Mismatched projection');
  } catch {
    return { provider: 'garmin', level: 'unsupported', issues: [{ severity: 'unsupported',
      code: 'provider_contract_unavailable', path: '$.strength',
      message: 'The complete matching strength prescription is required; the v1 summary cannot be sent to Garmin.' }] };
  }
  const issues: PlannedWorkoutProviderMappingAssessmentV1['issues'] = [];
  details.exercises.forEach((exercise, i) => {
    if (!garminStrengthExercise(exercise.name)) issues.push({ severity: 'unsupported',
      code: 'provider_contract_unavailable', path: `$.strength.exercises[${i}].name`,
      message: 'This exercise name has no verified Garmin mapping. Use a supported name from Training Plans Help; QS will not substitute another exercise.' });
  });
  return { provider: 'garmin', level: issues.length ? 'unsupported' : 'exact', issues: issues.slice(0, 20) };
}
