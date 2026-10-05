import { ActivityTypes, SpeedUnits, PaceUnits, SwimPaceUnits } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { parseWorkoutStructureV1, type WorkoutTargetV1 } from '@shared/planned-workout';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { manualWorkoutEditorToStructure, workoutStructureToManualEditor } from './planned-workout-editor.helper';
import {
  changeManualEditorTargetPresentation, changeManualEditorTargetSport, createManualWorkoutEditorTarget, manualEditorTargetPreview,
  manualEditorTargetToWorkout, workoutEditorTargetUnit, workoutTargetToManualEditor,
} from './planned-workout-target-editor.helper';

const targets: WorkoutTargetV1[] = [
  { kind: 'heart-rate', mode: 'absolute', minimumBpm: 0, maximumBpm: 167.123456789 },
  { kind: 'power', mode: 'absolute', minimumWatts: 0, maximumWatts: 312.123456789 },
  { kind: 'cadence', mode: 'absolute', minimumRpm: 0, maximumRpm: 91.123456789 },
  ...(['pace', 'speed'] as const).map(presentation => ({ kind: 'speed' as const, mode: 'absolute' as const, presentation, minimumMetersPerSecond: 3.1234567890123, maximumMetersPerSecond: 4.9876543210987 })),
  ...(['max-heart-rate', 'threshold-heart-rate'] as const).map(kind => ({ kind: 'heart-rate' as const, mode: 'relative' as const, minimumPercent: 0, maximumPercent: 120.123456789, reference: { kind, bpm: 183.123456789 } })),
  ...(['functional-threshold-power', 'critical-power'] as const).map(kind => ({ kind: 'power' as const, mode: 'relative' as const, minimumPercent: 80.123456789, maximumPercent: 150.123456789, reference: { kind, watts: 283.123456789 } })),
  { kind: 'cadence', mode: 'relative', minimumPercent: 0, maximumPercent: 130.123456789, reference: { kind: 'preferred-cadence', rpm: 91.123456789 } },
  ...(['pace', 'speed'] as const).map(presentation => ({ kind: 'speed' as const, mode: 'relative' as const, presentation, minimumPercent: 0, maximumPercent: 130.123456789, reference: { kind: 'threshold-speed' as const, metersPerSecond: 3.1234567890123 } })),
];
const preferences = [normalizeUserUnitSettings({}), normalizeUserUnitSettings({ speedUnits: [SpeedUnits.MilesPerHour], paceUnits: [PaceUnits.MinutesPerMile], swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] })];

describe('ordered manual workout targets', () => {
  it.each(targets)('reopens and resaves exact $kind $mode $presentation with both unit systems', target => {
    for (const sport of [ActivityTypes.Running, ActivityTypes.Swimming, ActivityTypes.Rowing]) for (const units of preferences) {
      const structure = parseWorkoutStructureV1({ version: 1, sport, ...(sport === ActivityTypes.Swimming ? { poolLength: { meters: 22.123456789, presentation: 'yards' } } : {}),
        nodes: [{ kind: 'repeat', id: 'block', count: 2, steps: [{ kind: 'step', id: 'precise', purpose: 'work', ending: { kind: 'time', seconds: 61.123456789 }, targets: [target], note: 'Keep IDs and order' }] }] });
      const editor = workoutStructureToManualEditor('Precise', '2026-10-05', structure, units);
      expect(manualWorkoutEditorToStructure(editor, units)).toEqual(structure);
      expect(JSON.stringify(manualWorkoutEditorToStructure(editor, units))).not.toMatch(/source|rangeMode|referenceValue/);
    }
  });

  it('authors every reference explicitly, preserves percentages above 100, and rejects missing or incompatible references', () => {
    for (const canonical of targets.filter(t => t.mode === 'relative')) {
      const draft = workoutTargetToManualEditor(canonical, ActivityTypes.Running);
      const { source, ...fresh } = draft;
      expect(manualEditorTargetToWorkout(fresh, ActivityTypes.Running)).toMatchObject({ minimumPercent: draft.minimum, maximumPercent: draft.maximum });
      expect(() => manualEditorTargetToWorkout({ ...fresh, referenceValue: null }, ActivityTypes.Running)).toThrow('positive reference');
      expect(() => manualEditorTargetToWorkout({ ...fresh, referenceKind: 'threshold-speed' === fresh.referenceKind ? 'max-heart-rate' : 'threshold-speed' }, ActivityTypes.Running)).toThrow('compatible');
    }
  });

  it.each(['pace', 'speed'] as const)('edits one %s bound without rewriting the other bound or speed reference', presentation => {
    const target: WorkoutTargetV1 = { kind: 'speed', mode: 'absolute', presentation, minimumMetersPerSecond: 3.1234567890123, maximumMetersPerSecond: 4.9876543210987 };
    const draft = workoutTargetToManualEditor(target, ActivityTypes.Running, preferences[1]);
    const changed = manualEditorTargetToWorkout({ ...draft, minimum: draft.minimum! * 0.99 }, ActivityTypes.Running, preferences[1]);
    expect(changed).toMatchObject(presentation === 'pace' ? { minimumMetersPerSecond: target.minimumMetersPerSecond } : { maximumMetersPerSecond: target.maximumMetersPerSecond });
    const relative: WorkoutTargetV1 = { kind: 'speed', mode: 'relative', presentation, minimumPercent: 80, maximumPercent: 120, reference: { kind: 'threshold-speed', metersPerSecond: 3.1234567890123 } };
    const relativeDraft = workoutTargetToManualEditor(relative, ActivityTypes.Running, preferences[1]);
    expect(manualEditorTargetToWorkout({ ...relativeDraft, minimum: 90 }, ActivityTypes.Running, preferences[1])).toEqual({ ...relative, minimumPercent: 90 });
  });

  it('switches speed presentation without changing canonical speed or saved reference values', () => {
    for (const canonical of targets.filter(t => t.kind === 'speed')) {
      const draft = workoutTargetToManualEditor(canonical, ActivityTypes.Running, preferences[1]);
      const switched = changeManualEditorTargetPresentation(draft, canonical.kind === 'speed' && canonical.presentation === 'pace' ? 'speed' : 'pace', ActivityTypes.Running, preferences[1]);
      expect(manualEditorTargetToWorkout(switched, ActivityTypes.Running, preferences[1])).toEqual({ ...canonical, presentation: switched.presentation });
    }
  });

  it('accepts zero absolute speed, tiny speeds and single values', () => {
    for (const speed of [0, 1e-12, 3.1234567890123]) {
      const canonical: WorkoutTargetV1 = { kind: 'speed', mode: 'absolute', presentation: 'speed', minimumMetersPerSecond: speed, maximumMetersPerSecond: speed };
      const draft = workoutTargetToManualEditor(canonical, ActivityTypes.Running);
      expect(draft.rangeMode).toBe('single');
      expect(manualEditorTargetToWorkout(draft, ActivityTypes.Running)).toEqual(canonical);
    }
  });

  it.each(['pace', 'speed'] as const)('collapses close rounded %s bounds to one exact canonical value when Single is chosen', presentation => {
    const canonical: WorkoutTargetV1 = { kind: 'speed', mode: 'absolute', presentation, minimumMetersPerSecond: 3.123456781, maximumMetersPerSecond: 3.123456789 };
    const draft = workoutTargetToManualEditor(canonical, ActivityTypes.Running);
    expect(draft.minimum).toBe(draft.maximum);
    expect(manualEditorTargetToWorkout({ ...draft, rangeMode: 'single' }, ActivityTypes.Running)).toMatchObject({
      minimumMetersPerSecond: presentation === 'pace' ? canonical.maximumMetersPerSecond : canonical.minimumMetersPerSecond,
      maximumMetersPerSecond: presentation === 'pace' ? canonical.maximumMetersPerSecond : canonical.minimumMetersPerSecond,
    });
  });

  it('preserves two mixed targets in order and enforces unique kinds and the two-target limit', () => {
    const structure = parseWorkoutStructureV1({ version: 1, sport: ActivityTypes.Cycling, nodes: [{ kind: 'step', id: 'mixed', purpose: 'work', ending: { kind: 'distance', meters: 1234.123456789 }, targets: [targets[8], targets[0]] }] });
    const draft = workoutStructureToManualEditor('Mixed', '2026-10-05', structure);
    expect(manualWorkoutEditorToStructure(draft)).toEqual(structure);
    if (draft.nodes[0].kind !== 'step') throw new Error('Expected step');
    draft.nodes[0].targets.push(draft.nodes[0].targets[0]);
    expect(() => manualWorkoutEditorToStructure(draft)).toThrow();
    draft.nodes[0].targets = [draft.nodes[0].targets[0], draft.nodes[0].targets[0]];
    expect(() => manualWorkoutEditorToStructure(draft)).toThrow();
    draft.nodes[0].targets = [];
    expect(manualWorkoutEditorToStructure(draft).nodes[0]).toMatchObject({ targets: [] });
  });

  it('converts partial pace drafts across sports without reinterpreting completed inputs', () => {
    const partial = { ...createManualWorkoutEditorTarget('speed'), minimum: 4, maximum: null };
    expect(changeManualEditorTargetSport(partial, ActivityTypes.Running, ActivityTypes.Swimming)).toMatchObject({ minimum: 0.4, maximum: null });
    const canonical: WorkoutTargetV1 = { kind: 'speed', mode: 'relative', presentation: 'pace', minimumPercent: 80, maximumPercent: 90,
      reference: { kind: 'threshold-speed', metersPerSecond: 3.1234567890123 } };
    const draft = workoutTargetToManualEditor(canonical, ActivityTypes.Running);
    const swim = changeManualEditorTargetSport({ ...draft, maximum: null }, ActivityTypes.Running, ActivityTypes.Swimming);
    expect(manualEditorTargetToWorkout({ ...swim, maximum: 100 }, ActivityTypes.Swimming)).toEqual({ ...canonical, maximumPercent: 100 });
  });

  it('shows canonical resolved ranges and unit-aware speed while keeping a zero relative pace editable', () => {
    const draft = { ...createManualWorkoutEditorTarget('power'), mode: 'relative' as const, minimum: 80, maximum: 120, referenceValue: 250 };
    expect(manualEditorTargetPreview(draft, ActivityTypes.Cycling)).toContain('200');
    expect(manualEditorTargetPreview(draft, ActivityTypes.Cycling)).toContain('300');
    expect(workoutEditorTargetUnit({ ...createManualWorkoutEditorTarget('speed'), presentation: 'speed' }, ActivityTypes.Running, preferences[1])).toBe('mph');
    expect(manualEditorTargetPreview(workoutTargetToManualEditor(targets[10], ActivityTypes.Running), ActivityTypes.Running)).toContain('unavailable');
  });
});
