import { createHash } from 'node:crypto';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { strengthProjectionMatchesDetails, type StrengthWorkoutDetailsV1 } from '../../../../../shared/strength-workout';
import { serializeSuuntoGuideJsonV1, serializeSuuntoStrengthGuideV1, serializeSuuntoGuideV2ForRecovery,
  serializeSuuntoStrengthGuideV2ForRecovery } from '../../providers/suunto-guide.serializer';
import { ProviderWorkoutMappingError } from '../../providers/provider-mapping';
import { hashTrainingScheduleRequestPayload } from '../../persistence';
import type { DeliveryAssessment, DeliveryOperation } from '../contracts';

// Adding a previously unsupported sport must not churn digests for existing Guides.
export const SUUNTO_MAPPING_VERSION = 'suunto-guides-v3';
const LEGACY_MAPPING_VERSION = 'suunto-guides-v2';
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
  return mapGuide(workout, destination, owner, strength, SUUNTO_MAPPING_VERSION);
}
function mapGuide(workout: ScheduledWorkoutV1, destination: string, owner: string,
  strength: StrengthWorkoutDetailsV1 | null | undefined, version: string) {
  if (workout.structure.sport === ActivityTypes.StrengthTraining &&
    (!strength || strength.workoutId !== workout.id || !strengthProjectionMatchesDetails(workout.structure, strength))) {
    throw new ProviderWorkoutMappingError('suunto', 'unsupported', [{ severity: 'unsupported',
      code: 'strength_details_missing', path: '$.strength', message: 'The complete strength prescription is unavailable or mismatched.' }]);
  }
  const options = { name: workout.title, owner: validateGuideOwner(owner),
    url: 'https://quantified-self.io/training/plans', localDate: workout.localDate,
    sourceWorkoutId: workout.id, externalId: guideExternalId(destination, workout.id), allowDegraded: true };
  const legacy = version === LEGACY_MAPPING_VERSION;
  return strength
    ? (legacy ? serializeSuuntoStrengthGuideV2ForRecovery : serializeSuuntoStrengthGuideV1)(strength, options)
    : (legacy ? serializeSuuntoGuideV2ForRecovery : serializeSuuntoGuideJsonV1)(workout.structure, options);
}
export function assessSuuntoGuide(workout: ScheduledWorkoutV1, destination: string, zone: string, owner: string,
  strength?: StrengthWorkoutDetailsV1 | null): DeliveryAssessment {
  const result = assessGuide(workout, destination, zone, owner, strength, SUUNTO_MAPPING_VERSION);
  if (result.level === 'degraded' && result.requiresApproval !== false) {
    const legacy = assessSuuntoGuideV2ForRecovery(workout, destination, zone, owner, strength);
    // Only the same metadata, recipe, destination and losses can inherit approval.
    if (legacy.level === 'degraded' && legacy.requiresApproval !== false
      && JSON.stringify(result.issues) === JSON.stringify(legacy.issues)) {
      return { ...result, compatibleApprovalDigest: legacy.digest };
    }
  }
  return result;
}
/** Never starts a delivery. Used to prove the identity of an already-started v2 attempt. */
export function assessSuuntoGuideV2ForRecovery(workout: ScheduledWorkoutV1, destination: string, zone: string, owner: string,
  strength?: StrengthWorkoutDetailsV1 | null): DeliveryAssessment {
  return assessGuide(workout, destination, zone, owner, strength, LEGACY_MAPPING_VERSION);
}
function digestBase(destination: string, zone: string, owner: string,
  strength: StrengthWorkoutDetailsV1 | null | undefined, version: string) {
  return { mappingVersion: version, destination, zone, owner,
    ...(strength ? { strength: strength.exercises } : {}) };
}
function assessGuide(workout: ScheduledWorkoutV1, destination: string, zone: string, owner: string,
  strength: StrengthWorkoutDetailsV1 | null | undefined, version: string): DeliveryAssessment {
  const base = digestBase(destination, zone, owner, strength, version);
  try {
    const result = mapGuide(workout, destination, owner, strength, version);
    return { level: result.level, issues: result.issues.map(issue => issue.message).slice(0, 20),
      ...(result.requiresApproval === undefined ? {} : { requiresApproval: result.requiresApproval }),
      digest: hashTrainingScheduleRequestPayload({ ...base, payload: result.artifact }), mappingVersion: version };
  } catch (error) {
    if (!(error instanceof ProviderWorkoutMappingError)) throw error;
    return { level: 'unsupported', issues: error.issues.map(issue => issue.message).slice(0, 20),
      digest: hashTrainingScheduleRequestPayload({ ...base, workout }), mappingVersion: version };
  }
}

/** Select the exact historical payload by its journaled digest, never by remote
 * resemblance alone. Unknown versions/content remain uncertain; no speculative POST. */
export function guidePayloadForRecovery(operation: DeliveryOperation, owner: string) {
  return guideMappingForRecovery(operation, owner)?.payload ?? null;
}

/** Transient classification shared by recovery and private diagnostics. Never
 * infer a version from the current adapter when the operation predates it. */
export function guideMappingForRecovery(operation: DeliveryOperation, owner: string) {
  if (!operation.workout || operation.kind !== 'upsert') return null;
  for (const version of [SUUNTO_MAPPING_VERSION, LEGACY_MAPPING_VERSION]) {
    try {
      const payload = mapGuide(operation.workout, operation.destinationKey, owner, operation.strength, version).artifact;
      const digest = hashTrainingScheduleRequestPayload({
        ...digestBase(operation.destinationKey, operation.timeZone, owner, operation.strength, version), payload,
      });
      if (digest === operation.digest) return { mappingVersion: version, payload };
    } catch (error) {
      if (!(error instanceof ProviderWorkoutMappingError)) throw error;
      return null;
    }
  }
  return null;
}
