import { describe, expect, it } from 'vitest';
import { ActivityTypes, DistanceUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '../../../../shared/unit-aware-display';
import { presentSuuntoSwimmingScreens } from './suunto-swimming-presentation';
import { defaultSuuntoSwimmingGuideSettings, normalizeSuuntoSwimmingGuideSettings } from '../../../../shared/suunto-swimming-guide-settings';
import { serializeSuuntoSwimmingGuideV14, serializeSuuntoGuideV11ForRecovery, type SuuntoGuideFieldsStepV1 } from './suunto-guide.serializer';
import type { WorkoutStepV1, WorkoutStructureV1 } from '../../../../shared/planned-workout';
const work: WorkoutStepV1 = { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'distance', meters: 100 }, targets: [] };
const rest: WorkoutStepV1 = { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 }, targets: [] };
const options = { name: 'Swimming', owner: 'Fixture', url: 'https://example.test', localDate: '2026-10-20', sourceWorkoutId: 'fixture', allowDegraded: true };
const recipe = (sport = ActivityTypes.Swimming): WorkoutStructureV1 => ({ version: 1, sport,
  nodes: [{ kind: 'repeat', id: 'sets', count: 10, steps: [work, rest] }] });
const screens = (structure = recipe(), settings = defaultSuuntoSwimmingGuideSettings()) =>
  serializeSuuntoSwimmingGuideV14(structure, options, settings).artifact.steps as SuuntoGuideFieldsStepV1[];
describe('Suunto swimming display only', () => {
  it('gives Rest a dedicated actual planned-interval counter and explicitly planned previous/next distance', () => {
    const output = screens();
    expect(output[1].title).toBe('Rest');
    expect(output[1].fields[0]).toEqual({ type: 'stepDurationCountdown', title: 'Rest rem', value: 15 });
    expect(output[1].fields).toContainEqual({ type: 'text', value: 'Interval 1/10' });
    expect(output[1].fields.some(field => field.type === 'text' && field.value.startsWith('Prev plan:'))).toBe(true);
    expect(output[1].fields.some(field => field.type === 'text' && field.value.startsWith('Next plan:'))).toBe(true);
    expect(output.at(-2)!.fields).toContainEqual({ type: 'text', value: 'Interval 10/10' });
    expect(output.at(-2)!.fields.some(field => field.type === 'text' && field.value.startsWith('Next plan:'))).toBe(false);
    expect(output.filter(screen => screen.title === 'Rest').every(screen => !screen.fields.some(field => 'aggregate' in field))).toBe(true);
  });
  it('numbers flat pyramid intervals without parsing titles or treating pool lengths as intervals', () => {
    const structure: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Swimming,
      nodes: [50, 100, 200].flatMap((meters, i) => [{ ...work, id: `work-${i}`, ending: { kind: 'distance' as const, meters } }, { ...rest, id: `rest-${i}` }]) };
    const output = screens(structure);
    expect(output[3].fields).toContainEqual({ type: 'text', value: 'Interval 2/3' });
    expect(output[3].fields.some(field => field.type === 'text' && field.value.includes('100'))).toBe(true);
    expect(output[3].fields.some(field => field.type === 'text' && field.value.includes('200'))).toBe(true);
  });
  it('does not invent a distance for a manual prescription', () => {
    const input = recipe(); input.nodes[0] = { kind: 'repeat', id: 'sets', count: 10, steps: [{ ...work, ending: { kind: 'manual' } }, rest] };
    const output = screens(input);
    expect(output[1].fields.filter(field => field.type === 'text')).toEqual([{ type: 'text', value: 'Interval 1/10' }]);
    expect(output[0].fields).toContainEqual({ type: 'distance', title: 'Swum', window: 'step' });
  });
  it('supports documented stroke COUNT independently from stroke RATE and omits pool SWOLF in open water', () => {
    const prefs = { ...defaultSuuntoSwimmingGuideSettings(), workFields: ['strokes', 'strokeRate', 'swolf'] as const };
    const output = screens(recipe(), { ...prefs, workFields: [...prefs.workFields] });
    expect(output[0].fields).toContainEqual({ type: 'strokes', title: 'Strokes', window: 'manualLap' });
    expect(output[0].fields).toContainEqual({ type: 'strokeRate', title: 'Avg strk', window: 'manualLap', aggregate: 'average' });
    expect(screens(recipe(ActivityTypes.OpenWaterSwimming), { ...prefs, workFields: [...prefs.workFields] })[0].fields.some(field => field.type === 'swolf')).toBe(false);
  });
  it('keeps the execution and recorded-lap graph identical, including both early-Lap paths', () => {
    const input = recipe(); (input.nodes[0] as { steps: WorkoutStepV1[] }).steps[0] = { ...work, ending: { kind: 'distance', meters: 100, allowEarlyLap: true } };
    const output = screens(input); const frozen = serializeSuuntoGuideV11ForRecovery(input, options).artifact.steps as SuuntoGuideFieldsStepV1[];
    const execution = (rows: SuuntoGuideFieldsStepV1[]) => rows.map(({ id, transitions, createManualLap }) => ({ id, transitions, createManualLap }));
    expect(execution(output)).toEqual(execution(frozen));
    expect(output.filter(row => row.title === 'Work').map(row => row.notification)).toEqual(frozen.filter(row => row.title === 'Work').map(row => row.notification));
  });
  it('avoids generated popups overlapping short rests without removing authored, manual or long-rest alerts', () => {
    expect(screens()[1].notification).toBeUndefined();
    for (const step of [{ ...rest, note: 'Check breathing' }, { ...rest, ending: { kind: 'manual' as const } },
      { ...rest, ending: { kind: 'time' as const, seconds: 21 } }]) {
      const input: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Swimming, nodes: [work, step] };
      expect(screens(input)[1].notification).toEqual((serializeSuuntoGuideV11ForRecovery(input, options).artifact.steps[1] as SuuntoGuideFieldsStepV1).notification);
    }
    expect(screens().at(-1)!.notification).toEqual({ title: 'Complete', text: 'Guide complete' });
  });
  it('normalizes malformed/unbounded preferences without accepting arbitrary resources or format fields', () => {
    for (const value of [null, { version: 1, workFields: ['resource'], restFields: [] }, { version: 1, workFields: Array(1), restFields: [] },
      { version: 1, workFields: Array(10_000).fill('pace'), restFields: [] },
      { ...defaultSuuntoSwimmingGuideSettings(), windowIndex: -1 }]) expect(normalizeSuuntoSwimmingGuideSettings(value)).toEqual(defaultSuuntoSwimmingGuideSettings());
  });
  it('reserves authored targets and notes, pairs HR with its target and never invents untargeted target fields', () => {
    const input: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Swimming, nodes: [work, { ...rest,
      note: 'Stay relaxed', targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 80, maximumBpm: 120 },
        { kind: 'speed', mode: 'absolute', presentation: 'pace', minimumMetersPerSecond: 1, maximumMetersPerSecond: 2 }] }] };
    const fields = screens(input)[1].fields;
    expect(fields).toHaveLength(5);
    expect(fields.map(field => field.type)).toEqual(['stepDurationCountdown', 'heartRate', 'targetHeartRate', 'targetPace', 'text']);
    expect(fields.at(-1)).toEqual({ type: 'text', value: 'Stay relaxed' });
    expect(screens().every(screen => !screen.fields.some(field => field.type.startsWith('target')))).toBe(true);
  });
  it('shows both measured interval distance and clearly separate workout totals if selected', () => {
    const input = recipe(); (input.nodes[0] as { steps: WorkoutStepV1[] }).steps[0] = { ...work, ending: { kind: 'manual' } };
    const fields = screens(input, { version: 1, workFields: ['distance', 'workoutDistance'], restFields: ['workoutStrokes'] })[0].fields;
    expect(fields).toContainEqual({ type: 'distance', title: 'Swum', window: 'step' });
    expect(fields).toContainEqual({ type: 'distance', title: 'Total', window: 'workout' });
    expect(screens(input, { version: 1, workFields: [], restFields: ['workoutStrokes'] })[1].fields)
      .toContainEqual({ type: 'strokes', title: 'Tot strk', window: 'workout' });
  });
  it('uses only current target counterparts on Rest, never a newly reset lap average labelled as completed effort', () => {
    const input: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Swimming, nodes: [work, { ...rest,
      targets: [{ kind: 'speed', mode: 'absolute', presentation: 'pace', minimumMetersPerSecond: 1, maximumMetersPerSecond: 2 }] }] };
    expect(screens(input)[1].fields.slice(0, 3).map(field => field.type)).toEqual(['stepDurationCountdown', 'pace', 'targetPace']);
    expect(screens(input)[1].fields[1]).toEqual({ type: 'pace', title: 'Pace' });
    expect(screens(input)[1].fields.some(field => 'aggregate' in field || 'window' in field && field.window === 'manualLap')).toBe(false);
  });
  it('uses Sports Lib owner units for planned text without modifying native meters or live pace', () => {
    const input: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.OpenWaterSwimming, nodes: [
      { ...work, ending: { kind: 'distance', meters: 1609.344 } }, rest] };
    const output = serializeSuuntoSwimmingGuideV14(input, options, undefined,
      normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles })).artifact.steps as SuuntoGuideFieldsStepV1[];
    expect(output[0].fields[0]).toEqual({ type: 'stepDistanceCountdown', title: 'Dist rem', value: 1609.344 });
    expect(output[1].fields).toContainEqual({ type: 'text', value: 'Prev plan: 1.00 mi' });
    expect(output[0].fields.find(field => field.type === 'pace')).toEqual({ type: 'pace', title: 'Avg pace', window: 'manualLap', aggregate: 'average' });
  });
  it('leaves active Recovery, warm-up and cool-down untouched and numbers only actual Work occurrences', () => {
    const input: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Swimming, nodes: [
      { ...work, id: 'warm', purpose: 'warmup' }, { ...rest, id: 'before' },
      { kind: 'repeat', id: 'sets', count: 2, steps: [work, { ...work, id: 'recovery', purpose: 'recovery' }, { ...work, id: 'second' }, rest] },
      { ...work, id: 'cool', purpose: 'cooldown' }] };
    const output = screens(input); const frozen = serializeSuuntoGuideV11ForRecovery(input, options).artifact.steps;
    expect(output[0]).toEqual(frozen[0]); expect(output.at(-2)).toEqual(frozen.at(-2));
    expect(output.filter(screen => screen.title === 'Recovery').map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id'))))
      .toEqual(Array(2).fill((frozen[2] as { steps: SuuntoGuideFieldsStepV1[] }).steps[1]));
    expect(output[1].fields.filter(field => field.type === 'text')).toEqual([{ type: 'text', value: 'Next plan: 100.0 m' }]);
    expect(output[5].fields).toContainEqual({ type: 'text', value: 'Interval 2/4' });
    expect(output[9].fields).toContainEqual({ type: 'text', value: 'Interval 4/4' });
  });
  it('falls back to a bounded native repeat without guessing counters/context, and preserves frozen steps at the JSON limit', () => {
    const input: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Swimming, nodes: [
      { kind: 'repeat', id: 'large', count: 100, steps: Array.from({ length: 12 }, (_, index) => ({ ...(index % 2 ? rest : work), id: `step-${index}` })) }] };
    const frozen = serializeSuuntoGuideV11ForRecovery(input, options).artifact.steps;
    const output = presentSuuntoSwimmingScreens(input, frozen, undefined, undefined, () => 1000);
    expect(output[0].type).toBe('repeat');
    if (output[0].type !== 'repeat') throw new Error('Expected compact repeat');
    expect(output[0].steps[1].fields[0]).toEqual({ type: 'stepDurationCountdown', title: 'Rest rem', value: 15 });
    expect(JSON.stringify(output)).not.toContain('Interval '); expect(JSON.stringify(output)).not.toContain('Prev plan');
    expect(presentSuuntoSwimmingScreens(input, frozen, undefined, undefined, () => 256 * 1024 + 1)).toBe(frozen);
    const bounded = presentSuuntoSwimmingScreens(recipe(), serializeSuuntoGuideV11ForRecovery(recipe(), options).artifact.steps,
      undefined, undefined, candidate => {
        if (candidate[0].type !== 'repeat') return 256 * 1024 + 1;
        expect(candidate[0].steps[0].notification).toHaveProperty('type', 'default');
        return 1000;
      });
    expect(bounded[0].type).toBe('repeat');
  });
  it.each([{ fields: [] }, { fields: ['strokes'] }] as const)('keeps automatic laps when the selected Work fields contain no average ($fields)', ({ fields }) => {
    const output = screens(recipe(), { version: 1, workFields: [...fields], restFields: [] });
    const original = screens();
    expect(output.map(({ id, transitions, createManualLap }) => ({ id, transitions, createManualLap })))
      .toEqual(original.map(({ id, transitions, createManualLap }) => ({ id, transitions, createManualLap })));
    expect(output.every(screen => !screen.fields.some(field => 'aggregate' in field))).toBe(true);
  });
});
