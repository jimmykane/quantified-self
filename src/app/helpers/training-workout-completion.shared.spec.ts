import { parseTrainingWorkoutCompletionV1 } from '@shared/training-workout-completion';

describe('Training workout completion contract', () => {
  const value = {
    schemaVersion: 1 as const,
    workoutId: 'workout-1',
    planId: 'plan-1',
    provider: 'suunto' as const,
    matchMethod: 'provider_marker' as const,
    eventId: 'event-1',
    activityId: 'activity-1',
    sourceSessionIndex: 0,
    activityStartAtMs: 1_000,
    scheduledLocalDate: '2026-09-17',
    workoutRevisionAtLink: 2,
    timing: 'on_date' as const,
    linkedAtMs: 2_000,
    updatedAtMs: 2_000,
  };

  it('accepts the strict owner-visible projection and returns an owned value', () => {
    const parsed = parseTrainingWorkoutCompletionV1(value);
    expect(parsed).toEqual(value);
    expect(parsed).not.toBe(value);
  });

  it.each([
    { schemaVersion: 2 },
    { provider: 'unknown' },
    { scheduledLocalDate: '2026-02-30' },
    { sourceSessionIndex: -1 },
    { workoutRevisionAtLink: 0 },
    { updatedAtMs: 1_999 },
    { privateEvidence: 'must-not-cross-the-contract' },
  ])('rejects malformed or expanded projections: %o', replacement => {
    expect(() => parseTrainingWorkoutCompletionV1({ ...value, ...replacement })).toThrow('Invalid workout completion.');
  });
});
