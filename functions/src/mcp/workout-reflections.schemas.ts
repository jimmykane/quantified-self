import { z } from 'zod';
import { WORKOUT_REFLECTION_NOTE_LIMIT, validateReflectionFields } from '../../../shared/workout-reflection';
export const WORKOUT_REFLECTIONS_READ_SCOPE = 'workout-reflections:read';
export const WORKOUT_REFLECTIONS_WRITE_SCOPE = 'workout-reflections:write';
export const MCP_WORKOUT_REFLECTION_TOOLS = ['get_workout_reflection', 'save_workout_reflection', 'delete_workout_reflection'] as const;
export type McpWorkoutReflectionTool = typeof MCP_WORKOUT_REFLECTION_TOOLS[number];
const reference = z.string().min(1).max(512);
const target = z.enum(['recording', 'activity']);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 2);
const fields = { effort: z.number().int().min(0).max(10).nullable(),
  note: z.string().max(WORKOUT_REFLECTION_NOTE_LIMIT).refine(value => {
    try { validateReflectionFields({ effort: null, note: value }); return true; } catch { return false; }
  }).nullable() };
const selected = { activityRef: reference, target };
const change = { ...selected, expectedRevision: revision, mutationId: z.uuid() };
export const MCP_WORKOUT_REFLECTION_INPUTS = {
  get_workout_reflection: z.strictObject(selected),
  save_workout_reflection: z.strictObject({ ...change, ...fields }),
  delete_workout_reflection: z.strictObject({ ...change, expectedRevision: revision.min(1) }),
};
const current = { ...selected, revision, present: z.boolean(), effortScale: z.literal('borg_cr10'), ...fields };
export const MCP_WORKOUT_REFLECTION_OUTPUTS = {
  get_workout_reflection: z.strictObject(current),
  save_workout_reflection: z.strictObject({ ...current, changed: z.boolean() }),
  delete_workout_reflection: z.strictObject({ ...selected, revision, deleted: z.boolean() }),
};
