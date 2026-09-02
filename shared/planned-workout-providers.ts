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

export interface PlannedWorkoutProviderMappingIssueV1 {
  severity: Exclude<PlannedWorkoutProviderMappingLevel, 'exact'>;
  code:
    | 'provider_contract_unavailable'
    | 'unsupported_sport'
    | 'unsupported_ending'
    | 'purpose_degraded'
    | 'multiple_targets_degraded'
    | 'relative_target_degraded'
    | 'relative_reference_conflict';
  path: string;
  message: string;
}

export interface PlannedWorkoutProviderMappingAssessmentV1 {
  provider: PlannedWorkoutProviderId;
  level: PlannedWorkoutProviderMappingLevel;
  issues: PlannedWorkoutProviderMappingIssueV1[];
}

/**
 * Versioned provider research snapshot. Delivery remains disabled until each
 * provider's fixture and sandbox CRUD/idempotency evidence is recorded.
 */
export const PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1: Readonly<
  Record<PlannedWorkoutProviderId, PlannedWorkoutProviderCapabilityV1>
> = {
  garmin: {
    id: 'garmin',
    label: 'Garmin',
    implementationState: 'blocked-contract',
    deliveryEnabled: false,
    deliveryModel: 'native-workout-and-schedule',
    requiredScopes: ['WORKOUT_IMPORT'],
    profile: null,
    scheduling: 'Workout content and Garmin Connect calendar scheduling have separate lifecycles.',
    limits: ['Current private Training API contract is not present in this repository.'],
    completionCorrelation: 'Pending confirmation from the current Garmin Training API contract.',
    unresolvedGates: [
      'Obtain the current private Training API schema, endpoints, limits, update/delete semantics, and test access.',
      'Pass sandbox create, update, reschedule, delete, reconnect, and duplicate tests.',
    ],
    evidence: [
      'https://developer.garmin.com/gc-developer-program/training-api/',
      'https://developer.garmin.com/gc-developer-program/program-faq/',
    ],
  },
  coros: {
    id: 'coros',
    label: 'COROS',
    implementationState: 'blocked-contract',
    deliveryEnabled: false,
    deliveryModel: 'native-plan-workout-batches',
    requiredScopes: ['training-plan partner entitlement'],
    profile: null,
    scheduling: 'Partner workout IDs are pushed in dated batches through the Training Plan API.',
    limits: ['At most 30 workouts per push.', 'Dates from today through one year ahead.'],
    completionCorrelation: 'Completed workout payloads may carry planWorkoutId.',
    unresolvedGates: [
      'Confirm Training Plan entitlement; provider code 30009 means access is unavailable.',
      'Confirm repeated-ID replacement and overlapping-window semantics with COROS.',
      'Pass sandbox create, update, reschedule, eligible-delete, and duplicate tests.',
    ],
    evidence: ['COROS API Reference V2.0.6 (partner document, February 2026)'],
  },
  wahoo: {
    id: 'wahoo',
    label: 'Wahoo',
    implementationState: 'fixture-only',
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
      'Device-visible scheduling is documented as the current day plus six days.',
    ],
    completionCorrelation: 'workout_token identifies the app workout, but third-party-origin completions are not shared.',
    unresolvedGates: [
      'Confirm Plans entitlement, scopes, same-app ownership, and date-only starts/day_code behavior.',
      'Pass sandbox CRUD, reconnect, duplicate, and current-day-plus-six device tests.',
    ],
    evidence: [
      'https://cloud-api.wahooligan.com/',
      'https://cloud-api.wahooligan.com/docs/plan-json-format.pdf',
    ],
  },
  suunto: {
    id: 'suunto',
    label: 'Suunto',
    implementationState: 'fixture-only',
    deliveryEnabled: false,
    deliveryModel: 'dated-guide',
    requiredScopes: ['SuuntoPlus Guides entitlement', 'Suunto subscription key'],
    profile: {
      sports: [ActivityTypes.Running, ActivityTypes.Cycling],
      endingKinds: ['time', 'distance', 'manual'],
      targetKinds: ['heart-rate', 'power', 'speed', 'cadence'],
      supportsRepeats: true,
      supportsRelativeTargets: true,
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
      'Confirm Guides entitlement, supported-watch workflow, storage, and pin/select behavior.',
      'Pass sandbox create, update, reschedule, delete, duplicate, and FIT-correlation tests.',
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

  if (provider === 'garmin' || provider === 'coros') {
    issues.push({
      severity: 'unsupported',
      code: 'provider_contract_unavailable',
      path: '$',
      message: `${PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[provider].label} mapping is blocked until the current partner contract is available.`,
    });
    return { provider, level: 'unsupported', issues };
  }

  if (![ActivityTypes.Running, ActivityTypes.Cycling].includes(structure.sport)) {
    issues.push({
      severity: 'unsupported',
      code: 'unsupported_sport',
      path: '$.sport',
      message: `${structure.sport} cannot be represented by the ${PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[provider].label} fixture mapper.`,
    });
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

    if (provider === 'wahoo' && step.purpose === 'other') {
      issues.push({
        severity: 'degraded',
        code: 'purpose_degraded',
        path: `${path}.purpose`,
        message: 'Wahoo has no generic other intensity, so this step is delivered as active.',
      });
    }

    if (provider === 'wahoo' && step.targets.length > 1) {
      issues.push({
        severity: 'degraded',
        code: 'multiple_targets_degraded',
        path: `${path}.targets`,
        message: 'The plan file preserves both targets, but ELEMNT bike computers use only the first target.',
      });
    }

    step.targets.forEach((target, targetIndex) => {
      if (target.mode !== 'relative') return;
      const targetPath = `${path}.targets[${targetIndex}]`;
      const referenceKey = relativeReferenceKey(target);
      const referenceValue = relativeReferenceValue(target);

      if (
        provider === 'suunto'
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

      if (referenceKey === null || referenceValue === null) return;
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
