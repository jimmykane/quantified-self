import { describe, expect, it } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { assertAssistantRecoveryDurationEdit, diffAssistantWorkoutNodes, isAssistantWorkoutReviews,
  type AssistantWorkoutReview } from '../../../shared/assistant-workout-review';
import type { WorkoutStepV1, WorkoutStructureV1 } from '../../../shared/planned-workout';

const step = (id: string, seconds: number, recovery = false): WorkoutStepV1 => ({ id, kind: 'step',
  purpose: recovery ? 'recovery' : 'work', ending: { kind: 'time', seconds }, targets: [], note: `${id} exact note` });
const recipe: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Running, nodes: [step('untargeted-60', 60),
  { kind: 'repeat', id: 'block', count: 4, steps: [
    { ...step('kilometre', 300), ending: { kind: 'distance', meters: 1000 }, targets: [
      { kind: 'heart-rate', mode: 'absolute', minimumBpm: 130, maximumBpm: 150 },
      { kind: 'speed', mode: 'relative', presentation: 'pace', minimumPercent: 95, maximumPercent: 105,
        reference: { kind: 'threshold-speed', metersPerSecond: 3.1234567890123 } },
    ] }, step('recovery-60', 60, true), step('recovery-90', 90, true),
  ] }, step('untargeted-75', 75), step('untargeted-90', 90)] };
function review(): AssistantWorkoutReview {
  const before = { title: 'Mixed workout', localDate: '2026-10-07', destination: 'Standalone', lifecycle: 'planned' as const, structure: recipe };
  return { index: 0, before: structuredClone(before), after: structuredClone(before), compatibility:
    ['garmin', 'coros', 'wahoo', 'suunto'].map(provider => ({ provider: provider as 'garmin', before: 'exact', after: 'exact', issues: [] })) };
}
describe('complete Assistant workout review', () => {
  it('changes only identified recovery definitions, preserving unrelated 60/75/90 second steps and exact snapshots', () => {
    const value = review();
    const repeat = value.after!.structure.nodes[1];
    if (repeat.kind !== 'repeat') throw new Error();
    repeat.steps.slice(1).forEach(s => { s.ending = { ...s.ending, kind: 'time', seconds: 75 }; });
    expect(() => assertAssistantRecoveryDurationEdit('change recovery to 75 seconds', [value])).not.toThrow();
    expect(diffAssistantWorkoutNodes(value.before!.structure, value.after!.structure).map(s => [s.id, s.fields]))
      .toEqual([['recovery-60', ['Duration / ending']], ['recovery-90', ['Duration / ending']]]);
    const target = repeat.steps[0].targets[1];
    if (target.kind !== 'speed' || target.mode !== 'relative') throw new Error();
    target.reference.metersPerSecond += 0.000000000001;
    expect(() => assertAssistantRecoveryDurationEdit('change recovery to 75 seconds', [value])).toThrow(/preserve/);
  });
  it.each(['note', 'order', 'id', 'repeat', 'date', 'target', 'lap'])('rejects an unrelated %s change in a duration-only proposal', field => {
    const value = review(); const s = value.after!.structure.nodes[0];
    if (s.kind !== 'step') throw new Error();
    if (field === 'note') s.note = 'other';
    if (field === 'order') value.after!.structure.nodes.reverse();
    if (field === 'id') s.id = 'new';
    if (field === 'repeat') { const r = value.after!.structure.nodes[1]; if (r.kind === 'repeat') r.count++; }
    if (field === 'date') value.after!.localDate = '2026-10-08';
    if (field === 'target') s.targets = [{ kind: 'cadence', mode: 'absolute', minimumRpm: 80, maximumRpm: 90 }];
    if (field === 'lap') s.ending = { kind: 'time', seconds: 60, allowEarlyLap: false };
    expect(() => assertAssistantRecoveryDurationEdit('change recovery to 75 seconds', [value])).toThrow();
  });
  it('reports inserted/deleted IDs and reordered repeat children without treating insertion shifts as moves', () => {
    const after = structuredClone(recipe); after.nodes.unshift(step('inserted', 30));
    expect(diffAssistantWorkoutNodes(recipe, after).map(v => v.id)).toEqual(['inserted']);
    after.nodes.pop(); const repeat = after.nodes[2];
    if (repeat.kind !== 'repeat') throw new Error();
    repeat.steps.reverse(); repeat.steps[0].targets = [];
    const changes = diffAssistantWorkoutNodes(recipe, after);
    expect(changes.at(-1)?.fields).toEqual(['Removed']);
    expect(changes.find(v => v.id === 'kilometre')?.fields).toContain('Order / repeat placement');
    expect(diffAssistantWorkoutNodes(null, recipe)).toHaveLength(7);
  });
  it('fails closed on incomplete recipes, unmatched operations and private fields', () => {
    const value = review(); expect(isAssistantWorkoutReviews([value])).toBe(true);
    for (const changed of [{ ...value, ownerUid: 'private' }, { ...value, index: 25 }, { ...value, after: { ...value.after, providerId: 'private' } },
      { ...value, after: { ...value.after, structure: { ...recipe, nodes: [{ id: 'incomplete', kind: 'step' }] } } }]) {
      expect(isAssistantWorkoutReviews([changed])).toBe(false);
    }
    expect(isAssistantWorkoutReviews([value, value])).toBe(false);
    expect(() => assertAssistantRecoveryDurationEdit('change recovery to 75 seconds', [])).toThrow();
  });
  it('rejects normalized sport aliases and untrimmed recipes at the app review boundary', () => {
    const value = review();
    for (const sport of ['StrengthTraining', 'strength_training']) {
      expect(isAssistantWorkoutReviews([{ ...value, after: { ...value.after, structure: { ...recipe, sport } } }])).toBe(false);
    }
    const untrimmed = structuredClone(value);
    const first = untrimmed.after!.structure.nodes[0];
    if (first.kind !== 'step') throw new Error();
    first.note = ` ${first.note} `;
    expect(isAssistantWorkoutReviews([untrimmed])).toBe(false);
  });
});
