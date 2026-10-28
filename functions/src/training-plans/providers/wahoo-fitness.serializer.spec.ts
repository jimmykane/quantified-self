import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { parseWorkoutStructureV1, type WorkoutStructureV1 } from '../../../../shared/planned-workout';
import { assessPlannedWorkoutProviderMappingV1 } from '../../../../shared/planned-workout-providers';
import { wahooWorkoutSportProfileV1 } from '../../../../shared/wahoo-workout-sports';
import { serializeWahooPlanJsonV1 } from './wahoo-plan.serializer';

const rows = [[ActivityTypes.Yoga, 66, 'exact'], [ActivityTypes.EllipticalTrainer, 20, 'exact'],
  [ActivityTypes.CardioTraining, 43, 'degraded']] as const;
const recipe = (sport: ActivityTypes): WorkoutStructureV1 => ({ version: 1, sport, nodes: [
  { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 30 }, targets: [], note: 'Move gently' },
  { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 30 }, targets: [] },
] });
const options = { name: 'Fitness fixture', description: 'Fitness fixture', location: 'indoor' as const, allowDegraded: true };

describe('Wahoo fitness workout profiles', () => {
  it.each(rows)('maps %s to cloud-tested type %i without changing the timed recipe', (sport, type, level) => {
    const structure = recipe(sport), before = structuredClone(structure);
    expect(wahooWorkoutSportProfileV1(sport)).toMatchObject({ family: 6, location: 0, workoutType: type, untargetedTimeOnly: true });
    expect(assessPlannedWorkoutProviderMappingV1('wahoo', structure).level).toBe(level);
    const serialized = serializeWahooPlanJsonV1(structure, options);
    expect(serialized.artifact.header).toMatchObject({ workout_type_family: 6, workout_type_location: 0 });
    expect(serialized.artifact.intervals).toMatchObject([
      { exit_trigger_type: 'time', exit_trigger_value: 30, targets: [{ type: 'rpe', low: 1, high: 10 }] },
      { exit_trigger_type: 'time', exit_trigger_value: 30, intensity_type: 'rest', targets: [{ type: 'rpe', low: 1, high: 10 }] },
    ]);
    if (level === 'degraded') expect(() => serializeWahooPlanJsonV1(structure, { ...options, allowDegraded: false })).toThrow();
    else expect(() => serializeWahooPlanJsonV1(structure, { ...options, allowDegraded: false })).not.toThrow();
    expect(() => serializeWahooPlanJsonV1(structure, { ...options, location: 'outdoor' })).toThrow();
    expect(structure).toEqual(before);
    expect(parseWorkoutStructureV1(JSON.parse(JSON.stringify(structure)))).toEqual(before);
  });

  it.each(rows)('rejects unverified %s prescriptions, including inside repeats', sport => {
    for (const ending of [{ kind: 'manual' }, { kind: 'distance', meters: 100 }, { kind: 'repetitions', repetitions: 10 }] as const) {
      const structure = recipe(sport);
      structure.nodes = [{ kind: 'repeat', id: 'repeat', count: 2, steps: [
        { kind: 'step', id: 'work', purpose: 'work', ending, targets: [] },
      ] }];
      expect(assessPlannedWorkoutProviderMappingV1('wahoo', structure).level).toBe('unsupported');
      expect(() => serializeWahooPlanJsonV1(structure, options)).toThrow();
    }
    const structure = recipe(sport);
    structure.nodes = [{ kind: 'step', id: 'target', purpose: 'work', ending: { kind: 'time', seconds: 30 },
      targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 100, maximumBpm: 130 }] }];
    expect(assessPlannedWorkoutProviderMappingV1('wahoo', structure).level).toBe('unsupported');
    expect(() => serializeWahooPlanJsonV1(structure, options)).toThrow();
  });
});
