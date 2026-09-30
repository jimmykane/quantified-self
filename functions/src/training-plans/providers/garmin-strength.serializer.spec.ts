import { describe, expect, it } from 'vitest';
import { projectStrengthWorkoutToV1 } from '../../../../shared/strength-workout';
import { assessPlannedWorkoutProviderMappingV1 } from '../../../../shared/planned-workout-providers';
import { serializeGarminStrengthWorkoutV1, serializeGarminWorkoutV1 } from './garmin-workout.serializer';
import expectedFixture from './fixtures/garmin-strength-v1.json';

const details = { version: 1 as const, workoutId: 'lift', revision: 1, exercises: [
  { id: 'squat', name: 'Barbell back squat', sets: [
    { id: 'one', ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 80.25, restAfterSeconds: 120 },
    { id: 'two', ending: { kind: 'repetitions' as const, repetitions: 8 }, externalLoadKg: 0 },
  ] },
  { id: 'plank', name: 'Plank', sets: [{ id: 'hold', ending: { kind: 'time' as const, seconds: 45 }, restAfterSeconds: 30 }] },
] };
const options = { name: 'Synthetic strength fixture', allowDegraded: false };

describe('Garmin strength — Training API V2 1.0 and verified Appendix B exercise identifiers', () => {
  it('preserves ordered exercises, each set, timed holds, exact kilogram loads and final rest', () => {
    const result = serializeGarminStrengthWorkoutV1(details, options);
    expect(result.artifact).toEqual(expectedFixture);
    expect(result.level).toBe('exact');
    expect(result.artifact).toMatchObject({ sport: 'STRENGTH_TRAINING', segments: [{ sport: 'STRENGTH_TRAINING', steps: [
      { stepOrder: 1, exerciseCategory: 'SQUAT', exerciseName: 'BARBELL_BACK_SQUAT', durationType: 'REPS', durationValue: 5, weightValue: 80.25, weightDisplayUnit: 'KILOGRAM' },
      { stepOrder: 2, intensity: 'REST', durationType: 'FIXED_REST', durationValue: 120, exerciseName: null, weightValue: null },
      { stepOrder: 3, durationType: 'REPS', durationValue: 8, weightValue: 0, weightDisplayUnit: 'KILOGRAM' },
      { stepOrder: 4, exerciseCategory: 'PLANK', exerciseName: 'PLANK', durationType: 'TIME', durationValue: 45, weightValue: null },
      { stepOrder: 5, durationType: 'FIXED_REST', durationValue: 30 },
    ] }] });
    expect(JSON.parse(JSON.stringify(result.artifact))).toEqual(result.artifact);
    expect(JSON.stringify(result.artifact)).not.toContain('lift');
    expect(JSON.stringify(result.artifact)).not.toContain('revision');
  });
  it('does not permit recipe-only strength, unknown exercises or a mismatched companion', () => {
    const structure = projectStrengthWorkoutToV1(details);
    expect(() => serializeGarminWorkoutV1(structure, options)).toThrow('cannot be represented');
    const unknown = { ...details, exercises: [{ ...details.exercises[0], name: 'My custom exercise' }] };
    expect(() => serializeGarminStrengthWorkoutV1(unknown, { ...options, allowDegraded: true })).toThrow('cannot be represented');
    expect(assessPlannedWorkoutProviderMappingV1('garmin', structure,
      { ...details, exercises: [{ ...details.exercises[0], name: 'Plank' }] }).level).toBe('unsupported');
  });
  it('rejects malformed companions and preserves the 100-step limit including rests', () => {
    expect(() => serializeGarminStrengthWorkoutV1({ ...details, revision: 0 }, options)).toThrow();
    const sets = Array.from({ length: 50 }, (_, i) => ({ id: `set-${i}`, ending: { kind: 'time', seconds: 30 }, restAfterSeconds: 10 }));
    const maximum = { ...details, exercises: [{ id: 'plank', name: 'Plank', sets }] };
    expect(serializeGarminStrengthWorkoutV1(maximum, options).artifact.segments[0].steps).toHaveLength(100);
    expect(() => serializeGarminStrengthWorkoutV1({ ...maximum,
      exercises: [...maximum.exercises, { id: 'extra', name: 'Squat', sets: [{ id: 'extra-set', ending: { kind: 'time', seconds: 30 } }] }] }, options)).toThrow();
  });
  it('keeps exercise identity matching literal rather than guessing equipment', () => {
    for (const name of ['barbell-back-squat', 'BARBELL_BACK_SQUAT', ' Barbell  back squat ']) {
      const value = { ...details, exercises: [{ ...details.exercises[0], name }] };
      expect(serializeGarminStrengthWorkoutV1(value, options).artifact.segments[0].steps[0]).toMatchObject({ exerciseName: 'BARBELL_BACK_SQUAT' });
    }
    expect(() => serializeGarminStrengthWorkoutV1({ ...details,
      exercises: [{ ...details.exercises[0], name: 'Back squat' }] }, options)).toThrow();
  });
});
