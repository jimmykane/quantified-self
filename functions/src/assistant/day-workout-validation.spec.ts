import { describe, expect, it } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { defaultDayWorkoutControls, parseGenerateDayWorkoutRequest } from '../../../shared/day-workout';
import { analyzeWorkoutStructureV1 } from '../../../shared/planned-workout-analysis';
import { validateDayWorkoutSuggestion } from './day-workout-validation';

const controls = defaultDayWorkoutControls('2026-10-28', 'Europe/Helsinki');
const step = (seconds = 600) => ({ kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds }, targets: [] });
const endurance = () => ({ kind: 'workout', title: 'Easy session', rationale: 'Keep the effort comfortable.',
  structure: { version: 1, sport: ActivityTypes.Running, nodes: [step()] } });
const strength = () => ({ version: 1 as const, exercises: [{ id: 'squat', name: 'Dumbbell squat',
  sets: [{ id: 'one', ending: { kind: 'repetitions' as const, repetitions: 8 }, restAfterSeconds: 60, externalLoadKg: 999 }] }] });

describe('day workout contract and prescription validation', () => {
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
