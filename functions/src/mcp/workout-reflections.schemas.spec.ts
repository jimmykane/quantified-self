import { describe, it, expect } from 'vitest';
import { MCP_WORKOUT_REFLECTION_INPUTS, MCP_WORKOUT_REFLECTION_OUTPUTS } from './workout-reflections.schemas';
import { hasValidMcpScopeDependencies, MCP_OAUTH_SCOPES as S } from './oauth.service';
const args = { activityRef: 'opaque', target: 'activity', expectedRevision: 0,
  mutationId: '11111111-1111-4111-8111-111111111111', effort: 0, note: null };
describe('Strict private reflection schemas and scopes', () => {
  it('accepts explicit zero and rejects extra fields and inferred mutation kinds', () => {
    expect(MCP_WORKOUT_REFLECTION_INPUTS.save_workout_reflection.safeParse(args).success).toBe(true);
    for (const patch of [{ effort: 0.5 }, { effort: undefined }, { target: 'planned_workout' }, { complete: true },
      { note: 'a'.repeat(2001) }, { note: '\u0000' }, { expectedRevision: -1 }, { mutationId: 'bad' }]) {
      expect(MCP_WORKOUT_REFLECTION_INPUTS.save_workout_reflection.safeParse({ ...args, ...patch }).success).toBe(false);
    }
  });
  it('requires the independent read grant and its activity parent for writes', () => {
    expect(hasValidMcpScopeDependencies([S.ActivityDetailsRead, S.WorkoutReflectionsRead, S.WorkoutReflectionsWrite])).toBe(true);
    for (const scopes of [[S.WorkoutReflectionsRead], [S.WorkoutReflectionsWrite], [S.ActivityDetailsRead, S.WorkoutReflectionsWrite]]) {
      expect(hasValidMcpScopeDependencies(scopes)).toBe(false);
    }
  });
  it('rejects provider metadata, audit receipts, IDs and diagnoses from outputs', () => {
    const value = { activityRef: 'opaque', target: 'activity', revision: 1, present: true, effortScale: 'borg_cr10', effort: 0, note: 'context' };
    expect(MCP_WORKOUT_REFLECTION_OUTPUTS.get_workout_reflection.safeParse(value).success).toBe(true);
    for (const key of ['uid', 'eventId', 'activityId', 'provider', 'mutationId', 'createdAtMs', 'diagnosis', 'workoutId']) {
      expect(MCP_WORKOUT_REFLECTION_OUTPUTS.get_workout_reflection.safeParse({ ...value, [key]: 'private-canary' }).success).toBe(false);
    }
  });
});
