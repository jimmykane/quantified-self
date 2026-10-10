import { describe, expect, it } from 'vitest';
import { ActivityTypes, DistanceUnits, PaceUnits, WeightUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '../../../../shared/unit-aware-display';
import { serializeSuuntoGuideJsonV1 } from './suunto-guide.serializer';
import { suuntoGuideDescription, withSuuntoGuideDescription } from './suunto-guide-description';

const recipe = { version: 1, sport: ActivityTypes.Running, nodes: [{ kind: 'repeat', id: 'repeat', count: 100,
  steps: [{ kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'distance', meters: 1609.344 },
    targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 150 }], note: 'Keep <steady>\n[not a link](https://example.com)' },
  { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 75 }, targets: [] }] }] };
const options = { name: 'Test', owner: 'QS', url: 'https://quantified-self.io/training/plans', localDate: '2026-10-11',
  sourceWorkoutId: 'test', allowDegraded: true };

describe('Suunto app-only Guide preview', () => {
  it('groups repeats and preserves targets, fractional-minute durations and literal notes', () => {
    const text = suuntoGuideDescription(recipe, 'Test');
    expect(text).toContain('Repeat 100 times');
    expect(text.match(/Work ·/g)).toHaveLength(1);
    expect(text).toContain('120–150 bpm');
    expect(text).toContain('01m 15s');
    expect(text).toContain('&lt;steady&gt;');
    expect(text).not.toContain('[not a link](https://example.com)');
  });
  it('uses owner units without changing canonical values', () => {
    const imperial = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles, paceUnits: [PaceUnits.MinutesPerMile] });
    expect(suuntoGuideDescription(recipe, 'Test', imperial)).toContain('mi');
    expect(suuntoGuideDescription(recipe, 'Test')).toContain('Km');
    expect(recipe.nodes[0].steps[0].ending.meters).toBe(1609.344);
  });
  it('explains manual and optional early-Lap endings', () => {
    const input = { version: 1, sport: ActivityTypes.Walking, nodes: [
      { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'manual' }, targets: [] },
      { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15, allowEarlyLap: true }, targets: [] }] };
    const text = suuntoGuideDescription(input, 'Walk');
    expect(text).toContain('Press Lap to finish');
    expect(text).toContain('15s or Lap');
  });
  it('preserves complete strength sets and owner-unit loads', () => {
    const structure = { version: 1, sport: ActivityTypes.StrengthTraining, nodes: [
      { kind: 'step', id: 'set-1', purpose: 'work', ending: { kind: 'manual' }, targets: [] }] };
    const details = { version: 1, revision: 1, workoutId: 'test', exercises: [{ id: 'exercise', name: 'Squat', sets: [
      { id: 'set', ending: { kind: 'repetitions', repetitions: 8 }, externalLoadKg: 10, restAfterSeconds: 15 }] }] };
    const text = suuntoGuideDescription(structure, 'Strength', normalizeUserUnitSettings({ weightUnits: WeightUnits.Pounds }), details);
    expect(text).toContain('Squat'); expect(text).toContain('8 reps'); expect(text).toContain('lb'); expect(text).toContain('Rest · 15s');
  });
  it('adds metadata only and respects character/UTF-8 readback bounds', () => {
    const artifact = serializeSuuntoGuideJsonV1(recipe, options).artifact;
    const original = structuredClone(artifact);
    const described = withSuuntoGuideDescription(artifact, suuntoGuideDescription(recipe, options.name));
    expect(described.richText).toBeTruthy(); expect(described.steps).toEqual(original.steps);
    expect(artifact).toEqual(original);
    expect(withSuuntoGuideDescription(artifact, '')).toBe(artifact);
    expect(withSuuntoGuideDescription(artifact, 'x'.repeat(100_001))).toBe(artifact);
    expect(withSuuntoGuideDescription(artifact, '😀'.repeat(90_000))).toBe(artifact);
  });
});
