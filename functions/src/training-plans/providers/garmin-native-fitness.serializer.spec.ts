import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { parseWorkoutStructureV1, type WorkoutStructureV1 } from '../../../../shared/planned-workout';
import { assessPlannedWorkoutProviderMappingV1 } from '../../../../shared/planned-workout-providers';
import { serializeGarminWorkoutV1 } from './garmin-workout.serializer';

describe('Garmin native fitness workout profiles', () => {
  it.each([
    [ActivityTypes.Yoga, 'YOGA'], [ActivityTypes.Pilates, 'PILATES'],
    [ActivityTypes.CardioTraining, 'CARDIO_TRAINING'],
  ] as const)('sends %s using its native profile and preserves the prescription', (sport, native) => {
    const recipe: WorkoutStructureV1 = { version: 1, sport, nodes: [
      { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 123 }, targets: [], note: 'Hold gently' },
      { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'manual' }, targets: [] },
    ] };
    const before = structuredClone(recipe);
    expect(assessPlannedWorkoutProviderMappingV1('garmin', recipe)).toMatchObject({ level: 'exact', issues: [] });
    const result = serializeGarminWorkoutV1(recipe, { name: 'Native fitness fixture', allowDegraded: false });
    expect(result.level).toBe('exact');
    expect(result.artifact.sport).toBe(native);
    expect(result.artifact.segments[0].sport).toBe(native);
    expect(result.artifact.segments[0].steps).toMatchObject([
      { durationType: 'TIME', durationValue: 123, description: 'Hold gently' },
      { durationType: 'OPEN', durationValue: null },
    ]);
    expect(recipe).toEqual(before);
    expect(parseWorkoutStructureV1(JSON.parse(JSON.stringify(recipe)))).toEqual(before);
    const repetitions = { ...recipe, nodes: [{ kind: 'step', id: 'reps', purpose: 'work',
      ending: { kind: 'repetitions', repetitions: 10 }, targets: [] }] };
    expect(assessPlannedWorkoutProviderMappingV1('garmin', repetitions).level).toBe('unsupported');
    expect(() => serializeGarminWorkoutV1(repetitions, { name: 'No invented exercise details', allowDegraded: true })).toThrow();
  });
});
