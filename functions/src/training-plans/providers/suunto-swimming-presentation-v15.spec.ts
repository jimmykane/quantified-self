import { describe, expect, it } from 'vitest';
import { ActivityTypes, DistanceUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '../../../../shared/unit-aware-display';
import { planSuuntoSwimmingScreen, suuntoSwimmingOccurrences, suuntoSwimmingRequiredShapes } from '../../../../shared/suunto-swimming-screen';
import type { WorkoutStepV1, WorkoutStructureV1 } from '../../../../shared/planned-workout';
import { serializeSuuntoSwimmingGuideV14, serializeSuuntoSwimmingGuideV15, serializeSuuntoGuideV11ForRecovery,
  type SuuntoGuideFieldsStepV1 } from './suunto-guide.serializer';
import { presentSuuntoSwimmingScreensV15 } from './suunto-swimming-presentation-v15';
import { defaultSuuntoSwimmingGuideSettings, type SuuntoSwimmingGuideSettings } from '../../../../shared/suunto-swimming-guide-settings';
const work: WorkoutStepV1 = { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'distance', meters: 100 }, targets: [] };
const rest: WorkoutStepV1 = { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 }, targets: [] };
const options = { name: 'Swim', owner: 'Fixture', url: 'https://example.test', localDate: '2026-10-20', sourceWorkoutId: 'fixture', allowDegraded: true };
const recipe = (sport = ActivityTypes.Swimming): WorkoutStructureV1 => ({ version: 1, sport,
  nodes: [{ kind: 'repeat', id: 'sets', count: 10, steps: [work, rest] }] });
const output = (structure = recipe(), settings?: SuuntoSwimmingGuideSettings) =>
  serializeSuuntoSwimmingGuideV15(structure, options, settings).artifact.steps as SuuntoGuideFieldsStepV1[];
describe('Suunto v15 swimming presentation', () => {
  it.each([ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming])('matches the shared allocation with and without HR targets for %s', sport => {
    for (const targeted of [false, true]) {
      const structure = recipe(sport);
      if (targeted) (structure.nodes[0] as { steps: WorkoutStepV1[] }).steps = [work, rest].map(step => ({ ...step,
        targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 80, maximumBpm: 120 }] }));
      const occurrences = suuntoSwimmingOccurrences(structure)!;
      const screens = output(structure);
      occurrences.forEach((occurrence, index) => {
        const report = planSuuntoSwimmingScreen(occurrence.step.purpose === 'rest' ? 'Rest' : 'Work',
          suuntoSwimmingRequiredShapes(occurrence.step), sport, undefined, occurrence, occurrences[index - 1], occurrences[index + 1]);
        expect(screens[index].title).toBe(report.title);
        // Shape-only target values are never used in payloads; preserve exact ranges.
        expect(screens[index].fields.map(field => field.type)).toEqual(report.fields.map(field => field.type));
        expect(screens[index].fields.filter(field => field.type.startsWith('target'))).toEqual(targeted
          ? [{ type: 'targetHeartRate', title: 'Tgt HR', min: 80, max: 120 }] : []);
        expect(screens[index].fields.length).toBeLessThanOrEqual(5);
      });
      expect(screens[1].notification).toBeUndefined();
      expect(screens[0].notification?.title).toBe('Work 1/10');
    }
  });
  it('leaves v14 text, payloads and non-swimming serializers unchanged', () => {
    const frozen = serializeSuuntoSwimmingGuideV14(recipe(), options).artifact;
    output();
    expect(serializeSuuntoSwimmingGuideV14(recipe(), options).artifact).toEqual(frozen);
    expect((frozen.steps[1] as SuuntoGuideFieldsStepV1).fields).toContainEqual({ type: 'text', value: 'Interval 1/10' });
    expect(serializeSuuntoSwimmingGuideV15(recipe(ActivityTypes.Running), options))
      .toEqual(serializeSuuntoSwimmingGuideV14(recipe(ActivityTypes.Running), options));
  });
  it('preserves both early-Lap branches, their IDs, durations, targets, notes and recorded boundaries', () => {
    const structure = recipe(); (structure.nodes[0] as { steps: WorkoutStepV1[] }).steps = [
      { ...work, ending: { kind: 'distance', meters: 100, allowEarlyLap: true }, note: 'Easy effort' }, rest];
    const frozen = serializeSuuntoGuideV11ForRecovery(structure, options).artifact.steps as SuuntoGuideFieldsStepV1[];
    const screens = output(structure);
    const execution = (values: SuuntoGuideFieldsStepV1[]) => values.map(({ id, transitions, createManualLap }) => ({ id, transitions, createManualLap }));
    expect(execution(screens)).toEqual(execution(frozen));
    expect(screens[0].fields).toContainEqual({ type: 'text', value: 'Easy effort' });
    expect(screens.find(screen => screen.id === 'qs-boundary-1-lap')?.title).toBe('Rest 1/10');
    expect(screens.find(screen => screen.id === 'qs-boundary-1-auto')?.title).toBe('Rest 1/10');
  });
  it('keeps planned context short, honors units and does not invent distance for manual steps', () => {
    const structure = recipe(); (structure.nodes[0] as { steps: WorkoutStepV1[] }).steps[0] = { ...work,
      ending: { kind: 'distance', meters: 1609.344, allowEarlyLap: true } };
    const screens = serializeSuuntoSwimmingGuideV15(structure, options, undefined,
      normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles })).artifact.steps as SuuntoGuideFieldsStepV1[];
    expect(screens[1].fields).toContainEqual({ type: 'text', value: 'Plan Prev: 1.00 mi / Next: 1.00 mi' });
    expect(JSON.stringify(screens)).not.toContain('or Lap');
    (structure.nodes[0] as { steps: WorkoutStepV1[] }).steps[0] = { ...work, ending: { kind: 'manual' } };
    expect(output(structure)[1].fields.some(field => field.type === 'text')).toBe(false);
  });
  it('retains authored notes/long rest alerts, but removes no selected fields to force a counter', () => {
    const structure = recipe(); (structure.nodes[0] as { steps: WorkoutStepV1[] }).steps[1] = { ...rest, note: 'Relax' };
    expect(output(structure)[1].notification).toEqual({ title: 'Rest 1/10', text: 'Relax' });
    expect(output(structure)[1].fields).toContainEqual({ type: 'text', value: 'Relax' });
    expect(output(recipe(), { ...defaultSuuntoSwimmingGuideSettings(), restFields: ['heartRate'] })[1].title).toBe('Rest');
  });
  it('bounds expanded and notification-enriched payloads and keeps the frozen graph if compact cannot fit', () => {
    const structure = recipe();
    const frozen = serializeSuuntoGuideV11ForRecovery(structure, options).artifact.steps;
    const compact = presentSuuntoSwimmingScreensV15(structure, frozen, undefined, undefined, candidate => {
      if (candidate[0].type !== 'repeat') return 256 * 1024 + 1;
      expect(candidate[0].steps[0].notification).toHaveProperty('type', 'default'); return 1000;
    });
    expect(compact[0].type).toBe('repeat'); expect(JSON.stringify(compact)).not.toContain('Prev:');
    expect(presentSuuntoSwimmingScreensV15(structure, frozen, undefined, undefined, () => 256 * 1024 + 1)).toBe(frozen);
  });
});
