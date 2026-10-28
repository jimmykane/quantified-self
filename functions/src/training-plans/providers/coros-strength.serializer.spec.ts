import { describe, expect, it } from 'vitest';
import { serializeCorosStrengthPlanV1, serializeCorosTrainingPlanV1 } from './coros-training-plan.serializer';
import { projectStrengthWorkoutToV1 } from '../../../../shared/strength-workout';
import { assessPlannedWorkoutProviderMappingV1 } from '../../../../shared/planned-workout-providers';

const options = { athleteId: 100, workoutId: 2000, title: 'Synthetic strength day', localDate: '2026-10-01',
  lastModifiedDate: '2026-09-24T10:00:00', allowDegraded: false };
const details = { version: 1 as const, workoutId: 'lift', revision: 1, exercises: [{ id: 'squat', name: 'スクワット 🏋️',
  sets: [{ id: 'one', ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 80.25, restAfterSeconds: 120 },
    { id: 'two', ending: { kind: 'repetitions' as const, repetitions: 8 }, externalLoadKg: 0 }] },
  { id: 'plank', name: 'Plank', sets: [{ id: 'hold', ending: { kind: 'time' as const, seconds: 45 }, restAfterSeconds: 30 }] }] };

describe('COROS strength — API Reference V2.0.6 §6.1 synthetic contract', () => {
  it('preserves ordered Unicode names, individual sets, fractional and zero kilogram loads, holds and final rest', () => {
    const result = serializeCorosStrengthPlanV1(details, options);
    expect(result.level).toBe('exact');
    expect(result.issues).toEqual([]);
    expect(result.artifact).toEqual({ AthleteId: 100, StartDate: '2026-10-01', EndDate: '2026-10-01', Workouts: [{
      LastModifiedDate: options.lastModifiedDate, Title: options.title, Id: 2000, WorkoutDay: options.localDate, WorkoutType: 'strength',
      Structure: [
        { Type: 'Step', IntensityClass: 'Active', Name: 'スクワット 🏋️', Description: 'Set 1', Ftp: 0, ThresholdHr: 0, ThresholdSpeed: 0,
          Length: { Unit: 'Reps', Value: 5 }, Rest: { Unit: 'Second', Value: 120 }, IntensityTarget: { Unit: 'ValueOfEquipmentWeight', Value: 80.25 } },
        { Type: 'Step', IntensityClass: 'Active', Name: 'スクワット 🏋️', Description: 'Set 2', Ftp: 0, ThresholdHr: 0, ThresholdSpeed: 0,
          Length: { Unit: 'Reps', Value: 8 }, IntensityTarget: { Unit: 'ValueOfEquipmentWeight', Value: 0 } },
        { Type: 'Step', IntensityClass: 'Active', Name: 'Plank', Description: 'Set 1', Ftp: 0, ThresholdHr: 0, ThresholdSpeed: 0,
          Length: { Unit: 'Second', Value: 45 }, Rest: { Unit: 'Second', Value: 30 }, IntensityTarget: [] },
      ],
    }] });
    expect(JSON.parse(JSON.stringify(result.artifact))).toEqual(result.artifact);
    expect(JSON.stringify(result.artifact)).not.toContain('workoutId');
    expect(JSON.stringify(result.artifact)).not.toContain('revision');
  });

  it('requires the full companion, not a v1 recipe or mismatched exercise projection', () => {
    const projection = projectStrengthWorkoutToV1(details);
    expect(() => serializeCorosTrainingPlanV1(projection, options)).toThrow('cannot be represented');
    expect(assessPlannedWorkoutProviderMappingV1('coros', projection, details).level).toBe('exact');
    expect(assessPlannedWorkoutProviderMappingV1('coros', projection).level).toBe('unsupported');
    expect(assessPlannedWorkoutProviderMappingV1('coros', projection,
      { ...details, exercises: [{ ...details.exercises[0], name: 'Different' }] }).level).toBe('unsupported');
  });

  it.each([-1, NaN, Infinity, 1001])('rejects invalid external load %s instead of treating it as body weight', externalLoadKg => {
    expect(() => serializeCorosStrengthPlanV1({ ...details, exercises: [{ ...details.exercises[0],
      sets: [{ ...details.exercises[0].sets[0], externalLoadKg }] }] }, options)).toThrow();
  });

  it.each([0, -1, 1.5])('rejects unsupported rest %s without dropping or rounding it', restAfterSeconds => {
    expect(() => serializeCorosStrengthPlanV1({ ...details, exercises: [{ ...details.exercises[0],
      sets: [{ ...details.exercises[0].sets[0], restAfterSeconds }] }] }, options)).toThrow();
  });

  it('preserves the canonical 100-projected-node limit, including optional rest', () => {
    const maximum = { ...details, exercises: [{ id: 'plank', name: 'Plank', sets: Array.from({ length: 50 }, (_, i) => ({
      id: `set-${i}`, ending: { kind: 'time', seconds: 30 }, restAfterSeconds: 10 })) }] };
    expect(serializeCorosStrengthPlanV1(maximum, options).artifact.Workouts[0].Structure).toHaveLength(50);
    expect(() => serializeCorosStrengthPlanV1({ ...maximum, exercises: [...maximum.exercises,
      { id: 'extra', name: 'Squat', sets: [{ id: 'extra-set', ending: { kind: 'time', seconds: 30 } }] }] }, options)).toThrow();
  });
  it('maps exercise sets to the documented strength Reps/Second, Rest and fixed equipment weight fields', () => {
    const result = serializeCorosStrengthPlanV1({
      version: 1, workoutId: 'strength-one', revision: 1, exercises: [
        { id: 'squat', name: 'Back squat', sets: [
          { id: 'set-one', ending: { kind: 'repetitions', repetitions: 5 }, externalLoadKg: 80, restAfterSeconds: 120 },
          { id: 'set-two', ending: { kind: 'repetitions', repetitions: 5 }, externalLoadKg: 80 },
        ] },
        { id: 'plank', name: 'Plank', sets: [{ id: 'hold', ending: { kind: 'time', seconds: 45 } }] },
      ],
    }, { athleteId: 100, sourceWorkoutId: 'strength-one', title: 'Strength day', localDate: '2026-10-01',
      lastModifiedDate: '2026-09-24T10:00:00', allowDegraded: false });
    expect(result.level).toBe('exact');
    expect(result.artifact.Workouts[0]).toMatchObject({ WorkoutType: 'strength', Structure: [
      { Name: 'Back squat', Length: { Unit: 'Reps', Value: 5 }, Rest: { Unit: 'Second', Value: 120 },
        IntensityTarget: { Unit: 'ValueOfEquipmentWeight', Value: 80 } },
      { Name: 'Back squat', Length: { Unit: 'Reps', Value: 5 }, IntensityTarget: { Unit: 'ValueOfEquipmentWeight', Value: 80 } },
      { Name: 'Plank', Length: { Unit: 'Second', Value: 45 }, IntensityTarget: [] },
    ] });
    expect(JSON.parse(JSON.stringify(result.artifact)).Workouts[0].Structure).toHaveLength(3);
  });
});
