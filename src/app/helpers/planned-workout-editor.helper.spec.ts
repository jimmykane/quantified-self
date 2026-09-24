import { ActivityTypes, DistanceUnits, PaceUnits, SwimPaceUnits } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import type { WorkoutStructureV1 } from '@shared/planned-workout';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import {
  createManualWorkoutEditorStep,
  changeManualWorkoutEditorSport,
  formatManualWorkoutStructure,
  manualWorkoutEditorToStructure,
  workoutStructureToManualEditor,
  type ManualWorkoutEditorStep,
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

  it.each([ActivityTypes.Running, ActivityTypes.Cycling])('saves and reopens %s miles as the same canonical metres', sport => {
    const units = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
    const value: ManualWorkoutEditorValue = {
      title: 'Mile repeats', localDate: '2026-09-03', sport,
      nodes: [{ kind: 'repeat', id: 'repeats', count: 2, steps: [{
        ...createManualWorkoutEditorStep('mile'), endingKind: 'distance', endingValue: 1,
      }] }],
    };
    const structure = manualWorkoutEditorToStructure(value, units);
    expect(structure.nodes[0]).toMatchObject({
      steps: [{ ending: { kind: 'distance', meters: 1609.344 } }],
    });
    expect(workoutStructureToManualEditor(value.title, value.localDate, structure, units).nodes)
      .toMatchObject(value.nodes);
    expect(manualWorkoutEditorToStructure(
      workoutStructureToManualEditor(value.title, value.localDate, structure, units), units,
    )).toEqual(structure);
    expect(workoutStructureToManualEditor(value.title, value.localDate, structure).nodes[0])
      .toMatchObject({ steps: [{ endingValue: 1.609344 }] });
  });

  it('shows a readable fractional mile while preserving the exact saved distance on an unchanged edit', () => {
    const units = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
    const structure: WorkoutStructureV1 = {
      version: 1, sport: ActivityTypes.Running,
      nodes: [{ kind: 'step', id: 'kilometer', purpose: 'work',
        ending: { kind: 'distance', meters: 1000 }, targets: [] }],
    };
    const editor = workoutStructureToManualEditor('Existing', '2026-09-03', structure, units);
    expect(editor.nodes[0]).toMatchObject({ endingValue: 0.621371 });
    expect(manualWorkoutEditorToStructure(editor, units)).toEqual(structure);
    const changed = { ...editor, nodes: [{ ...editor.nodes[0], endingValue: 1 } as ManualWorkoutEditorValue['nodes'][number]] };
    expect(manualWorkoutEditorToStructure(changed, units).nodes[0]).toMatchObject({
      ending: { kind: 'distance', meters: 1609.344 },
    });
    expect(manualWorkoutEditorToStructure(changeManualWorkoutEditorSport(editor, ActivityTypes.Swimming, units), units))
      .toMatchObject({ sport: ActivityTypes.Swimming, nodes: structure.nodes });
  });

  it('keeps a positive sub-millimetre canonical distance editable instead of rounding its input to zero', () => {
    const units = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
    const structure: WorkoutStructureV1 = {
      version: 1, sport: ActivityTypes.Running,
      nodes: [{ kind: 'step', id: 'tiny', purpose: 'work',
        ending: { kind: 'distance', meters: 0.000001 }, targets: [] }],
    };
    const editor = workoutStructureToManualEditor('Tiny distance', '2026-09-03', structure, units);
    expect((editor.nodes[0] as ManualWorkoutEditorStep).endingValue).toBeGreaterThan(0);
    expect(manualWorkoutEditorToStructure(editor, units)).toEqual(structure);
  });

  it('lets an unfinished numeric draft change sports without saving an invalid step', () => {
    const units = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
    const value: ManualWorkoutEditorValue = {
      title: 'Draft', localDate: '2026-09-03', sport: ActivityTypes.Running,
      nodes: [{ ...createManualWorkoutEditorStep('draft'), endingValue: 0 }],
    };
    expect(changeManualWorkoutEditorSport(value, ActivityTypes.Cycling, units).nodes[0])
      .toMatchObject({ endingValue: 0 });
    expect(() => manualWorkoutEditorToStructure(value, units)).toThrow('positive duration or distance');
  });

  it('keeps distance and pace preferences independent in the editor', () => {
    const units = normalizeUserUnitSettings({
      distanceUnits: DistanceUnits.Miles,
      paceUnits: [PaceUnits.MinutesPerMile],
    });
    const value: ManualWorkoutEditorValue = {
      title: 'Mile tempo', localDate: '2026-09-03', sport: ActivityTypes.Running,
      nodes: [{
        ...createManualWorkoutEditorStep('tempo'), endingKind: 'distance', endingValue: 1,
        targetKind: 'pace', targetMinimum: 4, targetMaximum: 5,
      }],
    };
    const structure = manualWorkoutEditorToStructure(value, units);
    expect(structure.nodes[0]).toMatchObject({
      ending: { kind: 'distance', meters: 1609.344 },
      targets: [{
        kind: 'speed', mode: 'absolute', presentation: 'pace',
        minimumMetersPerSecond: 1609.344 / 300,
        maximumMetersPerSecond: 1609.344 / 240,
      }],
    });
    expect(workoutStructureToManualEditor(value.title, value.localDate, structure, units).nodes[0])
      .toMatchObject({ endingValue: 1, targetMinimum: 4, targetMaximum: 5 });
    const metricPace = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
    expect(manualWorkoutEditorToStructure(value, metricPace).nodes[0]).toMatchObject({
      ending: { kind: 'distance', meters: 1609.344 },
      targets: [{ minimumMetersPerSecond: 1000 / 300, maximumMetersPerSecond: 1000 / 240 }],
    });
  });

  it('keeps canonical speed exact when a rounded mile pace is reopened or the sport changes', () => {
    const units = normalizeUserUnitSettings({
      distanceUnits: DistanceUnits.Miles,
      paceUnits: [PaceUnits.MinutesPerMile],
      swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard],
    });
    const structure: WorkoutStructureV1 = {
      version: 1, sport: ActivityTypes.Running,
      nodes: [{ kind: 'step', id: 'pace', purpose: 'work',
        ending: { kind: 'distance', meters: 1000 },
        targets: [{ kind: 'speed', mode: 'absolute', presentation: 'pace',
          minimumMetersPerSecond: 3.123456, maximumMetersPerSecond: 4.654321 }],
      }],
    };
    const editor = workoutStructureToManualEditor('Existing pace', '2026-09-03', structure, units);
    expect(manualWorkoutEditorToStructure(editor, units)).toEqual(structure);
    const swimEditor = changeManualWorkoutEditorSport(editor, ActivityTypes.Swimming, units);
    expect(manualWorkoutEditorToStructure(swimEditor, units).nodes).toEqual(structure.nodes);
    const changed = { ...editor, nodes: [{ ...editor.nodes[0], targetMinimum: 4 } as ManualWorkoutEditorValue['nodes'][number]] };
    expect(manualWorkoutEditorToStructure(changed, units).nodes).not.toEqual(structure.nodes);
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

  it.each([ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming])('keeps %s distances in metres and pace in the selected swim unit', sport => {
    const units = normalizeUserUnitSettings({ swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] });
    const value: ManualWorkoutEditorValue = {
      title: 'Swim intervals', localDate: '2026-09-24', sport,
      nodes: [{
        ...createManualWorkoutEditorStep('lengths'), endingKind: 'distance', endingValue: 100,
        targetKind: 'pace', targetMinimum: 1.5, targetMaximum: 2,
      }],
    };
    const structure = manualWorkoutEditorToStructure(value, units);
    expect(structure.nodes[0]).toMatchObject({
      ending: { kind: 'distance', meters: 100 },
      targets: [{
        minimumMetersPerSecond: 91.44 / 120,
        maximumMetersPerSecond: 91.44 / 90,
      }],
    });
    expect(workoutStructureToManualEditor(value.title, value.localDate, structure, units).nodes[0])
      .toMatchObject({ endingValue: 100, targetMinimum: 1.5, targetMaximum: 2 });
  });

  it('round-trips a selected 25 m or 25 yd pool without turning step distance into pool length', () => {
    const value: ManualWorkoutEditorValue = {
      title: 'Four lengths', localDate: '2026-09-24', sport: ActivityTypes.Swimming,
      poolLengthValue: 25, poolLengthUnit: 'meters',
      nodes: [{ kind: 'repeat', id: 'set', count: 4, steps: [{
        ...createManualWorkoutEditorStep('length'), endingKind: 'distance', endingValue: 25,
      }] }],
    };
    const meters = manualWorkoutEditorToStructure(value);
    expect(meters.poolLength).toEqual({ meters: 25, presentation: 'meters' });
    expect(meters.nodes[0]).toMatchObject({ count: 4, steps: [{ ending: { kind: 'distance', meters: 25 } }] });
    expect(workoutStructureToManualEditor(value.title, value.localDate, meters)).toMatchObject({
      poolLengthValue: 25, poolLengthUnit: 'meters',
    });
    expect(formatManualWorkoutStructure(meters)[0]).toBe('Pool · 25 m');
    expect(formatManualWorkoutStructure(meters, normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles }))[0])
      .toBe('Pool · 25 m');

    const yards = manualWorkoutEditorToStructure({ ...value, poolLengthUnit: 'yards' });
    expect(yards.poolLength).toEqual({ meters: 22.86, presentation: 'yards' });
    expect(workoutStructureToManualEditor(value.title, value.localDate, yards)).toMatchObject({
      poolLengthValue: 25, poolLengthUnit: 'yards',
    });
    expect(changeManualWorkoutEditorSport(value, ActivityTypes.OpenWaterSwimming).poolLengthValue).toBeNull();
    expect(manualWorkoutEditorToStructure(changeManualWorkoutEditorSport(value, ActivityTypes.OpenWaterSwimming)))
      .not.toHaveProperty('poolLength');
  });

  it.each([ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming])('preserves canonical distance and speed when switching to %s', sport => {
    const running: ManualWorkoutEditorValue = {
      title: 'Switch sport', localDate: '2026-09-24', sport: ActivityTypes.Running,
      nodes: [{
        ...createManualWorkoutEditorStep('work'), endingKind: 'distance', endingValue: 1,
        targetKind: 'pace', targetMinimum: 4, targetMaximum: 5,
      }],
    };
    const swimming = changeManualWorkoutEditorSport(running, sport);
    expect(swimming.nodes[0]).toMatchObject({ endingValue: 1000, targetMinimum: 0.4, targetMaximum: 0.5 });
    expect(manualWorkoutEditorToStructure(swimming).nodes).toEqual(manualWorkoutEditorToStructure(running).nodes);
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

    value.nodes = [{
      ...createManualWorkoutEditorStep('work'),
      targetKind: 'pace',
      targetMinimum: 5,
      targetMaximum: 4,
    }];
    expect(() => manualWorkoutEditorToStructure(value)).toThrow('Faster pace must not exceed slower pace');
    expect(() => manualWorkoutEditorToStructure(value, normalizeUserUnitSettings({
      paceUnits: [PaceUnits.MinutesPerMile],
    }))).toThrow('Faster pace must not exceed slower pace');
  });

  it('preserves step notes and accepts canonical zero-watt bounds', () => {
    const structure: WorkoutStructureV1 = {
      version: 1,
      sport: ActivityTypes.Cycling,
      nodes: [{
        kind: 'step',
        id: 'recovery',
        purpose: 'recovery',
        ending: { kind: 'time', seconds: 300 },
        targets: [{
          kind: 'power',
          mode: 'absolute',
          minimumWatts: 0,
          maximumWatts: 100,
        }],
        note: 'Keep the legs moving',
      }],
    };

    const editor = workoutStructureToManualEditor('Recovery', '2026-09-03', structure);
    expect(editor.nodes[0]).toMatchObject({
      targetKind: 'power',
      targetMinimum: 0,
      targetMaximum: 100,
      note: 'Keep the legs moving',
    });
    expect(manualWorkoutEditorToStructure(editor)).toEqual(structure);
  });

  it.each([
    ActivityTypes.TrailRunning,
    ActivityTypes.Treadmill,
    ActivityTypes.MountainBiking,
    ActivityTypes.IndoorCycling,
    ActivityTypes.EBiking,
    ActivityTypes.Handcycle,
  ])('round-trips the manual sport %s without changing canonical JSON', sport => {
    const structure: WorkoutStructureV1 = {
      version: 1,
      sport,
      nodes: [{
        kind: 'step',
        id: 'work',
        purpose: 'work',
        ending: { kind: 'time', seconds: 600 },
        targets: [],
      }],
    };

    const editor = workoutStructureToManualEditor('Sport-specific workout', '2026-09-03', structure);
    expect(editor.sport).toBe(sport);
    expect(manualWorkoutEditorToStructure(editor)).toEqual(structure);
  });

  it('rejects targets the first editor cannot represent instead of silently dropping them', () => {
    const base: WorkoutStructureV1 = {
      version: 1,
      sport: ActivityTypes.Running,
      nodes: [{
        kind: 'step',
        id: 'work',
        purpose: 'work',
        ending: { kind: 'time', seconds: 600 },
        targets: [{
          kind: 'cadence',
          mode: 'absolute',
          minimumRpm: 170,
          maximumRpm: 180,
        }],
      }],
    };
    expect(() => workoutStructureToManualEditor('Cadence', '2026-09-03', base))
      .toThrow('cadence target');

    const relative: WorkoutStructureV1 = {
      ...base,
      nodes: [{
        ...base.nodes[0],
        kind: 'step',
        targets: [{
          kind: 'heart-rate',
          mode: 'relative',
          minimumPercent: 80,
          maximumPercent: 90,
          reference: { kind: 'max-heart-rate', bpm: 190 },
        }],
      }],
    };
    expect(() => workoutStructureToManualEditor('Relative', '2026-09-03', relative))
      .toThrow('relative target');
  });
});
