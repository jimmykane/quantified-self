import { z } from 'zod';
import { TRAINING_RECIPE_WITH_GARMIN_ZONES_SCHEMA, TRAINING_STRENGTH_DRAFT_SCHEMA } from './training-plans.schemas';

export const TEMPLATE_READ_TOOLS = ['list_training_plan_templates', 'get_training_plan_template'] as const;
export const TEMPLATE_PREVIEW_TOOLS = ['preview_training_plan_enrollment'] as const;
export const TEMPLATE_TOOLS = [...TEMPLATE_READ_TOOLS, ...TEMPLATE_PREVIEW_TOOLS, 'apply_training_plan_enrollment'] as const;
const ref = z.string().min(1).max(2048);
const count = z.number().int().nonnegative().safe();
const source = z.enum(['catalog', 'private']);
const summary = z.strictObject({ templateRef: ref, source, version: count.positive(), name: z.string().max(120),
  description: z.string().max(1000), author: z.string().max(100), sport: z.string().max(100), days: count.max(366), workoutCount: count.max(400) });
const offset = count.max(365);
export const TEMPLATE_INPUTS = {
  list_training_plan_templates: z.strictObject({ source: source.default('catalog'), cursor: ref.optional() }),
  get_training_plan_template: z.strictObject({ templateRef: ref, offset: count.max(400).default(0) }),
  preview_training_plan_enrollment: z.strictObject({ templateRef: ref, anchor: z.enum(['start','finish']),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), longDay: count.max(6), pattern: z.enum(['standard','early']) }),
  apply_training_plan_enrollment: z.strictObject({ proposalRef: ref }),
};
export const TEMPLATE_PREVIEW = z.strictObject({ proposalRef: ref, permissionMode: z.literal('schedule'), expiresAtMs: count,
  scheduleRevision: count, summary: z.string().min(1).max(1000), requiresConfirmation: z.literal(true),
  changes: z.array(z.strictObject({ index: count.max(24), kind: z.literal('enroll-plan'), summary: z.string().max(500) })).min(1).max(25),
  providerPreviews: z.array(z.never()).length(0) });
export const TEMPLATE_OUTPUTS = {
  list_training_plan_templates: z.strictObject({ templates: z.array(summary).max(25), nextCursor: ref.nullable() }),
  get_training_plan_template: z.strictObject({ template: summary, sessions: z.array(z.strictObject({ day: offset, title: z.string().max(120),
    structure: TRAINING_RECIPE_WITH_GARMIN_ZONES_SCHEMA, strength: TRAINING_STRENGTH_DRAFT_SCHEMA.optional() })).max(7),
    rest: z.array(offset).max(366), phases: z.array(z.strictObject({ name: z.string().max(80), start: offset, end: offset })).max(32),
    nextOffset: count.nullable() }),
  preview_training_plan_enrollment: TEMPLATE_PREVIEW,
  apply_training_plan_enrollment: z.strictObject({ status: z.literal('applied'), lifecycle: z.literal('paused'), planRef: ref, scheduleRevision: count }),
};
