import { ActivityTypes } from '@sports-alliance/sports-lib';
import {
  parseWorkoutStructureV1,
  type WorkoutCompatibilityProfileV1,
  type WorkoutStepV1,
  type WorkoutStructureV1,
  type WorkoutTargetV1,
} from './planned-workout';

export const PLANNED_WORKOUT_PROVIDER_IDS = ['garmin', 'coros', 'wahoo', 'suunto'] as const;
export type PlannedWorkoutProviderId = typeof PLANNED_WORKOUT_PROVIDER_IDS[number];

export type PlannedWorkoutProviderImplementationState =
  | 'blocked-contract'
  | 'fixture-only'
  | 'private-rollout'
  | 'sandbox-verified'
  | 'enabled';

export type PlannedWorkoutProviderDeliveryModel =
  | 'native-workout-and-schedule'
  | 'native-plan-workout-batches'
  | 'plan-library-plus-dated-workout'
  | 'dated-guide';

export interface PlannedWorkoutProviderCapabilityV1 {
  id: PlannedWorkoutProviderId;
  label: string;
  implementationState: PlannedWorkoutProviderImplementationState;
  deliveryEnabled: boolean;
  deliveryModel: PlannedWorkoutProviderDeliveryModel;
  requiredScopes: readonly string[];
  profile: WorkoutCompatibilityProfileV1 | null;
  scheduling: string;
  limits: readonly string[];
  completionCorrelation: string;
  unresolvedGates: readonly string[];
  evidence: readonly string[];
}

export type PlannedWorkoutProviderMappingLevel = 'exact' | 'degraded' | 'unsupported';

/** Suunto Guide sport support proved against the provider activity catalog. */
export const SUUNTO_PLANNED_WORKOUT_SPORTS_V1 = [
  ActivityTypes.Running,
  ActivityTypes.TrailRunning,
  ActivityTypes.Treadmill,
  ActivityTypes.Cycling,
  ActivityTypes.MountainBiking,
  ActivityTypes.IndoorCycling,
  ActivityTypes.EBiking,
  ActivityTypes.Handcycle,
] as const;

/**
 * Garmin Training API V2 accepts only broad RUNNING/CYCLING workout sports.
 * Keep the exact authored QS sport, then fold these profiles at serialization.
 */
export const GARMIN_RUNNING_WORKOUT_SPORTS_V1 = [
  ActivityTypes.Running,
  ActivityTypes.TrailRunning,
  ActivityTypes.Treadmill,
  ActivityTypes.IndoorRunning,
  ActivityTypes.VirtualRunning,
] as const;

export const GARMIN_CYCLING_WORKOUT_SPORTS_V1 = [
  ActivityTypes.Cycling,
  ActivityTypes.MountainBiking,
  ActivityTypes.IndoorCycling,
  ActivityTypes.VirtualCycling,
  ActivityTypes.EBiking,
  ActivityTypes.Handcycle,
  ActivityTypes.Velomobile,
  ActivityTypes['Enduro MTB'],
  ActivityTypes.DownhillCycling,
] as const;

export const GARMIN_PLANNED_WORKOUT_SPORTS_V1 = [
  ...GARMIN_RUNNING_WORKOUT_SPORTS_V1,
  ...GARMIN_CYCLING_WORKOUT_SPORTS_V1,
] as const;

export const COROS_NATIVE_RUNNING_WORKOUT_SPORTS_V1 = [
  ActivityTypes.Running,
  ActivityTypes.TrailRunning,
] as const;

export const COROS_FOLDED_RUNNING_WORKOUT_SPORTS_V1 = [ActivityTypes.Treadmill] as const;

export const COROS_NATIVE_CYCLING_WORKOUT_SPORTS_V1 = [ActivityTypes.Cycling] as const;

export const COROS_FOLDED_CYCLING_WORKOUT_SPORTS_V1 = [
  ActivityTypes.MountainBiking,
  ActivityTypes.IndoorCycling,
  ActivityTypes.EBiking,
  ActivityTypes.Handcycle,
] as const;

export const COROS_PLANNED_WORKOUT_SPORTS_V1 = [
  ...COROS_NATIVE_RUNNING_WORKOUT_SPORTS_V1,
  ...COROS_FOLDED_RUNNING_WORKOUT_SPORTS_V1,
  ...COROS_NATIVE_CYCLING_WORKOUT_SPORTS_V1,
  ...COROS_FOLDED_CYCLING_WORKOUT_SPORTS_V1,
] as const;

export type CorosWorkoutSportFamilyV1 = 'RUNNING' | 'CYCLING';

export function corosWorkoutSportFamilyV1(sport: ActivityTypes): CorosWorkoutSportFamilyV1 | null {
  if (([...COROS_NATIVE_RUNNING_WORKOUT_SPORTS_V1, ...COROS_FOLDED_RUNNING_WORKOUT_SPORTS_V1] as readonly ActivityTypes[])
    .includes(sport)) return 'RUNNING';
  if (([...COROS_NATIVE_CYCLING_WORKOUT_SPORTS_V1, ...COROS_FOLDED_CYCLING_WORKOUT_SPORTS_V1] as readonly ActivityTypes[])
    .includes(sport)) return 'CYCLING';
  return null;
}

export type GarminWorkoutSportFamilyV1 = 'RUNNING' | 'CYCLING';

export function garminWorkoutSportFamilyV1(sport: ActivityTypes): GarminWorkoutSportFamilyV1 | null {
  if ((GARMIN_RUNNING_WORKOUT_SPORTS_V1 as readonly ActivityTypes[]).includes(sport)) return 'RUNNING';
  if ((GARMIN_CYCLING_WORKOUT_SPORTS_V1 as readonly ActivityTypes[]).includes(sport)) return 'CYCLING';
  return null;
}

export interface PlannedWorkoutProviderMappingIssueV1 {
  severity: Exclude<PlannedWorkoutProviderMappingLevel, 'exact'>;
  code:
    | 'provider_contract_unavailable'
    | 'unsupported_sport'
    | 'sport_profile_degraded'
    | 'unsupported_ending'
    | 'unsupported_target'
    | 'purpose_degraded'
    | 'multiple_targets_degraded'
    | 'relative_target_degraded'
    | 'relative_reference_conflict'
    | 'relative_target_device_support_limited';
  path: string;
  message: string;
}

export interface PlannedWorkoutProviderMappingAssessmentV1 {
  provider: PlannedWorkoutProviderId;
  level: PlannedWorkoutProviderMappingLevel;
  issues: PlannedWorkoutProviderMappingIssueV1[];
}

/**
 * Versioned provider research snapshot. Public delivery remains disabled until
 * each provider's documented contract and separately authorized live evidence
 * support the claimed lifecycle.
 */
export const PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1: Readonly<
  Record<PlannedWorkoutProviderId, PlannedWorkoutProviderCapabilityV1>
> = {
  garmin: {
    id: 'garmin',
    label: 'Garmin',
    implementationState: 'private-rollout',
    deliveryEnabled: false,
    deliveryModel: 'native-workout-and-schedule',
    requiredScopes: ['WORKOUT_IMPORT'],
    profile: {
      sports: GARMIN_PLANNED_WORKOUT_SPORTS_V1,
      endingKinds: ['time', 'distance', 'manual'],
      targetKinds: ['heart-rate', 'power', 'speed', 'cadence'],
      supportsRepeats: true,
      supportsRelativeTargets: false,
      maxNodes: 100,
      maxRepeatCount: 100,
      maxTargetsPerStep: 2,
    },
    scheduling: 'Workout content and Garmin Connect calendar scheduling have separate lifecycles.',
    limits: [
      'Single-sport workouts allow at most 100 total steps.',
      'Descriptions allow 1024 characters per workout and 512 characters per step.',
      'Training API V2 accepts RUNNING or CYCLING but has no sub-sport field; exact QS profiles are delivered through their broad family.',
      'A secondary target is documented only for cycling and depends on device support.',
      'Production limits: 3000 application requests per rolling minute including OAuth; 1000 per account per rolling day excluding OAuth.',
    ],
    completionCorrelation: 'Training API V2 does not document a completed-activity workout identifier.',
    unresolvedGates: [
      'Prove retained-ID missing/ownership response semantics and representative device behavior with the designated production account.',
      'Verify broad-family workouts from each authored subtype on representative compatible activity profiles before claiming profile-level device support.',
      'Confirm completion-correlation behavior outside the Training API contract.',
      'Complete bounded production-account create, update, reschedule, delete, reconnect, and duplicate evidence before broader rollout.',
    ],
    evidence: [
      'Garmin Connect Developer Program Training API V2, version 1.0 (private partner document, May 2025)',
      'https://developer.garmin.com/gc-developer-program/training-api/',
      'https://developer.garmin.com/gc-developer-program/program-faq/',
    ],
  },
  coros: {
    id: 'coros',
    label: 'COROS',
    implementationState: 'private-rollout',
    deliveryEnabled: false,
    deliveryModel: 'native-plan-workout-batches',
    requiredScopes: ['training-plan partner entitlement'],
    profile: {
      sports: COROS_PLANNED_WORKOUT_SPORTS_V1,
      endingKinds: ['time', 'distance', 'manual'],
      targetKinds: ['heart-rate', 'power', 'speed', 'cadence'],
      supportsRepeats: true,
      supportsRelativeTargets: true,
      maxTargetsPerStep: 1,
    },
    scheduling: 'Partner workout IDs are pushed in dated batches through the Training Plan API.',
    limits: ['At most 30 workouts per push.', 'Dates from today through one year ahead.'],
    completionCorrelation: 'Completed workout payloads may carry planWorkoutId.',
    unresolvedGates: [
      'Confirm Training Plan entitlement; provider code 30009 means access is unavailable.',
      'Confirm repeated-ID replacement and overlapping-window semantics with COROS.',
      'Record authorized create, repeated-ID update, overlapping-window preservation, reschedule, eligible-delete, completion-correlation, and app/watch evidence before broader rollout.',
    ],
    evidence: ['COROS API Reference V2.0.6 (partner document, February 2026)'],
  },
  wahoo: {
    id: 'wahoo',
    label: 'Wahoo',
    implementationState: 'private-rollout',
    deliveryEnabled: false,
    deliveryModel: 'plan-library-plus-dated-workout',
    requiredScopes: ['plans_read', 'plans_write', 'workouts_read', 'workouts_write'],
    profile: {
      sports: [ActivityTypes.Running, ActivityTypes.Cycling],
      endingKinds: ['time', 'distance', 'kilojoules'],
      targetKinds: ['heart-rate', 'power', 'speed', 'cadence'],
      supportsRepeats: true,
      supportsRelativeTargets: true,
      maxTargetsPerStep: 2,
    },
    scheduling: 'Create an app-owned Plan record, then attach it to a dated Workout record.',
    limits: [
      'The public plan.json schema is version 1.0.0 and supports running and cycling.',
      'Bike computers use only the first target in an interval.',
      'Relative heart-rate and threshold-speed targets are documented for treadmill workouts in the Wahoo app, not ELEMNT computers or RIVAL.',
      'Device-visible scheduling is documented as the current day plus six days.',
      'Private delivery requires time-based steps throughout; distance endings cannot supply the required Workout duration without an estimate.',
    ],
    completionCorrelation: 'Exact Workout, Plan and app-supplied workout_token identifiers can link a Wahoo-recorded activity; third-party-origin activities remain excluded.',
    unresolvedGates: [
      'Confirm existing production-app scope access, same-app ownership, and saved-timezone starts behavior in the private pilot.',
      'Complete production-account CRUD, reconnect, duplicate, and current-day-plus-six device tests; public delivery remains disabled.',
      'Absence and repair remain unavailable until owned inventory and negative-response semantics are proved.',
    ],
    evidence: [
      'https://cloud-api.wahooligan.com/',
      'https://cloud-api.wahooligan.com/docs/plan-json-format.pdf',
    ],
  },
  suunto: {
    id: 'suunto',
    label: 'Suunto',
    implementationState: 'private-rollout',
    deliveryEnabled: false,
    deliveryModel: 'dated-guide',
    requiredScopes: ['SuuntoPlus Guides entitlement', 'Existing Suunto API subscription key with Guides access', 'Existing Suunto OAuth authorization'],
    profile: {
      sports: SUUNTO_PLANNED_WORKOUT_SPORTS_V1,
      endingKinds: ['time', 'distance', 'manual'],
      targetKinds: ['heart-rate', 'power', 'speed', 'cadence'],
      supportsRepeats: true,
      supportsRelativeTargets: false,
      maxNodes: 100,
      maxRepeatCount: 100,
      maxTargetsPerStep: 2,
    },
    scheduling: 'Each scheduled workout becomes an app-owned SuuntoPlus Guide with a user-local localDate.',
    limits: [
      'A Guide has 1–1000 steps; repeats allow 1–100 iterations and cannot nest.',
      'Guide availability and watch storage/pinning are device-dependent.',
      'This is individual Guide delivery, not native training-plan/calendar parity.',
    ],
    completionCorrelation: 'The Guide externalId can be recovered from matching SuuntoPlus FIT session arrays.',
    unresolvedGates: [
      'Verify app/watch selection and pin behavior through separately approved live use.',
      'Authoritative missing-Guide detection is unavailable: ownership-related 404s and offset listings do not prove deletion.',
      'Public rollout requires separate approval; today through today + 6 is QS scheduling policy.',
    ],
    evidence: [
      'https://apizone.suunto.com/how-to-use-suuntoplus-guides-api',
      'https://apizone.suunto.com/suuntoplus-guide-description',
      'https://apizone.suunto.com/fit-description',
    ],
  },
};

export function isPlannedWorkoutProviderDeliveryEnabled(provider: PlannedWorkoutProviderId): boolean {
  return PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[provider].deliveryEnabled;
}

function relativeReferenceKey(target: WorkoutTargetV1): string | null {
  if (target.mode !== 'relative') return null;
  return `${target.kind}:${target.reference.kind}`;
}

function relativeReferenceValue(target: WorkoutTargetV1): number | null {
  if (target.mode !== 'relative') return null;
  switch (target.kind) {
    case 'heart-rate': return target.reference.bpm;
    case 'power': return target.reference.watts;
    case 'speed': return target.reference.metersPerSecond;
    case 'cadence': return target.reference.rpm;
  }
}

function structureSteps(structure: WorkoutStructureV1): Array<{
  path: string;
  step: WorkoutStepV1;
}> {
  const steps: Array<{ path: string; step: WorkoutStepV1 }> = [];
  structure.nodes.forEach((node, nodeIndex) => {
    const path = `$.nodes[${nodeIndex}]`;
    if (node.kind === 'step') {
      steps.push({ path, step: node });
      return;
    }
    node.steps.forEach((step, stepIndex) => steps.push({ path: `${path}.steps[${stepIndex}]`, step }));
  });
  return steps;
}

/**
 * Assesses mapping fidelity independently from provider access or delivery.
 * A result can be exact while delivery remains disabled pending sandbox proof.
 */
export function assessPlannedWorkoutProviderMappingV1(
  provider: PlannedWorkoutProviderId,
  value: unknown,
): PlannedWorkoutProviderMappingAssessmentV1 {
  const structure = parseWorkoutStructureV1(value);
  const issues: PlannedWorkoutProviderMappingIssueV1[] = [];
  const profile = PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[provider].profile;

  if (!profile) {
    issues.push({
      severity: 'unsupported',
      code: 'provider_contract_unavailable',
      path: '$',
      message: `${PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[provider].label} does not have a workout mapping contract.`,
    });
  } else if (profile.sports && !profile.sports.includes(structure.sport)) {
    issues.push({
      severity: 'unsupported',
      code: 'unsupported_sport',
      path: '$.sport',
      message: `${structure.sport} cannot be represented by the ${PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[provider].label} fixture mapper.`,
    });
  } else if ((provider === 'garmin' || provider === 'coros')
    && structure.sport !== ActivityTypes.Running
    && structure.sport !== ActivityTypes.Cycling
    && !(provider === 'coros' && structure.sport === ActivityTypes.TrailRunning)) {
    const family = provider === 'garmin'
      ? garminWorkoutSportFamilyV1(structure.sport)
      : corosWorkoutSportFamilyV1(structure.sport);
    if (family) {
      const familyLabel = family === 'RUNNING' ? 'Running' : 'Cycling';
      issues.push({
        severity: 'degraded',
        code: 'sport_profile_degraded',
        path: '$.sport',
        message: `${PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[provider].label} receives ${structure.sport} as a ${familyLabel} workout because its Training API has no exact ${structure.sport} profile.`,
      });
    }
  }

  const referenceSnapshots = new Map<string, number>();
  for (const { path, step } of structureSteps(structure)) {
    const supportedEndings = provider === 'wahoo'
      ? ['time', 'distance', 'kilojoules']
      : ['time', 'distance', 'manual'];
    if (!supportedEndings.includes(step.ending.kind)) {
      issues.push({
        severity: 'unsupported',
        code: 'unsupported_ending',
        path: `${path}.ending`,
        message: `${step.ending.kind} endings are not supported by ${PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[provider].label}.`,
      });
    }

    if (
      (provider === 'garmin' || provider === 'coros' || provider === 'wahoo')
      && step.purpose === 'other'
    ) {
      issues.push({
        severity: 'degraded',
        code: 'purpose_degraded',
        path: `${path}.purpose`,
        message: `${PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[provider].label} has no generic other intensity, so this step is delivered as active.`,
      });
    }

    if (provider === 'coros' && step.purpose === 'recovery') {
      issues.push({
        severity: 'degraded',
        code: 'purpose_degraded',
        path: `${path}.purpose`,
        message: 'COROS has no recovery intensity, so this step is delivered as rest.',
      });
    }

    if ((provider === 'wahoo' || provider === 'coros') && step.targets.length > 1) {
      issues.push({
        severity: 'degraded',
        code: 'multiple_targets_degraded',
        path: `${path}.targets`,
        message: provider === 'wahoo'
          ? 'The plan file preserves both targets, but ELEMNT bike computers use only the first target.'
          : 'COROS accepts one intensity target per step, so only the first target can be delivered.',
      });
    }

    if (provider === 'garmin' && step.targets.length > 1) {
      if (garminWorkoutSportFamilyV1(structure.sport) !== 'CYCLING') {
        issues.push({
          severity: 'unsupported',
          code: 'unsupported_target',
          path: `${path}.targets`,
          message: 'Garmin documents secondary targets only for cycling and lap swimming.',
        });
      } else if (step.targets[0]?.kind === step.targets[1]?.kind) {
        issues.push({
          severity: 'unsupported',
          code: 'unsupported_target',
          path: `${path}.targets[1]`,
          message: 'Garmin requires the secondary target type to differ from the primary target type.',
        });
      } else {
        issues.push({
          severity: 'degraded',
          code: 'multiple_targets_degraded',
          path: `${path}.targets`,
          message: 'Garmin cycling secondary targets are supported only on a documented subset of devices.',
        });
      }
    }

    if (
      provider === 'coros'
      && corosWorkoutSportFamilyV1(structure.sport) === 'CYCLING'
      && step.targets.some(target => target.kind === 'cadence')
    ) {
      issues.push({
        severity: 'unsupported',
        code: 'unsupported_target',
        path: `${path}.targets`,
        message: 'The COROS partner contract documents cadence targets for running and trail running, not cycling.',
      });
    }

    step.targets.forEach((target, targetIndex) => {
      if (target.mode !== 'relative') return;
      const targetPath = `${path}.targets[${targetIndex}]`;
      const referenceKey = relativeReferenceKey(target);
      const referenceValue = relativeReferenceValue(target);

      if (
        provider === 'garmin'
        || provider === 'suunto'
        || (provider === 'coros' && target.kind === 'cadence')
        || (provider === 'coros' && target.kind === 'heart-rate' && target.reference.kind === 'max-heart-rate')
        || (provider === 'coros' && target.kind === 'power' && target.reference.kind === 'critical-power')
        || (provider === 'wahoo' && target.kind === 'cadence')
        || (provider === 'wahoo' && target.kind === 'power' && target.reference.kind === 'critical-power')
      ) {
        issues.push({
          severity: 'degraded',
          code: 'relative_target_degraded',
          path: targetPath,
          message: `${PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[provider].label} cannot encode this relative reference; the stored reference snapshot must be frozen to an absolute range.`,
        });
        return;
      }

      if (provider === 'wahoo' && (target.kind === 'heart-rate' || target.kind === 'speed')) {
        issues.push({
          severity: 'degraded',
          code: 'relative_target_device_support_limited',
          path: targetPath,
          message: 'Wahoo documents relative heart-rate and threshold-speed targets for treadmill workouts in the Wahoo app, not ELEMNT computers or RIVAL.',
        });
      }

      if (provider !== 'wahoo' || referenceKey === null || referenceValue === null) return;
      const priorValue = referenceSnapshots.get(referenceKey);
      if (priorValue !== undefined && priorValue !== referenceValue) {
        issues.push({
          severity: 'degraded',
          code: 'relative_reference_conflict',
          path: targetPath,
          message: 'Wahoo stores one header value for this reference; this conflicting snapshot must be frozen to an absolute range.',
        });
        return;
      }
      referenceSnapshots.set(referenceKey, referenceValue);
    });
  }

  const level: PlannedWorkoutProviderMappingLevel = issues.some(issue => issue.severity === 'unsupported')
    ? 'unsupported'
    : issues.some(issue => issue.severity === 'degraded')
      ? 'degraded'
      : 'exact';
  return { provider, level, issues };
}
