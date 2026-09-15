import { z } from 'zod';
import { ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { WORKOUT_STEP_PURPOSES, parseWorkoutStructureV1 } from '../../../shared/planned-workout';
import { normalizeTrainingLocalDate } from '../../../shared/training-plans';
import { TRAINING_SYNC_OUTCOMES } from '../../../shared/training-delivery-summary';
import { PLANNED_WORKOUT_PROVIDER_IDS } from '../../../shared/planned-workout-providers';

export const TRAINING_PLANS_SCOPE = 'training-plans:read';
export const TRAINING_READ_TOOLS = ['list_training_plans', 'get_training_plan', 'query_planned_workouts',
  'get_planned_workout', 'get_training_sync_status'] as const;
export type TrainingReadTool = typeof TRAINING_READ_TOOLS[number];
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
};

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
  ending, targets: z.array(target).max(2), note: z.string().max(500).optional() });
/** Explicit public contract. New stored fields must never appear here implicitly. */
export const TRAINING_RECIPE_SCHEMA = z.strictObject({ version: z.literal(1), sport: z.enum(ActivityTypesHelper.getActivityTypesAsUniqueArray()),
  nodes: z.array(z.union([step, z.strictObject({ kind: z.literal('repeat'), id: nodeId,
    count: z.number().int().min(1).max(100), steps: z.array(step).min(1).max(100) })])).min(1).max(100),
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
};
export type TrainingReadResult = z.infer<typeof TRAINING_READ_OUTPUTS[TrainingReadTool]>;
