import { z } from 'zod';

export const TRAINING_THRESHOLD_READ_SCOPE = 'training-thresholds:read';
export const TRAINING_THRESHOLD_WRITE_SCOPE = 'training-thresholds:write';
export const TRAINING_THRESHOLD_TOOLS = ['get_training_thresholds', 'preview_training_threshold_change', 'apply_training_threshold_change'] as const;
export type TrainingThresholdTool = typeof TRAINING_THRESHOLD_TOOLS[number];
const ref = z.string().min(1).max(2048);
const revision = z.number().int().nonnegative().safe();
const family = z.string().min(1).max(64);
const instant = z.iso.datetime({ offset: true }).max(64);
const positive = z.number().positive().finite();
const quantity = (unit: 'watt' | 'bpm' | 'm/s') => z.strictObject({ value: positive, unit: z.literal(unit),
  displayValue: z.string().max(80), displayUnit: z.string().max(40) });
export const TRAINING_THRESHOLD_VALUES_SCHEMA = z.strictObject({
  functionalThresholdPower: quantity('watt').nullable(), lactateThresholdHR: quantity('bpm').nullable(),
  swimThresholdSpeed: quantity('m/s').nullable(),
});
export const TRAINING_THRESHOLD_REVIEW_SCHEMA = z.strictObject({ family, familyLabel: z.string().max(100),
  before: TRAINING_THRESHOLD_VALUES_SCHEMA, after: TRAINING_THRESHOLD_VALUES_SCHEMA });
const policy = z.strictObject({ family, familyLabel: z.string().max(100), revision,
  effectiveAt: instant.nullable(), policyRef: ref.nullable(), thresholds: TRAINING_THRESHOLD_VALUES_SCHEMA });
export const TRAINING_THRESHOLD_INPUTS = {
  get_training_thresholds: z.strictObject({ family: family.optional(), asOf: instant.optional() }),
  preview_training_threshold_change: z.strictObject({ policyRef: ref, mutationId: z.uuid(), changes: z.strictObject({
    functionalThresholdPower: positive.nullable().optional().describe('Independent FTP in watts; Running or Cycling only. Null clears this fallback.'),
    lactateThresholdHR: positive.nullable().optional().describe('Independent threshold HR in bpm. Null clears this fallback.'),
    css: z.strictObject({ paceSeconds: positive, distanceUnit: z.enum(['m', 'yd']) }).nullable().optional()
      .describe('CSS time in seconds per 100 metres or 100 yards, with an explicit unit. Null clears CSS.'),
  }).refine(value => Object.keys(value).length > 0, 'Choose at least one threshold to set or clear.') }),
  apply_training_threshold_change: z.strictObject({ proposalRef: ref }),
};
export const TRAINING_THRESHOLD_OUTPUTS = {
  get_training_thresholds: z.strictObject({ asOf: instant, policies: z.array(policy).max(50) }),
  preview_training_threshold_change: z.strictObject({ proposalRef: ref, expiresAtMs: revision,
    requiresConfirmation: z.literal(true), appliesTo: z.literal('future-workouts'), review: TRAINING_THRESHOLD_REVIEW_SCHEMA }),
  apply_training_threshold_change: z.strictObject({ status: z.literal('applied'), policy }),
};
