import { describe, expect, it } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { planSuuntoSwimmingScreen, suuntoSwimmingOccurrences, suuntoSwimmingRequiredShapes } from '../../../../shared/suunto-swimming-screen';
import type { WorkoutStepV1, WorkoutStructureV1 } from '../../../../shared/planned-workout';
import { defaultSuuntoSwimmingGuideSettings, normalizeSuuntoSwimmingGuideSettingsForRecovery,
  parseSuuntoSwimmingGuideSettings } from '../../../../shared/suunto-swimming-guide-settings';
const work: WorkoutStepV1 = { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'distance', meters: 100, allowEarlyLap: true }, targets: [] };
const rest: WorkoutStepV1 = { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 }, targets: [] };
const structure: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Swimming,
  nodes: [{ kind: 'repeat', id: 'set', count: 10, steps: [work, rest] }] };
const prefs = { version: 1, workFields: ['distance', 'pace', 'duration', 'interval', 'workoutDistance'],
  restFields: ['interval', 'previousPlannedDistance', 'nextPlannedDistance', 'workoutDistance', 'heartRate'] };
describe('shared Suunto swim field allocation', () => {
  const previousChoices = { version: 1, workFields: [], restFields: ['interval', 'previousLapPace', 'previousLapDuration', 'previousLapStrokes'] };
  it('bounds previous-lap choices to Rest and preserves historical settings fallback', () => {
    expect(parseSuuntoSwimmingGuideSettings(previousChoices).restFields).toEqual(previousChoices.restFields);
    expect(() => parseSuuntoSwimmingGuideSettings({ ...previousChoices, workFields: ['previousLapPace'] })).toThrow();
    expect(() => parseSuuntoSwimmingGuideSettings({ ...previousChoices, windowOffset: -1 })).toThrow();
    expect(normalizeSuuntoSwimmingGuideSettingsForRecovery(previousChoices)).toEqual(defaultSuuntoSwimmingGuideSettings());
  });
  it.each([ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming])('allocates native closed-lap readings after Work for %s', sport => {
    const occurrences = suuntoSwimmingOccurrences({ ...structure, sport })!;
    const output = planSuuntoSwimmingScreen('Rest', suuntoSwimmingRequiredShapes(rest), sport,
      previousChoices, occurrences[1], occurrences[0], occurrences[2], undefined, true);
    expect(output.title).toBe('Rest 1/10');
    expect(output.fields).toEqual([
      { type: 'stepDurationCountdown', value: 15, title: 'Rest rem' },
      { type: 'pace', title: 'PrevPace', window: 'manualLap', aggregate: 'average', windowOffset: -1 },
      { type: 'duration', title: 'PrevTime', window: 'manualLap', windowOffset: -1 },
      { type: 'strokes', title: 'PrevStrk', window: 'manualLap', windowOffset: -1 },
    ]);
    expect(output.choices.slice(1).every(choice => choice.state === 'included' && choice.reason.includes('final segment'))).toBe(true);
    expect(output.choices.slice(1).every(choice => choice.reason.includes('another Lap recorded without ending Rest changes which lap is shown'))).toBe(true);
  });
  it('does not substitute a warm-up, active recovery, earlier Rest or missing context for Work', () => {
    for (const purpose of ['warmup', 'recovery', 'rest'] as const) {
      const output = planSuuntoSwimmingScreen('Rest', suuntoSwimmingRequiredShapes(rest), structure.sport,
        previousChoices, { step: rest, total: 1 }, { step: { ...work, purpose }, total: 1 }, undefined, undefined, true);
      expect(output.fields.some(field => 'windowOffset' in field)).toBe(false);
      expect(output.choices.filter(choice => choice.field.startsWith('previousLap')).every(choice => choice.state === 'omitted')).toBe(true);
    }
    expect(planSuuntoSwimmingScreen('Rest', [], structure.sport, previousChoices,
      undefined, undefined, undefined, undefined, true).fields.some(field => 'windowOffset' in field)).toBe(false);
  });
  it('uses the heading for numbering and one short planned-context cell, preserving native readings', () => {
    const occurrences = suuntoSwimmingOccurrences(structure)!;
    const output = planSuuntoSwimmingScreen('Rest', suuntoSwimmingRequiredShapes(rest), structure.sport,
      prefs, occurrences[1], occurrences[0], occurrences[2]);
    expect(output.title).toBe('Rest 1/10');
    expect(output.fields.map(field => field.type)).toEqual(['stepDurationCountdown', 'text', 'distance', 'heartRate']);
    expect(output.fields[1]).toEqual({ type: 'text', value: 'Plan Prev: 100.0 m / Next: 100.0 m' });
    expect(output.choices.every(choice => choice.state !== 'omitted')).toBe(true);
    expect(output.choices[0].state).toBe('heading');
  });
  it('includes the target pair without pretending omitted choices are visible', () => {
    const step: WorkoutStepV1 = { ...work, targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 150 }] };
    const occurrence = { step, interval: 1, total: 10 };
    const output = planSuuntoSwimmingScreen('Work', suuntoSwimmingRequiredShapes(step), structure.sport, prefs, occurrence);
    expect(output.title).toBe('Work 1/10');
    expect(output.fields.map(field => field.type)).toEqual(['stepDistanceCountdown', 'heartRate', 'targetHeartRate', 'pace', 'duration']);
    expect(output.choices.find(choice => choice.field === 'workoutDistance')).toMatchObject({ state: 'omitted', reason: expect.stringContaining('No space') });
    expect(output.choices.find(choice => choice.field === 'distance')?.reason).toContain('Already included');
  });
  it('does not invent previous/next distances, counters, averages or SWOLF in open water', () => {
    const occurrence = { step: rest, total: 0 };
    const output = planSuuntoSwimmingScreen('Rest', suuntoSwimmingRequiredShapes(rest), ActivityTypes.OpenWaterSwimming, prefs, occurrence);
    expect(output.title).toBe('Rest');
    expect(output.choices.filter(choice => choice.state === 'omitted')).toHaveLength(3);
    expect(output.fields.some(field => 'aggregate' in field)).toBe(false);
    const workOutput = planSuuntoSwimmingScreen('Work', [], ActivityTypes.OpenWaterSwimming,
      { version: 1, workFields: ['swolf'], restFields: [] }, { step: { ...work, ending: { kind: 'manual' } }, total: 1, interval: 1 });
    expect(workOutput.choices[0]).toMatchObject({ state: 'omitted', reason: expect.stringContaining('pool') });
  });
  it('respects removed interval choices, long instructions and bounded expansion', () => {
    const step = { ...work, ending: { kind: 'manual' as const }, note: 'A'.repeat(45) };
    const output = planSuuntoSwimmingScreen('Work', suuntoSwimmingRequiredShapes(step), structure.sport,
      { version: 1, workFields: ['pace'], restFields: [] }, { step, total: 10, interval: 1 });
    expect(output.title).toBe('Work'); expect(output.fields).toEqual([{ type: 'text', value: step.note }]);
    expect(output.choices[0].reason).toContain('text-only');
    expect(suuntoSwimmingOccurrences({ ...structure, nodes: Array.from({ length: 11 }, (_, i) => ({
      kind: 'repeat', id: `set-${i}`, count: 100, steps: [{ ...work, id: `work-${i}` }, { ...rest, id: `rest-${i}` }] })) })).toBeNull();
  });
  it('includes Complete and early-Lap branch screens in the same expansion bound as delivery', () => {
    const nodes: WorkoutStructureV1['nodes'] = Array.from({ length: 3 }, (_, index) => ({
      kind: 'repeat', id: `set-${index}`, count: 100,
      steps: [{ ...work, id: `work-${index}` }, { ...rest, id: `rest-${index}` }] }));
    expect(suuntoSwimmingOccurrences({ ...structure, nodes })).not.toBeNull(); // 600 + 300 + Complete
    nodes.push({ kind: 'repeat', id: 'more', count: 50, steps: [{ ...work, id: 'more-work' }, { ...rest, id: 'more-rest' }] });
    expect(suuntoSwimmingOccurrences({ ...structure, nodes })).toBeNull(); // 700 + 350 + Complete
  });
});
