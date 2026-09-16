import { createHash } from 'node:crypto';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import { serializeSuuntoGuideJsonV1 } from '../../providers/suunto-guide.serializer';
import { ProviderWorkoutMappingError } from '../../providers/provider-mapping';
import { hashTrainingScheduleRequestPayload } from '../../persistence';
import type { DeliveryAssessment } from '../contracts';

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
export function guideMapping(workout: ScheduledWorkoutV1, destination: string, owner: string) {
  return serializeSuuntoGuideJsonV1(workout.structure, { name: workout.title, owner: validateGuideOwner(owner),
    url: 'https://quantified-self.io/training/plans', localDate: workout.localDate,
    sourceWorkoutId: workout.id, externalId: guideExternalId(destination, workout.id), allowDegraded: true });
}
export function assessSuuntoGuide(workout: ScheduledWorkoutV1, destination: string, zone: string, owner: string): DeliveryAssessment {
  const base = { mappingVersion: SUUNTO_MAPPING_VERSION, destination, zone, owner };
  try {
    const result = guideMapping(workout, destination, owner);
    return { level: result.level, issues: result.issues.map(issue => issue.message).slice(0, 20),
      digest: hashTrainingScheduleRequestPayload({ ...base, payload: result.artifact }), mappingVersion: SUUNTO_MAPPING_VERSION };
  } catch (error) {
    if (!(error instanceof ProviderWorkoutMappingError)) throw error;
    return { level: 'unsupported', issues: error.issues.map(issue => issue.message).slice(0, 20),
      digest: hashTrainingScheduleRequestPayload({ ...base, workout }), mappingVersion: SUUNTO_MAPPING_VERSION };
  }
}
