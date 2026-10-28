import { DataWeight } from '@sports-alliance/sports-lib';
import type { WorkoutStructureV1 } from './planned-workout';
import { parseStrengthWorkoutDetailsV1, strengthProjectionMatchesDetails, type StrengthWorkoutDetailsV1 } from './strength-workout';
import type { PlannedWorkoutProviderMappingAssessmentV1 } from './planned-workout-providers';

/** #783: owner-confirmed Wahoo app playback, Gym family 6 / indoor type 42.
 * The published recipe has no rep counter or native exercise/load fields. */
export function assessWahooStrengthWorkoutV1(structure: WorkoutStructureV1,
  value?: StrengthWorkoutDetailsV1 | null): PlannedWorkoutProviderMappingAssessmentV1 {
  let details: StrengthWorkoutDetailsV1;
  try {
    details = parseStrengthWorkoutDetailsV1(value);
    if (!strengthProjectionMatchesDetails(structure, details)) throw new Error('Mismatched prescription');
  } catch {
    return { provider: 'wahoo', level: 'unsupported', issues: [{ severity: 'unsupported',
      code: 'provider_contract_unavailable', path: '$.strength',
      message: 'The complete matching strength prescription is required; the v1 summary cannot be sent to Wahoo.' }] };
  }
  const issues: PlannedWorkoutProviderMappingAssessmentV1['issues'] = [{ severity: 'degraded',
    code: 'sport_profile_degraded', path: '$.strength',
    message: 'Wahoo Gym uses timed sets/rests. Names and kilogram loads are instructions, not native rep/load tracking. Rounded load instructions require review.' }];
  details.exercises.forEach((exercise, i) => exercise.sets.forEach((set, j) => {
    const path = `$.strength.exercises[${i}].sets[${j}]`;
    if (set.ending.kind !== 'time') issues.push({ severity: 'unsupported', code: 'unsupported_ending',
      path: `${path}.ending`, message: 'Wahoo strength delivery requires timed sets; repetition sets cannot be sent or converted to estimated time.' });
    if (set.externalLoadKg !== undefined && Number(new DataWeight(set.externalLoadKg).getDisplayValue()) !== set.externalLoadKg) {
      issues.push({ severity: 'degraded', code: 'purpose_degraded', path: `${path}.externalLoadKg`,
        message: 'Wahoo rounds this kilogram load instruction using Sports Lib display; it has no exact native load field. Review the rounded load before sending. QS keeps the exact prescription.' });
    }
  }));
  return { provider: 'wahoo', level: issues.some(issue => issue.severity === 'unsupported') ? 'unsupported' : 'degraded',
    // Preserve a blocking issue even when many earlier loads need rounding review.
    issues: [...issues.filter(issue => issue.severity === 'unsupported'), ...issues.filter(issue => issue.severity === 'degraded')].slice(0, 20) };
}
