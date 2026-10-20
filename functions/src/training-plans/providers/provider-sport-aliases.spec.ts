import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { resolveCompatibleActivityType } from '../../../../shared/activity-type-compatibility';
import { MANUAL_WORKOUT_EDITOR_SPORTS_V1, parseWorkoutStructureV1, type WorkoutStructureV1 } from '../../../../shared/planned-workout';
import { assessPlannedWorkoutProviderMappingV1, isPlannedWorkoutProviderDeliveryEnabled } from '../../../../shared/planned-workout-providers';
import { wahooWorkoutSportProfileV1 } from '../../../../shared/wahoo-workout-sports';
import { serializeSuuntoGuideJsonV1 } from './suunto-guide.serializer';
import { serializeGarminWorkoutV1 } from './garmin-workout.serializer';
import { serializeCorosTrainingPlanV1 } from './coros-training-plan.serializer';
import { serializeWahooPlanJsonV1 } from './wahoo-plan.serializer';

// Expected provider destinations from the approved table, independent of the registry.
const rows: Array<[string, ActivityTypes, 'RUNNING' | 'CYCLING' | 'GENERIC', 'run' | 'trailRun' | 'bike' | null, ActivityTypes]> = [
  ...['Road Running', 'Track Running', 'Ultra Running', 'Crosscountry Running', 'Indoor Track Running', 'Obstacle Racing']
    .map(name => [name, ActivityTypes.Running, 'RUNNING', 'run', ActivityTypes.Running] as typeof rows[number]),
  ['Vertical Running', ActivityTypes.TrailRunning, 'RUNNING', 'trailRun', ActivityTypes.TrailRunning],
  ['Indoor Running', ActivityTypes.Treadmill, 'RUNNING', 'run', ActivityTypes.Treadmill],
  ['Virtual Running', ActivityTypes.Treadmill, 'RUNNING', 'run', ActivityTypes.VirtualRunning],
  ...['Road Cycling', 'Gravel Cycling', 'Track Cycling', 'Cyclocross', 'Recumbent Cycling', 'Velomobile', 'BMX', 'Kickbiking']
    .map(name => [name, ActivityTypes.Cycling, 'CYCLING', 'bike', ActivityTypes.Cycling] as typeof rows[number]),
  ...['LES MILLS RPM', 'LES MILLS SPRINT', 'LES MILLS THE TRIP']
    .map(name => [name, ActivityTypes.IndoorCycling, 'CYCLING', 'bike', ActivityTypes.IndoorCycling] as typeof rows[number]),
  ['Virtual Cycling', ActivityTypes.IndoorCycling, 'CYCLING', 'bike', ActivityTypes.VirtualCycling],
  ['Indoor Hand Cycle', ActivityTypes.Handcycle, 'CYCLING', 'bike', ActivityTypes.Handcycle],
  ['Mountain Bike Orienteering', ActivityTypes.MountainBiking, 'CYCLING', 'bike', ActivityTypes.MountainBiking],
  ...['E-Mountain Biking', 'E-Enduro MTB'].map(name => [name, ActivityTypes.EBiking, 'CYCLING', 'bike', ActivityTypes.EBiking] as typeof rows[number]),
  ...['Enduro MTB', 'Downhill Cycling'].map(name => [name, ActivityTypes.MountainBiking, 'CYCLING', 'bike', ActivityTypes.MountainBiking] as typeof rows[number]),
  ...['Speed Walking', 'Nordic Walking', 'Indoor Walking'].map(name => [name, ActivityTypes.Walking, 'GENERIC', null, ActivityTypes.Walking] as typeof rows[number]),
  ['Trekking', ActivityTypes.Hiking, 'GENERIC', null, ActivityTypes.Hiking],
];
const recipe = (sport: ActivityTypes): WorkoutStructureV1 => ({ version: 1, sport, nodes: [
  { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [] },
  { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 60 }, targets: [] },
] });
// Approved Suunto-only additions: expected IDs/fidelity do not come from the mapper.
const suuntoOnlyRows: Array<[string, number, boolean]> = [
  ['Kettlebell', 63, true], ['Calisthenics', 104, true],
  ['Core Training', 23, false], ['LES MILLS CORE', 23, false],
  ['LES MILLS GRIT Strength', 23, false], ['LES MILLS BODYPUMP', 23, false],
  ['Virtual Rowing', 57, false],
];
const suuntoOptions = { name: 'Alias fixture', owner: 'Quantified Self', url: 'https://quantified-self.io/training/plans',
  sourceWorkoutId: 'alias-fixture', localDate: '2026-10-11', allowDegraded: true };
const corosOptions = { athleteId: 24680, workoutId: 13579, title: 'Alias fixture', localDate: '2026-10-11',
  lastModifiedDate: '2026-10-10T12:00:00', allowDegraded: true };

describe('approved planned-workout sport aliases', () => {
  it.each(suuntoOnlyRows)('maps %s to its approved Suunto profile without changing its prescription', (name, activityId, native) => {
    const structure = recipe(resolveCompatibleActivityType(name)!);
    structure.nodes[0] = { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'manual' },
      targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 100, maximumBpm: 130 }] };
    const before = structuredClone(structure);
    const guide = serializeSuuntoGuideJsonV1(structure, { ...suuntoOptions, allowDegraded: !native });
    expect(guide.artifact.activities).toEqual([activityId]);
    expect(guide.level).toBe(native ? 'exact' : 'degraded');
    expect(guide.artifact.steps[0]).toMatchObject({ type: 'fields', fields: expect.arrayContaining([
      expect.objectContaining({ type: 'heartRate' }), expect.objectContaining({ type: 'targetHeartRate', min: 100, max: 130 }),
    ]), transitions: [{ condition: { type: 'manualLap' } }] });
    if (native) {
      expect(guide.issues).toEqual([]);
      // HR-only strength presentation must not invent pace or create extra recorded laps.
      expect(guide.artifact.steps[0]).not.toHaveProperty('createManualLap');
      expect(JSON.stringify(guide.artifact.steps)).not.toMatch(/"type":"(?:pace|speed|power|cadence)"/);
    } else {
      expect(guide.issues).toContainEqual(expect.objectContaining({ code: 'sport_profile_degraded', message: expect.stringContaining(name) }));
      expect(() => serializeSuuntoGuideJsonV1(structure, { ...suuntoOptions, allowDegraded: false })).toThrow();
    }
    for (const provider of ['garmin', 'coros', 'wahoo'] as const) {
      expect(assessPlannedWorkoutProviderMappingV1(provider, recipe(structure.sport))).toMatchObject({ level: 'unsupported',
        issues: expect.arrayContaining([expect.objectContaining({ code: 'unsupported_sport' })]) });
    }
    expect(structure).toEqual(before);
    expect(parseWorkoutStructureV1(JSON.parse(JSON.stringify(structure)))).toEqual(before);
    const repetitions = { ...structure, nodes: [{ kind: 'step', id: 'reps', purpose: 'work',
      ending: { kind: 'repetitions', repetitions: 10 }, targets: [] }] };
    expect(assessPlannedWorkoutProviderMappingV1('suunto', repetitions)).toMatchObject({ level: 'unsupported',
      issues: expect.arrayContaining([expect.objectContaining({ code: 'unsupported_ending' })]) });
  });

  it('delivers Weight Training through Suunto Gym without changing the recipe or enabling other providers', () => {
    const structure = parseWorkoutStructureV1(JSON.parse(JSON.stringify(recipe(ActivityTypes.WeightTraining))));
    structure.nodes[0] = { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'manual' },
      targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 100, maximumBpm: 130 }], note: 'Lift with good form' };
    const before = structuredClone(structure);
    const guide = serializeSuuntoGuideJsonV1(structure, suuntoOptions);
    const canonical = { ...structure, sport: ActivityTypes.StrengthTraining };
    expect(guide.artifact).toEqual(serializeSuuntoGuideJsonV1(canonical, suuntoOptions).artifact);
    expect(guide.artifact.activities).toEqual([23]);
    expect(guide.artifact.steps[0]).toMatchObject({ type: 'fields', fields: expect.arrayContaining([
      expect.objectContaining({ type: 'heartRate' }),
      expect.objectContaining({ type: 'targetHeartRate', min: 100, max: 130 }),
    ]), transitions: [{ condition: { type: 'manualLap' } }] });
    expect(guide.level).toBe('degraded');
    expect(guide.issues).toContainEqual(expect.objectContaining({ code: 'sport_profile_degraded', path: '$.sport',
      message: expect.stringContaining('Weight Training using its Strength Training profile') }));
    expect(() => serializeSuuntoGuideJsonV1(structure, { ...suuntoOptions, allowDegraded: false })).toThrow();
    for (const provider of ['garmin', 'coros', 'wahoo'] as const) {
      expect(assessPlannedWorkoutProviderMappingV1(provider, recipe(ActivityTypes.WeightTraining))).toMatchObject({
        level: 'unsupported', issues: expect.arrayContaining([expect.objectContaining({ code: 'unsupported_sport' })]),
      });
    }
    const repetitions = { ...structure, nodes: [{ kind: 'step', id: 'reps', purpose: 'work',
      ending: { kind: 'repetitions', repetitions: 10 }, targets: [] }] };
    expect(assessPlannedWorkoutProviderMappingV1('suunto', repetitions)).toMatchObject({ level: 'unsupported',
      issues: expect.arrayContaining([expect.objectContaining({ code: 'unsupported_ending' })]) });
    expect(structure).toEqual(before);
    expect(parseWorkoutStructureV1(JSON.parse(JSON.stringify(structure)))).toEqual(before);
  });

  it.each(MANUAL_WORKOUT_EDITOR_SPORTS_V1)('has a Suunto mapping for the editor sport %s', sport => {
    expect(serializeSuuntoGuideJsonV1(recipe(sport), suuntoOptions).artifact.activities.length).toBeGreaterThan(0);
  });

  it.each(rows)('delivers %s through the approved existing profiles and retains its QS recipe', (name, suunto, garmin, coros, wahoo) => {
    const sport = resolveCompatibleActivityType(name)!;
    expect(sport).toBe(name);
    const structure = parseWorkoutStructureV1(JSON.parse(JSON.stringify(recipe(sport))));
    const before = JSON.stringify(structure);
    const guide = serializeSuuntoGuideJsonV1(structure, suuntoOptions);
    expect(guide.artifact).toEqual(serializeSuuntoGuideJsonV1(recipe(suunto), suuntoOptions).artifact);
    expect(guide.issues).toContainEqual(expect.objectContaining({ code: 'sport_profile_degraded', path: '$.sport', message: expect.stringContaining(name) }));
    expect(() => serializeSuuntoGuideJsonV1(structure, { ...suuntoOptions, allowDegraded: false })).toThrow();
    expect(serializeGarminWorkoutV1(structure, { name: 'Alias fixture', allowDegraded: true }).artifact.sport).toBe(garmin);
    const profile = wahooWorkoutSportProfileV1(wahoo)!;
    const wahooOptions = { name: 'Alias fixture', location: profile.location === 0 ? 'indoor' as const : 'outdoor' as const, allowDegraded: true };
    expect(serializeWahooPlanJsonV1(structure, wahooOptions).artifact)
      .toEqual(serializeWahooPlanJsonV1(recipe(wahoo), wahooOptions).artifact);
    if (coros) expect(serializeCorosTrainingPlanV1(structure, corosOptions).artifact.Workouts[0].WorkoutType).toBe(coros);
    else expect(assessPlannedWorkoutProviderMappingV1('coros', structure).level).toBe('unsupported');
    expect(JSON.stringify(structure)).toBe(before);
    expect(isPlannedWorkoutProviderDeliveryEnabled('coros')).toBe(false);
  });

  it.each(['Speed Walking', 'Nordic Walking', 'Indoor Walking', 'Trekking'])('keeps existing Wahoo timed and untargeted restrictions for %s', name => {
      const structure = recipe(resolveCompatibleActivityType(name)!);
      structure.nodes[0] = { ...structure.nodes[0] as Extract<WorkoutStructureV1['nodes'][number], { kind: 'step' }>,
        ending: { kind: 'distance', meters: 1000 }, targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 100, maximumBpm: 130 }] };
      expect(assessPlannedWorkoutProviderMappingV1('wahoo', structure)).toMatchObject({ level: 'unsupported',
        issues: expect.arrayContaining([expect.objectContaining({ code: 'unsupported_ending' }), expect.objectContaining({ code: 'unsupported_target' })]) });
    });

  it.each(['BMX', 'Kickbiking', 'E-Mountain Biking', 'Indoor Hand Cycle'])('retains COROS cycling cadence restrictions for %s', name => {
    const structure = recipe(resolveCompatibleActivityType(name)!);
    const step = structure.nodes[0] as Extract<WorkoutStructureV1['nodes'][number], { kind: 'step' }>;
    step.targets = [{ kind: 'cadence', mode: 'absolute', minimumRpm: 80, maximumRpm: 90 }];
    expect(assessPlannedWorkoutProviderMappingV1('coros', structure)).toMatchObject({ level: 'unsupported',
      issues: expect.arrayContaining([expect.objectContaining({ code: 'unsupported_target' })]) });
  });

  it.each(['Classic Crosscountry Skiing', 'Skate Skiing', 'AMRAP', 'EMOM', 'Tabata'])('does not infer unapproved outbound support for %s', name => {
      for (const provider of ['suunto', 'garmin', 'coros', 'wahoo'] as const) {
        expect(assessPlannedWorkoutProviderMappingV1(provider, recipe(resolveCompatibleActivityType(name)!)).level).toBe('unsupported');
      }
    });
});
