import { createHash } from 'node:crypto';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import { ActivityTypes, WeightUnits, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '../../../../../shared/unit-aware-display';
import { strengthProjectionMatchesDetails, type StrengthWorkoutDetailsV1 } from '../../../../../shared/strength-workout';
import { serializeSuuntoGuideJsonV1, serializeSuuntoStrengthGuideV1, serializeSuuntoGuideV2ForRecovery,
  serializeSuuntoStrengthGuideV2ForRecovery, serializeSuuntoGuideV3ForRecovery,
  serializeSuuntoStrengthGuideV3ForRecovery, serializeSuuntoGuideV4ForRecovery,
  serializeSuuntoStrengthGuideV4ForRecovery, serializeSuuntoStrengthGuideV7ForRecovery,
  serializeSuuntoGuideV5ForRecovery, serializeSuuntoGuideV6ForRecovery, serializeSuuntoGuideV7ForRecovery, serializeSuuntoGuideV9ForRecovery, serializeSuuntoGuideV10ForRecovery, serializeSuuntoGuideV11ForRecovery, serializeSuuntoGuideV12ForRecovery } from '../../providers/suunto-guide.serializer';
import { hasSuuntoRestPresentation } from '../../providers/suunto-rest-presentation';
import { suuntoGuideDescription, withSuuntoGuideDescription } from '../../providers/suunto-guide-description';
import { ProviderWorkoutMappingError } from '../../providers/provider-mapping';
import { hashTrainingScheduleRequestPayload } from '../../persistence';
import type { DeliveryAssessment, DeliveryOperation } from '../contracts';

// App-only descriptions use a new identity; historical watch graphs stay frozen.
export const SUUNTO_MAPPING_VERSION = 'suunto-guides-v13';
const REST_MAPPING_VERSION = 'suunto-guides-v12';
const MANUAL_MAPPING_VERSION = 'suunto-guides-v11';
const STRENGTH_MAPPING_VERSION = 'suunto-guides-v8';
const POOL_SCREEN_MAPPING_VERSION = 'suunto-guides-v9';
const SWIM_MAPPING_VERSION = 'suunto-guides-v10';
const LEGACY_MAPPING_VERSIONS = ['suunto-guides-v12', 'suunto-guides-v11', 'suunto-guides-v7', 'suunto-guides-v6', 'suunto-guides-v5', 'suunto-guides-v4', 'suunto-guides-v3', 'suunto-guides-v2'] as const;
// Choose the unchanged watch graph underneath v13's app-only metadata.
function watchMappingVersion(workout: ScheduledWorkoutV1): string {
  return workout.structure.sport === ActivityTypes.StrengthTraining ? STRENGTH_MAPPING_VERSION
    : hasSuuntoRestPresentation(workout.structure) ? REST_MAPPING_VERSION
    : [ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming].includes(workout.structure.sport) ? SWIM_MAPPING_VERSION
      : workout.structure.nodes.some(node => (node.kind === 'step' ? [node] : node.steps)
        .some(step => step.ending.kind === 'manual' && !step.note)) ? MANUAL_MAPPING_VERSION : 'suunto-guides-v7';
}
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
  strength?: StrengthWorkoutDetailsV1 | null, weightUnits?: WeightUnits, unitSettings?: UserUnitSettingsInterface) {
  return mapGuide(workout, destination, owner, strength, SUUNTO_MAPPING_VERSION, weightUnits, unitSettings);
}
function mapGuide(workout: ScheduledWorkoutV1, destination: string, owner: string,
  strength: StrengthWorkoutDetailsV1 | null | undefined, version: string, weightUnits?: WeightUnits,
  unitSettings?: UserUnitSettingsInterface): ReturnType<typeof serializeSuuntoGuideJsonV1> {
  if (version === SUUNTO_MAPPING_VERSION) {
    const settings = normalizeUserUnitSettings({ ...unitSettings, ...(weightUnits ? { weightUnits } : {}) });
    const result = mapGuide(workout, destination, owner, strength, watchMappingVersion(workout), settings.weightUnits);
    return { ...result, artifact: withSuuntoGuideDescription(result.artifact,
      suuntoGuideDescription(workout.structure, workout.title, settings, strength)) };
  }
  if (workout.structure.sport === ActivityTypes.StrengthTraining &&
    (!strength || strength.workoutId !== workout.id || !strengthProjectionMatchesDetails(workout.structure, strength))) {
    throw new ProviderWorkoutMappingError('suunto', 'unsupported', [{ severity: 'unsupported',
      code: 'strength_details_missing', path: '$.strength', message: 'The complete strength prescription is unavailable or mismatched.' }]);
  }
  const options = { name: workout.title, owner: validateGuideOwner(owner),
    url: 'https://quantified-self.io/training/plans', localDate: workout.localDate,
    sourceWorkoutId: workout.id, externalId: guideExternalId(destination, workout.id), allowDegraded: true,
    ...(version === STRENGTH_MAPPING_VERSION ? { weightUnits } : {}) };
  const recipeSerializer = version === 'suunto-guides-v2' ? serializeSuuntoGuideV2ForRecovery
    : version === 'suunto-guides-v3' ? serializeSuuntoGuideV3ForRecovery
      : version === 'suunto-guides-v4' ? serializeSuuntoGuideV4ForRecovery
        : version === 'suunto-guides-v5' ? serializeSuuntoGuideV5ForRecovery
          : version === 'suunto-guides-v6' ? serializeSuuntoGuideV6ForRecovery
            : version === REST_MAPPING_VERSION ? serializeSuuntoGuideV12ForRecovery
              : version === MANUAL_MAPPING_VERSION ? serializeSuuntoGuideV11ForRecovery
              : version === SWIM_MAPPING_VERSION ? serializeSuuntoGuideV10ForRecovery
                : version === POOL_SCREEN_MAPPING_VERSION ? serializeSuuntoGuideV9ForRecovery : serializeSuuntoGuideV7ForRecovery;
  const strengthSerializer = version === 'suunto-guides-v2' ? serializeSuuntoStrengthGuideV2ForRecovery
    : version === 'suunto-guides-v3' ? serializeSuuntoStrengthGuideV3ForRecovery
      : version === 'suunto-guides-v4' ? serializeSuuntoStrengthGuideV4ForRecovery
        : version === STRENGTH_MAPPING_VERSION ? serializeSuuntoStrengthGuideV1 : serializeSuuntoStrengthGuideV7ForRecovery;
  return strength
    ? strengthSerializer(strength, options) : recipeSerializer(workout.structure, options);
}
export function assessSuuntoGuide(workout: ScheduledWorkoutV1, destination: string, zone: string, owner: string,
  strength?: StrengthWorkoutDetailsV1 | null, weightUnits?: WeightUnits, unitSettings?: UserUnitSettingsInterface,
  approvalUnitSettings?: readonly UserUnitSettingsInterface[]): DeliveryAssessment {
  const current = inspectGuide(workout, destination, zone, owner, strength, SUUNTO_MAPPING_VERSION, weightUnits, unitSettings);
  const result = current.assessment;
  if (result.level === 'degraded' && result.requiresApproval !== false) {
    const candidates = LEGACY_MAPPING_VERSIONS.filter(version => version !== result.mappingVersion).map(version =>
      inspectGuide(workout, destination, zone, owner, strength, version));
    // At most the originally approved and most recent proved unit snapshots.
    // Recompute full payload/loss identities; never trust a unit-only public claim.
    for (const units of approvalUnitSettings?.slice(0, 2) ?? []) {
      candidates.push(inspectGuide(workout, destination, zone, owner, strength, SUUNTO_MAPPING_VERSION,
        units.weightUnits, units));
    }
    if (workout.structure.sport === ActivityTypes.Swimming) candidates.push(
      inspectGuide(workout, destination, zone, owner, strength, POOL_SCREEN_MAPPING_VERSION));
    if ([ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming].includes(workout.structure.sport)) candidates.push(
      inspectGuide(workout, destination, zone, owner, strength, SWIM_MAPPING_VERSION));
    if (strength) {
      const units = normalizeUserUnitSettings({ ...unitSettings, ...(weightUnits ? { weightUnits } : {}) }).weightUnits;
      const alternateUnits = units === WeightUnits.Kilograms ? WeightUnits.Pounds : WeightUnits.Kilograms;
      candidates.push(inspectGuide(workout, destination, zone, owner, strength, STRENGTH_MAPPING_VERSION, units));
      candidates.push(inspectGuide(workout, destination, zone, owner, strength, STRENGTH_MAPPING_VERSION, alternateUnits));
      candidates.push(inspectGuide(workout, destination, zone, owner, strength, SUUNTO_MAPPING_VERSION, alternateUnits, unitSettings));
    }
    // Approval can carry across units only for the same complete prescription
    // and complete losses, including paths beyond the bounded public issues.
    // Intent still requires retained full-content evidence and current consent.
    const compatibleApprovalDigests = candidates.filter(candidate =>
      candidate.assessment.level === 'degraded' && candidate.assessment.requiresApproval !== false
      && current.lossSignature === candidate.lossSignature).map(candidate => candidate.assessment.digest);
    if (compatibleApprovalDigests.length) return { ...result, compatibleApprovalDigests };
  }
  return result;
}
/** Never starts a delivery. Used to prove the identity of an already-started v2 attempt. */
export function assessSuuntoGuideV2ForRecovery(workout: ScheduledWorkoutV1, destination: string, zone: string, owner: string,
  strength?: StrengthWorkoutDetailsV1 | null): DeliveryAssessment {
  return assessGuide(workout, destination, zone, owner, strength, 'suunto-guides-v2');
}
/** Recovery/approval equivalence only; never authors a new current delivery. */
export function assessSuuntoGuideV3ForRecovery(workout: ScheduledWorkoutV1, destination: string, zone: string, owner: string,
  strength?: StrengthWorkoutDetailsV1 | null): DeliveryAssessment {
  return assessGuide(workout, destination, zone, owner, strength, 'suunto-guides-v3');
}
/** Recovery/approval equivalence only; never authors a new current delivery. */
export function assessSuuntoGuideV4ForRecovery(workout: ScheduledWorkoutV1, destination: string, zone: string, owner: string,
  strength?: StrengthWorkoutDetailsV1 | null): DeliveryAssessment {
  return assessGuide(workout, destination, zone, owner, strength, 'suunto-guides-v4');
}
/** Frozen v5 recovery/approval identity only; no new historical delivery. */
export function assessSuuntoGuideV5ForRecovery(workout: ScheduledWorkoutV1, destination: string, zone: string, owner: string,
  strength?: StrengthWorkoutDetailsV1 | null): DeliveryAssessment {
  return assessGuide(workout, destination, zone, owner, strength, 'suunto-guides-v5');
}

/** Frozen v6 recovery/approval identity only; no new historical delivery. */
export function assessSuuntoGuideV6ForRecovery(workout: ScheduledWorkoutV1, destination: string, zone: string, owner: string,
  strength?: StrengthWorkoutDetailsV1 | null): DeliveryAssessment {
  return assessGuide(workout, destination, zone, owner, strength, 'suunto-guides-v6');
}

/** Frozen v7 identity: canonical kg strength text and historical pool-SWOLF interval screens. */
export function assessSuuntoGuideV7ForRecovery(workout: ScheduledWorkoutV1, destination: string, zone: string, owner: string,
  strength?: StrengthWorkoutDetailsV1 | null): DeliveryAssessment {
  return assessGuide(workout, destination, zone, owner, strength, 'suunto-guides-v7');
}

/** Frozen pool-only v9 identity; no new historical delivery. */
export function assessSuuntoGuideV9ForRecovery(workout: ScheduledWorkoutV1, destination: string, zone: string, owner: string): DeliveryAssessment {
  return assessGuide(workout, destination, zone, owner, undefined, POOL_SCREEN_MAPPING_VERSION);
}

/** Frozen v10/v11 identities; never initiate a new historical delivery. */
export function assessSuuntoGuideV10ForRecovery(workout: ScheduledWorkoutV1, destination: string, zone: string, owner: string): DeliveryAssessment {
  return assessGuide(workout, destination, zone, owner, undefined, SWIM_MAPPING_VERSION);
}
export function assessSuuntoGuideV11ForRecovery(workout: ScheduledWorkoutV1, destination: string, zone: string, owner: string): DeliveryAssessment {
  return assessGuide(workout, destination, zone, owner, undefined, MANUAL_MAPPING_VERSION);
}
export function assessSuuntoGuideV12ForRecovery(workout: ScheduledWorkoutV1, destination: string, zone: string, owner: string): DeliveryAssessment {
  return assessGuide(workout, destination, zone, owner, undefined, REST_MAPPING_VERSION);
}

function digestBase(destination: string, zone: string, owner: string,
  strength: StrengthWorkoutDetailsV1 | null | undefined, version: string, weightUnits?: WeightUnits) {
  return { mappingVersion: version, destination, zone, owner,
    ...(strength && version === STRENGTH_MAPPING_VERSION
      ? { weightUnits: normalizeUserUnitSettings({ weightUnits }).weightUnits } : {}),
    ...(strength ? { strength: strength.exercises } : {}) };
}
function assessGuide(workout: ScheduledWorkoutV1, destination: string, zone: string, owner: string,
  strength: StrengthWorkoutDetailsV1 | null | undefined, version: string, weightUnits?: WeightUnits): DeliveryAssessment {
  return inspectGuide(workout, destination, zone, owner, strength, version, weightUnits).assessment;
}
/** The complete loss signature is transient, never exposed or journaled. */
function inspectGuide(workout: ScheduledWorkoutV1, destination: string, zone: string, owner: string,
  strength: StrengthWorkoutDetailsV1 | null | undefined, version: string, weightUnits?: WeightUnits,
  unitSettings?: UserUnitSettingsInterface): {
    assessment: DeliveryAssessment; lossSignature: string;
  } {
  const base = digestBase(destination, zone, owner, strength, version, weightUnits);
  try {
    const result = mapGuide(workout, destination, owner, strength, version, weightUnits, unitSettings);
    return { lossSignature: JSON.stringify(result.issues), assessment: {
      level: result.level, issues: result.issues.map(issue => issue.message).slice(0, 20),
      ...(result.requiresApproval === undefined ? {} : { requiresApproval: result.requiresApproval }),
      digest: hashTrainingScheduleRequestPayload({ ...base, payload: result.artifact }), mappingVersion: version } };
  } catch (error) {
    if (!(error instanceof ProviderWorkoutMappingError)) throw error;
    return { lossSignature: JSON.stringify(error.issues), assessment: {
      level: 'unsupported', issues: error.issues.map(issue => issue.message).slice(0, 20),
      digest: hashTrainingScheduleRequestPayload({ ...base, workout }), mappingVersion: version } };
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
  const versions: string[] = [SUUNTO_MAPPING_VERSION, STRENGTH_MAPPING_VERSION, ...LEGACY_MAPPING_VERSIONS];
  if (operation.workout.structure.sport === ActivityTypes.Swimming) versions.unshift(POOL_SCREEN_MAPPING_VERSION);
  if ([ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming].includes(operation.workout.structure.sport)) versions.unshift(SWIM_MAPPING_VERSION);
  for (const version of versions) {
    try {
      const payload = mapGuide(operation.workout, operation.destinationKey, owner, operation.strength, version,
        operation.suuntoWeightUnits, operation.suuntoUnitSettings).artifact;
      const digest = hashTrainingScheduleRequestPayload({
        ...digestBase(operation.destinationKey, operation.timeZone, owner, operation.strength, version, operation.suuntoWeightUnits), payload,
      });
      if (digest === operation.digest) return { mappingVersion: version, payload };
    } catch (error) {
      if (!(error instanceof ProviderWorkoutMappingError)) throw error;
      continue;
    }
  }
  return null;
}
