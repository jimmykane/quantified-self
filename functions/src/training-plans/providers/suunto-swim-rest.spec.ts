import { createHash } from 'node:crypto';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import type { WorkoutStepV1, WorkoutStructureV1 } from '../../../../shared/planned-workout';
import { serializeSuuntoGuideJsonV1, serializeSuuntoGuideV7ForRecovery, serializeSuuntoGuideV9ForRecovery,
  type SuuntoGuideFieldsStepV1, type SuuntoGuideStepV1 } from './suunto-guide.serializer';

const options = { name: 'Pool screens', owner: 'Quantified Self', url: 'https://quantified-self.io/training/plans',
  localDate: '2026-10-08', sourceWorkoutId: 'pool-screens', allowDegraded: false };
const work: WorkoutStepV1 = { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'manual' }, targets: [] };
const rest: WorkoutStepV1 = { ...work, id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 } };
const structure = (sport: ActivityTypes): WorkoutStructureV1 => ({ version: 1, sport,
  nodes: [{ kind: 'repeat', id: 'sets', count: 3, steps: [work, rest] }] });
const screens = (steps: SuuntoGuideStepV1[]): SuuntoGuideFieldsStepV1[] => steps.flatMap(step =>
  step.type === 'repeat' ? step.steps : [step]);
const boundaries = (steps: SuuntoGuideStepV1[]): unknown[] => steps.map(step => step.type === 'repeat'
  ? { ...step, steps: boundaries(step.steps) } : Object.fromEntries(Object.entries(step).filter(([key]) => !['fields', 'notification'].includes(key))));

it('freezes the historical v9 payload before changing swim presentation', () => {
  expect(createHash('sha256').update(JSON.stringify(serializeSuuntoGuideV9ForRecovery(structure(ActivityTypes.Swimming), options).artifact)).digest('hex'))
    .toBe('2ef79e4d6cb4599712eaf1072c42593622fa62f529f864292590ddaf3bdae197');
});

describe.each([ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming])('swim Rest presentation: %s', sport => {
  it('explains that Lap finishes the current swim and keeps the 15-second Rest notifications', () => {
    const result = serializeSuuntoGuideJsonV1(structure(sport), options);
    const fields = screens(result.artifact.steps);
    for (const step of fields.filter(step => step.title === 'Work')) {
      expect(step.notification).toEqual({ title: 'Work', text: 'Swim now. Press Lap to finish this interval.' });
      expect(step.transitions).toEqual([{ condition: { type: 'manualLap' } }]);
    }
    for (const step of fields.filter(step => step.title === 'Rest')) {
      expect(step.notification).toEqual({ title: 'Rest', text: 'Rest for 15s' });
      expect(step.fields).toContainEqual({ type: 'distance', title: 'Total', window: 'workout' });
      expect(step.fields.some(field => 'aggregate' in field)).toBe(false);
      expect(step.transitions).toEqual([{ condition: { type: 'stepDuration', value: 15 } }]);
    }
    expect(result.level).toBe('exact');
  });
  it('uses separate, unambiguous wording for manual Rest', () => {
    const result = serializeSuuntoGuideJsonV1({ version: 1, sport, nodes: [{ ...rest, ending: { kind: 'manual' } }] }, options);
    expect(result.artifact.steps[0]).toMatchObject({ notification: {
      title: 'Rest', text: 'Rest now. Press Lap to finish this rest.',
    } });
  });
  it('preserves authored notes over generated notifications', () => {
    for (const step of [work, rest]) {
      const result = serializeSuuntoGuideJsonV1({ version: 1, sport, nodes: [{ ...step, note: 'Freestyle, easy turns' }] }, options);
      expect(result.artifact.steps[0]).toMatchObject({ notification: { text: 'Freestyle, easy turns' } });
    }
  });
  it('keeps active recovery readings rather than treating recovery as stationary Rest', () => {
    const input: WorkoutStructureV1 = { version: 1, sport, nodes: [{ ...work, purpose: 'recovery' }] };
    const step = serializeSuuntoGuideJsonV1(input, options).artifact.steps[0] as SuuntoGuideFieldsStepV1;
    expect(step.fields.some(field => 'aggregate' in field)).toBe(true);
    expect(step.fields).not.toContainEqual({ type: 'distance', title: 'Total', window: 'workout' });
    if (sport === ActivityTypes.OpenWaterSwimming) {
      expect(step.fields).toEqual((serializeSuuntoGuideV7ForRecovery(input, options).artifact.steps[0] as SuuntoGuideFieldsStepV1).fields);
    }
  });
  const hr = { kind: 'heart-rate', mode: 'absolute', minimumBpm: 80, maximumBpm: 120 } as const;
  const pace = { kind: 'speed', mode: 'absolute', presentation: 'pace', minimumMetersPerSecond: 1, maximumMetersPerSecond: 1.2 } as const;
  const cases = ([{ kind: 'manual' }, { kind: 'time', seconds: 15 }, { kind: 'distance', meters: 100 }] as const)
    .flatMap(ending => ([[], [hr], [pace], [hr, pace], [pace, hr]] as WorkoutStepV1['targets'][])
      .flatMap(targets => [undefined, 'Easy breathing', 'A'.repeat(40)].map(note => ({ ending, targets, note }))));
  it.each(cases)('reserves the ending, target ranges and notes before optional Total: $ending $targets $note', changes => {
    const input: WorkoutStructureV1 = { version: 1, sport, nodes: [{ ...rest, ...changes }] };
    const before = structuredClone(input);
    const result = serializeSuuntoGuideJsonV1(input, options);
    const step = result.artifact.steps[0] as SuuntoGuideFieldsStepV1;
    const old = serializeSuuntoGuideV7ForRecovery(input, options).artifact.steps[0] as SuuntoGuideFieldsStepV1;
    expect(step.fields.filter(field => field.type.startsWith('target'))).toEqual(old.fields.filter(field => field.type.startsWith('target')));
    expect(step.fields.filter(field => field.type.endsWith('Countdown'))).toEqual(old.fields.filter(field => field.type.endsWith('Countdown'))
      .map(field => ({ ...field, title: sport === ActivityTypes.Swimming ? changes.ending.kind === 'time' ? 'Time rem' : 'Dist rem' : 'Remain' })));
    expect(step.fields.filter(field => field.type === 'text')).toEqual(changes.note ? [{ type: 'text', value: changes.note }] : []);
    expect(step.fields.length).toBeLessThanOrEqual(5);
    expect(step.fields.some(field => 'aggregate' in field)).toBe(false);
    for (const field of step.fields) if ('title' in field) expect(Array.from(field.title).length).toBeLessThan(9);
    const available = 5 - changes.targets.length - (changes.note ? 1 : 0) - (changes.ending.kind === 'manual' ? 0 : 1);
    expect(step.fields.some(field => field.type === 'distance')).toBe(available >= 2);
    expect(result.level).toBe('exact');
    expect(input).toEqual(before);
  });
  it('leaves long manual instructions text-only without shortening them for Total', () => {
    const note = 'A'.repeat(54);
    const step = serializeSuuntoGuideJsonV1({ version: 1, sport, nodes: [{ ...rest, ending: { kind: 'manual' }, note }] }, options)
      .artifact.steps[0] as SuuntoGuideFieldsStepV1;
    expect(step.fields).toEqual([{ type: 'text', value: note }]);
    expect(step.notification?.text).toBe(note);
  });
  it.each([false, true])('keeps all repeat, final and early-Lap boundaries and requests every start notification (early=%s)', early => {
    const input: WorkoutStructureV1 = { version: 1, sport, nodes: [
      { ...work, id: 'first', ending: { kind: 'time', seconds: 30, allowEarlyLap: early } },
      { kind: 'repeat', id: 'sets', count: 10, steps: [work, { ...rest, ending: { kind: 'time', seconds: 15, allowEarlyLap: early } }] },
      { ...rest, id: 'last', ending: { kind: 'manual' } },
    ] };
    const current = serializeSuuntoGuideJsonV1(input, options).artifact;
    const old = (sport === ActivityTypes.Swimming ? serializeSuuntoGuideV9ForRecovery : serializeSuuntoGuideV7ForRecovery)(input, options).artifact;
    expect(boundaries(current.steps)).toEqual(boundaries(old.steps));
    for (const step of screens(current.steps)) {
      expect(step.notification).toMatchObject({ title: step.title, text: expect.any(String) });
      expect(Array.from(step.notification!.text).length).toBeLessThanOrEqual(54);
    }
    expect(screens(current.steps).at(-1)).toMatchObject({ title: 'Complete', notification: { title: 'Complete', text: 'Guide complete' } });
  });
  it.each([false, true])('preserves historical Lap boundaries even in an all-Rest Guide (early=%s)', early => {
    const input: WorkoutStructureV1 = { version: 1, sport, nodes: [
      { ...rest, id: 'manual', ending: { kind: 'manual' } },
      { kind: 'repeat', id: 'rests', count: 10, steps: [
        { ...rest, id: 'timed', ending: { kind: 'time', seconds: 15, allowEarlyLap: early } },
        { ...rest, id: 'distance', ending: { kind: 'distance', meters: 100, allowEarlyLap: early } },
      ] },
    ] };
    const current = serializeSuuntoGuideJsonV1(input, options).artifact;
    const old = (sport === ActivityTypes.Swimming ? serializeSuuntoGuideV9ForRecovery : serializeSuuntoGuideV7ForRecovery)(input, options).artifact;
    expect(boundaries(current.steps)).toEqual(boundaries(old.steps));
    for (const step of screens(current.steps).filter(step => step.title === 'Rest')) {
      expect(step.fields.some(field => 'aggregate' in field)).toBe(false);
      expect(step.fields).toContainEqual({ type: 'distance', title: 'Total', window: 'workout' });
    }
  });
});

it.each([ActivityTypes.Running, ActivityTypes.Cycling, ActivityTypes.StrengthTraining, ActivityTypes.Rowing, ActivityTypes.Walking])(
  'keeps non-swim manual/Rest payloads byte-equivalent to v7: %s', sport => {
    expect(serializeSuuntoGuideJsonV1(structure(sport), options)).toEqual(serializeSuuntoGuideV7ForRecovery(structure(sport), options));
  });
