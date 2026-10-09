import { createHash } from 'node:crypto';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { WORKOUT_STEP_PURPOSES, type WorkoutStepV1, type WorkoutStructureV1 } from '../../../../shared/planned-workout';
import { serializeSuuntoGuideV11ForRecovery, serializeSuuntoGuideV7ForRecovery, serializeSuuntoGuideV10ForRecovery,
  type SuuntoGuideFieldsStepV1, type SuuntoGuideStepV1 } from './suunto-guide.serializer';

const options = { name: 'Manual instructions', owner: 'Quantified Self', url: 'https://quantified-self.io/training/plans',
  localDate: '2026-10-08', sourceWorkoutId: 'manual-instructions', allowDegraded: false };
const manual: WorkoutStepV1 = { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'manual' }, targets: [] };
const nonSwimSports = [ActivityTypes.Running, ActivityTypes.TrailRunning, ActivityTypes.Treadmill, ActivityTypes.Cycling,
  ActivityTypes.MountainBiking, ActivityTypes.IndoorCycling, ActivityTypes.EBiking, ActivityTypes.Handcycle,
  ActivityTypes.Walking, ActivityTypes.Hiking, ActivityTypes.Rowing, ActivityTypes.IndoorRowing, ActivityTypes.StrengthTraining];
const normalizeWording = (steps: SuuntoGuideStepV1[]): SuuntoGuideStepV1[] => steps.map(step => step.type === 'repeat'
  ? { ...step, steps: normalizeWording(step.steps) as SuuntoGuideFieldsStepV1[] }
  : { ...step, fields: step.fields.map(field => field.type === 'text' && field.value === 'Lap to finish'
    ? { ...field, value: 'Press lap' } : field), ...(step.notification?.text === 'Press Lap to finish this interval.'
      || step.notification?.text === 'Rest now. Press Lap to finish this rest.'
      ? { notification: { ...step.notification, text: 'Press lap when ready' } } : {}) });

describe.each(nonSwimSports)('frozen v11 manual instructions: %s', sport => {
  it.each(WORKOUT_STEP_PURPOSES)('explains that Lap finishes the active %s without changing readings or boundaries', purpose => {
    const recipe: WorkoutStructureV1 = { version: 1, sport, nodes: [{ ...manual, purpose }] };
    const before = structuredClone(recipe);
    const current = serializeSuuntoGuideV11ForRecovery(recipe, options);
    const old = serializeSuuntoGuideV7ForRecovery(recipe, options);
    const step = current.artifact.steps[0] as SuuntoGuideFieldsStepV1;
    expect(step.notification?.text).toBe(purpose === 'rest'
      ? 'Rest now. Press Lap to finish this rest.' : 'Press Lap to finish this interval.');
    expect(Array.from(step.notification!.text).length).toBeLessThanOrEqual(54);
    expect(step.fields).toContainEqual({ type: 'text', value: 'Lap to finish' });
    expect(step.transitions).toEqual([{ condition: { type: 'manualLap' } }]);
    expect({ ...current, artifact: { ...current.artifact, steps: normalizeWording(current.artifact.steps) } }).toEqual(old);
    expect(recipe).toEqual(before);
  });
  it.each([
    { kind: 'time', seconds: 90 }, { kind: 'distance', meters: 100 },
    { kind: 'time', seconds: 90, allowEarlyLap: true }, { kind: 'distance', meters: 100, allowEarlyLap: true },
  ] as const)('keeps numeric/early-Lap %s instructions byte-identical to v7', ending => {
    const recipe: WorkoutStructureV1 = { version: 1, sport, nodes: [{ ...manual, ending }] };
    expect(serializeSuuntoGuideV11ForRecovery(recipe, options)).toEqual(serializeSuuntoGuideV7ForRecovery(recipe, options));
  });
  it.each(['Wait for the coach before starting', 'A'.repeat(40), 'B'.repeat(54),
    'Lap to finish', 'Press Lap to finish this interval.', 'Rest now. Press Lap to finish this rest.'])('preserves authored instructions: %s', note => {
    const recipe: WorkoutStructureV1 = { version: 1, sport, nodes: [{ ...manual, note }] };
    expect(serializeSuuntoGuideV11ForRecovery(recipe, options)).toEqual(serializeSuuntoGuideV7ForRecovery(recipe, options));
  });
  it('preserves authored lookalike text when another step requires the new generated wording', () => {
    const recipe: WorkoutStructureV1 = { version: 1, sport, nodes: [manual,
      { ...manual, id: 'coached', note: 'Lap to finish' },
      { ...manual, id: 'coached-work', note: 'Press Lap to finish this interval.' },
      { ...manual, id: 'coached-rest', purpose: 'rest', note: 'Rest now. Press Lap to finish this rest.' },
    ] };
    const current = serializeSuuntoGuideV11ForRecovery(recipe, options);
    const old = serializeSuuntoGuideV7ForRecovery(recipe, options);
    const first = current.artifact.steps[0] as SuuntoGuideFieldsStepV1;
    expect(first.notification?.text).toBe('Press Lap to finish this interval.');
    expect(first.fields).toContainEqual({ type: 'text', value: 'Lap to finish' });
    // Revert only the known generated step, not any authored string with the
    // same text. The rest of the complete payload must remain byte-identical.
    expect({ ...current, artifact: { ...current.artifact,
      steps: [old.artifact.steps[0], ...current.artifact.steps.slice(1)] } }).toEqual(old);
  });
  it.each([false, true])('keeps repeated mixed manual/timed/early-Lap boundaries and all targets/notes (early=%s)', early => {
    const recipe: WorkoutStructureV1 = { version: 1, sport, nodes: [
      { ...manual, id: 'warmup', purpose: 'warmup' },
      { kind: 'repeat', id: 'sets', count: 10, steps: [
        { ...manual, targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 150 }] },
        { ...manual, id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15, allowEarlyLap: early } },
        { ...manual, id: 'coached', purpose: 'recovery', note: 'Follow the coach' },
      ] },
      { ...manual, id: 'cooldown', purpose: 'cooldown' },
    ] };
    const current = serializeSuuntoGuideV11ForRecovery(recipe, options);
    const old = serializeSuuntoGuideV7ForRecovery(recipe, options);
    expect({ ...current, artifact: { ...current.artifact, steps: normalizeWording(current.artifact.steps) } }).toEqual(old);
  });
});

it.each([
  [ActivityTypes.Swimming, '7df836343f0047d5e901730bccc92702fe67ab6923ef5b8c5765ac398f0d9221'],
  [ActivityTypes.OpenWaterSwimming, '9e839c21ef8072a1bac07632a3484188e915120abf68a9bae7d22447badbc564'],
] as const)('preserves the pre-change v10 %s artifact and frozen recovery', (sport, digest) => {
  const recipe: WorkoutStructureV1 = { version: 1, sport, nodes: [{ kind: 'repeat', id: 'sets', count: 3,
    steps: [manual, { ...manual, id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 } }] }] };
  const current = serializeSuuntoGuideV11ForRecovery(recipe, options);
  expect(createHash('sha256').update(JSON.stringify(current.artifact)).digest('hex')).toBe(digest);
  expect(current).toEqual(serializeSuuntoGuideV10ForRecovery(recipe, options));
});
