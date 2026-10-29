import { ActivityTypes, WeightUnits } from '@sports-alliance/sports-lib';
import { defaultDayWorkoutControls, parseGenerateDayWorkoutRequest } from '@shared/day-workout';
import { projectStrengthWorkoutToV1 } from '@shared/strength-workout';
import { analyzeWorkoutStructureV1 } from '@shared/planned-workout-analysis';
import { dayWorkoutReview } from './day-workout-review.helper';

describe('Calendar workout draft review', () => {
  it('starts with explicit time and independent disabled context choices across sports', () => {
    const controls = defaultDayWorkoutControls('2026-10-28', 'Europe/Helsinki');
    expect(controls).toMatchObject({ minutes: 30, trainingContext: false, timelineContext: false, sport: ActivityTypes.Running });
    expect(parseGenerateDayWorkoutRequest({ requestId: 'request-123', controls }, new Date('2026-10-27T23:00Z'))).toEqual({ requestId: 'request-123', controls });
    expect(defaultDayWorkoutControls('2026-10-28', 'UTC', ActivityTypes.StrengthTraining)).toMatchObject({ equipment: ['bodyweight'], target: 'none' });
  });
  it('shows every strength set, rest, zero/fractional load and an explicitly separate estimate in user units', () => {
    const strength = { version: 1 as const, exercises: [{ id: 'squat', name: 'Dumbbell squat', sets: [
      { id: 'one', ending: { kind: 'repetitions' as const, repetitions: 8 }, externalLoadKg: 0, restAfterSeconds: 60 },
      { id: 'two', ending: { kind: 'repetitions' as const, repetitions: 8 }, externalLoadKg: 12.5, restAfterSeconds: 90 },
      { id: 'three', ending: { kind: 'repetitions' as const, repetitions: 6 } },
    ] }] };
    const structure = projectStrengthWorkoutToV1({ ...strength, workoutId: 'draft', revision: 1 });
    const draft = { title: 'Strength', structure, strength, estimatedMinutes: { minimum: 20, maximum: 30 } };
    const metric = dayWorkoutReview(draft);
    expect(metric.exercises[0].sets).toHaveLength(3);
    expect(metric.exercises[0].sets[0]).toContain('0.0 kg');
    expect(metric.exercises[0].sets[1]).toContain('12.5 kg');
    expect(metric.exercises[0].sets[1]).toContain('01m 30s');
    expect(metric.exercises[0].sets[2]).toContain('load unspecified');
    expect(metric.estimate).toContain('AI planning estimate');
    expect(analyzeWorkoutStructureV1(structure).summary.duration.completeExactSeconds).toBeNull();
    expect(dayWorkoutReview(draft, { weightUnits: WeightUnits.Pounds } as never).exercises[0].sets[1]).toContain('27.6 lb');
  });
  it('expands every repeat step and total pass count without flattening away recovery', () => {
    const review = dayWorkoutReview({ title: 'Intervals', structure: { version: 1, sport: ActivityTypes.Running, nodes: [
      { kind: 'repeat', id: 'repeats', count: 4, steps: [
        { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 120 }, targets: [] },
        { kind: 'step', id: 'rest', purpose: 'recovery', ending: { kind: 'time', seconds: 60 }, targets: [] },
      ] },
    ] } });
    expect(review.intervals[0].repeat).toBe('4 passes');
    expect(review.intervals[0].steps).toHaveLength(2);
    expect(review.intervals[0].steps[1]).toMatch(/recovery/i);
  });
  it('includes effort notes in standalone and repeated steps before the user saves the workout', () => {
    const review = dayWorkoutReview({ title: 'Effort guidance', structure: { version: 1, sport: ActivityTypes.Running, nodes: [
      { kind: 'step', id: 'warmup', purpose: 'warmup', ending: { kind: 'time', seconds: 300 }, targets: [], note: 'Conversational effort' },
      { kind: 'repeat', id: 'repeat', count: 3, steps: [
        { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 120 }, targets: [], note: 'Controlled, not an all-out sprint' },
        { kind: 'step', id: 'recover', purpose: 'recovery', ending: { kind: 'time', seconds: 60 }, targets: [], note: 'Walk until comfortable' },
      ] },
    ] } });
    expect(review.intervals[0].steps[0]).toContain('Conversational effort');
    expect(review.intervals[1].steps[0]).toContain('Controlled, not an all-out sprint');
    expect(review.intervals[1].steps[1]).toContain('Walk until comfortable');
  });
});
