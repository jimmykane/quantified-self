import { ActivityTypes, SpeedUnits, PaceUnits, SwimPaceUnits } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { formatWorkoutTargetV1, parseWorkoutStructureV1, type WorkoutTargetV1 } from '@shared/planned-workout';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { manualWorkoutEditorToStructure, workoutStructureToManualEditor } from './planned-workout-editor.helper';
import {
  changeManualEditorTargetPresentation, changeManualEditorTargetSport, createManualWorkoutEditorTarget, manualEditorTargetPreview,
  copyManualWorkoutEditorTarget, manualEditorTargetToWorkout, workoutEditorTargetUnit, workoutTargetToManualEditor,
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

const resolvedTargetFixtures: { name: string; relative: WorkoutTargetV1; resolved: WorkoutTargetV1 }[] = [
  { name: 'maximum heart rate',
    relative: { kind: 'heart-rate', mode: 'relative', minimumPercent: 80, maximumPercent: 120, reference: { kind: 'max-heart-rate', bpm: 190 } },
    resolved: { kind: 'heart-rate', mode: 'absolute', minimumBpm: 152, maximumBpm: 228 } },
  { name: 'functional threshold power',
    relative: { kind: 'power', mode: 'relative', minimumPercent: 80, maximumPercent: 120, reference: { kind: 'functional-threshold-power', watts: 250 } },
    resolved: { kind: 'power', mode: 'absolute', minimumWatts: 200, maximumWatts: 300 } },
  { name: 'critical power',
    relative: { kind: 'power', mode: 'relative', minimumPercent: 75, maximumPercent: 105, reference: { kind: 'critical-power', watts: 300 } },
    resolved: { kind: 'power', mode: 'absolute', minimumWatts: 225, maximumWatts: 315 } },
  { name: 'threshold speed',
    relative: { kind: 'speed', mode: 'relative', presentation: 'pace', minimumPercent: 90, maximumPercent: 110, reference: { kind: 'threshold-speed', metersPerSecond: 5 } },
    resolved: { kind: 'speed', mode: 'absolute', presentation: 'pace', minimumMetersPerSecond: 4.5, maximumMetersPerSecond: 5.5 } },
];

describe('manual workout target resolution', () => {
  it.each(resolvedTargetFixtures)('resolves $name while retaining the explicit reference and percentages', ({ relative, resolved }) => {
    for (const units of preferences) {
      const draft = workoutTargetToManualEditor(relative, ActivityTypes.Running, units);
      expect(manualEditorTargetToWorkout(draft, ActivityTypes.Running, units)).toEqual(relative);
      expect(manualEditorTargetPreview(draft, ActivityTypes.Running, units))
        .toBe(`Resolved · ${formatWorkoutTargetV1(resolved, units, undefined, ActivityTypes.Running)}`);
      if (relative.kind === 'speed' && resolved.kind === 'speed') {
        const switched = changeManualEditorTargetPresentation(draft, 'speed', ActivityTypes.Running, units);
        expect(manualEditorTargetToWorkout(switched, ActivityTypes.Running, units)).toEqual({ ...relative, presentation: 'speed' });
        expect(manualEditorTargetPreview(switched, ActivityTypes.Running, units))
          .toBe(`Resolved · ${formatWorkoutTargetV1({ ...resolved, presentation: 'speed' }, units, undefined, ActivityTypes.Running)}`);
      }
    }
  });

  it('converts absolute 4–5 min/km pace without inverting canonical bounds', () => {
    const draft = { ...createManualWorkoutEditorTarget('speed'), presentation: 'pace' as const, minimum: 4, maximum: 5 };
    const expected: WorkoutTargetV1 = { kind: 'speed', mode: 'absolute', presentation: 'pace',
      minimumMetersPerSecond: 3.3333333333333335, maximumMetersPerSecond: 4.166666666666667 };
    expect(manualEditorTargetToWorkout(draft, ActivityTypes.Running)).toEqual(expected);
    const switched = changeManualEditorTargetPresentation(draft, 'speed', ActivityTypes.Running);
    expect(manualEditorTargetToWorkout(switched, ActivityTypes.Running)).toEqual({ ...expected, presentation: 'speed' });
  });
});

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
      const fresh = { ...draft, source: undefined };
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

  it.each(['pace', 'speed'] as const)('converts each completed %s field while another bound is unfinished', presentation => {
    const next = presentation === 'pace' ? 'speed' : 'pace';
    for (const units of preferences) {
      const canonical: WorkoutTargetV1 = { kind: 'speed', mode: 'absolute', presentation,
        minimumMetersPerSecond: 3.1234567890123, maximumMetersPerSecond: 4.9876543210987 };
      const draft = workoutTargetToManualEditor(canonical, ActivityTypes.Running, units);
      const switched = changeManualEditorTargetPresentation({ ...draft, maximum: null }, next, ActivityTypes.Running, units);
      expect(switched.minimum).toBeNull();
      expect(switched.maximum).toBe(workoutTargetToManualEditor({ ...canonical, presentation: next }, ActivityTypes.Running, units).maximum);
      const returned = changeManualEditorTargetPresentation(switched, presentation, ActivityTypes.Running, units);
      expect(returned.maximum).toBeNull();
      expect(manualEditorTargetToWorkout({ ...returned, maximum: draft.maximum }, ActivityTypes.Running, units))
        .toMatchObject(presentation === 'pace' ? { maximumMetersPerSecond: canonical.maximumMetersPerSecond }
          : { minimumMetersPerSecond: canonical.minimumMetersPerSecond });

      const relative: WorkoutTargetV1 = { kind: 'speed', mode: 'relative', presentation, minimumPercent: 80, maximumPercent: 120,
        reference: { kind: 'threshold-speed', metersPerSecond: 3.1234567890123 } };
      const relativeDraft = workoutTargetToManualEditor(relative, ActivityTypes.Running, units);
      const changed = changeManualEditorTargetPresentation({ ...relativeDraft, maximum: Number.NaN }, next, ActivityTypes.Running, units);
      expect(changed.minimum).toBe(80);
      expect(changed.maximum).toBeNaN();
      expect(manualEditorTargetToWorkout({ ...changed, maximum: 130 }, ActivityTypes.Running, units))
        .toEqual({ ...relative, presentation: next, maximumPercent: 130 });
    }
  });

  it('converts a manually entered reference while percentage bounds are still empty', () => {
    const draft = { ...createManualWorkoutEditorTarget('speed'), mode: 'relative' as const, referenceValue: 5 };
    const speed = changeManualEditorTargetPresentation(draft, 'speed', ActivityTypes.Running);
    expect(speed.referenceValue).toBe(12);
    expect(speed.minimum).toBeNull(); expect(speed.maximum).toBeNull();
    expect(changeManualEditorTargetPresentation(speed, 'pace', ActivityTypes.Running).referenceValue).toBe(5);
  });

  it.each(['pace', 'speed'] as const)('preserves newly typed %s values through combined presentation and sport changes in incomplete drafts', presentation => {
    for (const units of preferences) for (const saved of [false, true]) {
      const original: WorkoutTargetV1 = { kind: 'speed', mode: 'relative', presentation, minimumPercent: 80, maximumPercent: 120,
        reference: { kind: 'threshold-speed', metersPerSecond: 3.1234567890123 } };
      const relative = { ...(saved ? workoutTargetToManualEditor(original, ActivityTypes.Running, units)
        : { ...createManualWorkoutEditorTarget('speed'), mode: 'relative' as const, presentation, minimum: 80 }),
      maximum: null, referenceValue: presentation === 'pace' ? 4.123456789 : 12.123456789 };
      const expected = manualEditorTargetToWorkout({ ...relative, maximum: 120 }, ActivityTypes.Running, units);
      const next = presentation === 'pace' ? 'speed' : 'pace';
      const switched = changeManualEditorTargetPresentation(relative, next, ActivityTypes.Running, units);
      expect(manualEditorTargetToWorkout({ ...switched, maximum: 120 }, ActivityTypes.Running, units))
        .toEqual({ ...expected, presentation: next });
      const swim = changeManualEditorTargetSport(switched, ActivityTypes.Running, ActivityTypes.Swimming, units);
      const swimOriginalPresentation = changeManualEditorTargetPresentation(swim, presentation, ActivityTypes.Swimming, units);
      const returned = changeManualEditorTargetSport(swimOriginalPresentation, ActivityTypes.Swimming, ActivityTypes.Running, units);
      expect(manualEditorTargetToWorkout({ ...returned, maximum: 120 }, ActivityTypes.Running, units)).toEqual(expected);
      expect(JSON.stringify(manualEditorTargetToWorkout({ ...returned, maximum: 120 }, ActivityTypes.Running, units)))
        .not.toMatch(/source|speedSource|referenceSaved/);

      const absolute = { ...createManualWorkoutEditorTarget('speed'), presentation,
        minimum: presentation === 'pace' ? 4.123456789 : 12.123456789 };
      const single = manualEditorTargetToWorkout({ ...absolute, rangeMode: 'single' }, ActivityTypes.Running, units);
      const changed = changeManualEditorTargetPresentation(absolute, next, ActivityTypes.Running, units);
      const changedSport = changeManualEditorTargetSport(changed, ActivityTypes.Running, ActivityTypes.Swimming, units);
      const restored = changeManualEditorTargetPresentation(changedSport, presentation, ActivityTypes.Swimming, units);
      const final = changeManualEditorTargetSport(restored, ActivityTypes.Swimming, ActivityTypes.Running, units);
      expect(manualEditorTargetToWorkout({ ...final, rangeMode: 'single' }, ActivityTypes.Running, units)).toEqual(single);
    }
  });

  it('duplicates newly converted reference snapshots independently', () => {
    const draft = { ...createManualWorkoutEditorTarget('speed'), mode: 'relative' as const, referenceValue: 4.123456789 };
    const converted = changeManualEditorTargetPresentation(draft, 'speed', ActivityTypes.Running);
    const copied = copyManualWorkoutEditorTarget(converted);
    expect(copied.speedSource).toBeDefined();
    expect(copied.speedSource).not.toBe(converted.speedSource);
    expect(copied.speedSource!.referenceValue).not.toBe(converted.speedSource!.referenceValue);
    copied.speedSource!.referenceValue!.metersPerSecond = 10;
    expect(converted.speedSource!.referenceValue!.metersPerSecond).not.toBe(10);
  });

  it('does not overflow finite speed inputs when rounding their display precision', () => {
    const canonical: WorkoutTargetV1 = { kind: 'speed', mode: 'absolute', presentation: 'speed',
      minimumMetersPerSecond: 1e302, maximumMetersPerSecond: 1e302 };
    const draft = workoutTargetToManualEditor(canonical, ActivityTypes.Running);
    expect(Number.isFinite(draft.minimum)).toBe(true);
    expect(manualEditorTargetToWorkout(draft, ActivityTypes.Running)).toEqual(canonical);
  });

  it('accepts zero absolute speed, tiny speeds and single values', () => {
    for (const speed of [0, 1e-12, 3.1234567890123]) {
      const canonical: WorkoutTargetV1 = { kind: 'speed', mode: 'absolute', presentation: 'speed', minimumMetersPerSecond: speed, maximumMetersPerSecond: speed };
      const draft = workoutTargetToManualEditor(canonical, ActivityTypes.Running);
      expect(draft.rangeMode).toBe('single');
      expect(manualEditorTargetToWorkout(draft, ActivityTypes.Running)).toEqual(canonical);
    }
  });

  it('does not turn a zero speed in an unfinished range into an infinite pace input', () => {
    const canonical: WorkoutTargetV1 = { kind: 'speed', mode: 'absolute', presentation: 'speed',
      minimumMetersPerSecond: 0, maximumMetersPerSecond: 5 };
    for (const saved of [false, true]) {
      const draft = saved ? workoutTargetToManualEditor(canonical, ActivityTypes.Cycling)
        : { ...createManualWorkoutEditorTarget('speed'), presentation: 'speed' as const, minimum: 0 };
      const pace = changeManualEditorTargetPresentation({ ...draft, maximum: null }, 'pace', ActivityTypes.Cycling);
      expect(pace.minimum).toBeNull(); expect(pace.maximum).toBeNull();
      expect(pace.speedSource?.minimum).toBeUndefined(); expect(pace.speedSource?.maximum).toBeUndefined();
      expect(() => manualEditorTargetToWorkout(pace, ActivityTypes.Cycling)).toThrow('numeric values');
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

  it.each(['pace', 'speed'] as const)('keeps an equal displayed %s range valid when one bound is set to the untouched bound', presentation => {
    const canonical: WorkoutTargetV1 = { kind: 'speed', mode: 'absolute', presentation,
      minimumMetersPerSecond: 3.1234567890123, maximumMetersPerSecond: 4.9876543210987 };
    for (const units of preferences) for (const field of ['minimum', 'maximum'] as const) {
      const draft = workoutTargetToManualEditor(canonical, ActivityTypes.Running, units);
      const other = field === 'minimum' ? 'maximum' : 'minimum';
      const target = manualEditorTargetToWorkout({ ...draft, [field]: draft[other] }, ActivityTypes.Running, units);
      const value = (presentation === 'pace') === (other === 'minimum')
        ? canonical.maximumMetersPerSecond : canonical.minimumMetersPerSecond;
      expect(target).toEqual({ ...canonical, minimumMetersPerSecond: value, maximumMetersPerSecond: value });
      expect(() => parseWorkoutStructureV1({ version: 1, sport: ActivityTypes.Running,
        nodes: [{ kind: 'step', id: 'equal', purpose: 'work', ending: { kind: 'manual' }, targets: [target] }] })).not.toThrow();
    }
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
