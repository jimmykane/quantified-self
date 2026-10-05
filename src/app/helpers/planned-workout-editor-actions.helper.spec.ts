import { ActivityTypes, DistanceUnits, PaceUnits } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { createManualWorkoutEditorStep, manualWorkoutEditorToStructure, workoutStructureToManualEditor,
  type ManualWorkoutEditorRepeat, type ManualWorkoutEditorValue } from './planned-workout-editor.helper';
import { canDuplicateManualWorkoutEditorNode, duplicateManualWorkoutEditorNode, manualWorkoutEditorNodeCount,
  moveManualWorkoutEditorNode } from './planned-workout-editor-actions.helper';

const draft = (): ManualWorkoutEditorValue => ({ title: 'Intervals', localDate: '2026-10-05', sport: ActivityTypes.Running,
  nodes: [createManualWorkoutEditorStep('warmup'), { kind: 'repeat', id: 'block', count: 4,
    steps: [createManualWorkoutEditorStep('work'), { ...createManualWorkoutEditorStep('recovery'), purpose: 'recovery' }] },
  createManualWorkoutEditorStep('cooldown')] });
const ids = () => { let sequence = 0; return (kind: 'step' | 'repeat') => `${kind}-copy-${++sequence}`; };

describe('manual workout draft ordering and duplication', () => {
  it('moves whole blocks by stable ID, preserving children and the source draft', () => {
    const original = draft();
    const moved = moveManualWorkoutEditorNode(original, 'block', 0);
    expect(moved.nodes.map(node => node.id)).toEqual(['block', 'warmup', 'cooldown']);
    expect(moved.nodes[0]).toBe(original.nodes[1]);
    expect(original.nodes.map(node => node.id)).toEqual(['warmup', 'block', 'cooldown']);
  });

  it('moves repeat children only within their parent and keeps their IDs', () => {
    const original = draft();
    const moved = moveManualWorkoutEditorNode(original, 'recovery', 0, 'block');
    expect((moved.nodes[1] as ManualWorkoutEditorRepeat).steps.map(step => step.id)).toEqual(['recovery', 'work']);
    expect(moved.nodes[0]).toBe(original.nodes[0]);
    expect(moveManualWorkoutEditorNode(original, 'work', 0)).toBe(original);
    expect(moveManualWorkoutEditorNode(original, 'block', 0, 'block')).toBe(original);
    expect(moveManualWorkoutEditorNode(original, 'work', 0, 'missing')).toBe(original);
  });

  it.each([-1, 3, 0.5, Number.NaN])('ignores invalid destination %s and unchanged positions', destination => {
    const original = draft();
    expect(moveManualWorkoutEditorNode(original, 'warmup', destination)).toBe(original);
    expect(moveManualWorkoutEditorNode(original, 'warmup', 0)).toBe(original);
  });

  it('duplicates a whole repeat immediately after the source with fresh IDs and independent children', () => {
    const original = draft();
    const copy = duplicateManualWorkoutEditorNode(original, 'block', ids());
    expect(copy.nodes.map(node => node.id)).toEqual(['warmup', 'block', 'repeat-copy-1', 'cooldown']);
    const block = copy.nodes[2] as ManualWorkoutEditorRepeat;
    expect(block.count).toBe(4);
    expect(block.steps.map(step => step.id)).toEqual(['step-copy-2', 'step-copy-3']);
    block.steps[0].endingValue = 2;
    expect((original.nodes[1] as ManualWorkoutEditorRepeat).steps[0].endingValue).toBe(10);
    const childCopy = duplicateManualWorkoutEditorNode(original, 'work', ids(), 'block');
    expect((childCopy.nodes[1] as ManualWorkoutEditorRepeat).steps.map(step => step.id)).toEqual(['work', 'step-copy-1', 'recovery']);
  });

  it('preserves exact duration, distance, pace, notes and pool metadata across copies and save/reopen', () => {
    const units = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles, paceUnits: [PaceUnits.MinutesPerMile] });
    const editor = workoutStructureToManualEditor('Precise', '2026-10-05', { version: 1, sport: ActivityTypes.Running,
      nodes: [{ kind: 'step', id: 'timed', purpose: 'warmup', ending: { kind: 'time', seconds: 123.456789012345 }, targets: [], note: 'Easy start' },
      { kind: 'repeat', id: 'block', count: 3, steps: [{ kind: 'step', id: 'paced', purpose: 'work',
        ending: { kind: 'distance', meters: 1609.344123 }, targets: [{ kind: 'speed', mode: 'absolute', presentation: 'pace',
          minimumMetersPerSecond: 3.14159265, maximumMetersPerSecond: 4.123456789 }], note: 'Hold form' }] }] }, units);
    const copiedTime = duplicateManualWorkoutEditorNode(editor, 'timed', ids());
    const copy = duplicateManualWorkoutEditorNode(copiedTime, 'block', ids());
    const structure = manualWorkoutEditorToStructure(copy, units);
    expect(structure.nodes[1]).toEqual({ ...structure.nodes[0], id: 'step-copy-1' });
    const block = structure.nodes[2];
    if (block.kind !== 'repeat') throw new Error('Expected repeat');
    expect(structure.nodes[3]).toEqual({ ...block, id: 'repeat-copy-1', steps: [{ ...block.steps[0], id: 'step-copy-2' }] });
    expect(manualWorkoutEditorToStructure(workoutStructureToManualEditor('Precise', '2026-10-05', structure, units), units)).toEqual(structure);
    expect(JSON.stringify(structure)).not.toMatch(/sourceDuration|sourceDistance|sourcePace/);
    const sourceBlock = copy.nodes[2] as ManualWorkoutEditorRepeat;
    const copiedBlock = copy.nodes[3] as ManualWorkoutEditorRepeat;
    expect(copiedBlock.steps[0].sourcePace).not.toBe(sourceBlock.steps[0].sourcePace);
    expect(copiedBlock.steps[0].sourceDistance).not.toBe(sourceBlock.steps[0].sourceDistance);
    const pool = { ...draft(), sport: ActivityTypes.Swimming, poolLengthValue: 25, poolLengthUnit: 'yards' as const };
    expect(duplicateManualWorkoutEditorNode(pool, 'block', ids())).toMatchObject({ poolLengthValue: 25, poolLengthUnit: 'yards' });
  });

  it('counts repeat blocks and children against the canonical 100-node limit', () => {
    const original = { ...draft(), nodes: Array.from({ length: 98 }, (_, i) => createManualWorkoutEditorStep(`step-${i}`)) };
    const copy = duplicateManualWorkoutEditorNode(original, 'step-0', ids());
    const full = duplicateManualWorkoutEditorNode(copy, 'step-0', ids());
    expect(manualWorkoutEditorNodeCount(full)).toBe(100);
    expect(canDuplicateManualWorkoutEditorNode(full, 'step-0')).toBe(false);
    expect(duplicateManualWorkoutEditorNode(full, 'step-0', ids())).toBe(full);
    const blockAtLimit = { ...draft(), nodes: [...original.nodes.slice(0, 96), draft().nodes[1]] };
    expect(manualWorkoutEditorNodeCount(blockAtLimit)).toBe(99);
    expect(duplicateManualWorkoutEditorNode(blockAtLimit, 'block', ids())).toBe(blockAtLimit);
    expect(canDuplicateManualWorkoutEditorNode(blockAtLimit, 'work', 'block')).toBe(true);
  });

  it('copies partial fields for continued editing and keeps exact duration caches independent', () => {
    const original = draft();
    original.nodes[0] = { ...createManualWorkoutEditorStep('partial'), endingValue: Number.NaN,
      targetKind: 'power', targetMinimum: null, targetMaximum: 250, note: 'Finish this draft',
      sourceDuration: { editorValue: 1.25, seconds: 75 } };
    const copy = duplicateManualWorkoutEditorNode(original, 'partial', ids());
    expect(copy.nodes[1]).toEqual({ ...original.nodes[0], id: 'step-copy-1' });
    if (copy.nodes[1].kind !== 'step' || original.nodes[0].kind !== 'step') throw new Error('Expected steps');
    expect(copy.nodes[1].sourceDuration).not.toBe(original.nodes[0].sourceDuration);
    expect(() => manualWorkoutEditorToStructure(copy)).toThrow();
  });

  it('avoids ID collisions across every parent and fails atomically when a factory cannot supply valid IDs', () => {
    const original = draft();
    const candidates = ['work', 'block', 'bad id', 'unique'];
    const copied = duplicateManualWorkoutEditorNode(original, 'warmup', () => candidates.shift()!);
    expect(copied.nodes[1].id).toBe('unique');
    expect(() => duplicateManualWorkoutEditorNode(original, 'block', () => 'work')).toThrow('unique workout step ID');
    expect(original).toEqual(draft());
    expect(duplicateManualWorkoutEditorNode(original, 'missing', ids())).toBe(original);
  });
});
