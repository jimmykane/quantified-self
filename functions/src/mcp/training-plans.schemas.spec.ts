import { describe, expect, it } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import {
  WORKOUT_ENDING_KINDS,
  WORKOUT_STEP_PURPOSES,
  WORKOUT_TARGET_KINDS,
  type WorkoutEndingV1,
  type WorkoutStructureV1,
  type WorkoutTargetV1,
} from '../../../shared/planned-workout';
import {
  MCP_WORKOUT_RECIPE_VARIANT_COVERAGE,
  TRAINING_CHANGE_SCHEMA,
  TRAINING_READ_OUTPUTS,
  TRAINING_RECIPE_SCHEMA,
  TRAINING_RECIPE_WITH_POOL_SCHEMA,
  TRAINING_WRITE_INPUTS,
} from './training-plans.schemas';

const recipe = (ending: WorkoutEndingV1, targets: WorkoutTargetV1[] = []): WorkoutStructureV1 => ({ version: 1, sport: ActivityTypes.Running,
  nodes: [{ kind: 'step', id: 'step-1', purpose: 'work', ending, targets, note: '夜の練習 🏃\nPrivate context' }] });

const endingFixtures = {
  time: { kind: 'time', seconds: 60 },
  distance: { kind: 'distance', meters: 1000 },
  kilojoules: { kind: 'kilojoules', kilojoules: 50 },
  repetitions: { kind: 'repetitions', repetitions: 10 },
  manual: { kind: 'manual' },
} satisfies Record<keyof typeof MCP_WORKOUT_RECIPE_VARIANT_COVERAGE.endings, WorkoutEndingV1>;

const targetVariantFixtures = {
  'heart-rate:absolute': { kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 140 },
  'heart-rate:relative': { kind: 'heart-rate', mode: 'relative', minimumPercent: 60, maximumPercent: 80,
    reference: { kind: 'max-heart-rate', bpm: 180 } },
  'power:absolute': { kind: 'power', mode: 'absolute', minimumWatts: 0, maximumWatts: 150 },
  'power:relative': { kind: 'power', mode: 'relative', minimumPercent: 0, maximumPercent: 80,
    reference: { kind: 'critical-power', watts: 250 } },
  'speed:absolute': { kind: 'speed', mode: 'absolute', minimumMetersPerSecond: 3, maximumMetersPerSecond: 4,
    presentation: 'pace' },
  'speed:relative': { kind: 'speed', mode: 'relative', minimumPercent: 80, maximumPercent: 90,
    reference: { kind: 'threshold-speed', metersPerSecond: 4 }, presentation: 'speed' },
  'cadence:absolute': { kind: 'cadence', mode: 'absolute', minimumRpm: 70, maximumRpm: 90 },
  'cadence:relative': { kind: 'cadence', mode: 'relative', minimumPercent: 80, maximumPercent: 90,
    reference: { kind: 'preferred-cadence', rpm: 90 } },
} satisfies Record<keyof typeof MCP_WORKOUT_RECIPE_VARIANT_COVERAGE.targetVariants, WorkoutTargetV1>;

const targetReferenceFixtures = {
  'heart-rate:max-heart-rate': { kind: 'heart-rate', mode: 'relative', minimumPercent: 60, maximumPercent: 80,
    reference: { kind: 'max-heart-rate', bpm: 180 } },
  'heart-rate:threshold-heart-rate': { kind: 'heart-rate', mode: 'relative', minimumPercent: 80, maximumPercent: 90,
    reference: { kind: 'threshold-heart-rate', bpm: 165 } },
  'power:functional-threshold-power': { kind: 'power', mode: 'relative', minimumPercent: 80, maximumPercent: 90,
    reference: { kind: 'functional-threshold-power', watts: 260 } },
  'power:critical-power': { kind: 'power', mode: 'relative', minimumPercent: 80, maximumPercent: 90,
    reference: { kind: 'critical-power', watts: 250 } },
  'speed:threshold-speed': { kind: 'speed', mode: 'relative', minimumPercent: 80, maximumPercent: 90,
    presentation: 'pace', reference: { kind: 'threshold-speed', metersPerSecond: 4 } },
  'cadence:preferred-cadence': { kind: 'cadence', mode: 'relative', minimumPercent: 80, maximumPercent: 90,
    reference: { kind: 'preferred-cadence', rpm: 90 } },
} satisfies Record<keyof typeof MCP_WORKOUT_RECIPE_VARIANT_COVERAGE.targetReferences, WorkoutTargetV1>;

const speedPresentationFixtures = {
  pace: { kind: 'speed', mode: 'absolute', minimumMetersPerSecond: 3, maximumMetersPerSecond: 4, presentation: 'pace' },
  speed: { kind: 'speed', mode: 'absolute', minimumMetersPerSecond: 3, maximumMetersPerSecond: 4, presentation: 'speed' },
} satisfies Record<keyof typeof MCP_WORKOUT_RECIPE_VARIANT_COVERAGE.speedPresentations, WorkoutTargetV1>;

function expectPublicReadWriteRoundTrip(input: WorkoutStructureV1): void {
  const serialized = JSON.parse(JSON.stringify(input));
  const read = TRAINING_READ_OUTPUTS.get_planned_workout.parse({
    scheduleRevision: 3,
    workout: {
      workoutRef: 'opaque-workout',
      planRef: null,
      title: 'Workout',
      localDate: '2026-09-18',
      lifecycle: 'planned',
      revision: 2,
      createdAtMs: 1,
      updatedAtMs: 2,
      structure: serialized,
      displaySteps: [],
    },
  });
  expect(read.workout.structure).toEqual(input);

  const write = TRAINING_CHANGE_SCHEMA.parse({
    kind: 'create-workout',
    localKey: 'workout',
    plan: null,
    localDate: '2026-09-18',
    title: 'Workout',
    structure: serialized,
  });
  expect(write).toMatchObject({ structure: input });
}

describe('Strict public Training recipe v1', () => {
  it.each([ActivityTypes.Walking, ActivityTypes.Hiking, ActivityTypes.Rowing, ActivityTypes.IndoorRowing])('round-trips %s through the frozen read and approval-gated proposal schema', sport => {
    expectPublicReadWriteRoundTrip({ ...recipe({ kind: 'distance', meters: 500 }), sport });
  });
  it('keeps every explicit shared recipe catalog exhaustive', () => {
    expect(MCP_WORKOUT_RECIPE_VARIANT_COVERAGE.version).toBe(1);
    expect(Object.keys(MCP_WORKOUT_RECIPE_VARIANT_COVERAGE.stepPurposes)).toEqual([...WORKOUT_STEP_PURPOSES]);
    expect(Object.keys(endingFixtures)).toEqual([...WORKOUT_ENDING_KINDS]);
    expect(Object.keys(MCP_WORKOUT_RECIPE_VARIANT_COVERAGE.targetModes)).toEqual(['absolute', 'relative']);
    expect([...new Set(Object.values(targetVariantFixtures).map(target => target.kind))]).toEqual([...WORKOUT_TARGET_KINDS]);
    expect(MCP_WORKOUT_RECIPE_VARIANT_COVERAGE.additiveStructureFields).toEqual({ poolLength: true });
  });

  it.each(Object.entries(endingFixtures))('round-trips shared ending %s through public reads and writes', (_kind, ending) => {
    expectPublicReadWriteRoundTrip(recipe(ending));
  });

  it.each(Object.entries(targetVariantFixtures))('round-trips shared target variant %s through public reads and writes', (_variant, target) => {
    const input = recipe({ kind:'manual' }, [target]);
    expectPublicReadWriteRoundTrip(input);
    expect(TRAINING_RECIPE_SCHEMA.safeParse(recipe({kind:'manual'},[{...target,remoteId:'PRIVATE'}])).success).toBe(false);
  });

  it.each(Object.entries(targetReferenceFixtures))('round-trips shared relative reference %s', (_reference, target) => {
    expectPublicReadWriteRoundTrip(recipe({ kind: 'manual' }, [target]));
  });

  it.each(Object.entries(speedPresentationFixtures))('round-trips speed presentation %s', (_presentation, target) => {
    expectPublicReadWriteRoundTrip(recipe({ kind: 'manual' }, [target]));
  });

  it.each(WORKOUT_STEP_PURPOSES)('round-trips step purpose %s', purpose => {
    const input = recipe({ kind: 'manual' });
    input.nodes[0].purpose = purpose;
    expectPublicReadWriteRoundTrip(input);
  });

  it('round-trips both shared node discriminants', () => {
    expect(Object.keys(MCP_WORKOUT_RECIPE_VARIANT_COVERAGE.nodes)).toEqual(['step', 'repeat']);
    const input: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Running, nodes: [{
      kind: 'repeat', id: 'repeat-1', count: 4,
      steps: [{ kind: 'step', id: 'repeat-work', purpose: 'work', ending: { kind: 'time', seconds: 60 }, targets: [] }],
    }] };
    expectPublicReadWriteRoundTrip(input);
  });

  it('rejects malformed versions, discriminants, repeats, IDs, ranges and leaked neighbors', () => {
    const input = recipe({kind:'time',seconds:60}), step = input.nodes[0];
    for (const bad of [ {...input,version:2}, {...input,sport:'unknown'}, {...input,provider:'PRIVATE'},
      {...input,nodes:[step,step]}, {...input,nodes:[{...step,id:'a/b'}]},
      recipe({kind:'time',seconds:Infinity}), recipe({kind:'time',seconds:-1}), recipe({kind:'other'}),
      recipe({kind:'manual'},[{kind:'power',mode:'absolute',minimumWatts:200,maximumWatts:100}]),
      {...input,nodes:[{...step,note:'x'.repeat(501)}]},
      {...input,nodes:[{kind:'repeat',id:'repeat',count:101,steps:[step]}]},
      {...input,nodes:[{kind:'repeat',id:'repeat',count:2,steps:[{kind:'repeat',id:'nested',count:2,steps:[step]}]}]},
      {...input,nodes:Array.from({length:101},(_,i)=>({...step,id:`s${i}`}))},
    ]) expect(TRAINING_RECIPE_SCHEMA.safeParse(bad).success).toBe(false);
  });
});

describe('Strict Training write proposal contract', () => {
  it('round-trips metre and yard pool lengths only through the additive v2 contract', () => {
    for (const poolLength of [{ meters: 25, presentation: 'meters' as const },
      { meters: 22.86, presentation: 'yards' as const }]) {
      const structure: WorkoutStructureV1 = { ...recipe({ kind: 'distance', meters: 100 }),
        sport: ActivityTypes.Swimming, poolLength };
      const serialized = JSON.parse(JSON.stringify(structure));
      expect(TRAINING_RECIPE_WITH_POOL_SCHEMA.parse(serialized)).toEqual(structure);
      expect(TRAINING_READ_OUTPUTS.get_planned_workout_v2.parse({ scheduleRevision: 1,
        workout: { workoutRef: 'opaque', planRef: null, title: 'Pool swim', localDate: '2026-09-30',
          lifecycle: 'planned', revision: 1, createdAtMs: 1, updatedAtMs: 1,
          structure: serialized, displaySteps: [] } }).workout.structure).toEqual(structure);
      expect(TRAINING_WRITE_INPUTS.preview_planned_workout_v2_change.safeParse({ expectedScheduleRevision: 1,
        change: { kind: 'create-workout', localKey: 'swim', plan: null, localDate: '2026-09-30',
          title: 'Pool swim', structure: serialized } }).success).toBe(true);
      expect(TRAINING_RECIPE_SCHEMA.safeParse(serialized).success).toBe(false);
    }
  });

  it('rejects non-pool, malformed and private pool-length fields', () => {
    const structure = { ...recipe({ kind: 'distance', meters: 100 }), sport: ActivityTypes.Swimming,
      poolLength: { meters: 25, presentation: 'meters' } };
    for (const bad of [
      { ...structure, sport: ActivityTypes.OpenWaterSwimming },
      { ...structure, sport: ActivityTypes.Running },
      { ...structure, poolLength: { meters: 0, presentation: 'meters' } },
      { ...structure, poolLength: { meters: Infinity, presentation: 'meters' } },
      { ...structure, poolLength: { meters: 1001, presentation: 'meters' } },
      { ...structure, poolLength: { meters: 25, presentation: 'feet' } },
      { ...structure, poolLength: { meters: 25, presentation: 'meters', remoteId: 'PRIVATE' } },
      { ...structure, remoteId: 'PRIVATE' },
    ]) expect(TRAINING_RECIPE_WITH_POOL_SCHEMA.safeParse(bad).success).toBe(false);
    const legacy = { ...recipe({ kind: 'distance', meters: 100 }), sport: ActivityTypes.Swimming };
    expect(TRAINING_RECIPE_WITH_POOL_SCHEMA.parse(legacy)).toEqual(legacy);
  });
  it('offers a focused single-workout input without operation or local-key fields', () => {
    const input = {
      expectedScheduleRevision: 1,
      localDate: '2026-09-18',
      title: 'Easy run',
      structure: recipe({ kind: 'time', seconds: 1800 }),
    };
    expect(TRAINING_WRITE_INPUTS.preview_create_planned_workout.parse(input)).toMatchObject({
      ...input,
      planRef: null,
    });
    expect(TRAINING_WRITE_INPUTS.preview_create_planned_workout.safeParse({
      ...input,
      kind: 'create-workout',
      localKey: 'client-owned-key',
    }).success).toBe(false);
  });

  it('adds optional focused delivery without client-owned linking fields', () => {
    const input = {
      expectedScheduleRevision: 1,
      localDate: '2026-09-18',
      title: 'Easy run',
      structure: recipe({ kind: 'time', seconds: 1800 }),
      delivery: { providers: ['garmin'], timeZone: 'Europe/Helsinki' },
    };
    expect(TRAINING_WRITE_INPUTS.preview_create_planned_workout.parse(input)).toMatchObject({
      ...input,
      planRef: null,
    });
    expect(TRAINING_WRITE_INPUTS.preview_create_planned_workout.safeParse({
      ...input,
      kind: 'create-workout',
      localKey: 'client-owned-key',
      target: { localKey: 'client-owned-key' },
    }).success).toBe(false);
    expect(TRAINING_WRITE_INPUTS.preview_create_planned_workout.safeParse({
      ...input,
      delivery: { providers: ['garmin'], timeZone: '' },
    }).success).toBe(false);
  });

  it('accepts only the bounded safe lifecycle and explicit provider actions', () => {
    expect(TRAINING_CHANGE_SCHEMA.safeParse({ kind: 'create-workout', localKey: 'run', plan: null,
      localDate: '2026-09-18', title: 'Easy run', structure: recipe({ kind: 'time', seconds: 1800 }) }).success).toBe(true);
    expect(TRAINING_CHANGE_SCHEMA.safeParse({ kind: 'provider-delivery', targetType: 'workout',
      target: { localKey: 'run' }, providers: 'all_connected', action: 'send', timeZone: 'Europe/Helsinki' }).success).toBe(true);
    expect(TRAINING_CHANGE_SCHEMA.safeParse({ kind: 'provider-delivery', targetType: 'workout',
      target: { ref: 'opaque' }, providers: ['wahoo'], action: 'send', timeZone: 'Europe/Helsinki' }).success).toBe(true);
    expect(TRAINING_CHANGE_SCHEMA.safeParse({ kind: 'delete-plan', plan: { ref: 'opaque' },
      workoutDisposition: 'convert-to-standalone' }).success).toBe(true);
    for (const forbidden of [
      { kind: 'permanently-delete-workout', workout: { ref: 'opaque' } },
      { kind: 'delete-plan', plan: { ref: 'opaque' } },
      { kind: 'restore-training-revision', revision: 1 },
      { kind: 'provider-delivery', targetType: 'workout', target: { ref: 'opaque' }, providers: ['garmin'], action: 'send', remoteId: 'PRIVATE' },
    ]) expect(TRAINING_CHANGE_SCHEMA.safeParse(forbidden).success).toBe(false);
  });

  it('caps one ordered proposal at 25 changes', () => {
    const change = { kind: 'set-workout-lifecycle', workout: { ref: 'opaque' }, lifecycle: 'skipped' };
    expect(TRAINING_WRITE_INPUTS.preview_training_changes.safeParse({ expectedScheduleRevision: 1,
      changes: Array.from({ length: 25 }, () => change) }).success).toBe(true);
    expect(TRAINING_WRITE_INPUTS.preview_training_changes.safeParse({ expectedScheduleRevision: 1,
      changes: Array.from({ length: 26 }, () => change) }).success).toBe(false);
  });

  it('requires a complete strength draft in the additive preview and keeps v1 recipes frozen', () => {
    const draft = { version: 1, exercises: [{ id: 'squat', name: 'Squat', sets: [{ id: 'set-one',
      ending: { kind: 'repetitions', repetitions: 5 }, externalLoadKg: 80, restAfterSeconds: 120 }] }] };
    const input = { expectedScheduleRevision: 1, change: { kind: 'create-workout', localKey: 'lift', plan: null,
      localDate: '2026-09-30', title: 'Strength', strength: draft } };
    expect(TRAINING_WRITE_INPUTS.preview_strength_workout_change.safeParse(input).success).toBe(true);
    expect(TRAINING_WRITE_INPUTS.preview_strength_workout_change.safeParse({ ...input,
      change: { ...input.change, structure: recipe({ kind: 'manual' }) } }).success).toBe(false);
    expect(TRAINING_WRITE_INPUTS.preview_strength_workout_change.safeParse({ ...input,
      change: { ...input.change, strength: { ...draft, exercises: [{ ...draft.exercises[0], sets: [
        draft.exercises[0].sets[0], draft.exercises[0].sets[0] ] }] } } }).success).toBe(false);
    expect(TRAINING_WRITE_INPUTS.preview_training_changes.safeParse({ expectedScheduleRevision: 1,
      changes: [{ ...input.change, structure: recipe({ kind: 'manual' }) }] }).success).toBe(false);
  });
});
