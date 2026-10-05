import { ActivityTypes, DistanceUnits, PaceUnits, SwimPaceUnits, SpeedUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import type { WorkoutStepV1, WorkoutStructureV1 } from '@shared/planned-workout';
import { buildWorkoutProfile, formatWorkoutProfileAxis, WORKOUT_PROFILE_EXPANSION_BUDGET } from './workout-profile.helper';
import { buildWorkoutProfileChartOption } from './workout-profile-chart.helper';

const step = (id: string, seconds = 60): WorkoutStepV1 => ({ kind: 'step', id, purpose: 'work', ending: { kind: 'time', seconds }, targets: [] });
const recipe = (nodes: WorkoutStructureV1['nodes'], sport = ActivityTypes.Running): WorkoutStructureV1 => ({ version: 1, sport, nodes });

describe('workout profile presentation', () => {
  it('preserves mixed kilometre / HR blocks and untargeted 60, 75 and 90 second efforts without estimating intensity or time', () => {
    const structure = recipe([{ ...step('hr-block'), ending: { kind: 'distance', meters: 1000 },
      targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 130, maximumBpm: 145 }] },
    step('one-minute'), step('one-fifteen', 75), step('one-thirty', 90)]);
    const before = JSON.stringify(structure);
    const model = buildWorkoutProfile(structure);
    expect(model.occurrences.map(s => s.stepId)).toEqual(['hr-block', 'one-minute', 'one-fifteen', 'one-thirty']);
    expect(model.occurrences.map(s => s.ending)).toEqual(['1.00 Km', '01m 00s', '01m 15s', '01m 30s']);
    expect(model.occurrences.slice(1).every(s => s.targets.length === 0)).toBe(true);
    expect(model.metrics).toEqual(['heart-rate']);
    expect(JSON.stringify(structure)).toBe(before);
  });

  it('keeps equal warm-up / cool-down targets constant and separates two simultaneous metrics', () => {
    const model = buildWorkoutProfile(recipe(['warmup', 'cooldown'].map((purpose: 'warmup' | 'cooldown') => ({
      ...step(purpose), purpose, targets: [
        { kind: 'power', mode: 'absolute', minimumWatts: 200, maximumWatts: 200 },
        { kind: 'heart-rate', mode: 'absolute', minimumBpm: 140, maximumBpm: 150 },
      ],
    }))));
    expect(model.metrics).toEqual(['power', 'heart-rate']);
    expect(model.occurrences.every(s => s.targets[0].minimum === 200 && s.targets[0].maximum === 200)).toBe(true);
  });

  it('resolves relative ranges only from saved references, reverses pace bounds and exposes the snapshot text', () => {
    const model = buildWorkoutProfile(recipe([{ ...step('relative'), ending: { kind: 'manual' }, targets: [
      { kind: 'speed', mode: 'relative', minimumPercent: 80, maximumPercent: 100,
        presentation: 'pace', reference: { kind: 'threshold-speed', metersPerSecond: 4 } },
      { kind: 'cadence', mode: 'relative', minimumPercent: 90, maximumPercent: 110,
        reference: { kind: 'preferred-cadence', rpm: 180 } },
    ] }]));
    expect(model.occurrences[0].ending).toBe('Manual transition');
    expect(model.occurrences[0].targets[0]).toMatchObject({ metric: 'pace', minimum: 250, maximum: 312.5, relative: true });
    expect(model.occurrences[0].targets[1].minimum).toBeCloseTo(162);
    expect(model.occurrences[0].targets[1].maximum).toBeCloseTo(198);
    expect(model.occurrences[0].targets[0].text).toContain('saved reference');
    expect(() => buildWorkoutProfile(recipe([{ ...step('missing'), targets: [
      { kind: 'power', mode: 'relative', minimumPercent: 80, maximumPercent: 100 } as never,
    ] }]))).toThrow();
  });

  it('uses unique deterministic occurrence keys without changing canonical IDs', () => {
    const structure = recipe([{ kind: 'repeat', id: 'set', count: 3, steps: [step('work'), { ...step('recover'), purpose: 'recovery' }] }]);
    const a = buildWorkoutProfile(structure);
    expect(a.occurrences.map(s => s.occurrenceKey)).toEqual(['set/1/work', 'set/1/recover', 'set/2/work', 'set/2/recover', 'set/3/work', 'set/3/recover']);
    expect(buildWorkoutProfile(structure).occurrences).toEqual(a.occurrences);
    expect(a.occurrences[4]).toMatchObject({ stepId: 'work', repeatId: 'set', iteration: 3, ordinal: 5 });
  });

  it('retains valid zero-percent relative pace instructions without suppressing the other steps', () => {
    const model = buildWorkoutProfile(recipe([{ ...step('open-pace'), targets: [
      { kind: 'speed', mode: 'relative', minimumPercent: 0, maximumPercent: 100,
        presentation: 'pace', reference: { kind: 'threshold-speed', metersPerSecond: 4 } },
    ] }, { ...step('steady'), targets: [
      { kind: 'speed', mode: 'absolute', minimumMetersPerSecond: 3, maximumMetersPerSecond: 4, presentation: 'pace' },
    ] }]));
    expect(model.occurrences).toHaveLength(2);
    expect(model.occurrences[0].targets[0]).toMatchObject({ metric: 'pace', minimum: null, maximum: null });
    expect(model.occurrences[0].targets[0].text).toContain('0–100%');
    expect(model.occurrences[0].targets[0].text).toContain('No finite pace range');
    expect(model.occurrences[1].targets[0]).toMatchObject({ metric: 'pace', minimum: 250, maximum: 1000 / 3 });
    const option = buildWorkoutProfileChartOption(model, 'pace', null, [], false, 320, true) as {
      series: Array<{ data: Array<{ value: number[]; occurrenceKey: string }> }>;
    };
    expect(option.series[0].data).toEqual([{ value: [1, 250, 1000 / 3], occurrenceKey: 'root/1/steady' }]);
    expect(buildWorkoutProfile(recipe([model.structure.nodes[0]])).metrics).toEqual([]);
  });

  it('represents all 9,900 legal occurrences with bounded pass drilldown and no silent truncation', () => {
    const structure = recipe([{ kind: 'repeat', id: 'large', count: 100, steps: Array.from({ length: 99 }, (_, i) => step(`s${i}`)) }]);
    const model = buildWorkoutProfile(structure, null, undefined, { large: 100 });
    expect(model.grouped).toBe(true);
    expect(model.occurrenceCount).toBe(9900);
    expect(model.occurrences).toHaveLength(99);
    expect(model.occurrences.length).toBeLessThanOrEqual(WORKOUT_PROFILE_EXPANSION_BUDGET);
    expect(model.repeats[0].passes).toHaveLength(100);
    expect(model.occurrences[98]).toMatchObject({ ordinal: 9900, occurrenceKey: 'large/100/s98' });
    expect(buildWorkoutProfile(structure, null, undefined, { large: 101 }).repeats[0].iteration).toBe(1);
  });

  it('formats imperial, pool swim and rowing target axes through the canonical formatter', () => {
    const units = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles, paceUnits: [PaceUnits.MinutesPerMile],
      speedUnits: [SpeedUnits.MilesPerHour], swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] });
    expect(formatWorkoutProfileAxis(300, 'pace', recipe([step('run')]), units)).toBe('08:02 min/m');
    expect(formatWorkoutProfileAxis(100, 'pace', recipe([step('swim')], ActivityTypes.Swimming), units)).toContain('/100yd');
    expect(formatWorkoutProfileAxis(120, 'pace', recipe([step('row')], ActivityTypes.Rowing), units)).toContain('500');
    expect(formatWorkoutProfileAxis(4, 'speed', recipe([step('speed')]), units)).toContain('mph');
  });

  it('retains manual, energy and repetition endings and notes as exact recipe facts', () => {
    const model = buildWorkoutProfile(recipe([{ ...step('manual'), ending: { kind: 'manual' }, note: '<script>untrusted</script>' },
      { ...step('energy'), ending: { kind: 'kilojoules', kilojoules: 50 } },
      { ...step('reps'), ending: { kind: 'repetitions', repetitions: 12 } }]));
    expect(model.occurrences.map(s => s.ending)).toEqual(['Manual transition', '50 kJ', '12 reps']);
    expect(model.occurrences[0].note).toBe('<script>untrusted</script>');
  });
});
