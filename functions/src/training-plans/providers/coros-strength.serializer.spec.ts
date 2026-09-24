import { describe, expect, it } from 'vitest';
import { serializeCorosStrengthPlanV1 } from './coros-training-plan.serializer';

describe('COROS strength contract fixture', () => {
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
