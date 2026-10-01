import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { MANUAL_WORKOUT_EDITOR_SPORTS_V1, parseWorkoutStructureV1 } from '../../../../../shared/planned-workout';
import { WAHOO_PLANNED_WORKOUT_SPORTS_V1, wahooWorkoutSportProfileV1 } from '../../../../../shared/wahoo-workout-sports';
import { WAHOO_SPORT_FIXTURES } from '../test-support/wahoo-sport-fixtures';
import { serializeWahooPlanJsonV1 } from '../../providers/wahoo-plan.serializer';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import { hasWahooTrainingScopes } from '../../../../../shared/wahoo-training';
import { WAHOO_API_SCOPES } from '../../../wahoo/constants';
import { projectStrengthWorkoutToV1 } from '../../../../../shared/strength-workout';
import { wahooFixtureStrengthDetails } from '../test-support/wahoo-http-fixture';
import { assessWahooDelivery, wahooDurationSeconds, wahooIdentities, wahooPlanBody, wahooStarts, wahooWorkoutBody, wahooWorkoutDate } from './mapping';

export function wahooFixtureWorkout(): ScheduledWorkoutV1 {
  return { schemaVersion: 1, id: 'workout', planId: 'plan', title: 'Intervals', localDate: '2026-10-25', lifecycle: 'planned',
    revision: 1, createdAtMs: 1_700_000_000_000, updatedAtMs: 1_700_000_000_000,
    structure: { version: 1, sport: ActivityTypes.Running, nodes: [
      { kind: 'step', id: 'run', purpose: 'work', ending: { kind: 'time', seconds: 90 }, targets: [] },
      { kind: 'repeat', id: 'repeat', count: 3, steps: [
        { kind: 'step', id: 'interval', purpose: 'work', ending: { kind: 'time', seconds: 31 }, targets: [] },
      ] },
    ] } };
}
describe('Wahoo delivery mapping (no editor changes)', () => {
  it.each([[ActivityTypes.Walking, 6], [ActivityTypes.Hiking, 9]] as const)('keeps %s Plan family and exact Workout type aligned, including repeats', (sport, type) => {
    const workout = { ...wahooFixtureWorkout(), structure: { ...wahooFixtureWorkout().structure, sport } };
    expect(assessWahooDelivery(workout, 'destination', 'UTC').level).toBe('exact');
    const encoded = new URLSearchParams(wahooPlanBody(workout, 'destination', true)).get('plan[file]')!;
    const recipe = JSON.parse(Buffer.from(encoded.split(',')[1], 'base64').toString());
    expect(recipe.header).toMatchObject({ workout_type_family: 9, workout_type_location: 1, duration_s: 183 });
    expect(recipe.intervals[1]).toMatchObject({ exit_trigger_type: 'repeat', exit_trigger_value: 2 });
    const fields = new URLSearchParams(wahooWorkoutBody(workout, 'destination', 'UTC', '123'));
    expect(fields.get('workout[workout_type_id]')).toBe(String(type));
    expect(fields.get('workout[minutes]')).toBe('3.05');
    expect(workout.structure.sport).toBe(sport);
    const changed = structuredClone(workout);
    changed.structure.nodes = [{ kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 300 },
      targets: [{ kind: 'speed', mode: 'absolute', presentation: 'pace', minimumMetersPerSecond: 1, maximumMetersPerSecond: 2 }] }];
    expect(assessWahooDelivery(changed, 'destination', 'UTC').level).toBe('unsupported');
    expect(() => wahooPlanBody(changed, 'destination', true)).toThrow();
  });
  it.each([ActivityTypes.Cycling, ActivityTypes.Running])('preserves the %s v4 mapping and existing content', sport => {
    const workout = { ...wahooFixtureWorkout(), structure: { ...wahooFixtureWorkout().structure, sport } };
    expect(assessWahooDelivery(workout, 'destination', 'UTC').mappingVersion).toBe('wahoo-plans-v4');
    const encoded = new URLSearchParams(wahooPlanBody(workout, 'destination', true)).get('plan[file]')!;
    expect(JSON.parse(Buffer.from(encoded.split(',')[1], 'base64').toString()).header.workout_type_family)
      .toBe(sport === ActivityTypes.Cycling ? 0 : 1);
  });
  it('covers every editor sport and only the explicit additional running/cycling profiles', () => {
    expect(new Set(WAHOO_PLANNED_WORKOUT_SPORTS_V1)).toEqual(new Set([
      ...WAHOO_SPORT_FIXTURES.map(row => row.sport), ActivityTypes.StrengthTraining,
    ]));
    for (const sport of MANUAL_WORKOUT_EDITOR_SPORTS_V1) expect(WAHOO_PLANNED_WORKOUT_SPORTS_V1).toContain(sport);
  });
  it.each([ActivityTypes.Walking, ActivityTypes.Hiking, ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming,
    ActivityTypes.Rowing, ActivityTypes.IndoorRowing])('keeps %s prescription limits separate from profile-validation state', sport => {
    expect(wahooWorkoutSportProfileV1(sport)?.untargetedTimeOnly).toBe(true);
    const workout = { ...wahooFixtureWorkout(), structure: { ...wahooFixtureWorkout().structure, sport } };
    expect(assessWahooDelivery(workout, 'destination', 'UTC')).toMatchObject({ level: 'exact', issues: [] });
  });
  it.each([
    [ActivityTypes.Running, 'a8c6ec5468a0e0aceabb538a572ce312bc8d9efc633679abc514a9692012c5ce', '86c832a2c9e2e1afd366f25fe673746c3875968f09eadf760daa825f5e033581'],
    [ActivityTypes.Cycling, 'a41c3104bc690562f5f9da41ac6576dcf3a478b7b486a9085357d93f87e80747', '567a43c918577de7230e7a763ba0139f7c5f7308aa4f567fdf9bbe4f209606b3'],
    [ActivityTypes.Swimming, '057f5cf00c720474f1f31e141c933ff2a0e7e377a079e72e9097862e3878ec86', '8862ea58c939c6f88c3e777067d0938861c57cf6cb7a7583f9c1957fe69b7214'],
    [ActivityTypes.OpenWaterSwimming, 'ee56e4be94f095ae4769b8cfd5ac837e38e4bececbb331f9b033952535e1e092', 'ecdcabd3c5ddd6e43390b0f851f7ca886efed4c118942297b78006299d0a8bde'],
    [ActivityTypes.Rowing, '8603c7fab849139382cc6e4970668429b86440fa837f4a3717eb9311adc8d46c', 'db765d06e062e7c4fffaa25a14751dbba259be3024012cfefbfb1b9997d7e229'],
    [ActivityTypes.IndoorRowing, '4c185661176a0c59ecc8ee69a9326a61d524d6abe713da92ea893bfdaa82a439', 'bc91be6f001ab1cd8a20c19c3fb988d46ba34b9fee82c16a3778062a8129dfc8'],
  ] as const)('preserves the pre-proof %s v4 payload and digest when only the warning changes', (sport, digest, payloadHash) => {
    const workout = wahooFixtureWorkout(); workout.structure.sport = sport;
    expect(assessWahooDelivery(workout, 'destination', 'UTC')).toMatchObject({ mappingVersion: 'wahoo-plans-v4', digest });
    expect(createHash('sha256').update(wahooPlanBody(workout, 'destination', true)
      + '\n' + wahooWorkoutBody(workout, 'destination', 'UTC', '123')).digest('hex')).toBe(payloadHash);
  });
  it.each(WAHOO_SPORT_FIXTURES)('maps $sport to its expected family/type/location without rewriting canonical sport', ({ sport, family, type, location, level }) => {
    const workout = { ...wahooFixtureWorkout(), structure: { ...wahooFixtureWorkout().structure, sport } };
    const before = structuredClone(workout);
    expect(parseWorkoutStructureV1(JSON.parse(JSON.stringify(workout.structure)))).toEqual(workout.structure);
    expect(assessWahooDelivery(workout, 'destination', 'UTC').level).toBe(level);
    const encoded = new URLSearchParams(wahooPlanBody(workout, 'destination', true)).get('plan[file]')!;
    const recipe = JSON.parse(Buffer.from(encoded.split(',')[1], 'base64').toString());
    expect(recipe.header).toMatchObject({ workout_type_family: family, workout_type_location: location });
    expect(recipe.intervals[1]).toMatchObject({ exit_trigger_type: 'repeat', exit_trigger_value: 2 });
    const fields = new URLSearchParams(wahooWorkoutBody(workout, 'destination', 'UTC', '123'));
    expect(fields.get('workout[workout_type_id]')).toBe(String(type));
    expect(fields.get('workout[minutes]')).toBe('3.05');
    expect(workout).toEqual(before);
    if (level === 'degraded') {
      expect(assessWahooDelivery(workout, 'destination', 'UTC').requiresApproval).not.toBe(false);
      expect(() => serializeWahooPlanJsonV1(workout.structure, { name: workout.title,
        location: location === 0 ? 'indoor' : 'outdoor', allowDegraded: false })).toThrow();
    }
  });
  it.each([ActivityTypes.Yoga, ActivityTypes.Other])('never admits arbitrary recorded activity %s or defaults it to running', sport => {
    const workout = { ...wahooFixtureWorkout(), structure: { ...wahooFixtureWorkout().structure, sport } };
    expect(assessWahooDelivery(workout, 'destination', 'UTC').level).toBe('unsupported');
    expect(() => wahooWorkoutBody(workout, 'destination', 'UTC', '123')).toThrow();
  });
  it.each(WAHOO_SPORT_FIXTURES.filter(row => row.family === 0 || row.family === 1))('preserves the authored absolute HR target for $sport', ({ sport }) => {
    const workout = wahooFixtureWorkout(); workout.structure.sport = sport;
    const step = workout.structure.nodes[0]; if (step.kind !== 'step') throw new Error('Expected step');
    step.targets = [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 100, maximumBpm: 130 }];
    const encoded = new URLSearchParams(wahooPlanBody(workout, 'destination', true)).get('plan[file]')!;
    const recipe = JSON.parse(Buffer.from(encoded.split(',')[1], 'base64').toString());
    expect(recipe.intervals[0].targets).toEqual([{ type: 'hr', low: 100, high: 130 }]);
  });
  it('preserves selected pool length in QS and still requires review because Wahoo cannot receive it', () => {
    const workout = wahooFixtureWorkout(); workout.structure.sport = ActivityTypes.Swimming;
    workout.structure.poolLength = { meters: 25, presentation: 'meters' };
    expect(assessWahooDelivery(workout, 'destination', 'UTC').level).toBe('degraded');
    expect(assessWahooDelivery(workout, 'destination', 'UTC').requiresApproval).not.toBe(false);
    expect(() => serializeWahooPlanJsonV1(workout.structure, { name: workout.title, location: 'indoor', allowDegraded: false }))
      .toThrow(expect.objectContaining({ code: 'degradation-confirmation-required' }));
    expect(assessWahooDelivery(workout, 'destination', 'UTC').issues).toEqual([
      'Wahoo does not receive the selected pool length; set it on the device where needed.',
    ]);
    const encoded = new URLSearchParams(wahooPlanBody(workout, 'destination', true)).get('plan[file]')!;
    expect(Buffer.from(encoded.split(',')[1], 'base64').toString()).not.toMatch(/poolLength|pool_length/);
    expect(workout.structure.poolLength).toEqual({ meters: 25, presentation: 'meters' });
  });
  it.each([ActivityTypes.Walking, ActivityTypes.Hiking, ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming, ActivityTypes.Rowing, ActivityTypes.IndoorRowing])('blocks an intensity target hidden inside a %s repeat even with mapping approval', sport => {
    const workout = { ...wahooFixtureWorkout(), structure: { ...wahooFixtureWorkout().structure, sport } };
    const repeat = workout.structure.nodes[1];
    if (repeat.kind !== 'repeat') throw new Error('Expected fixture repeat');
    repeat.steps[0].targets = [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 100, maximumBpm: 130 }];
    expect(assessWahooDelivery(workout, 'destination', 'UTC').level).toBe('unsupported');
    expect(() => wahooPlanBody(workout, 'destination', true)).toThrow();
  });
  it('rejects a timed total that overflows rather than writing null header duration', () => {
    const workout = wahooFixtureWorkout(); workout.structure.sport = ActivityTypes.Walking;
    workout.structure.nodes = [{ kind: 'repeat', id: 'repeat', count: 100, steps: [
      { kind: 'step', id: 'overflow', purpose: 'work', ending: { kind: 'time', seconds: Number.MAX_VALUE }, targets: [] },
    ] }];
    expect(wahooDurationSeconds(workout.structure)).toBeNull();
    expect(assessWahooDelivery(workout, 'destination', 'UTC').level).toBe('unsupported');
    expect(() => wahooPlanBody(workout, 'destination', true)).toThrow();
  });
  it('requires the complete owned companion and includes load-only changes in the digest without changing provider identities', () => {
    const details = wahooFixtureStrengthDetails('workout');
    const workout = { ...wahooFixtureWorkout(), structure: projectStrengthWorkoutToV1(details) };
    const result = assessWahooDelivery(workout, 'destination', 'UTC', details);
    expect(result).toMatchObject({ level: 'degraded', requiresApproval: false });
    const body = new URLSearchParams(wahooWorkoutBody(workout, 'destination', 'UTC', '123'));
    expect(body.get('workout[workout_type_id]')).toBe('42');
    expect(body.get('workout[minutes]')).toBe('5');
    const changed = structuredClone(details);
    changed.exercises[0].sets[0].externalLoadKg = 2.5;
    expect(projectStrengthWorkoutToV1(changed)).toEqual(workout.structure);
    expect(assessWahooDelivery(workout, 'destination', 'UTC', changed).digest).not.toBe(result.digest);
    for (const invalid of [undefined, null, { ...details, workoutId: 'foreign' },
      { ...details, exercises: [{ ...details.exercises[0], name: 'Changed' }] },
      { ...details, exercises: [{ ...details.exercises[0], sets: [{ ...details.exercises[0].sets[0], externalLoadKg: NaN }] }] }]) {
      expect(assessWahooDelivery(workout, 'destination', 'UTC', invalid).level).toBe('unsupported');
      expect(() => wahooPlanBody(workout, 'destination', true, invalid)).toThrow();
    }
    const encoded = new URLSearchParams(wahooPlanBody(workout, 'destination', true, changed)).get('plan[file]')!;
    expect(JSON.parse(Buffer.from(encoded.split(',')[1], 'base64').toString()).header)
      .toMatchObject({ workout_type_family: 6, workout_type_location: 0 });
  });
  it('derives exact fractional minutes and encodes the existing recipe', () => {
    const workout = wahooFixtureWorkout();
    expect(wahooDurationSeconds(workout.structure)).toBe(183);
    const body = new URLSearchParams(wahooWorkoutBody(workout, 'destination', 'Europe/Helsinki', '123'));
    expect(body.get('workout[minutes]')).toBe('3.05');
    expect(body.get('workout[plan_id]')).toBe('123');
    expect(body.get('workout[workout_type_id]')).toBe('1');
    expect(body.has('workout[day_code]')).toBe(false);
    const encoded = new URLSearchParams(wahooPlanBody(workout, 'destination', true)).get('plan[file]')!;
    const plan = JSON.parse(Buffer.from(encoded.split(',')[1], 'base64').toString());
    expect(plan.header).toMatchObject({ name: workout.title, description: workout.title });
    expect(plan.intervals[0].targets).toEqual([{ type: 'rpe', low: 1, high: 10 }]);
    expect(plan.intervals[1].intervals[0].targets).toEqual([{ type: 'rpe', low: 1, high: 10 }]);
    expect(plan.intervals[1]).toMatchObject({ exit_trigger_type: 'repeat', exit_trigger_value: 2 });
  });
  it.each(['distance', 'kilojoules'] as const)('does not estimate duration from %s endings', ending => {
    const workout = wahooFixtureWorkout();
    workout.structure.nodes[0] = { kind: 'step', id: 'run', purpose: 'work', targets: [],
      ending: ending === 'distance' ? { kind: ending, meters: 1000 } : { kind: ending, kilojoules: 50 } };
    expect(wahooDurationSeconds(workout.structure)).toBeNull();
    expect(assessWahooDelivery(workout, 'destination', 'UTC')).toMatchObject({ level: 'unsupported' });
    expect(() => wahooWorkoutBody(workout, 'destination', 'UTC', '1')).toThrow();
    // Fixture-format capability is intentionally independent from live delivery.
    expect(wahooPlanBody(workout, 'destination', true)).toBeTruthy();
  });
  it.each([
    ['2026-10-25', 'Europe/Helsinki', '2026-10-25T10:00:00.000Z'],
    ['2026-03-29', 'Europe/Helsinki', '2026-03-29T09:00:00.000Z'],
    ['2026-12-31', 'Pacific/Kiritimati', '2026-12-30T22:00:00.000Z'],
    ['2027-01-01', 'Pacific/Pago_Pago', '2027-01-01T23:00:00.000Z'],
    ['2026-10-04', 'Australia/Lord_Howe', '2026-10-04T01:00:00.000Z'],
  ])('retains local calendar date %s in %s', (date, zone, expected) => {
    expect(wahooStarts(date, zone)).toBe(expected);
    expect(wahooWorkoutDate(expected, zone)).toBe(date);
  });
  it('isolates accounts and copied workouts while surviving edits and rescheduling', () => {
    const identity = wahooIdentities('a', 'workout');
    expect(wahooIdentities('a', 'workout')).toEqual(identity);
    expect(wahooIdentities('b', 'workout')).not.toEqual(identity);
    expect(wahooIdentities('a', 'copy')).not.toEqual(identity);
    expect(identity.externalId.length).toBeLessThan(64);
    expect(identity.workoutToken.length).toBeLessThan(64);
  });
  it('retains old OAuth scopes and requires explicit new grants', () => {
    expect(hasWahooTrainingScopes(WAHOO_API_SCOPES)).toBe(true);
    for (const scope of ['routes_read', 'routes_write', 'offline_data']) expect(WAHOO_API_SCOPES.split(' ')).toContain(scope);
    for (const scope of [undefined, '', 'user_read workouts_read workouts_write routes_read routes_write offline_data', ['plans_read']]) {
      expect(hasWahooTrainingScopes(scope)).toBe(false);
    }
  });
});
