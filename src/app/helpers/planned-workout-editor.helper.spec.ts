import { ActivityTypes, DistanceUnits, PaceUnits, SpeedUnits, SwimPaceUnits } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import type { WorkoutStructureV1 } from '@shared/planned-workout';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import {
  createManualWorkoutEditorStep,
  changeManualWorkoutEditorSport,
  changeManualWorkoutEditorStepEnding,
  changeManualWorkoutEditorStepTarget,
  manualWorkoutEditorSpeedUnit,
  formatManualWorkoutStructure,
  manualWorkoutEditorToStructure,
  workoutStructureToManualEditor,
  type ManualWorkoutEditorStep,
  type ManualWorkoutEditorValue,
} from './planned-workout-editor.helper';

describe('manual planned-workout editor conversion', () => {
  it.each([ActivityTypes.Running, ActivityTypes.TrailRunning, ActivityTypes.Treadmill,
    ActivityTypes.Cycling, ActivityTypes.IndoorCycling, ActivityTypes.MountainBiking])('round-trips editable cadence for %s', sport => {
    const value: ManualWorkoutEditorValue = { title: 'Cadence intervals', localDate: '2026-10-05', sport,
      nodes: [{ ...createManualWorkoutEditorStep('cadence'), targetKind: 'cadence', targetMinimum: 80, targetMaximum: 95 }] };
    const structure = manualWorkoutEditorToStructure(value);
    expect(structure.nodes[0]).toMatchObject({ targets: [{ kind: 'cadence', mode: 'absolute', minimumRpm: 80, maximumRpm: 95 }] });
    const reopened = workoutStructureToManualEditor(value.title, value.localDate, structure);
    expect(reopened.nodes[0]).toMatchObject({ targetKind: 'cadence', targetMinimum: 80, targetMaximum: 95 });
    expect(manualWorkoutEditorToStructure(reopened)).toEqual(structure);
    for (const nextSport of [ActivityTypes.Swimming, ActivityTypes.Rowing, ActivityTypes.Hiking]) {
      expect(manualWorkoutEditorToStructure(changeManualWorkoutEditorSport(reopened, nextSport)).nodes).toEqual(structure.nodes);
    }
  });

  it.each([[null, 90], [NaN, 90], [-1, 90], [95, 80]])('rejects invalid cadence bounds %s–%s', (minimum, maximum) => {
    const value: ManualWorkoutEditorValue = { title: 'Invalid cadence', localDate: '2026-10-05', sport: ActivityTypes.Cycling,
      nodes: [{ ...createManualWorkoutEditorStep('invalid'), targetKind: 'cadence', targetMinimum: minimum, targetMaximum: maximum }] };
    expect(() => manualWorkoutEditorToStructure(value)).toThrow();
  });

  it('clears incompatible numeric bounds when switching to or from cadence', () => {
    const pace: ManualWorkoutEditorStep = { ...createManualWorkoutEditorStep('pace'), targetKind: 'pace', targetMinimum: 4, targetMaximum: 5 };
    const cadence = changeManualWorkoutEditorStepTarget(pace, 'cadence', ActivityTypes.Running);
    expect(cadence).toMatchObject({ targetKind: 'cadence', targetMinimum: null, targetMaximum: null });
    expect(changeManualWorkoutEditorStepTarget({ ...cadence, targetMinimum: 170, targetMaximum: 180 }, 'speed', ActivityTypes.Running))
      .toMatchObject({ targetKind: 'speed', targetMinimum: null, targetMaximum: null });
  });

  it.each([
    { unit: SpeedUnits.KilometersPerHour, label: 'km/h', minimum: 18, maximum: 36, factor: 3.6 },
    { unit: SpeedUnits.MilesPerHour, label: 'mph', minimum: 10, maximum: 20, factor: 3600 / 1609.344 },
    { unit: SpeedUnits.MetersPerSecond, label: 'm/s', minimum: 5, maximum: 10, factor: 1 },
    { unit: SpeedUnits.FeetPerSecond, label: 'ft/s', minimum: 10, maximum: 20, factor: 1 / .3048 },
    { unit: SpeedUnits.Knots, label: 'kn', minimum: 10, maximum: 20, factor: 3600 / 1852 },
  ])('stores cycling speed entered in $label as canonical m/s', ({ unit, label, minimum, maximum, factor }) => {
    const units = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles,
      paceUnits: [PaceUnits.MinutesPerMile], speedUnits: [unit] });
    const value: ManualWorkoutEditorValue = { title: 'Cycling intervals', localDate: '2026-10-05', sport: ActivityTypes.Cycling,
      nodes: [{ ...createManualWorkoutEditorStep('ride'), targetKind: 'speed', targetMinimum: minimum, targetMaximum: maximum }] };
    const structure = manualWorkoutEditorToStructure(value, units);
    const node = structure.nodes[0];
    if (node.kind !== 'step' || node.targets[0].kind !== 'speed' || node.targets[0].mode !== 'absolute') throw new Error('Expected speed target');
    const target = node.targets[0];
    expect(manualWorkoutEditorSpeedUnit(units)).toBe(label);
    expect(target).toMatchObject({ kind: 'speed', mode: 'absolute', presentation: 'speed' });
    expect(target.minimumMetersPerSecond).toBeCloseTo(minimum / factor, 10);
    expect(target.maximumMetersPerSecond).toBeCloseTo(maximum / factor, 10);
    expect(workoutStructureToManualEditor(value.title, value.localDate, structure, units).nodes[0])
      .toMatchObject({ targetKind: 'speed', targetMinimum: minimum, targetMaximum: maximum });
  });

  it('preserves exact saved speed through reopen and sport changes', () => {
    const units = normalizeUserUnitSettings({ speedUnits: [SpeedUnits.MilesPerHour] });
    const structure: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Cycling,
      nodes: [{ kind: 'step', id: 'precise', purpose: 'work', ending: { kind: 'time', seconds: 60 },
        targets: [{ kind: 'speed', mode: 'absolute', presentation: 'speed', minimumMetersPerSecond: 5.123456789,
          maximumMetersPerSecond: 10.987654321 }] }] };
    const editor = workoutStructureToManualEditor('Exact speed', '2026-10-05', structure, units);
    expect(manualWorkoutEditorToStructure(editor, units)).toEqual(structure);
    const indoor = changeManualWorkoutEditorSport(editor, ActivityTypes.IndoorCycling, units);
    expect(manualWorkoutEditorToStructure(indoor, units).nodes).toEqual(structure.nodes);
  });

  it('converts pace and speed choices without changing the physical target range', () => {
    const step: ManualWorkoutEditorStep = { ...createManualWorkoutEditorStep('pace'), targetKind: 'pace', targetMinimum: 4, targetMaximum: 5 };
    const speed = changeManualWorkoutEditorStepTarget(step, 'speed', ActivityTypes.Cycling);
    expect(speed).toMatchObject({ targetKind: 'speed', targetMinimum: 12, targetMaximum: 15 });
    const pace = changeManualWorkoutEditorStepTarget(speed, 'pace', ActivityTypes.Cycling);
    expect(pace).toMatchObject({ targetKind: 'pace', targetMinimum: 4, targetMaximum: 5 });
    const value: ManualWorkoutEditorValue = { title: 'Presentation', localDate: '2026-10-05', sport: ActivityTypes.Cycling, nodes: [pace] };
    expect(manualWorkoutEditorToStructure(value).nodes[0]).toMatchObject({ targets: [{
      presentation: 'pace', minimumMetersPerSecond: 1000 / 300, maximumMetersPerSecond: 1000 / 240,
    }] });
  });

  it('keeps zero-speed bounds finite and clears an unconvertible pace draft', () => {
    const step: ManualWorkoutEditorStep = { ...createManualWorkoutEditorStep('stopped'), targetKind: 'speed', targetMinimum: 0, targetMaximum: 18 };
    const value: ManualWorkoutEditorValue = { title: 'Speed', localDate: '2026-10-05', sport: ActivityTypes.Cycling, nodes: [step] };
    expect(manualWorkoutEditorToStructure(value).nodes[0]).toMatchObject({ targets: [{ presentation: 'speed', minimumMetersPerSecond: 0,
      maximumMetersPerSecond: 5 }] });
    expect(changeManualWorkoutEditorStepTarget(step, 'pace', ActivityTypes.Cycling))
      .toMatchObject({ targetKind: 'pace', targetMinimum: null, targetMaximum: null });
  });

  it.each([[null, 18], [NaN, 18], [-1, 18], [36, 18]])('rejects invalid speed bounds %s–%s', (minimum, maximum) => {
    const value: ManualWorkoutEditorValue = { title: 'Invalid speed', localDate: '2026-10-05', sport: ActivityTypes.Cycling,
      nodes: [{ ...createManualWorkoutEditorStep('invalid'), targetKind: 'speed', targetMinimum: minimum, targetMaximum: maximum }] };
    expect(() => manualWorkoutEditorToStructure(value)).toThrow();
  });

  it.each([75, 90, 3723, 123.456789012345, 1e-9])('preserves exact %s-second endings through reopen and lap toggles', seconds => {
    const structure: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Running,
      nodes: [{ kind: 'repeat', id: 'repeat', count: 3, steps: [
        { kind: 'step', id: 'timed', purpose: 'work', ending: { kind: 'time', seconds }, targets: [] },
      ] }] };
    const editor = workoutStructureToManualEditor('Intervals', '2026-10-04', structure);
    expect(manualWorkoutEditorToStructure(editor)).toEqual(structure);
    const repeat = editor.nodes[0];
    if (repeat.kind !== 'repeat') throw new Error('Expected repeat');
    const manual = changeManualWorkoutEditorStepEnding(repeat.steps[0], 'manual', editor.sport);
    const time = changeManualWorkoutEditorStepEnding(manual, 'time', editor.sport);
    expect(manualWorkoutEditorToStructure({ ...editor, nodes: [{ ...repeat, steps: [time] }] })).toEqual(structure);
    expect(changeManualWorkoutEditorStepEnding(manual, 'distance', editor.sport).sourceDuration).toBeUndefined();
    expect(manualWorkoutEditorToStructure({ ...editor, nodes: [{ ...repeat, steps: [{ ...time, endingValue: 1.5 }] }] })
      .nodes[0]).toMatchObject({ steps: [{ ending: { kind: 'time', seconds: 90 } }] });
  });
  it('preserves exact saved metres through lap toggles without persisting the hidden distance', () => {
    const units = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
    const structure: WorkoutStructureV1 = {
      version: 1, sport: ActivityTypes.Running,
      nodes: [{ kind: 'step', id: 'distance', purpose: 'warmup',
        ending: { kind: 'distance', meters: 1000 }, targets: [] }],
    };
    const editor = workoutStructureToManualEditor('Draft', '2026-10-03', structure, units);
    const step = editor.nodes[0] as ManualWorkoutEditorStep;
    const lap = changeManualWorkoutEditorStepEnding(step, 'manual', editor.sport, units);
    expect(manualWorkoutEditorToStructure({ ...editor, nodes: [lap] }, units).nodes[0])
      .toEqual({ ...structure.nodes[0], ending: { kind: 'manual' } });
    expect(manualWorkoutEditorToStructure({ ...editor, nodes: [
      changeManualWorkoutEditorStepEnding(lap, 'distance', editor.sport, units),
    ] }, units)).toEqual(structure);
    expect(changeManualWorkoutEditorStepEnding(lap, 'manual', editor.sport, units)).toBe(lap);
  });

  it.each([ActivityTypes.Swimming, ActivityTypes.Rowing])(
    'converts an unsaved distance draft while lap-ended when switching to %s', sport => {
      const units = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
      const distance: ManualWorkoutEditorStep = {
        ...createManualWorkoutEditorStep('mile'), endingKind: 'distance', endingValue: 1,
      };
      const editor: ManualWorkoutEditorValue = {
        title: 'Draft', localDate: '2026-10-03', sport: ActivityTypes.Running,
        nodes: [{ kind: 'repeat', id: 'repeats', count: 2,
          steps: [changeManualWorkoutEditorStepEnding(distance, 'manual', ActivityTypes.Running, units)] }],
      };
      const converted = changeManualWorkoutEditorSport(editor, sport, units);
      const repeat = converted.nodes[0];
      expect(repeat.kind).toBe('repeat');
      if (repeat.kind !== 'repeat') throw new Error('Expected a repeat');
      expect(repeat.steps[0].endingValue).toBe(1609.344);
      expect(manualWorkoutEditorToStructure({ ...converted, nodes: [{ ...repeat,
        steps: [changeManualWorkoutEditorStepEnding(repeat.steps[0], 'distance', sport, units)],
      }] }, units).nodes[0]).toMatchObject({ steps: [{ ending: { kind: 'distance', meters: 1609.344 } }] });
    },
  );

  it('clears the distance cache when switching a lap draft to time', () => {
    const units = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
    const distance: ManualWorkoutEditorStep = {
      ...createManualWorkoutEditorStep('distance'), endingKind: 'distance', endingValue: 0.621371,
      sourceDistance: { editorValue: 0.621371, meters: 1000 },
    };
    const lap = changeManualWorkoutEditorStepEnding(distance, 'manual', ActivityTypes.Running, units);
    const time = changeManualWorkoutEditorStepEnding(lap, 'time', ActivityTypes.Running, units);
    expect(time.sourceDistance).toBeUndefined();
    const nextLap = changeManualWorkoutEditorStepEnding(time, 'manual', ActivityTypes.Running, units);
    expect(nextLap.sourceDistance).toBeUndefined();
    const nextDistance = changeManualWorkoutEditorStepEnding(nextLap, 'distance', ActivityTypes.Running, units);
    expect(nextDistance.sourceDistance).toBeUndefined();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE])(
    'allows an invalid distance draft of %s to become a valid lap step without retaining a cache', endingValue => {
      const step: ManualWorkoutEditorStep = {
        ...createManualWorkoutEditorStep('lap'), endingKind: 'distance', endingValue,
      };
      const lap = changeManualWorkoutEditorStepEnding(step, 'manual', ActivityTypes.Running);
      expect(lap.sourceDistance).toBeUndefined();
      expect(manualWorkoutEditorToStructure({
        title: 'Lap', localDate: '2026-10-03', sport: ActivityTypes.Running, nodes: [lap],
      }).nodes[0]).toMatchObject({ ending: { kind: 'manual' } });
    },
  );

  it.each(['warmup', 'work', 'recovery', 'cooldown', 'rest', 'other'] as const)(
    'round-trips a lap-ended %s with its ID, target and instructions intact', purpose => {
      const structure: WorkoutStructureV1 = {
        version: 1, sport: ActivityTypes.Running,
        nodes: [{ kind: 'step', id: `lap-${purpose}`, purpose, ending: { kind: 'manual' },
          targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 140 }],
          note: 'Press lap when ready' }],
      };
      const units = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
      const editor = workoutStructureToManualEditor('Lap steps', '2026-10-03', structure, units);
      expect(editor.nodes[0]).toMatchObject({ endingKind: 'manual' });
      expect(manualWorkoutEditorToStructure(editor, units)).toEqual(structure);
      expect(JSON.parse(JSON.stringify(manualWorkoutEditorToStructure(editor, units)))).toEqual(structure);
      expect(formatManualWorkoutStructure(structure, units).join(' ')).toContain('Manual transition');
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not invent a numeric limit from a stale lap-step draft value of %s', endingValue => {
      const editor: ManualWorkoutEditorValue = {
        title: 'Wait for lap', localDate: '2026-10-03', sport: ActivityTypes.Cycling,
        nodes: [{ ...createManualWorkoutEditorStep('lap'), endingKind: 'manual', endingValue }],
      };
      expect(manualWorkoutEditorToStructure(editor).nodes[0]).toEqual({
        kind: 'step', id: 'lap', purpose: 'work', ending: { kind: 'manual' }, targets: [],
      });
      for (const endingKind of ['time', 'distance'] as const) {
        const numeric = { ...editor, nodes: [{ ...createManualWorkoutEditorStep('lap'), endingKind, endingValue }] };
        expect(() => manualWorkoutEditorToStructure(numeric)).toThrow('positive duration or distance');
      }
    },
  );

  it('round-trips mixed fixed repeats and preserves lap endings across sport changes', () => {
    const structure: WorkoutStructureV1 = {
      version: 1, sport: ActivityTypes.Running,
      nodes: [
        { kind: 'step', id: 'warmup', purpose: 'warmup', ending: { kind: 'manual' }, targets: [] },
        { kind: 'repeat', id: 'repeats', count: 3, steps: [
          { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'distance', meters: 1000 }, targets: [] },
          { kind: 'step', id: 'recover', purpose: 'recovery', ending: { kind: 'manual' }, targets: [], note: 'Wait until ready' },
        ] },
        { kind: 'step', id: 'cooldown', purpose: 'cooldown', ending: { kind: 'time', seconds: 300 }, targets: [] },
      ],
    };
    const editor = workoutStructureToManualEditor('Mixed workout', '2026-10-03', structure);
    expect(manualWorkoutEditorToStructure(editor)).toEqual(structure);
    expect(manualWorkoutEditorToStructure(changeManualWorkoutEditorSport(editor, ActivityTypes.Hiking)))
      .toEqual({ ...structure, sport: ActivityTypes.Hiking });
  });

  it.each([{ kind: 'kilojoules', kilojoules: 10 }, { kind: 'repetitions', repetitions: 10 }] as const)(
    'still refuses to edit unsupported %s endings without silently changing them', ending => {
      const structure: WorkoutStructureV1 = {
        version: 1, sport: ActivityTypes.Cycling,
        nodes: [{ kind: 'step', id: 'work', purpose: 'work', ending, targets: [] }],
      };
      expect(() => workoutStructureToManualEditor('Unsupported', '2026-10-03', structure))
        .toThrow('ending that the first manual editor cannot change');
    },
  );

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

  it.each([ActivityTypes.Rowing, ActivityTypes.IndoorRowing])('keeps %s distance in metres and pace as a 500 m split', sport => {
    const value: ManualWorkoutEditorValue = {
      title: 'Row intervals', localDate: '2026-09-24', sport,
      nodes: [{
        ...createManualWorkoutEditorStep('interval'), endingKind: 'distance', endingValue: 500,
        targetKind: 'pace', targetMinimum: 1.75, targetMaximum: 2,
      }],
    };
    const structure = manualWorkoutEditorToStructure(value);
    expect(structure).toMatchObject({ sport, nodes: [{
      ending: { kind: 'distance', meters: 500 },
      targets: [{ minimumMetersPerSecond: 500 / 120, maximumMetersPerSecond: 500 / 105 }],
    }] });
    expect(workoutStructureToManualEditor(value.title, value.localDate, structure).nodes[0])
      .toMatchObject({ endingValue: 500, targetMinimum: 1.75, targetMaximum: 2 });
    expect(formatManualWorkoutStructure(structure).join(' ')).toContain('500');
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
    expect(workoutStructureToManualEditor('Cadence', '2026-09-03', base).nodes[0])
      .toMatchObject({ targetKind: 'cadence', targetMinimum: 170, targetMaximum: 180 });

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


describe('early-Lap editor preservation', () => {
  it.each([undefined, false, true])('round-trips %s through repeats and temporary manual ending', allowEarlyLap => {
    const structure: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Running, nodes: [{ kind: 'repeat', id: 'repeat', count: 3,
      steps: [{ kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'distance', meters: 1609.344,
        ...(allowEarlyLap === undefined ? {} : { allowEarlyLap }) }, targets: [] }] }] };
    const editor = workoutStructureToManualEditor('Intervals', '2026-10-06', structure);
    expect(manualWorkoutEditorToStructure(editor)).toEqual(structure);
    const repeat = editor.nodes[0];
    if (repeat.kind !== 'repeat') throw new Error('Expected repeat');
    const manual = changeManualWorkoutEditorStepEnding(repeat.steps[0], 'manual', editor.sport);
    repeat.steps[0] = manual;
    expect(manualWorkoutEditorToStructure(editor).nodes[0]).toMatchObject({ steps: [{ ending: { kind: 'manual' } }] });
    repeat.steps[0] = changeManualWorkoutEditorStepEnding(manual, 'distance', editor.sport);
    expect(manualWorkoutEditorToStructure(editor)).toEqual(structure);
  });
});
