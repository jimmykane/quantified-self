import { describe, expect, it } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { DAY_WORKOUT_SIGNAL_OPTIONS, defaultDayWorkoutControls, parseGenerateDayWorkoutRequest } from '../../../shared/day-workout';
import { analyzeWorkoutStructureV1 } from '../../../shared/planned-workout-analysis';
import { validateDayWorkoutSuggestion } from './day-workout-validation';

// A real legacy shape guards byte-for-byte replay compatibility after new defaults change.
const controls = { localDate: '2026-10-28', timeZone: 'Europe/Helsinki', sport: ActivityTypes.Running, minutes: 30,
  purpose: 'suggest' as const, timing: 'approximate' as const, target: 'auto' as const, structure: 'auto' as const, destinationPlanId: null,
  equipment: ['bodyweight' as const], strengthFocus: 'full-body' as const, usePreviousWeights: true, trainingContext: true, timelineContext: true,
  ...Object.fromEntries(DAY_WORKOUT_SIGNAL_OPTIONS.map(({ key }) => [key, true])) };
const automatic = defaultDayWorkoutControls('2026-10-28', 'Europe/Helsinki');
const step = (seconds = 600) => ({ kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds }, targets: [] });
const endurance = () => ({ kind: 'workout', title: 'Easy session', rationale: 'Keep the effort comfortable.',
  structure: { version: 1, sport: ActivityTypes.Running, nodes: [step()] } });
const strength = () => ({ version: 1 as const, exercises: [{ id: 'squat', name: 'Dumbbell squat',
  sets: [{ id: 'one', ending: { kind: 'repetitions' as const, repetitions: 8 }, restAfterSeconds: 60, externalLoadKg: 999 }] }] });

describe('day workout contract and prescription validation', () => {
  it('defaults every signal on, preserves explicit opt-outs and old request fingerprints, and rejects malformed choices', () => {
    const now = new Date('2026-10-28T12:00Z');
    const legacy = { ...controls };
    for (const { key } of DAY_WORKOUT_SIGNAL_OPTIONS) {
      expect(controls[key]).toBe(true);
      expect(parseGenerateDayWorkoutRequest({ requestId: 'request-123', controls: { ...controls, [key]: false } }, now).controls[key]).toBe(false);
      for (const value of [undefined, null, 'false', 0]) {
        expect(() => parseGenerateDayWorkoutRequest({ requestId: 'request-123', controls: { ...controls, [key]: value } }, now)).toThrow(/personalization/);
      }
      delete legacy[key];
    }
    const parsed = parseGenerateDayWorkoutRequest({ requestId: 'request-123', controls: legacy }, now);
    expect(JSON.stringify(parsed.controls)).toBe(JSON.stringify(legacy));
  });
  it('requires explicit independent consent, supported controls and today/future dates in the selected zone', () => {
    const now = new Date('2026-10-27T23:00:00Z');
    expect(parseGenerateDayWorkoutRequest({ requestId: 'request-123', controls }, now).controls).toMatchObject({ trainingContext: true, timelineContext: true });
    for (const changed of [{ localDate: '2026-10-27' }, { localDate: '2027-10-29' }, { trainingContext: undefined },
      { minutes: 0 }, { sport: 'Sky Diving' }, { equipment: ['bodyweight', 'bodyweight'] }, { uid: 'foreign' }]) {
      expect(() => parseGenerateDayWorkoutRequest({ requestId: 'request-123', controls: { ...controls, ...changed } }, now)).toThrow();
    }
  });
  it('accepts the app’s prefixed request IDs while rejecting paths and unbounded identifiers', () => {
    const now = new Date('2026-10-28T12:00:00Z');
    for (const requestId of ['day-workout:71f1e982-b718-4c5b-a3c7-c45eebdefc84', 'day-workout:mh9z41kd-6ws9updb']) {
      expect(parseGenerateDayWorkoutRequest({ requestId, controls }, now).requestId).toBe(requestId);
    }
    for (const requestId of ['day-workout/foreign', 'day-workout:../foreign', 'short', 'a'.repeat(101)]) {
      expect(() => parseGenerateDayWorkoutRequest({ requestId, controls }, now)).toThrow('Invalid request identifier');
    }
  });
  it.each([{ timing: ['strict'] }, { structure: ['simple'] }, { strengthFocus: ['core'] }])('rejects coerced enum controls %j', patch => {
    expect(() => parseGenerateDayWorkoutRequest({ requestId: 'request-123', controls: { ...controls, ...patch } }, new Date('2026-10-28T12:00Z'))).toThrow('Choose supported workout options');
  });
  it('counts every repeated recovery and warmup against strict time', () => {
    const value = endurance();
    value.structure.nodes = [{ kind: 'repeat', id: 'repeats', count: 4, steps: [step()] }] as never;
    expect(() => validateDayWorkoutSuggestion(value, { ...controls, timing: 'strict' })).toThrow(/budget/);
    expect(validateDayWorkoutSuggestion(value, { ...controls, minutes: 40, timing: 'strict' }).draft).not.toBeNull();
    value.structure.nodes = [{ ...step(), ending: { kind: 'distance', meters: 1000 } }] as never;
    expect(() => validateDayWorkoutSuggestion(value, { ...controls, timing: 'strict' })).toThrow(/timed/);
  });
  it('rejects strength-only fields on endurance suggestions, including null placeholders', () => {
    for (const fields of [{ strength: null }, { estimatedMinutes: null }, { estimatedMinutes: { minimum: 25, maximum: 30 } }]) {
      expect(() => validateDayWorkoutSuggestion({ ...endurance(), ...fields }, controls)).toThrow('Strength fields require a strength sport.');
    }
  });
  it('rejects invented athlete references and preserves rest as no draft', () => {
    const value = endurance();
    value.structure.nodes[0].targets = [{ kind: 'heart-rate', mode: 'relative', minimumPercent: 60,
      maximumPercent: 70, reference: { kind: 'max-heart-rate', bpm: 190 } }] as never;
    expect(() => validateDayWorkoutSuggestion(value, controls)).toThrow(/reference/);
    expect(validateDayWorkoutSuggestion({ kind: 'rest', rationale: 'Consider rest today.' }, controls).draft).toBeNull();
    expect(() => validateDayWorkoutSuggestion({ kind: 'rest', rationale: 'Rest.', title: 'Rest workout' }, controls)).toThrow();
  });
  it('retains repetitions and unknown canonical duration; strips invented loads without permission', () => {
    const result = validateDayWorkoutSuggestion({ kind: 'workout', title: 'Strength', rationale: 'General strength.',
      strength: strength(), estimatedMinutes: { minimum: 25, maximum: 35 } },
    { ...controls, sport: ActivityTypes.StrengthTraining, target: 'none' });
    expect(result.draft?.strength?.exercises[0].sets[0].externalLoadKg).toBeUndefined();
    expect(result.draft?.estimatedMinutes).toEqual({ minimum: 25, maximum: 35 });
    expect(analyzeWorkoutStructureV1(result.draft!.structure).summary.duration.completeExactSeconds).toBeNull();
  });
  it.each([0, 12.5])('reuses exact planned load %s only for matching names and prescriptions', load => {
    const previous = strength(); previous.exercises[0].sets[0].externalLoadKg = load;
    const options = { ...controls, sport: ActivityTypes.StrengthTraining, target: 'none' as const, trainingContext: true, equipment: ['dumbbells' as const] };
    const value = { kind: 'workout', title: 'Strength', rationale: 'General strength.', strength: strength() };
    const history = [{ localDate: '2026-10-25', strength: previous }];
    const result = validateDayWorkoutSuggestion(value, options, history);
    expect(result.draft?.strength?.exercises[0].sets[0].externalLoadKg).toBe(load);
    expect(result.previousLoads).toEqual([{ exerciseId: 'squat', localDate: '2026-10-25' }]);
    previous.exercises[0].name = 'Barbell squat';
    expect(validateDayWorkoutSuggestion(value, options, history).previousLoads).toEqual([]);
    previous.exercises[0].name = 'Dumbbell squat';
    expect(validateDayWorkoutSuggestion(value, options, [...history, ...history]).previousLoads).toEqual([]);
    previous.exercises[0].sets[0].ending.repetitions = 10;
    expect(validateDayWorkoutSuggestion(value, options, history).previousLoads).toEqual([]);
  });
  it('does not add a previous positive weight to a bodyweight-only request, while preserving explicit zero', () => {
    const options = { ...controls, sport: ActivityTypes.StrengthTraining, target: 'none' as const, trainingContext: true };
    const previous = strength(); previous.exercises[0].name = 'Squat'; previous.exercises[0].sets[0].externalLoadKg = 12.5;
    const suggested = strength(); suggested.exercises[0].name = 'Squat';
    const value = { kind: 'workout', title: 'Bodyweight', rationale: 'No equipment required.', strength: suggested };
    const history = [{ localDate: '2026-10-25', strength: previous }];
    const result = validateDayWorkoutSuggestion(value, options, history);
    expect(result.draft?.strength?.exercises[0].sets[0].externalLoadKg).toBeUndefined();
    expect(result.previousLoads).toEqual([]);
    previous.exercises[0].sets[0].externalLoadKg = 0;
    expect(validateDayWorkoutSuggestion(value, options, history).draft?.strength?.exercises[0].sets[0].externalLoadKg).toBe(0);
  });
});


describe('explicit Garmin zone generation', () => {
  const zone = { kind: 'power', mode: 'garmin-zone', zone: 2 };
  const suggestion = () => ({ ...endurance(), structure: { version: 1, sport: ActivityTypes.Running,
    nodes: [{ ...step(), targets: [zone] }] } });
  it('accepts symbolic zones without any FTP evidence and preserves them through repeats', () => {
    const result = validateDayWorkoutSuggestion(suggestion(), { ...controls, target: 'garmin-power-zone' });
    expect(result.draft?.structure.nodes[0]).toMatchObject({ targets: [zone] });
    const repeated = suggestion(); repeated.structure.nodes = [{ kind: 'repeat', id: 'repeat', count: 2,
      steps: repeated.structure.nodes } as never];
    expect(validateDayWorkoutSuggestion(repeated, { ...controls, target: 'garmin-power-zone' }).draft?.structure.nodes[0]).toMatchObject({ count: 2 });
  });
  it('requires explicit selection, one zone and a supported exact sport', () => {
    for (const target of ['auto', 'power', 'heart-rate', 'none'] as const) expect(() => validateDayWorkoutSuggestion(suggestion(), { ...controls, target })).toThrow();
    expect(() => validateDayWorkoutSuggestion(endurance(), { ...controls, target: 'garmin-power-zone' })).toThrow(/Include a Garmin/);
    expect(() => parseGenerateDayWorkoutRequest({ requestId: 'native-zone', controls: { ...controls, target: 'garmin-power-zone', sport: ActivityTypes.TrailRunning } }, new Date('2026-10-28T12:00Z'))).toThrow();
    expect(() => validateDayWorkoutSuggestion({ ...suggestion(), structure: { ...suggestion().structure, nodes: [{ ...step(), targets: [{ ...zone, zone: 8 }] }] } }, { ...controls, target: 'garmin-power-zone' })).toThrow();
  });
});


it.each([false, true])('does not introduce an unrequested early-Lap setting (%s) while generating a native zone', allowEarlyLap => {
  const row = { ...endurance(), structure: { version: 1, sport: ActivityTypes.Running, nodes: [{ ...step(),
    ending: { kind: 'time', seconds: 600, allowEarlyLap }, targets: [{ kind: 'power', mode: 'garmin-zone', zone: 2 }] }] } };
  expect(() => validateDayWorkoutSuggestion(row, { ...controls, target: 'garmin-power-zone' })).toThrow('early Lap');
});


describe('explicit generation power averaging', () => {
  const power = { kind: 'power', mode: 'relative', minimumPercent: 60, maximumPercent: 80, reference: { kind: 'critical-power', watts: 250 } } as const;
  it.each([3, 10, 30] as const)('applies %i seconds only to validated power in steps and repeats', seconds => {
    const selected = { ...controls, target: 'power' as const, garminPowerAveragingSeconds: seconds };
    expect(parseGenerateDayWorkoutRequest({ requestId: 'request-avg', controls: selected }, new Date('2026-10-28T12:00Z')).controls).toEqual(selected);
    const replacement = { requestId: 'replacement-avg', controls: selected, replaceWorkout: { id: 'saved-workout', revision: 3 } };
    expect(parseGenerateDayWorkoutRequest(replacement, new Date('2026-10-28T12:00Z'))).toEqual(replacement);
    const row = { ...endurance(), structure: { version: 1, sport: ActivityTypes.Running, nodes: [
      { ...step(), id: 'warmup' }, { kind: 'repeat', id: 'repeats', count: 2, steps: [{ ...step(), targets: [power] }] },
    ] } };
    const original = JSON.stringify(row);
    const result = validateDayWorkoutSuggestion(row, selected, [], [power]);
    expect(result.draft?.structure.nodes[1]).toMatchObject({ steps: [{ targets: [{ ...power, garminPowerAveragingSeconds: seconds }] }] });
    expect(JSON.stringify(row)).toBe(original);
    expect(result.draft?.structure.nodes[0]).toMatchObject({ targets: [] });
    expect(validateDayWorkoutSuggestion(row, controls, [], [power]).draft?.structure).toEqual(row.structure);
    const native = { ...endurance(), structure: { version: 1, sport: ActivityTypes.Running, nodes: [{ ...step(), targets: [{ kind: 'power', mode: 'garmin-zone', zone: 2 }] }] } };
    expect(validateDayWorkoutSuggestion(native, { ...selected, target: 'garmin-power-zone' }).draft?.structure.nodes[0])
      .toMatchObject({ targets: [{ mode: 'garmin-zone', zone: 2, garminPowerAveragingSeconds: seconds }] });
  });
  it('rejects invalid controls and model-invented averaging', () => {
    for (const seconds of [undefined, null, 0, 5, '10', 10.5]) expect(() => parseGenerateDayWorkoutRequest({ requestId: 'request-avg',
      controls: { ...controls, garminPowerAveragingSeconds: seconds } }, new Date('2026-10-28T12:00Z'))).toThrow('averaging');
    for (const target of ['none', 'heart-rate', 'speed']) expect(() => parseGenerateDayWorkoutRequest({ requestId: 'request-avg',
      controls: { ...controls, target, garminPowerAveragingSeconds: 10 } }, new Date('2026-10-28T12:00Z'))).toThrow('averaging');
    const row = { ...endurance(), structure: { version: 1, sport: ActivityTypes.Running, nodes: [{ ...step(), targets: [{ ...power, garminPowerAveragingSeconds: 10 }] }] } };
    expect(() => validateDayWorkoutSuggestion(row, controls, [], [power])).toThrow('explicit controls');
  });
});


describe('Auto duration', () => {
  it('defaults to Auto without a budget and preserves legacy/manual semantics', () => {
    const now = new Date('2026-10-28T12:00Z');
    expect(automatic.durationMode).toBe('auto'); expect(automatic).not.toHaveProperty('minutes');
    const parse = (value: object) => parseGenerateDayWorkoutRequest({ requestId: 'duration-test', controls: value }, now).controls;
    expect(parse(automatic)).toEqual(automatic);
    expect(parse(controls)).not.toHaveProperty('durationMode');
    expect(parse({ ...controls, durationMode: 'manual' })).toMatchObject({ minutes: 30, durationMode: 'manual' });
    for (const value of [null, undefined, 'invalid', ['auto']]) expect(() => parse({ ...controls, durationMode: value })).toThrow();
    for (const patch of [{ minutes: 30 }, { minutes: undefined }, { timing: 'strict' }]) expect(() => parse({ ...automatic, ...patch })).toThrow();
    expect(() => parse({ ...automatic, durationMode: 'manual' })).toThrow();
  });
  it('validates the entire timed prescription including repeat passes without imposing 30 minutes', () => {
    const value = endurance();
    value.structure.nodes = [{ kind: 'repeat', id: 'repeat', count: 4, steps: [step(900)] }] as never;
    expect(validateDayWorkoutSuggestion(value, automatic).draft).not.toBeNull();
    for (const seconds of [299, 14401]) {
      value.structure.nodes = [step(seconds)];
      expect(() => validateDayWorkoutSuggestion(value, automatic)).toThrow(/5 and 240/);
    }
    for (const seconds of [300, 14400]) {
      value.structure.nodes = [step(seconds)];
      expect(validateDayWorkoutSuggestion(value, automatic).draft).not.toBeNull();
    }
    value.structure.nodes = [{ kind: 'repeat', id: 'repeat', count: 2, steps: [step(7500)] }] as never;
    expect(() => validateDayWorkoutSuggestion(value, automatic)).toThrow(/5 and 240/);
    value.structure.nodes = [{ ...step(), ending: { kind: 'distance', meters: 1000 } }] as never;
    expect(() => validateDayWorkoutSuggestion(value, automatic)).toThrow(/timed/);
    expect(validateDayWorkoutSuggestion({ kind: 'rest', rationale: 'Recovery today.' }, automatic).draft).toBeNull();
  });
  it('requires a bounded strength estimate without converting reps to time', () => {
    const options = { ...automatic, sport: ActivityTypes.StrengthTraining, target: 'none' as const };
    const value = { kind: 'workout', title: 'Strength', rationale: 'Usual session.', strength: strength() };
    for (const range of [undefined, { minimum: 4, maximum: 20 }, { minimum: 20, maximum: 241 }]) {
      expect(() => validateDayWorkoutSuggestion({ ...value, ...(range ? { estimatedMinutes: range } : {}) }, options)).toThrow(/estimate/);
    }
    const result = validateDayWorkoutSuggestion({ ...value, estimatedMinutes: { minimum: 20, maximum: 40 } }, options);
    expect(result.draft?.strength?.exercises[0].sets[0].ending.kind).toBe('repetitions');
    const timed = { ...value, strength: { version: 1, exercises: [{ id: 'hold', name: 'Hold', sets: [
      { id: 'one', ending: { kind: 'time', seconds: 60 } },
    ] }] }, estimatedMinutes: { minimum: 5, maximum: 10 } };
    expect(() => validateDayWorkoutSuggestion(timed, options)).toThrow(/5 and 240/);
    timed.strength.exercises[0].sets[0].ending.seconds = 300;
    expect(validateDayWorkoutSuggestion(timed, options).draft).not.toBeNull();
    value.strength.exercises[0].sets[0].restAfterSeconds = 1200;
    expect(() => validateDayWorkoutSuggestion({ ...value, estimatedMinutes: { minimum: 5, maximum: 30 } }, options)).toThrow(/timed work/);
    expect(validateDayWorkoutSuggestion({ ...value, estimatedMinutes: { minimum: 20, maximum: 30 } }, options).draft).not.toBeNull();
    value.strength.exercises[0].sets[0].restAfterSeconds = 3600;
    expect(() => validateDayWorkoutSuggestion({ ...value, estimatedMinutes: { minimum: 20, maximum: 40 } }, options)).toThrow(/timed work/);
  });
});
