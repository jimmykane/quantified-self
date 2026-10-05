import { z } from 'zod';
import { WORKOUT_STEP_PURPOSES, type WorkoutStepPurposeV1 } from '../../../shared/planned-workout';
import { WORKOUT_DURATION_UNKNOWN_REASONS_V1, type WorkoutAnalysisV1 } from '../../../shared/planned-workout-analysis';

const number = z.number().finite().nonnegative();
const positive = z.number().finite().positive();
const count = z.number().int().nonnegative().max(9900);
const coverage = z.enum(['none', 'partial', 'complete']);
const range = z.strictObject({ minimumSeconds: positive, maximumSeconds: positive });
const summary = z.strictObject({ executedSteps: count, earlyLapSteps: count,
  duration: z.strictObject({ exactSubtotalSeconds: number, exactSteps: count,
    estimatedSubtotalRange: range.nullable(), estimatedSteps: count, unknownSteps: count,
    coveredSubtotalRange: range.nullable(), completeExactSeconds: positive.nullable(),
    completeRange: range.nullable(), coverage }),
  distance: z.strictObject({ exactSubtotalMeters: number, exactSteps: count, unknownSteps: count,
    completeExactMeters: positive.nullable(), coverage }),
});
const nodeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
/** Explicit allowlist; adding an internal analysis field never exposes it automatically. */
export const WORKOUT_PRESCRIPTION_ANALYSIS_SCHEMA = z.strictObject({ version: z.literal(1),
  counts: z.strictObject({ structuralNodes: count.max(100), definedSteps: count.max(100), executedSteps: count }),
  summary,
  byPurpose: z.strictObject({ warmup: summary, work: summary, recovery: summary, cooldown: summary,
    rest: summary, other: summary } satisfies Record<WorkoutStepPurposeV1, typeof summary>),
  steps: z.array(z.strictObject({ stepId: nodeId, repeatId: nodeId.nullable(),
    multiplier: z.number().int().min(1).max(100), purpose: z.enum(WORKOUT_STEP_PURPOSES),
    allowEarlyLap: z.boolean(),
    prescribedSeconds: positive.nullable(), prescribedMeters: positive.nullable(),
    duration: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('exact'), seconds: positive }),
      z.strictObject({ kind: z.literal('estimated'), minimumSeconds: positive, maximumSeconds: positive,
        basis: z.enum(['absolute-speed', 'saved-threshold-speed']) }),
      z.strictObject({ kind: z.literal('unknown'), reason: z.enum(WORKOUT_DURATION_UNKNOWN_REASONS_V1) }),
    ]),
  })).min(1).max(100),
}) satisfies z.ZodType<WorkoutAnalysisV1>;
