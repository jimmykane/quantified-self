import { createHash } from 'node:crypto';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import type { WorkoutStructureV1, WorkoutStepV1, WorkoutEndingV1 } from '../../../../shared/planned-workout';
import { serializeSuuntoGuideJsonV1, serializeSuuntoGuideV7ForRecovery, type SuuntoGuideFieldsStepV1,
  type SuuntoGuideStepV1 } from './suunto-guide.serializer';

const options = { name: 'Pool screens', owner: 'Quantified Self', url: 'https://quantified-self.io/training/plans',
  localDate: '2026-10-08', sourceWorkoutId: 'pool-screens', allowDegraded: false };
const recipe: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Swimming, nodes: [
  { kind: 'repeat', id: 'sets', count: 3, steps: [
    { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'manual' }, targets: [] },
    { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 }, targets: [] },
  ] },
] };
const work = recipe.nodes[0].kind === 'repeat' ? recipe.nodes[0].steps[0] : recipe.nodes[0];
const hr = { kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 140 } as const;
const pace = { kind: 'speed', mode: 'absolute', presentation: 'pace', minimumMetersPerSecond: 1,
  maximumMetersPerSecond: 1.2 } as const;
const power = { kind: 'power', mode: 'absolute', minimumWatts: 100, maximumWatts: 150 } as const;
function screen(changes: Partial<WorkoutStepV1> = {}) {
  return serializeSuuntoGuideJsonV1({ version: 1, sport: ActivityTypes.Swimming,
    nodes: [{ ...work, ...changes }] }, options).artifact.steps[0] as SuuntoGuideFieldsStepV1;
}
function withoutFields(steps: SuuntoGuideStepV1[]): unknown[] {
  return steps.map(step => step.type === 'repeat' ? { ...step, steps: withoutFields(step.steps) }
    : Object.fromEntries(Object.entries(step).filter(([key]) => key !== 'fields')));
}

describe('pool-only Guide screens', () => {
  it('shows step progress on manual work without evicting useful swim readings', () => {
    const mapped = screen();
    expect(mapped.fields).toEqual([
      { type: 'pace', title: 'Avg pace', window: 'manualLap', aggregate: 'average' },
      { type: 'distance', title: 'Swum', window: 'step' },
      { type: 'duration', title: 'Elapsed', window: 'step' },
      { type: 'strokeRate', title: 'Avg strk', window: 'manualLap', aggregate: 'average' },
      { type: 'swolf', title: 'AvgSWOLF', window: 'manualLap', aggregate: 'average' },
    ]);
    expect(mapped.notification).toEqual({ title: 'Work', text: 'Press lap when ready' });
    expect(mapped.transitions).toEqual([{ condition: { type: 'manualLap' } }]);
  });
  it.each([
    [{ kind: 'time', seconds: 15.25 }, 'stepDurationCountdown', 'Time rem', 15.25],
    [{ kind: 'distance', meters: 100 }, 'stepDistanceCountdown', 'Dist rem', 100],
  ] satisfies Array<[WorkoutEndingV1, string, string, number]>)('labels the native remaining %s, not distance already swum', (ending, type, title, value) => {
    expect(screen({ ending }).fields[1]).toEqual({ type, title, value });
    expect(screen({ ending }).fields.some(field => field.type === 'distance' || field.type === 'duration')).toBe(false);
  });
  it.each([{ kind: 'manual' }, { kind: 'time', seconds: 15 }, { kind: 'distance', meters: 25 }] as const)(
    'shows HR and the actual rest ending, not newly reset swim averages: %s', ending => {
      const mapped = screen({ purpose: 'rest', ending });
      expect(mapped.fields[0]).toEqual({ type: 'heartRate', title: 'HR' });
      expect(mapped.fields.map(field => field.type)).toEqual(ending.kind === 'manual' ? ['heartRate']
        : ['heartRate', ending.kind === 'time' ? 'stepDurationCountdown' : 'stepDistanceCountdown']);
    });
  it('does not treat active recovery as stationary rest', () => {
    expect(screen({ purpose: 'recovery' }).fields).toEqual(screen().fields);
  });
  const cases = (['work', 'rest'] as const).flatMap(purpose =>
    ([{ kind: 'manual' }, { kind: 'time', seconds: 90.5 }, { kind: 'distance', meters: 100.25 }] as const).flatMap(ending =>
      ([[], [hr], [pace], [hr, pace], [pace, hr], [power, hr]] as WorkoutStepV1['targets'][]).flatMap(targets =>
        [undefined, 'Freestyle'].map(note => ({ purpose, ending, targets, note })))));
  it.each(cases)('preserves authored content and budget: $purpose $ending $targets $note', changes => {
    const input = { version: 1, sport: ActivityTypes.Swimming, nodes: [{ ...work, ...changes }] };
    const before = JSON.stringify(input);
    const result = serializeSuuntoGuideJsonV1(input, options);
    const current = result.artifact.steps[0] as SuuntoGuideFieldsStepV1;
    const old = serializeSuuntoGuideV7ForRecovery(input, options).artifact.steps[0] as SuuntoGuideFieldsStepV1;
    expect(current.fields.filter(field => field.type.startsWith('target')))
      .toEqual(old.fields.filter(field => field.type.startsWith('target')));
    expect(current.fields.filter(field => field.type === 'text')).toEqual(changes.note ? [{ type: 'text', value: changes.note }] : []);
    expect(current.fields.length).toBeLessThanOrEqual(5);
    expect(new Set(current.fields.map(field => field.type)).size).toBe(current.fields.length);
    expect(withoutFields(result.artifact.steps)).toEqual(withoutFields(serializeSuuntoGuideV7ForRecovery(input, options).artifact.steps));
    for (const field of current.fields) {
      if ('title' in field) expect(Array.from(field.title).length).toBeLessThan(9);
      if (field.type === 'distance' || field.type === 'duration') expect(field).toMatchObject({ window: 'step' });
      else if ('window' in field) expect(field).toMatchObject({ window: 'manualLap', aggregate: 'average' });
    }
    expect(result.level).toBe('exact');
    expect(JSON.stringify(input)).toBe(before);
  });
  it('prioritises both authored counterparts then manual progress before optional swim metrics', () => {
    expect(screen({ targets: [hr, pace], note: 'Freestyle' }).fields.map(field => field.type))
      .toEqual(['heartRate', 'targetHeartRate', 'targetPace', 'text', 'pace']);
    expect(screen({ targets: [hr], note: 'Freestyle' }).fields.map(field => field.type))
      .toEqual(['heartRate', 'targetHeartRate', 'text', 'distance', 'duration']);
  });
  it('keeps long manual instructions text-only and unshortened to add readings', () => {
    const note = 'A'.repeat(54);
    expect(screen({ note }).fields).toEqual([{ type: 'text', value: note }]);
    expect(screen({ note, purpose: 'rest' }).fields).toEqual([{ type: 'text', value: note }]);
  });
});

describe('pool screen delivery recovery', () => {
  it('uses a compact current SWOLF label without changing the historical label', () => {
    const current = screen().fields.find(field => field.type === 'swolf');
    const old = serializeSuuntoGuideV7ForRecovery({ version: 1, sport: ActivityTypes.Swimming,
      nodes: [work] }, options).artifact.steps[0] as SuuntoGuideFieldsStepV1;
    expect(current).toEqual({ type: 'swolf', title: 'AvgSWOLF', window: 'manualLap', aggregate: 'average' });
    expect(old.fields.find(field => field.type === 'swolf'))
      .toEqual({ type: 'swolf', title: 'Avg SWOLF', window: 'manualLap', aggregate: 'average' });
  });
  it('freezes the complete pre-layout v7 payload', () => {
    const artifact = serializeSuuntoGuideV7ForRecovery(recipe, options).artifact;
    expect(createHash('sha256').update(JSON.stringify(artifact)).digest('hex'))
      .toBe('683ae02428360c258d96485a0628ded6566efed3dd1206bde4f85be7ddd11370');
  });
  it.each([false, true])('keeps automatic/manual/repeated/early-Lap boundaries identical (early=%s)', early => {
    for (const restOnly of [false, true]) {
      const structure: WorkoutStructureV1 = { ...recipe, nodes: [
        { ...work, id: 'opening', purpose: restOnly ? 'rest' : 'warmup', ending: { kind: 'time', seconds: 30, allowEarlyLap: early } },
        { kind: 'repeat', id: 'sets', count: 100, steps: [
          { ...work, purpose: restOnly ? 'rest' : 'work', ending: { kind: 'distance', meters: 100, allowEarlyLap: early } },
          { ...work, id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 } },
          { ...work, id: 'manual', purpose: 'rest' },
        ] },
        { ...work, id: 'end', purpose: restOnly ? 'rest' : 'cooldown', ending: { kind: 'time', seconds: 30 } },
      ] };
      const current = serializeSuuntoGuideJsonV1(structure, options).artifact;
      const old = serializeSuuntoGuideV7ForRecovery(structure, options).artifact;
      expect(withoutFields(current.steps)).toEqual(withoutFields(old.steps));
      if (restOnly) {
        expect(JSON.stringify(current.steps)).not.toContain('"window":"manualLap"');
        expect(JSON.stringify(current.steps)).toContain('"createManualLap":true');
      }
    }
  });
});
