import { GOAL_PROGRESS_REQUEST } from '../training-goals/schemas';
import { z } from 'zod';
import { normalizeTrainingLocalDate } from '../../../shared/training-plans';
import { TRAINING_GOAL_KINDS, TRAINING_GOAL_LIFECYCLES, TRAINING_GOAL_PRIORITIES, TRAINING_GOAL_TARGETS } from '../../../shared/training-goals';

export const GOAL_READ_TOOLS = ['list_training_goals', 'get_training_goal', 'get_training_goals_progress'] as const;
export const GOAL_PREVIEW_TOOLS = ['preview_training_goal_change'] as const;
export const GOAL_TOOLS = [...GOAL_READ_TOOLS, ...GOAL_PREVIEW_TOOLS, 'apply_training_goal_change'] as const;
const count = z.number().int().nonnegative().safe();
const ref = z.string().min(1).max(2048);
const date = z.string().length(10).refine(value => { try { return normalizeTrainingLocalDate(value) === value; } catch { return false; } });
const timeZone = z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; } });
const fields = {
  name: z.string().min(1).max(120), kind: z.enum(TRAINING_GOAL_KINDS), lifecycle: z.enum(TRAINING_GOAL_LIFECYCLES),
  priority: z.enum(TRAINING_GOAL_PRIORITIES), startLocalDate: date, targetLocalDate: date.nullable(),
  sportScope: z.enum(['all', 'sport', 'family']), sport: z.string().min(1).max(100).nullable(), objective: z.string().max(2000),
  weeklyTarget: z.strictObject({ kind: z.enum(TRAINING_GOAL_TARGETS), value: z.number().positive().max(10000000) }).nullable(),
};
export const GOAL_REVIEW_FIELDS_SCHEMA = z.strictObject({ ...fields, planName: z.string().min(1).max(120).nullable() });
export const GOAL_REVIEW_SCHEMA = z.strictObject({ before: GOAL_REVIEW_FIELDS_SCHEMA.nullable(), after: GOAL_REVIEW_FIELDS_SCHEMA });
export const GOAL_PUBLIC_SCHEMA = z.strictObject({ ...fields, goalRef: ref, revision: count.positive(),
  planRef: ref.nullable(), linkedPlanAvailable: z.boolean(), planName: z.string().min(1).max(120).nullable() });
export const GOAL_INPUTS = {
  list_training_goals: z.strictObject({ scope: z.enum(['current', 'archived', 'all']).default('current'), cursor: ref.optional() }),
  get_training_goal: z.strictObject({ goalRef: ref }),
  get_training_goals_progress: GOAL_PROGRESS_REQUEST.extend({ goalRefs: z.array(ref).min(1).max(25) }),
  preview_training_goal_change: z.strictObject({ goalRef: ref.nullable(), expectedRevision: count,
    goal: z.strictObject({ ...fields, planRef: ref.nullable() }) }),
  apply_training_goal_change: z.strictObject({ proposalRef: ref }),
};
export const GOAL_PREVIEW_OUTPUT = z.strictObject({ proposalRef: ref, permissionMode: z.literal('schedule'), expiresAtMs: count,
  // Compatibility with the app-owned Training review. Goal concurrency uses its own state, not this display value.
  scheduleRevision: count, summary: z.string().min(1).max(1000), requiresConfirmation: z.literal(true),
  changes: z.array(z.strictObject({ index: z.literal(0), kind: z.literal('set-training-goal'), summary: z.string().min(1).max(500) })).length(1),
  providerPreviews: z.array(z.never()).length(0), goalReview: GOAL_REVIEW_SCHEMA });
export const GOAL_OUTPUTS = {
  list_training_goals: z.strictObject({ goalsRevision: count, goals: z.array(GOAL_PUBLIC_SCHEMA).max(25), nextCursor: ref.nullable() }),
  get_training_goal: z.strictObject({ goalsRevision: count, goal: GOAL_PUBLIC_SCHEMA }),
  get_training_goals_progress: z.strictObject({ goalsRevision: count, localDate: date, timeZone, weekStartsOn: count.max(6),
    complete: z.boolean(), progress: z.array(z.strictObject({ goalRef: ref, goalRevision: count.positive(), startLocalDate: date,
      endLocalDate: date, partialWeek: z.boolean(), kind: z.enum(TRAINING_GOAL_TARGETS), value: z.number().nonnegative(),
      target: z.number().positive(), complete: z.boolean(), met: z.boolean(), displayValue: z.string().max(100), displayTarget: z.string().max(100) })).max(25) }),
  preview_training_goal_change: GOAL_PREVIEW_OUTPUT,
  apply_training_goal_change: z.strictObject({ status: z.literal('applied'), goalsRevision: count.positive(), goal: GOAL_PUBLIC_SCHEMA }),
};
