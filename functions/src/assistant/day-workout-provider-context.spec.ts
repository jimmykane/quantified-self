import * as wahooMapping from '../training-plans/delivery/wahoo/mapping';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { defaultDayWorkoutControls } from '../../../shared/day-workout';
import { PLANNED_WORKOUT_PROVIDER_IDS } from '../../../shared/planned-workout-providers';
import { garminStrengthExercise } from '../../../shared/garmin-strength-workout';
import { dayWorkoutProviderContext } from './day-workout-provider-context';
import { validateDayWorkoutSuggestion } from './day-workout-validation';

const controls = defaultDayWorkoutControls('2026-11-02', 'UTC');
describe('provider-aware daily recipe context', () => {
  it('derives Wahoo ending constraints from the existing mapper instead of the broad catalog', () => {
    const context = dayWorkoutProviderContext(controls, ['wahoo', 'garmin'], []);
    expect(context.evidence.providers[0].endings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'time', level: 'exact' }), expect.objectContaining({ kind: 'distance', level: 'unsupported' }),
    ]));
    expect(context.evidence.commonExactEndings).toEqual(['time']);
    expect(context.evidence.providers[0].timedTotals).toContainEqual(expect.objectContaining({ totalSeconds: 61, level: 'unsupported' }));
  });
  it.each(PLANNED_WORKOUT_PROVIDER_IDS)('keeps timed running exact but discloses relative-target limitations for %s', provider => {
    const reference = { kind: 'heart-rate' as const, mode: 'relative' as const, minimumPercent: 60, maximumPercent: 70,
      reference: { kind: 'max-heart-rate' as const, bpm: 190 } };
    const context = dayWorkoutProviderContext(controls, [provider], [reference, reference]);
    expect(context.evidence.commonExactEndings).toContain('time');
    expect(context.evidence.providers[0].targets).toEqual([{ kind: 'heart-rate', level: 'degraded',
      issues: [expect.stringContaining(provider === 'wahoo' ? 'not ELEMNT computers or RIVAL' : 'stored reference snapshot must be frozen to an absolute range')] }]);
    expect(context.evidence).not.toHaveProperty('digest');
  });
  it('keeps an unsupported sport explicit instead of substituting another sport or rest', () => {
    const context = dayWorkoutProviderContext({ ...controls, sport: ActivityTypes.Hiking }, ['coros'], []);
    expect(context.evidence.providers[0].sportSupported).toBe(false);
    expect(context.evidence.commonExactEndings).toEqual([]);
  });
  it('uses the canonical Garmin strength-name allowlist and preserves strength ending semantics', () => {
    const context = dayWorkoutProviderContext({ ...controls, sport: ActivityTypes.StrengthTraining }, ['garmin', 'wahoo'], []);
    const names = context.evidence.providers[0].allowedExerciseNames!;
    expect(names).toContain('Barbell Back Squat'); expect(names.every(name => !!garminStrengthExercise(name))).toBe(true);
    expect(context.evidence.providers[1].endings).toContainEqual(expect.objectContaining({ kind: 'repetitions', level: 'unsupported' }));
  });
  it('does not use a mapping correction to relax explicit targets or previously planned loads', () => {
    const target = { ...controls, target: 'power' as const };
    const context = dayWorkoutProviderContext(target, ['wahoo'], []);
    const suggestion = validateDayWorkoutSuggestion({ kind: 'workout', title: 'Run', rationale: 'Easy session', structure: {
      version: 1, sport: controls.sport, nodes: [{ kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'distance', meters: 1000 }, targets: [] }],
    } }, controls, [], []);
    expect(context.correction(suggestion)).toBeNull();
    const defaultContext = dayWorkoutProviderContext(controls, ['wahoo'], []);
    expect(defaultContext.correction({ ...suggestion, previousLoads: [{ exerciseId: 'squat', localDate: '2026-11-01' }] })).toBeNull();
  });
  it('keeps optional compatibility failures generic instead of leaking errors or failing valid generation', () => {
    const check = vi.spyOn(wahooMapping, 'assessWahooDelivery').mockImplementation(() => { throw Error('private-error-canary'); });
    try {
      const context = dayWorkoutProviderContext(controls, ['wahoo'], []);
      expect(context.evidence.commonExactEndings).toEqual([]);
      expect(JSON.stringify(context.evidence)).toContain('Local format checking is unavailable');
      expect(JSON.stringify(context.evidence)).not.toContain('private-error-canary');
    } finally { check.mockRestore(); }
  });
  it('discloses incompatible recipes and permits a bounded correction without rewriting the draft', () => {
    const context = dayWorkoutProviderContext(controls, ['wahoo'], []);
    const suggestion = validateDayWorkoutSuggestion({ kind: 'workout', title: 'Run', rationale: 'Easy session', structure: {
      version: 1, sport: controls.sport, nodes: [{ kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'distance', meters: 1000 }, targets: [] }],
    } }, controls, [], []);
    const before = structuredClone(suggestion);
    expect(context.correction(suggestion)).toContain('Keep the same selected sport');
    expect(context.limitations(suggestion)[0]).toContain('Delivery to Wahoo needs Review sync');
    expect(suggestion).toEqual(before);
    expect(context.correction({ kind: 'rest', rationale: 'Recovery', draft: null, previousLoads: [] })).toBeNull();
  });
});
