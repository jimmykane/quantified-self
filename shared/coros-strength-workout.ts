import type { WorkoutStructureV1 } from './planned-workout';
import { parseStrengthWorkoutDetailsV1, strengthProjectionMatchesDetails, type StrengthWorkoutDetailsV1 } from './strength-workout';
import type { PlannedWorkoutProviderMappingAssessmentV1 } from './planned-workout-providers';

/** COROS API Reference V2.0.6 §6.1: named individual sets, Reps/Second, Rest and fixed kg load.
 * A v1 compatibility summary alone never establishes the complete prescription. */
export function assessCorosStrengthWorkoutV1(structure: WorkoutStructureV1,
  value?: StrengthWorkoutDetailsV1 | null): PlannedWorkoutProviderMappingAssessmentV1 {
  try {
    const details = parseStrengthWorkoutDetailsV1(value);
    if (!strengthProjectionMatchesDetails(structure, details)) throw new Error('Mismatched prescription');
    return { provider: 'coros', level: 'exact', issues: [] };
  } catch {
    return { provider: 'coros', level: 'unsupported', issues: [{ severity: 'unsupported',
      code: 'provider_contract_unavailable', path: '$.strength',
      message: 'The complete matching strength prescription is required; the v1 summary cannot be sent to COROS.' }] };
  }
}
