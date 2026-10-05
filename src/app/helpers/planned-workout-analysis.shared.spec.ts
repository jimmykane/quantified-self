import { describe, expect, it } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { WorkoutStructureValidationError, type WorkoutStepV1, type WorkoutStructureV1 } from '@shared/planned-workout';
import { aggregateWorkoutAnalysesV1, analyzeWorkoutStructureV1, WorkoutAnalysisArithmeticError } from '@shared/planned-workout-analysis';
import { wahooDurationSeconds } from '@shared/wahoo-workout-sports';

const step = (id: string, ending: WorkoutStepV1['ending'], targets: WorkoutStepV1['targets'] = [],
  purpose: WorkoutStepV1['purpose'] = 'work'): WorkoutStepV1 => ({ kind: 'step', id, purpose, ending, targets });
const recipe = (nodes: WorkoutStructureV1['nodes']): WorkoutStructureV1 => ({ version: 1, sport: ActivityTypes.Running, nodes });
const speed = (minimumMetersPerSecond = 1000 / 300, maximumMetersPerSecond = 1000 / 240,
  presentation: 'pace' | 'speed' = 'pace'): WorkoutStepV1['targets'] => [{ kind: 'speed', mode: 'absolute',
  minimumMetersPerSecond, maximumMetersPerSecond, presentation }];

describe('shared workout prescription analysis', () => {
  it('separates exact, estimated and unknown contributions and multiplies total repeat passes', () => {
    const input = recipe([step('warmup', { kind: 'time', seconds: 600 }, [], 'warmup'),
      { kind: 'repeat', id: 'main', count: 4, steps: [
        step('work', { kind: 'distance', meters: 1000 }, speed()),
        step('recover', { kind: 'manual' }, [], 'recovery'),
      ] }]);
    const before = JSON.stringify(input);
    const result = analyzeWorkoutStructureV1(input);
    expect(result.counts).toEqual({ structuralNodes: 4, definedSteps: 3, executedSteps: 9 });
    expect(result.summary.duration).toEqual({ exactSubtotalSeconds: 600, exactSteps: 1,
      estimatedSubtotalRange: { minimumSeconds: expect.closeTo(960, 10), maximumSeconds: 1200 }, estimatedSteps: 4, unknownSteps: 4,
      coveredSubtotalRange: { minimumSeconds: 1560, maximumSeconds: 1800 }, completeExactSeconds: null,
      completeRange: null, coverage: 'partial' });
    expect(result.summary.distance).toEqual({ exactSubtotalMeters: 4000, exactSteps: 4, unknownSteps: 5,
      completeExactMeters: null, coverage: 'partial' });
    expect(result.steps[1]).toEqual({ stepId: 'work', repeatId: 'main', multiplier: 4, purpose: 'work',
      prescribedSeconds: null, prescribedMeters: 1000, duration: { kind: 'estimated',
        minimumSeconds: expect.closeTo(240, 10), maximumSeconds: 300, basis: 'absolute-speed' } });
    expect(result.byPurpose.warmup.duration.completeExactSeconds).toBe(600);
    expect(result.byPurpose.work.duration.completeRange).toEqual({ minimumSeconds: expect.closeTo(960, 10), maximumSeconds: 1200 });
    expect(result.byPurpose.recovery.duration).toMatchObject({ unknownSteps: 4, coverage: 'none', coveredSubtotalRange: null });
    expect(result.byPurpose.rest).toMatchObject({ executedSteps: 0, duration: { completeExactSeconds: null, coverage: 'none' } });
    expect(JSON.stringify(input)).toBe(before);
    expect(wahooDurationSeconds(input)).toBeNull();
  });
  it('preserves fractional timed values and agrees with Wahoo only for complete exact timed recipes', () => {
    const input = recipe([step('one', { kind: 'time', seconds: 60.125 }),
      { kind: 'repeat', id: 'repeat', count: 3, steps: [step('two', { kind: 'time', seconds: 0.375 })] }]);
    const result = analyzeWorkoutStructureV1(input);
    expect(result.summary.duration).toMatchObject({ completeExactSeconds: 61.25, exactSubtotalSeconds: 61.25,
      estimatedSubtotalRange: null, completeRange: { minimumSeconds: 61.25, maximumSeconds: 61.25 }, coverage: 'complete' });
    expect(result.summary.distance).toMatchObject({ exactSubtotalMeters: 0, completeExactMeters: null, coverage: 'none' });
    expect(result.summary.duration.completeExactSeconds).toBe(wahooDurationSeconds(input));
  });
  it('counts distance-only prescriptions without inventing duration or timed-step distance', () => {
    const result = analyzeWorkoutStructureV1(recipe([step('distance', { kind: 'distance', meters: 1609.344 })]));
    expect(result.summary.distance).toMatchObject({ completeExactMeters: 1609.344, coverage: 'complete' });
    expect(result.summary.duration).toMatchObject({ exactSubtotalSeconds: 0, coveredSubtotalRange: null, coverage: 'none' });
    expect(result.steps[0].duration).toEqual({ kind: 'unknown', reason: 'missing-speed' });
    const timed = analyzeWorkoutStructureV1(recipe([step('timed', { kind: 'time', seconds: 60 }, speed())]));
    expect(timed.summary.distance.completeExactMeters).toBeNull();
  });
  it.each(['pace', 'speed'] as const)('inverts speed bounds for %s presentation and retains point estimates as estimates', presentation => {
    const result = analyzeWorkoutStructureV1(recipe([step('distance', { kind: 'distance', meters: 1000 }, speed(2, 4, presentation))]));
    expect(result.summary.duration).toMatchObject({ completeExactSeconds: null, coverage: 'complete',
      completeRange: { minimumSeconds: 250, maximumSeconds: 500 } });
    const point = analyzeWorkoutStructureV1(recipe([step('point', { kind: 'distance', meters: 1000 }, speed(4, 4, presentation))]));
    expect(point.steps[0].duration).toMatchObject({ kind: 'estimated', minimumSeconds: 250, maximumSeconds: 250 });
    expect(wahooDurationSeconds(recipe([step('point', { kind: 'distance', meters: 1000 }, speed(4, 4, presentation))]))).toBeNull();
  });
  it('uses only the saved threshold-speed reference, even alongside a second target', () => {
    const result = analyzeWorkoutStructureV1(recipe([step('relative', { kind: 'distance', meters: 1200 }, [
      { kind: 'speed', mode: 'relative', minimumPercent: 80, maximumPercent: 100,
        presentation: 'speed', reference: { kind: 'threshold-speed', metersPerSecond: 5 } },
      { kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 150 },
    ])]));
    expect(result.steps[0].duration).toEqual({ kind: 'estimated', minimumSeconds: 240, maximumSeconds: 300,
      basis: 'saved-threshold-speed' });
  });
  it.each([
    { targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 150 }] },
    { targets: [{ kind: 'power', mode: 'absolute', minimumWatts: 200, maximumWatts: 300 }] },
    { targets: [{ kind: 'cadence', mode: 'absolute', minimumRpm: 80, maximumRpm: 100 }] },
  ] satisfies { targets: WorkoutStepV1['targets'] }[])('never infers speed from non-speed targets %j', ({ targets }) => {
    expect(analyzeWorkoutStructureV1(recipe([step('distance', { kind: 'distance', meters: 1000 }, targets)]))
      .steps[0].duration).toEqual({ kind: 'unknown', reason: 'missing-speed' });
  });
  it('keeps valid zero speed/percentage bounds unknown, without tightening canonical validation', () => {
    for (const targets of [speed(0, 4, 'speed'), [{ kind: 'speed', mode: 'relative', minimumPercent: 0,
      maximumPercent: 100, presentation: 'speed', reference: { kind: 'threshold-speed', metersPerSecond: 5 } }]]) {
      const result = analyzeWorkoutStructureV1(recipe([step('zero', { kind: 'distance', meters: 1000 }, targets as WorkoutStepV1['targets'])]));
      expect(result.steps[0].duration).toEqual({ kind: 'unknown', reason: 'unbounded-speed' });
      expect(result.summary.duration.coveredSubtotalRange).toBeNull();
    }
  });
  it('retains manual, repetition and energy unknown reasons through maximum repeats without expansion', () => {
    const result = analyzeWorkoutStructureV1(recipe([{ kind: 'repeat', id: 'repeat', count: 100, steps: [
      step('manual', { kind: 'manual' }), step('reps', { kind: 'repetitions', repetitions: 10 }),
      step('energy', { kind: 'kilojoules', kilojoules: 100 }, [{ kind: 'power', mode: 'absolute', minimumWatts: 200, maximumWatts: 200 }]),
    ] }]));
    expect(result.counts).toEqual({ structuralNodes: 4, definedSteps: 3, executedSteps: 300 });
    expect(result.steps.map(s => s.duration)).toEqual([{ kind: 'unknown', reason: 'manual-ending' },
      { kind: 'unknown', reason: 'repetitions-ending' }, { kind: 'unknown', reason: 'kilojoules-ending' }]);
    expect(result.summary.duration).toMatchObject({ unknownSteps: 300, completeRange: null, coverage: 'none' });
    const maximum = analyzeWorkoutStructureV1(recipe([{ kind: 'repeat', id: 'max', count: 100,
      steps: Array.from({ length: 99 }, (_, i) => step(`s${i}`, { kind: 'time', seconds: 1 })) }]));
    expect(maximum.counts).toEqual({ structuralNodes: 100, definedSteps: 99, executedSteps: 9900 });
    expect(maximum.steps).toHaveLength(99);
  });
  it('rejects missing/invalid/inverted canonical values instead of silently repairing them', () => {
    const invalid = [recipe([step('zero', { kind: 'time', seconds: 0 })]),
      recipe([step('nan', { kind: 'distance', meters: NaN })]), recipe([step('inverted', { kind: 'distance', meters: 1 }, speed(4, 2))]),
      { ...recipe([step('missing', { kind: 'time', seconds: 1 })]), version: 2 },
      recipe([step('relative', { kind: 'distance', meters: 1 }, [{ kind: 'speed', mode: 'relative',
        minimumPercent: 80, maximumPercent: 100, presentation: 'pace' } as WorkoutStepV1['targets'][number]])]),
    ];
    invalid.forEach(input => expect(() => analyzeWorkoutStructureV1(input)).toThrow(WorkoutStructureValidationError));
  });
  it('fails explicitly on overflow and underflow rather than producing non-finite or zero estimates', () => {
    expect(() => analyzeWorkoutStructureV1(recipe([{ kind: 'repeat', id: 'overflow', count: 100,
      steps: [step('huge', { kind: 'time', seconds: Number.MAX_VALUE })] }]))).toThrow(WorkoutAnalysisArithmeticError);
    expect(() => analyzeWorkoutStructureV1(recipe([step('tiny', { kind: 'distance', meters: Number.MIN_VALUE },
      speed(Number.MAX_VALUE, Number.MAX_VALUE, 'speed'))]))).toThrow(WorkoutAnalysisArithmeticError);
    const huge = analyzeWorkoutStructureV1(recipe([step('huge', { kind: 'time', seconds: Number.MAX_VALUE })]));
    expect(() => aggregateWorkoutAnalysesV1([huge, huge], { sourceComplete: true })).toThrow(WorkoutAnalysisArithmeticError);
  });
  it('aggregates purposes and coverage, withholding complete totals for a partial source scan', () => {
    const timed = analyzeWorkoutStructureV1(recipe([step('one', { kind: 'time', seconds: 60 }, [], 'warmup')]));
    const distance = analyzeWorkoutStructureV1(recipe([step('two', { kind: 'distance', meters: 1000 }, speed())]));
    const combined = aggregateWorkoutAnalysesV1([timed, distance], { sourceComplete: true });
    expect(combined.summary.duration).toMatchObject({ completeExactSeconds: null, coverage: 'complete',
      completeRange: { minimumSeconds: 300, maximumSeconds: 360 } });
    expect(combined.byPurpose.warmup.duration.completeExactSeconds).toBe(60);
    const partial = aggregateWorkoutAnalysesV1([timed], { sourceComplete: false });
    expect(partial).toMatchObject({ workoutCount: 1, sourceComplete: false, summary: { duration: {
      exactSubtotalSeconds: 60, completeRange: null, completeExactSeconds: null, coverage: 'partial' } } });
    expect(aggregateWorkoutAnalysesV1([], { sourceComplete: true }).summary.duration)
      .toMatchObject({ coveredSubtotalRange: null, completeExactSeconds: null, coverage: 'none' });
  });
});
