import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { parseWorkoutStructureV1, type WorkoutStructureV1 } from '../../../../shared/planned-workout';
import { assessPlannedWorkoutProviderMappingV1 } from '../../../../shared/planned-workout-providers';
import { wahooWorkoutSportProfileV1 } from '../../../../shared/wahoo-workout-sports';
import { serializeGarminWorkoutV1 } from './garmin-workout.serializer';
import { serializeWahooPlanJsonV1 } from './wahoo-plan.serializer';

const rows = [
  ...[ActivityTypes.Crossfit, ActivityTypes['Circuit Training'], ActivityTypes.Aerobics, ActivityTypes.HIIT,
    ActivityTypes.AMRAP, ActivityTypes.EMOM, ActivityTypes.Tabata].map(sport => ({ sport, garmin: 'CARDIO_TRAINING', wahoo: 43 })),
  ...[ActivityTypes.Crosstrainer, ActivityTypes.EllipticalTrainer].map(sport => ({ sport, garmin: 'CARDIO_TRAINING', wahoo: 20 })),
  ...[ActivityTypes.Stretching, ActivityTypes.FlexibilityTraining, ActivityTypes.Meditation, ActivityTypes.Breathwork]
    .map(sport => ({ sport, garmin: 'GENERIC', wahoo: 42 })),
  { sport: ActivityTypes.Pilates, garmin: 'PILATES', wahoo: 42 },
];
const recipe = (sport: ActivityTypes): WorkoutStructureV1 => ({ version: 1, sport, nodes: [
  { kind: 'repeat', id: 'round', count: 2, steps: [
    { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 31 }, targets: [], note: 'Original instruction' },
    { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 17 }, targets: [] },
  ] },
] });

describe('approved cardio and mobility workout aliases', () => {
  it.each(rows)('preserves $sport and delivers the approved profiles with explicit review', ({ sport, garmin, wahoo }) => {
    const source = recipe(sport), before = structuredClone(source);
    const g = serializeGarminWorkoutV1(source, { name: 'Alias fixture', allowDegraded: true });
    expect(g.artifact.sport).toBe(garmin);
    expect(g.artifact.segments[0].sport).toBe(garmin);
    expect(g.level).toBe(sport === ActivityTypes.Pilates ? 'exact' : 'degraded');
    if (sport !== ActivityTypes.Pilates) expect(() => serializeGarminWorkoutV1(source, { name: 'Alias fixture', allowDegraded: false })).toThrow();
    expect(wahooWorkoutSportProfileV1(sport)).toMatchObject({ family: 6, location: 0, workoutType: wahoo, untargetedTimeOnly: true });
    const options = { name: 'Alias fixture', location: 'indoor' as const, allowDegraded: true };
    const w = serializeWahooPlanJsonV1(source, options);
    expect(w.artifact.header).toMatchObject({ workout_type_family: 6, workout_type_location: 0, duration_s: 96 });
    expect(w.artifact.intervals[0]).toMatchObject({ exit_trigger_type: 'repeat', exit_trigger_value: 1 });
    if (sport !== ActivityTypes.EllipticalTrainer) expect(() => serializeWahooPlanJsonV1(source, { ...options, allowDegraded: false })).toThrow();
    expect(assessPlannedWorkoutProviderMappingV1('coros', source).level).toBe('unsupported');
    expect(source).toEqual(before);
    expect(parseWorkoutStructureV1(JSON.parse(JSON.stringify(source)))).toEqual(before);
  });

  it.each(rows)('keeps unverified Wahoo $sport endings and targets blocked', ({ sport, garmin }) => {
    for (const step of [
      { kind: 'step', id: 'manual', purpose: 'work', ending: { kind: 'manual' }, targets: [] },
      { kind: 'step', id: 'hr', purpose: 'work', ending: { kind: 'time', seconds: 60 },
        targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 100, maximumBpm: 130 }] },
    ]) {
      const source = { version: 1, sport, nodes: [step] };
      expect(assessPlannedWorkoutProviderMappingV1('wahoo', source).level).toBe('unsupported');
      if (garmin === 'GENERIC') expect(assessPlannedWorkoutProviderMappingV1('garmin', source).level).toBe('unsupported');
    }
  });
});
