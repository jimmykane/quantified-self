import { createHash } from 'node:crypto';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import type { WorkoutStepV1, WorkoutStructureV1 } from '../../../../shared/planned-workout';
import { serializeSuuntoGuideJsonV1, serializeSuuntoGuideV11ForRecovery,
  type SuuntoGuideFieldsStepV1, type SuuntoGuideStepV1 } from './suunto-guide.serializer';
import { hasSuuntoRestPresentation, presentSuuntoRestScreens } from './suunto-rest-presentation';

const options = { name: 'Rest UX', owner: 'Quantified Self', url: 'https://quantified-self.io/training/plans',
  localDate: '2026-10-08', sourceWorkoutId: 'rest-ux', allowDegraded: false };
const work: WorkoutStepV1 = { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'manual' }, targets: [] };
const rest: WorkoutStepV1 = { ...work, id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 } };
const hr = { kind: 'heart-rate', mode: 'absolute', minimumBpm: 80, maximumBpm: 120 } as const;
const pace = { kind: 'speed', mode: 'absolute', presentation: 'pace', minimumMetersPerSecond: 1, maximumMetersPerSecond: 2 } as const;
const power = { kind: 'power', mode: 'absolute', minimumWatts: 50, maximumWatts: 100 } as const;
const recipe = (sport: ActivityTypes, nodes: WorkoutStructureV1['nodes'] = [
  { kind: 'repeat', id: 'sets', count: 3, steps: [work, rest] },
]): WorkoutStructureV1 => ({ version: 1, sport, nodes });
const expanded = (steps: SuuntoGuideStepV1[]): SuuntoGuideFieldsStepV1[] => steps.flatMap(node => node.type === 'repeat'
  ? Array.from({ length: node.times }, () => node.steps).flat() : [node]);
const execution = (steps: SuuntoGuideStepV1[]) => expanded(steps).map(screen => ({
  condition: screen.transitions?.map(transition => transition.condition), lap: screen.createManualLap ?? false,
  text: screen.notification?.text,
}));

describe.each([ActivityTypes.Running, ActivityTypes.TrailRunning, ActivityTypes.Treadmill, ActivityTypes.Cycling,
  ActivityTypes.MountainBiking, ActivityTypes.IndoorCycling, ActivityTypes.EBiking, ActivityTypes.Handcycle,
  ActivityTypes.Walking, ActivityTypes.Hiking, ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming])('Rest UX: %s', sport => {
  it('leads with countdown, numbers actual Work/Rest pairs and previews the next phase without guessing distance', () => {
    const input = recipe(sport); const before = structuredClone(input);
    const current = serializeSuuntoGuideJsonV1(input, options);
    const old = serializeSuuntoGuideV11ForRecovery(input, options);
    const screens = expanded(current.artifact.steps);
    expect(screens.map(screen => screen.title)).toEqual(['Work 1/3', 'Rest 1/3', 'Work 2/3', 'Rest 2/3', 'Work 3/3', 'Rest 3/3', 'Complete']);
    expect(new Set(screens.map(screen => screen.id)).size).toBe(screens.length);
    expect(screens[1].fields[0]).toEqual({ type: 'stepDurationCountdown', value: 15, title: 'Rest rem' });
    expect(screens[1].fields).toContainEqual({ type: 'text', value: 'Next: Work 2/3' });
    expect(screens[5].fields.some(field => field.type === 'text')).toBe(false);
    expect(screens.filter(screen => screen.title.startsWith('Rest')).every(screen =>
      !screen.fields.some(field => 'aggregate' in field))).toBe(true);
    for (let index = 0; index < 3; index++) expect(screens[index * 2].fields).toEqual(expanded(old.artifact.steps)[index * 2].fields);
    expect(execution(current.artifact.steps)).toEqual(execution(old.artifact.steps));
    expect(current.level).toBe(old.level); expect(current.issues).toEqual(old.issues);
    expect(input).toEqual(before);
    for (const screen of screens) {
      expect(screen.fields.length).toBeLessThanOrEqual(5);
      expect(Array.from(screen.title).length).toBeLessThanOrEqual(13);
    }
    expect(JSON.stringify(current)).not.toMatch(/previousLap|windowIndex|100m/);
  });
  it.each([false, true])('preserves the frozen early-Lap execution graph (enabled=%s)', early => {
    const input = recipe(sport, [{ kind: 'repeat', id: 'sets', count: 3, steps: [
      { ...work, ending: { kind: 'time', seconds: 90, allowEarlyLap: early } },
      { ...rest, ending: { kind: 'time', seconds: 15, allowEarlyLap: early } },
    ] }, { ...work, id: 'cooldown', purpose: 'cooldown', ending: { kind: 'manual' } }]);
    const current = serializeSuuntoGuideJsonV1(input, options).artifact;
    const old = serializeSuuntoGuideV11ForRecovery(input, options).artifact;
    expect(execution(current.steps)).toEqual(execution(old.steps));
    if (early) expect(current.steps.map(node => node.type === 'fields' ? { id: node.id, transitions: node.transitions, lap: node.createManualLap } : node))
      .toEqual(old.steps.map(node => node.type === 'fields' ? { id: node.id, transitions: node.transitions, lap: node.createManualLap } : node));
    const finalRest = expanded(current.steps).filter(screen => screen.title === 'Rest 3/3');
    for (const screen of finalRest) expect(screen.fields).toContainEqual({ type: 'text', value: 'Next: Cool down' });
  });
  it('does not reinterpret active Recovery as Rest or change its targets/readings', () => {
    const input = recipe(sport, [{ ...rest, purpose: 'recovery', targets: [pace] }, { ...rest, id: 'pause' }]);
    const current = expanded(serializeSuuntoGuideJsonV1(input, options).artifact.steps);
    const old = expanded(serializeSuuntoGuideV11ForRecovery(input, options).artifact.steps);
    expect(current[0]).toEqual(old[0]);
    expect(current[0].fields[0]).toMatchObject({ type: 'pace', window: 'manualLap', aggregate: 'average' });
  });
  it('keeps both Work targets, instructions and early-Lap branch readings unchanged inside numbered sets', () => {
    const input = recipe(sport, [{ kind: 'repeat', id: 'sets', count: 3, steps: [
      { ...work, ending: { kind: 'time', seconds: 60.5, allowEarlyLap: true }, targets: [hr, pace], note: 'Fast but smooth' }, rest,
    ] }]);
    const current = expanded(serializeSuuntoGuideJsonV1(input, options).artifact.steps).filter(screen => screen.title.startsWith('Work'));
    const old = expanded(serializeSuuntoGuideV11ForRecovery(input, options).artifact.steps).filter(screen => screen.title === 'Work');
    expect(current.map(screen => ({ fields: screen.fields, text: screen.notification?.text, transitions: screen.transitions })))
      .toEqual(old.map(screen => ({ fields: screen.fields, text: screen.notification?.text, transitions: screen.transitions })));
  });
  const cases = ([{ kind: 'manual' }, { kind: 'time', seconds: 15.5 }, { kind: 'distance', meters: 100 }] as const)
    .flatMap(ending => ([[], [hr], [pace], [hr, pace], [pace, hr]] as WorkoutStepV1['targets'][])
      .flatMap(targets => [undefined, 'Easy breathing', 'A'.repeat(40)].map(note => ({ ending, targets, note }))));
  it.each(cases)('preserves authored fields before optional context: $ending $targets $note', changes => {
    const input = recipe(sport, [{ ...rest, ...changes }, { ...work, id: 'next' }]);
    const current = expanded(serializeSuuntoGuideJsonV1(input, options).artifact.steps)[0];
    const old = expanded(serializeSuuntoGuideV11ForRecovery(input, options).artifact.steps)[0];
    expect(current.fields.filter(field => field.type.startsWith('target'))).toEqual(old.fields.filter(field => field.type.startsWith('target')));
    expect(current.fields.filter(field => field.type === 'text' && field.value !== 'Next: Work')).toEqual(old.fields.filter(field => field.type === 'text'));
    expect(current.transitions).toEqual(old.transitions); expect(current.createManualLap).toBe(old.createManualLap);
    expect(current.notification).toEqual(old.notification);
    expect(current.fields.length).toBeLessThanOrEqual(5);
    if (changes.ending.kind !== 'manual') expect(current.fields[0]).toMatchObject({ value: changes.ending.kind === 'time' ? 15.5 : 100 });
    expect(current.fields.some(field => 'aggregate' in field)).toBe(false);
    for (const field of current.fields) if ('title' in field) expect(Array.from(field.title).length).toBeLessThan(9);
  });
  it('keeps a long manual Rest instruction text-only and on its previous digest when no numbering changes', () => {
    const input = recipe(sport, [{ ...rest, ending: { kind: 'manual' }, note: 'A'.repeat(54) }]);
    expect(hasSuuntoRestPresentation(input)).toBe(false);
    expect(serializeSuuntoGuideJsonV1(input, options)).toEqual(serializeSuuntoGuideV11ForRecovery(input, options));
  });
});

it('keeps cycling Rest target counterparts current, but active Recovery power averaged', () => {
  const input = recipe(ActivityTypes.Cycling, [{ ...rest, targets: [power, hr] },
    { ...rest, id: 'spin', purpose: 'recovery', targets: [power] }]);
  const screens = expanded(serializeSuuntoGuideJsonV1(input, options).artifact.steps);
  expect(screens[0].fields).toEqual([{ type: 'stepDurationCountdown', value: 15, title: 'Rest rem' },
    { type: 'targetPower', min: 50, max: 100, title: 'Tgt W' },
    { type: 'targetHeartRate', min: 80, max: 120, title: 'Tgt HR' },
    { type: 'power', title: 'Power' }, { type: 'heartRate', title: 'HR' }]);
  expect(screens[1].fields[0]).toMatchObject({ type: 'power', window: 'manualLap', aggregate: 'average' });
});
it.each([ActivityTypes.Walking, ActivityTypes.Hiking, ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming])(
  'preserves %s power/cadence targets without inventing unsupported measured counterparts', sport => {
  const input = recipe(sport, [{ ...rest, targets: [power, { kind: 'cadence', mode: 'absolute', minimumRpm: 20, maximumRpm: 40 }] }]);
  const screens = expanded(serializeSuuntoGuideJsonV1(input, options).artifact.steps);
  expect(screens[0].fields.filter(field => field.type.startsWith('target'))).toHaveLength(2);
  expect(screens[0].fields.some(field => field.type === 'power' || field.type === 'cadence')).toBe(false);
  expect(screens[0].fields).toContainEqual({ type: 'heartRate', title: 'HR' });
});
it.each([ActivityTypes.Rowing, ActivityTypes.IndoorRowing, ActivityTypes.StrengthTraining])('leaves out-of-scope %s artifacts byte-identical', sport => {
  expect(serializeSuuntoGuideJsonV1(recipe(sport), options)).toEqual(serializeSuuntoGuideV11ForRecovery(recipe(sport), options));
});
it('keeps simple pairs up to 100 passes clearly labelled and within the notification title limit', () => {
  const input = recipe(ActivityTypes.Running, [{ kind: 'repeat', id: 'sets', count: 100, steps: [work, rest] }]);
  const screens = expanded(serializeSuuntoGuideJsonV1(input, options).artifact.steps);
  expect(screens.at(-2)?.title).toBe('Rest 100/100');
  expect(screens.every(screen => Array.from(screen.notification!.title).length <= 13)).toBe(true);
});
it('does not number complex sets as if a pass were a single completed interval', () => {
  const input = recipe(ActivityTypes.Running, [{ kind: 'repeat', id: 'sets', count: 3,
    steps: [work, rest, { ...work, id: 'second' }] }]);
  const screens = expanded(serializeSuuntoGuideJsonV1(input, options).artifact.steps);
  expect(screens.filter(screen => screen.title === 'Rest')).toHaveLength(3);
  expect(screens.every(screen => !screen.title.includes('/'))).toBe(true);
});
it('keeps oversized compact repeats sendable without speculative numbering or changing their execution', () => {
  const input = recipe(ActivityTypes.Running, Array.from({ length: 6 }, (_, index) => ({ kind: 'repeat', id: `sets-${index}`, count: 100,
    steps: [{ ...work, id: `work-${index}` }, { ...rest, id: `rest-${index}` }] })));
  const current = serializeSuuntoGuideJsonV1(input, options).artifact;
  const old = serializeSuuntoGuideV11ForRecovery(input, options).artifact;
  expect(current.steps.some(node => node.type === 'repeat')).toBe(true);
  expect(current.steps.length).toBe(old.steps.length);
  expect(execution(current.steps)).toEqual(execution(old.steps));
  for (const screen of expanded(current.steps).filter(screen => screen.title === 'Rest')) expect(screen.fields[0]).toMatchObject({ type: 'stepDurationCountdown' });
});
it('falls back before exceeding the real archive JSON readback budget, not just the screen count', () => {
  const input = recipe(ActivityTypes.Running, [{ kind: 'repeat', id: 'sets', count: 80, steps: Array.from({ length: 10 }, (_, index) => ({
    ...rest, id: `rest-${index}`, targets: [hr, pace], note: 'A'.repeat(40),
  })) }]);
  const current = serializeSuuntoGuideJsonV1(input, options).artifact;
  expect(current.steps.some(node => node.type === 'repeat')).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(current))).toBeLessThanOrEqual(256 * 1024);
  expect(execution(current.steps)).toEqual(execution(serializeSuuntoGuideV11ForRecovery(input, options).artifact.steps));
});
it('does not mutate frozen source screens when numbering is unavailable', () => {
  const input = recipe(ActivityTypes.Running); const old = serializeSuuntoGuideV11ForRecovery(input, options).artifact;
  const before = structuredClone(old);
  expect(presentSuuntoRestScreens(input, old.steps, () => 256 * 1024 + 1).some(node => node.type === 'repeat')).toBe(true);
  expect(old).toEqual(before);
});
it('reserves default-notification enrichment before choosing the numbered layout', () => {
  const input = recipe(ActivityTypes.Running); const old = serializeSuuntoGuideV11ForRecovery(input, options).artifact;
  const output = presentSuuntoRestScreens(input, old.steps, steps => JSON.stringify(steps).includes('"type":"default"') ? 256 * 1024 + 1 : 1);
  expect(output.some(node => node.type === 'repeat')).toBe(true);
});
it('describes a following Other phase without the ambiguous Next: Next wording', () => {
  const input = recipe(ActivityTypes.Running, [rest, { ...work, id: 'other', purpose: 'other' }]);
  const screen = expanded(serializeSuuntoGuideJsonV1(input, options).artifact.steps)[0];
  expect(screen.fields).toContainEqual({ type: 'text', value: 'Next: Interval' });
});
it('freezes a full v11 rest artifact for uncertain historical recovery', () => {
  const old = serializeSuuntoGuideV11ForRecovery(recipe(ActivityTypes.Running), options).artifact;
  const digest = createHash('sha256').update(JSON.stringify(old)).digest('hex');
  expect(digest).toBe('d7398cbff039263078279ad4bdb987a6fb887f0fc2ae61898f6e554b879f41ad');
  expect(serializeSuuntoGuideV11ForRecovery(recipe(ActivityTypes.Running), options).artifact).toEqual(old);
});
