import { z } from 'zod';
import { ActivityTypesHelper } from '@sports-alliance/sports-lib';
import {
  WORKOUT_STEP_PURPOSES,
  WORKOUT_STRUCTURE_MAX_NODES,
  WORKOUT_STRUCTURE_MAX_REPEAT_COUNT,
  WORKOUT_STRUCTURE_MAX_TARGETS_PER_STEP,
  WORKOUT_STRUCTURE_VERSION,
  parseWorkoutStructureV1,
  type WorkoutEndingKindV1,
  type WorkoutNodeV1,
  type WorkoutSpeedPresentationV1,
  type WorkoutStepPurposeV1,
  type WorkoutTargetModeV1,
  type WorkoutTargetV1,
} from '../../../shared/planned-workout';
import { normalizeTrainingLocalDate, TRAINING_PLAN_COLORS } from '../../../shared/training-plans';
import { TRAINING_SYNC_OUTCOMES } from '../../../shared/training-delivery-summary';
import { PLANNED_WORKOUT_PROVIDER_IDS } from '../../../shared/planned-workout-providers';

export const TRAINING_PLANS_SCOPE = 'training-plans:read';
export const TRAINING_PLANS_WRITE_SCOPE = 'training-plans:write';
export const TRAINING_DELIVERY_WRITE_SCOPE = 'training-delivery:write';
export const TRAINING_READ_TOOLS = ['list_training_plans', 'get_training_plan', 'query_planned_workouts',
  'get_planned_workout', 'get_training_sync_status', 'get_planned_workout_completion'] as const;
export type TrainingReadTool = typeof TRAINING_READ_TOOLS[number];
export const TRAINING_PREVIEW_TOOLS = ['preview_create_planned_workout', 'preview_training_changes'] as const;
export const TRAINING_WRITE_TOOLS = [...TRAINING_PREVIEW_TOOLS, 'apply_training_changes'] as const;
export type TrainingWriteTool = typeof TRAINING_WRITE_TOOLS[number];
export const trainingDate = z.string().length(10).refine(value => {
  try { return normalizeTrainingLocalDate(value) === value; } catch { return false; }
}).meta({ format: 'date' });
const ref = z.string().min(1).max(2048);
const count = z.number().int().nonnegative().safe();
const positive = z.number().positive();
const nodeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const lifecycle = z.enum(['active', 'paused', 'archived']);
const pagination = { limit: z.number().int().min(1).max(100).default(25), cursor: z.string().min(1).max(8192).optional() };
export const TRAINING_READ_INPUTS = {
  list_training_plans: z.strictObject({ search: z.string().max(120).optional(), lifecycle: lifecycle.optional(), ...pagination }),
  get_training_plan: z.strictObject({ planRef: ref }),
  query_planned_workouts: z.strictObject({ startDate: trainingDate, endDate: trainingDate,
    scope: z.enum(['calendar', 'standalone', 'plan', 'all']).default('calendar'), planRef: ref.optional(), ...pagination }),
  get_planned_workout: z.strictObject({ workoutRef: ref }),
  get_training_sync_status: z.strictObject({ scope: z.enum(['plan', 'workout']), reference: ref }),
  get_planned_workout_completion: z.strictObject({ workoutRef: ref }),
};

type WorkoutTargetVariantKey<T extends WorkoutTargetV1 = WorkoutTargetV1> = T extends WorkoutTargetV1
  ? `${T['kind']}:${T['mode']}`
  : never;
type RelativeWorkoutTargetV1 = Extract<WorkoutTargetV1, { mode: 'relative' }>;
type WorkoutTargetReferenceKey<T extends RelativeWorkoutTargetV1 = RelativeWorkoutTargetV1> =
  T extends RelativeWorkoutTargetV1
    ? T['reference'] extends { kind: infer ReferenceKind extends string }
      ? `${T['kind']}:${ReferenceKind}`
      : never
    : never;

/**
 * Compile-time review gate for every shared recipe discriminant that MCP mirrors manually.
 * Adding a shared variant fails the Functions build until the public schema and fixtures are
 * deliberately extended; this map must never be used to expose stored fields automatically.
 */
export const MCP_WORKOUT_RECIPE_VARIANT_COVERAGE = {
  version: 1 satisfies typeof WORKOUT_STRUCTURE_VERSION,
  nodes: {
    step: true,
    repeat: true,
  } satisfies Record<WorkoutNodeV1['kind'], true>,
  stepPurposes: {
    warmup: true,
    work: true,
    recovery: true,
    cooldown: true,
    rest: true,
    other: true,
  } satisfies Record<WorkoutStepPurposeV1, true>,
  endings: {
    time: true,
    distance: true,
    kilojoules: true,
    repetitions: true,
    manual: true,
  } satisfies Record<WorkoutEndingKindV1, true>,
  targetModes: {
    absolute: true,
    relative: true,
  } satisfies Record<WorkoutTargetModeV1, true>,
  targetVariants: {
    'heart-rate:absolute': true,
    'heart-rate:relative': true,
    'power:absolute': true,
    'power:relative': true,
    'speed:absolute': true,
    'speed:relative': true,
    'cadence:absolute': true,
    'cadence:relative': true,
  } satisfies Record<WorkoutTargetVariantKey, true>,
  targetReferences: {
    'heart-rate:max-heart-rate': true,
    'heart-rate:threshold-heart-rate': true,
    'power:functional-threshold-power': true,
    'power:critical-power': true,
    'speed:threshold-speed': true,
    'cadence:preferred-cadence': true,
  } satisfies Record<WorkoutTargetReferenceKey, true>,
  speedPresentations: {
    pace: true,
    speed: true,
  } satisfies Record<WorkoutSpeedPresentationV1, true>,
} as const;

const ending = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('time'), seconds: positive }),
  z.strictObject({ kind: z.literal('distance'), meters: positive }),
  z.strictObject({ kind: z.literal('kilojoules'), kilojoules: positive }),
  z.strictObject({ kind: z.literal('repetitions'), repetitions: positive.int() }),
  z.strictObject({ kind: z.literal('manual') }),
]);
const percent = { mode: z.literal('relative'), minimumPercent: z.number().nonnegative(), maximumPercent: z.number().nonnegative() };
const presentation = z.enum(['pace', 'speed']);
const target = z.union([
  z.strictObject({ kind: z.literal('heart-rate'), mode: z.literal('absolute'), minimumBpm: z.number().nonnegative(), maximumBpm: z.number().nonnegative() }),
  z.strictObject({ kind: z.literal('heart-rate'), ...percent, reference: z.strictObject({
    kind: z.enum(['max-heart-rate', 'threshold-heart-rate']), bpm: positive }) }),
  z.strictObject({ kind: z.literal('power'), mode: z.literal('absolute'), minimumWatts: z.number().nonnegative(), maximumWatts: z.number().nonnegative() }),
  z.strictObject({ kind: z.literal('power'), ...percent, reference: z.strictObject({
    kind: z.enum(['functional-threshold-power', 'critical-power']), watts: positive }) }),
  z.strictObject({ kind: z.literal('speed'), mode: z.literal('absolute'), presentation, minimumMetersPerSecond: z.number().nonnegative(), maximumMetersPerSecond: z.number().nonnegative() }),
  z.strictObject({ kind: z.literal('speed'), ...percent, presentation, reference: z.strictObject({
    kind: z.literal('threshold-speed'), metersPerSecond: positive }) }),
  z.strictObject({ kind: z.literal('cadence'), mode: z.literal('absolute'), minimumRpm: z.number().nonnegative(), maximumRpm: z.number().nonnegative() }),
  z.strictObject({ kind: z.literal('cadence'), ...percent, reference: z.strictObject({ kind: z.literal('preferred-cadence'), rpm: positive }) }),
]);
const step = z.strictObject({ kind: z.literal('step'), id: nodeId, purpose: z.enum(WORKOUT_STEP_PURPOSES),
  ending, targets: z.array(target).max(WORKOUT_STRUCTURE_MAX_TARGETS_PER_STEP), note: z.string().max(500).optional() });
/** Explicit public contract. New stored fields must never appear here implicitly. */
export const TRAINING_RECIPE_SCHEMA = z.strictObject({ version: z.literal(WORKOUT_STRUCTURE_VERSION), sport: z.enum(ActivityTypesHelper.getActivityTypesAsUniqueArray()),
  nodes: z.array(z.union([step, z.strictObject({ kind: z.literal('repeat'), id: nodeId,
    count: z.number().int().min(1).max(WORKOUT_STRUCTURE_MAX_REPEAT_COUNT),
    steps: z.array(step).min(1).max(WORKOUT_STRUCTURE_MAX_NODES) })])).min(1).max(WORKOUT_STRUCTURE_MAX_NODES),
}).refine(value => { try { parseWorkoutStructureV1(value); return true; } catch { return false; } });
const plan = z.strictObject({ planRef: ref, name: z.string().min(1).max(120), lifecycle,
  startDate: trainingDate, endDate: trainingDate, revision: count, currentWorkoutCount: count.max(400),
  color: z.string().max(32).nullable(), createdAtMs: count, updatedAtMs: count });
const workout = z.strictObject({ workoutRef: ref, planRef: ref.nullable(), title: z.string().min(1).max(120),
  localDate: trainingDate, lifecycle: z.enum(['planned', 'skipped']), revision: count, createdAtMs: count, updatedAtMs: count });
const envelope = { scheduleRevision: count, scanComplete: z.boolean(), recordsScanned: count.max(1000),
  nextCursor: z.string().max(8192).nullable(), limitsReached: z.array(z.enum(['limit', 'scan', 'bytes'])).max(3) };
export const TRAINING_READ_OUTPUTS = {
  list_training_plans: z.strictObject({ ...envelope, plans: z.array(plan).max(100) }),
  get_training_plan: z.strictObject({ scheduleRevision: count, plan }),
  query_planned_workouts: z.strictObject({ ...envelope, startDate: trainingDate, endDate: trainingDate,
    scope: z.enum(['calendar', 'standalone', 'plan', 'all']), workouts: z.array(workout).max(100) }),
  get_planned_workout: z.strictObject({ scheduleRevision: count, workout: workout.extend({
    structure: TRAINING_RECIPE_SCHEMA, displaySteps: z.array(z.strictObject({ nodeId,
      text: z.string().max(2000) })).max(100) }) }),
  get_training_sync_status: z.strictObject({ scheduleRevision: count, scope: z.enum(['plan', 'workout']),
    reference: ref, scanComplete: z.boolean(), checkedAtMs: count,
    services: z.array(z.strictObject({ provider: z.enum(PLANNED_WORKOUT_PROVIDER_IDS),
      state: z.enum(['current', 'history', 'inactive', 'off', 'empty', 'incomplete']),
      timeZone: z.string().max(100).nullable(), totalWorkouts: count.max(400).nullable(), syncedWorkouts: count.max(400).nullable(),
      outcomes: z.array(z.strictObject({ status: z.enum(TRAINING_SYNC_OUTCOMES), count: count.max(400) })).max(TRAINING_SYNC_OUTCOMES.length),
      hasRemoteCopy: z.boolean(), differsFromQS: z.boolean().nullable(), retainedCopies: count.max(1600).nullable(),
      lastAttemptAtMs: count.nullable(), lastAcceptedAtMs: count.nullable(), updatedAtMs: count.nullable(),
    })).max(4) }),
  get_planned_workout_completion: z.strictObject({
    scheduleRevision: count,
    workoutRef: ref,
    state: z.enum(['linked', 'unlinked']),
    provider: z.enum(PLANNED_WORKOUT_PROVIDER_IDS).nullable(),
    matchMethod: z.enum(['provider_marker', 'manual_confirmation']).nullable(),
    timing: z.enum(['on_date', 'early', 'late', 'unknown']).nullable(),
    scheduledDate: trainingDate,
    workoutRevision: count,
    linkedWorkoutRevision: count.nullable(),
    workoutChangedSinceCompletion: z.boolean(),
    activityStartAtMs: count.nullable(),
    linkedAtMs: count.nullable(),
    activityRef: ref.nullable(),
  }),
};
export type TrainingReadResult = z.infer<typeof TRAINING_READ_OUTPUTS[TrainingReadTool]>;

const localKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const entityTarget = z.union([
  z.strictObject({ ref }),
  z.strictObject({ localKey }),
]);
const optionalPlanTarget = z.union([entityTarget, z.null()]);
const providers = z.union([
  z.literal('all_connected'),
  z.array(z.enum(PLANNED_WORKOUT_PROVIDER_IDS)).min(1).max(PLANNED_WORKOUT_PROVIDER_IDS.length)
    .refine(values => new Set(values).size === values.length, 'Providers must be unique.'),
]);

export const TRAINING_CHANGE_SCHEMA = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('create-plan'), localKey, name: z.string().trim().min(1).max(120),
    color: z.enum(TRAINING_PLAN_COLORS).optional(), startDate: trainingDate, endDate: trainingDate,
    activate: z.boolean().default(false) }),
  z.strictObject({ kind: z.literal('rename-plan'), plan: entityTarget, name: z.string().trim().min(1).max(120) }),
  z.strictObject({ kind: z.literal('set-plan-color'), plan: entityTarget, color: z.enum(TRAINING_PLAN_COLORS) }),
  z.strictObject({ kind: z.literal('set-plan-lifecycle'), plan: entityTarget,
    lifecycle: z.enum(['active', 'paused', 'archived']) }),
  z.strictObject({ kind: z.literal('shift-plan'), plan: entityTarget, days: z.number().int().min(-366).max(366).refine(days => days !== 0) }),
  z.strictObject({ kind: z.literal('create-workout'), localKey, plan: optionalPlanTarget.default(null),
    localDate: trainingDate, title: z.string().trim().min(1).max(120), structure: TRAINING_RECIPE_SCHEMA }),
  z.strictObject({ kind: z.literal('update-workout'), workout: entityTarget, plan: optionalPlanTarget,
    localDate: trainingDate, title: z.string().trim().min(1).max(120), structure: TRAINING_RECIPE_SCHEMA }),
  z.strictObject({ kind: z.literal('move-workout'), workout: entityTarget, plan: optionalPlanTarget,
    localDate: trainingDate }),
  z.strictObject({ kind: z.literal('copy-workout'), sourceWorkout: entityTarget, localKey,
    plan: optionalPlanTarget, localDate: trainingDate }),
  z.strictObject({ kind: z.literal('set-workout-lifecycle'), workout: entityTarget,
    lifecycle: z.enum(['planned', 'skipped']) }),
  z.strictObject({ kind: z.literal('delete-workout'), workout: entityTarget }),
  z.strictObject({ kind: z.literal('provider-delivery'), targetType: z.enum(['plan', 'workout']), target: entityTarget,
    providers, action: z.enum(['enable', 'send', 'resume', 'stop', 'retry', 'check', 'approve']),
    timeZone: z.string().min(1).max(100).optional() }),
]);

const proposedChange = z.strictObject({ index: count.max(24), kind: z.string().min(1).max(64), summary: z.string().min(1).max(500) });
const providerPreview = z.strictObject({ index: count.max(24), provider: z.enum(PLANNED_WORKOUT_PROVIDER_IDS),
  targetType: z.enum(['plan', 'workout']), action: z.enum(['enable', 'send', 'resume', 'stop', 'retry', 'check', 'approve']),
  availability: z.enum(['ready', 'unavailable', 'reconnect_required', 'connection_repair', 'pro_required']),
  timeZone: z.string().max(100).nullable(), eligibleCount: count.max(400), warningCount: count.max(400),
  summary: z.string().min(1).max(500) });
const appliedChange = z.strictObject({ index: count.max(24), kind: z.string().min(1).max(64),
  status: z.enum(['applied', 'already_applied', 'failed']), message: z.string().min(1).max(500) });
const providerResult = z.strictObject({ index: count.max(24), provider: z.enum(PLANNED_WORKOUT_PROVIDER_IDS),
  status: z.enum(['queued', 'applied', 'already_applied', 'blocked', 'failed']), message: z.string().min(1).max(500) });

const focusedWorkoutPreviewInput = {
  expectedScheduleRevision: count,
  planRef: ref.nullable().default(null),
  localDate: trainingDate,
  title: z.string().trim().min(1).max(120),
  structure: TRAINING_RECIPE_SCHEMA,
};
export const TRAINING_CREATE_WORKOUT_INPUT_WITHOUT_DELIVERY = z.strictObject(focusedWorkoutPreviewInput);

export const TRAINING_WRITE_INPUTS = {
  preview_create_planned_workout: z.strictObject({
    ...focusedWorkoutPreviewInput,
    delivery: z.strictObject({
      providers,
      timeZone: z.string().min(1).max(100),
    }).optional(),
  }),
  preview_training_changes: z.strictObject({
    expectedScheduleRevision: count,
    changes: z.array(TRAINING_CHANGE_SCHEMA).min(1).max(25),
  }),
  apply_training_changes: z.strictObject({ proposalRef: ref,
    permissionMode: z.enum(['schedule', 'delivery', 'combined']) }),
};

const trainingPreviewOutput = z.strictObject({ proposalRef: ref, expiresAtMs: count,
    permissionMode: z.enum(['schedule', 'delivery', 'combined']),
    scheduleRevision: count, summary: z.string().min(1).max(1000), requiresConfirmation: z.literal(true),
    confirmationUrl: z.string().url().max(4096),
    changes: z.array(proposedChange).min(1).max(25), providerPreviews: z.array(providerPreview).max(100) });

const trainingApplyOutput = z.strictObject({
  proposalRef: ref,
  status: z.enum(['applied', 'partially_applied', 'confirmation_required']),
  scheduleRevision: count.optional(),
  changes: z.array(appliedChange).max(25).optional(),
  providers: z.array(providerResult).max(100).optional(),
  createdReferences: z.array(z.strictObject({
    localKey, kind: z.enum(['plan', 'workout']), reference: ref,
  })).max(25).optional(),
  expiresAtMs: count.optional(),
  confirmationUrl: z.string().url().max(4096).optional(),
  message: z.string().min(1).max(1000).optional(),
}).superRefine((value, context) => {
  const confirmation = value.status === 'confirmation_required';
  const missingConfirmation = value.expiresAtMs === undefined
    || value.confirmationUrl === undefined || value.message === undefined;
  const missingApplied = value.scheduleRevision === undefined
    || value.changes === undefined || value.providers === undefined || value.createdReferences === undefined;
  const hasAnyApplied = value.scheduleRevision !== undefined
    || value.changes !== undefined || value.providers !== undefined || value.createdReferences !== undefined;
  const hasAnyConfirmation = value.expiresAtMs !== undefined
    || value.confirmationUrl !== undefined || value.message !== undefined;
  if ((confirmation && missingConfirmation) || (!confirmation && missingApplied)) {
    context.addIssue({
      code: 'custom',
      message: confirmation
        ? 'A browser confirmation result requires its URL, message and expiry.'
        : 'An applied result requires the schedule revision, changes, providers and created references.',
    });
  }
  if (confirmation && hasAnyApplied) {
    context.addIssue({ code: 'custom', message: 'A browser confirmation result cannot claim applied changes.' });
  }
  if (!confirmation && hasAnyConfirmation) {
    context.addIssue({ code: 'custom', message: 'An applied result cannot request browser confirmation.' });
  }
}).meta({
  oneOf: [
    {
      properties: {
        status: { const: 'confirmation_required' },
        proposalRef: {}, expiresAtMs: {}, confirmationUrl: {}, message: {},
      },
      required: ['proposalRef', 'status', 'expiresAtMs', 'confirmationUrl', 'message'],
    },
    {
      properties: {
        status: { enum: ['applied', 'partially_applied'] },
        proposalRef: {}, scheduleRevision: {}, changes: {}, providers: {}, createdReferences: {},
      },
      required: ['proposalRef', 'status', 'scheduleRevision', 'changes', 'providers', 'createdReferences'],
    },
  ],
});

export const TRAINING_WRITE_OUTPUTS = {
  preview_create_planned_workout: trainingPreviewOutput,
  preview_training_changes: trainingPreviewOutput,
  apply_training_changes: trainingApplyOutput,
};
