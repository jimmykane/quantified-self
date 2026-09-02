import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  createManualWorkoutEditorStep,
  manualWorkoutEditorToStructure,
  workoutStructureToManualEditor,
  type ManualWorkoutEditorValue,
} from './planned-workout-editor.helper';

describe('manual planned-workout editor conversion', () => {
  it('stores minutes and kilometres as canonical seconds and metres', () => {
    const value: ManualWorkoutEditorValue = {
      title: 'Brick',
      localDate: '2026-09-03',
      sport: ActivityTypes.Cycling,
      nodes: [
        { ...createManualWorkoutEditorStep('time'), endingValue: 12.5 },
        { ...createManualWorkoutEditorStep('distance'), endingKind: 'distance', endingValue: 5 },
      ],
    };
    const structure = manualWorkoutEditorToStructure(value);

    expect(structure.nodes[0]).toMatchObject({ ending: { kind: 'time', seconds: 750 } });
    expect(structure.nodes[1]).toMatchObject({ ending: { kind: 'distance', meters: 5000 } });
  });

  it('creates fixed repeats without nested repeat nodes', () => {
    const value: ManualWorkoutEditorValue = {
      title: 'Intervals',
      localDate: '2026-09-03',
      sport: ActivityTypes.Running,
      nodes: [{
        kind: 'repeat',
        id: 'repeat-1',
        count: 6,
        steps: [createManualWorkoutEditorStep('work'), {
          ...createManualWorkoutEditorStep('recover'), purpose: 'recovery', endingValue: 2,
        }],
      }],
    };

    expect(manualWorkoutEditorToStructure(value).nodes[0]).toMatchObject({
      kind: 'repeat', count: 6, steps: [{ kind: 'step' }, { kind: 'step', purpose: 'recovery' }],
    });
  });

  it('converts pace ranges to ordered m/s while preserving pace presentation', () => {
    const value: ManualWorkoutEditorValue = {
      title: 'Tempo',
      localDate: '2026-09-03',
      sport: ActivityTypes.Running,
      nodes: [{
        ...createManualWorkoutEditorStep('tempo'),
        targetKind: 'pace',
        targetMinimum: 4,
        targetMaximum: 5,
      }],
    };
    const structure = manualWorkoutEditorToStructure(value);

    expect(structure.nodes[0]).toMatchObject({
      targets: [{
        kind: 'speed', mode: 'absolute', presentation: 'pace',
        minimumMetersPerSecond: 1000 / 300,
        maximumMetersPerSecond: 1000 / 240,
      }],
    });
    expect(workoutStructureToManualEditor('Tempo', value.localDate, structure).nodes[0]).toMatchObject({
      targetKind: 'pace', targetMinimum: 4, targetMaximum: 5,
    });
  });

  it('rejects invalid repeat and target ranges before the callable', () => {
    const value: ManualWorkoutEditorValue = {
      title: 'Invalid',
      localDate: '2026-09-03',
      sport: ActivityTypes.Running,
      nodes: [{
        kind: 'repeat', id: 'repeat', count: 0, steps: [createManualWorkoutEditorStep('work')],
      }],
    };
    expect(() => manualWorkoutEditorToStructure(value)).toThrow('Repeat counts');

    value.nodes = [{
      ...createManualWorkoutEditorStep('work'),
      targetKind: 'heart-rate',
      targetMinimum: 170,
      targetMaximum: 150,
    }];
    expect(() => manualWorkoutEditorToStructure(value)).toThrow('minimum must not exceed');
  });
});
