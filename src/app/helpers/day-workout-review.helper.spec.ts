import { ActivityTypes, WeightUnits } from '@sports-alliance/sports-lib';
import { defaultDayWorkoutControls, parseGenerateDayWorkoutRequest } from '@shared/day-workout';
import { projectStrengthWorkoutToV1 } from '@shared/strength-workout';
import { analyzeWorkoutStructureV1 } from '@shared/planned-workout-analysis';
import { dayWorkoutReview, dayWorkoutReviewTiming } from './day-workout-review.helper';

describe('Calendar workout draft review', () => {
  it('starts with explicit time and independent enabled context choices across sports', () => {
    const controls = defaultDayWorkoutControls('2026-10-28', 'Europe/Helsinki');
    expect(controls).toMatchObject({ minutes: 30, trainingContext: true, timelineContext: true, usePreviousWeights: true, sport: ActivityTypes.Running });
    expect(parseGenerateDayWorkoutRequest({ requestId: 'request-123', controls }, new Date('2026-10-27T23:00Z'))).toEqual({ requestId: 'request-123', controls });
    expect(defaultDayWorkoutControls('2026-10-28', 'UTC', ActivityTypes.StrengthTraining)).toMatchObject({ equipment: ['bodyweight'], target: 'none' });
  });
  it('preserves explicit context opt-outs and requires every choice in incoming requests', () => {
    const controls = { ...defaultDayWorkoutControls('2026-10-28', 'UTC'), trainingContext: false, timelineContext: false, usePreviousWeights: false };
    expect(parseGenerateDayWorkoutRequest({ requestId: 'request-123', controls }, new Date('2026-10-28T12:00Z')).controls).toEqual(controls);
    const missingChoice: Partial<typeof controls> = { ...controls };
    delete missingChoice.timelineContext;
    expect(() => parseGenerateDayWorkoutRequest({ requestId: 'request-123', controls: missingChoice }, new Date('2026-10-28T12:00Z'))).toThrow('Explicit context choices');
  });
  it('shows every strength set, rest, zero/fractional load and an explicitly separate estimate in user units', () => {
    const strength = { version: 1 as const, exercises: [{ id: 'squat', name: 'Dumbbell squat', sets: [
      { id: 'one', ending: { kind: 'repetitions' as const, repetitions: 8 }, externalLoadKg: 0, restAfterSeconds: 60 },
      { id: 'two', ending: { kind: 'repetitions' as const, repetitions: 8 }, externalLoadKg: 12.5, restAfterSeconds: 90 },
      { id: 'three', ending: { kind: 'repetitions' as const, repetitions: 6 } },
    ] }] };
    const structure = projectStrengthWorkoutToV1({ ...strength, workoutId: 'draft', revision: 1 });
    const draft = { title: 'Strength', structure, strength, estimatedMinutes: { minimum: 20, maximum: 30 } };
    const metric = dayWorkoutReview(draft, undefined, [{ exerciseId: 'squat', localDate: '2026-10-25' }]);
    expect(metric.exercises[0].previouslyPlannedOn).toBe('2026-10-25');
    expect(dayWorkoutReview(draft, undefined, [{ exerciseId: 'other', localDate: '2026-10-24' }]).exercises[0].previouslyPlannedOn).toBeNull();
    expect(metric.exercises[0].sets).toHaveLength(3);
    expect(metric.exercises[0].sets[0]).toContain('0.0 kg');
    expect(metric.exercises[0].sets[1]).toContain('12.5 kg');
    expect(metric.exercises[0].sets[1]).toContain('01m 30s');
    expect(metric.exercises[0].sets[2]).toContain('load unspecified');
    expect(metric.summary).toBe('AI planning estimate: 20m 00s–30m 00s');
    expect(metric.timingDetails).toContain('Timing breakdown: 02m 30s timed subtotal + 3 steps with unknown duration');
    expect(analyzeWorkoutStructureV1(structure).summary.duration.completeExactSeconds).toBeNull();
    expect(dayWorkoutReview(draft, { weightUnits: WeightUnits.Pounds } as never).exercises[0].sets[1]).toContain('27.6 lb');
  });
  it.each([undefined, { weightUnits: WeightUnits.Pounds }])('never presents the timed portion as a rep-based session total (%j)', units => {
    const strength = { version: 1 as const, exercises: [{ id: 'squat', name: 'Squat', sets: Array.from({ length: 6 }, (_, index) => ({
      id: `set-${index}`, ending: { kind: 'repetitions' as const, repetitions: 8 }, restAfterSeconds: 95,
    })) }] };
    const structure = projectStrengthWorkoutToV1({ ...strength, workoutId: 'draft', revision: 1 });
    const draft = { title: 'Strength', structure, strength };
    const estimated = dayWorkoutReviewTiming({ ...draft, estimatedMinutes: { minimum: 20, maximum: 30 } }, units);
    expect(estimated.summary).toBe('AI planning estimate: 20m 00s–30m 00s');
    expect(estimated.timingDetails).toBe('Timing breakdown: 09m 30s timed subtotal + 6 steps with unknown duration. Rep-based sets and transitions add time.');
    expect(dayWorkoutReviewTiming(draft, units)).toEqual({ summary: 'Total session duration unknown', timingDetails: estimated.timingDetails });
    expect(analyzeWorkoutStructureV1(structure).summary.duration.completeExactSeconds).toBeNull();
  });
  it('retains exact totals for fully timed strength rather than replacing them with an AI estimate', () => {
    const strength = { version: 1 as const, exercises: [{ id: 'plank', name: 'Plank', sets: [
      { id: 'hold', ending: { kind: 'time' as const, seconds: 60 }, restAfterSeconds: 30 },
    ] }] };
    const structure = projectStrengthWorkoutToV1({ ...strength, workoutId: 'draft', revision: 1 });
    expect(dayWorkoutReviewTiming({ title: 'Timed strength', structure, strength, estimatedMinutes: { minimum: 2, maximum: 3 } }))
      .toEqual({ summary: '01m 30s', timingDetails: 'AI planning estimate: 02m 00s–03m 00s' });
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
