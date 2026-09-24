import { createHash } from 'node:crypto';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { strengthProjectionMatchesDetails, type StrengthWorkoutDetailsV1 } from '../../../../../shared/strength-workout';
import { serializeSuuntoGuideJsonV1, serializeSuuntoStrengthGuideV1 } from '../../providers/suunto-guide.serializer';
import { ProviderWorkoutMappingError } from '../../providers/provider-mapping';
import { hashTrainingScheduleRequestPayload } from '../../persistence';
import type { DeliveryAssessment } from '../contracts';

// Adding a previously unsupported sport must not churn digests for existing Guides.
export const SUUNTO_MAPPING_VERSION = 'suunto-guides-v1';
// Destination already incorporates Firebase UID + provider account. Do not reuse
// a plain workout ID: two QS users may legitimately connect the same Suunto account.
export function guideExternalId(destination: string, workoutId: string): string {
  return `qs-suunto-${createHash('sha256').update(JSON.stringify([destination, workoutId])).digest('base64url')}`;
}
export function validateGuideOwner(owner: string): string {
  if (!owner || owner !== owner.trim() || Array.from(owner).length > 64
    || Array.from(owner).some(character => character.charCodeAt(0) < 32)) throw new Error('Suunto Guide application name is not configured.');
  return owner;
}
export function guideMapping(workout: ScheduledWorkoutV1, destination: string, owner: string,
  strength?: StrengthWorkoutDetailsV1 | null) {
  if (workout.structure.sport === ActivityTypes.StrengthTraining &&
    (!strength || strength.workoutId !== workout.id || !strengthProjectionMatchesDetails(workout.structure, strength))) {
    throw new ProviderWorkoutMappingError('suunto', 'unsupported', [{ severity: 'unsupported',
      code: 'strength_details_missing', path: '$.strength', message: 'The complete strength prescription is unavailable or mismatched.' }]);
  }
  const options = { name: workout.title, owner: validateGuideOwner(owner),
    url: 'https://quantified-self.io/training/plans', localDate: workout.localDate,
    sourceWorkoutId: workout.id, externalId: guideExternalId(destination, workout.id), allowDegraded: true };
  return strength
    ? serializeSuuntoStrengthGuideV1(strength, options)
    : serializeSuuntoGuideJsonV1(workout.structure, options);
}
export function assessSuuntoGuide(workout: ScheduledWorkoutV1, destination: string, zone: string, owner: string,
  strength?: StrengthWorkoutDetailsV1 | null): DeliveryAssessment {
  const base = { mappingVersion: SUUNTO_MAPPING_VERSION, destination, zone, owner,
    ...(strength ? { strength: strength.exercises } : {}) };
  try {
    const result = guideMapping(workout, destination, owner, strength);
    return { level: result.level, issues: result.issues.map(issue => issue.message).slice(0, 20),
      digest: hashTrainingScheduleRequestPayload({ ...base, payload: result.artifact }), mappingVersion: SUUNTO_MAPPING_VERSION };
  } catch (error) {
    if (!(error instanceof ProviderWorkoutMappingError)) throw error;
    return { level: 'unsupported', issues: error.issues.map(issue => issue.message).slice(0, 20),
      digest: hashTrainingScheduleRequestPayload({ ...base, workout }), mappingVersion: SUUNTO_MAPPING_VERSION };
  }
}
