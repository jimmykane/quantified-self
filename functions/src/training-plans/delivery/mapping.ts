import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { ScheduledWorkoutV1 } from '../../../../shared/training-plans';
import type { PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import { hashTrainingScheduleRequestPayload } from '../persistence';
import { serializeGarminWorkoutV1, serializeGarminStrengthWorkoutV1 } from '../providers/garmin-workout.serializer';
import { serializeCorosTrainingPlanV1, serializeCorosStrengthPlanV1,
  type SerializeCorosTrainingPlanOptionsV1 } from '../providers/coros-training-plan.serializer';
import { parseStrengthWorkoutDetailsV1, strengthProjectionMatchesDetails, type StrengthWorkoutDetailsV1 } from '../../../../shared/strength-workout';
import { serializeWahooPlanJsonV1, serializeWahooStrengthPlanV1 } from '../providers/wahoo-plan.serializer';
import { serializeSuuntoGuideJsonV1 } from '../providers/suunto-guide.serializer';
import { ProviderWorkoutMappingError } from '../providers/provider-mapping';
import type { DeliveryAssessment } from './contracts';

export const TRAINING_DELIVERY_MAPPING_VERSION = 'fixtures-v1';
/** Pool swims still require Pro, explicit consent, connection authority and compatible step mapping. */
export const GARMIN_POOL_SWIMMING_DELIVERY_READY = true;
export function corosWorkoutMapping(workout: ScheduledWorkoutV1, strength: StrengthWorkoutDetailsV1 | null | undefined,
  options: SerializeCorosTrainingPlanOptionsV1) {
  if (workout.structure.sport !== ActivityTypes.StrengthTraining) return serializeCorosTrainingPlanV1(workout.structure, options);
  let details: StrengthWorkoutDetailsV1;
  try {
    details = parseStrengthWorkoutDetailsV1(strength);
    if (details.workoutId !== workout.id || !strengthProjectionMatchesDetails(workout.structure, details)) throw new Error('Mismatched prescription');
  } catch {
    throw new ProviderWorkoutMappingError('coros', 'unsupported', [{ severity: 'unsupported',
      code: 'provider_contract_unavailable', path: '$.strength', message: 'The complete matching strength prescription is required.' }]);
  }
  return serializeCorosStrengthPlanV1(details, options);
}
export function garminWorkoutMapping(workout: ScheduledWorkoutV1, strength?: StrengthWorkoutDetailsV1 | null) {
  const options = { name: workout.title, allowDegraded: true };
  if (workout.structure.sport !== ActivityTypes.StrengthTraining) return serializeGarminWorkoutV1(workout.structure, options);
  let details: StrengthWorkoutDetailsV1;
  try {
    details = parseStrengthWorkoutDetailsV1(strength);
    if (details.workoutId !== workout.id || !strengthProjectionMatchesDetails(workout.structure, details)) throw new Error('Mismatched prescription');
  } catch {
    throw new ProviderWorkoutMappingError('garmin', 'unsupported', [{ severity: 'unsupported',
      code: 'provider_contract_unavailable', path: '$.strength', message: 'The complete matching strength prescription is required.' }]);
  }
  return serializeGarminStrengthWorkoutV1(details, options);
}
export function wahooWorkoutMapping(workout: ScheduledWorkoutV1, strength?: StrengthWorkoutDetailsV1 | null) {
  if (workout.structure.sport !== ActivityTypes.StrengthTraining) return serializeWahooPlanJsonV1(workout.structure,
    { name: workout.title, description: workout.title, location: 'outdoor', allowDegraded: true });
  let details: StrengthWorkoutDetailsV1;
  try {
    details = parseStrengthWorkoutDetailsV1(strength);
    if (details.workoutId !== workout.id || !strengthProjectionMatchesDetails(workout.structure, details)) throw new Error('Mismatched prescription');
  } catch {
    throw new ProviderWorkoutMappingError('wahoo', 'unsupported', [{ severity: 'unsupported',
      code: 'provider_contract_unavailable', path: '$.strength', message: 'The complete matching strength prescription is required.' }]);
  }
  return serializeWahooStrengthPlanV1(details, { name: workout.title, allowDegraded: true });
}
/** Fixture assessment is available without provider access; serialization is NOT delivery. */
export function assessTrainingDeliveryMapping(provider: PlannedWorkoutProviderId, workout: ScheduledWorkoutV1,
  destinationKey: string, timeZone: string, strength?: StrengthWorkoutDetailsV1 | null): DeliveryAssessment {
  const digest = hashTrainingScheduleRequestPayload({ provider, destinationKey, timeZone,
    mappingVersion: TRAINING_DELIVERY_MAPPING_VERSION, title: workout.title, localDate: workout.localDate, structure: workout.structure,
    ...((provider === 'garmin' || provider === 'coros' || provider === 'wahoo') && workout.structure.sport === ActivityTypes.StrengthTraining
      && strength ? { strength: strength.exercises } : {}) });
  if (provider === 'garmin' && workout.structure.sport === ActivityTypes.Swimming
    && !GARMIN_POOL_SWIMMING_DELIVERY_READY) {
    return { level: 'unsupported', issues: ['Garmin pool-swim delivery is temporarily unavailable (#733).'],
      digest, mappingVersion: TRAINING_DELIVERY_MAPPING_VERSION };
  }
  try {
    const options = { name: workout.title, allowDegraded: true };
    const result = provider === 'garmin' ? garminWorkoutMapping(workout, strength)
      : provider === 'coros' ? corosWorkoutMapping(workout, strength, {
        athleteId: 1, sourceWorkoutId: destinationKey, title: workout.title, localDate: workout.localDate,
        lastModifiedDate: `${workout.localDate}T00:00:00`, allowDegraded: true,
      }) : provider === 'wahoo' ? wahooWorkoutMapping(workout, strength)
        : serializeSuuntoGuideJsonV1(workout.structure, { ...options, owner: 'Quantified Self',
          url: 'https://quantified-self.io', localDate: workout.localDate, sourceWorkoutId: destinationKey });
    return { level: result.level, ...(result.requiresApproval === undefined ? {} : { requiresApproval: result.requiresApproval }),
      issues: result.issues.map(issue => issue.message).slice(0, 20), digest, mappingVersion: TRAINING_DELIVERY_MAPPING_VERSION };
  } catch (error) {
    if (!(error instanceof ProviderWorkoutMappingError)) throw error;
    return { level: 'unsupported', issues: error.issues.map(issue => issue.message).slice(0, 20), digest, mappingVersion: TRAINING_DELIVERY_MAPPING_VERSION };
  }
}
