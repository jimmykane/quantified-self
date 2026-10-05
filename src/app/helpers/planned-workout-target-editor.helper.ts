import {
  ActivityTypes, PaceUnits, SwimPaceUnits, DataCadence, DataHeartRate, DataPace, DataPower, DataSpeed, DataSwimDistance, DataSwimPace,
  DynamicDataLoader, type DataInterface, type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import {
  formatWorkoutTargetV1, isRowingWorkoutSportV1, isSwimmingWorkoutSportV1,
  type WorkoutTargetKindV1, type WorkoutTargetV1,
} from '@shared/planned-workout';
import { normalizeUserUnitSettings, resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';

type RelativeTarget = Extract<WorkoutTargetV1, { mode: 'relative' }>;
export type WorkoutEditorReferenceKind = RelativeTarget['reference']['kind'];
type SpeedEditorField = 'minimum' | 'maximum' | 'referenceValue';
interface EditorSpeedSnapshot { editorValue: number; metersPerSecond: number }
export interface ManualWorkoutEditorTarget {
  kind: WorkoutTargetKindV1;
  mode: 'absolute' | 'relative';
  presentation: 'pace' | 'speed';
  rangeMode: 'single' | 'range';
  minimum: number | null;
  maximum: number | null;
  referenceKind: WorkoutEditorReferenceKind;
  referenceValue: number | null;
  /** Local display snapshot. Never serialized into the canonical recipe. */
  source?: { target: WorkoutTargetV1; minimum: number; maximum: number; referenceValue: number | null; referenceSaved?: boolean };
  /** Exact completed fields through conversion of an unfinished draft. Never persisted. */
  speedSource?: { mode: 'absolute' | 'relative'; presentation: 'pace' | 'speed';
    minimum?: EditorSpeedSnapshot; maximum?: EditorSpeedSnapshot; referenceValue?: EditorSpeedSnapshot };
}

function cloneWorkoutTarget(target: WorkoutTargetV1): WorkoutTargetV1 {
  if (target.mode === 'absolute') return { ...target };
  switch (target.kind) {
    case 'heart-rate': return { ...target, reference: { ...target.reference } };
    case 'power': return { ...target, reference: { ...target.reference } };
    case 'speed': return { ...target, reference: { ...target.reference } };
    case 'cadence': return { ...target, reference: { ...target.reference } };
  }
}

export function copyManualWorkoutEditorTarget(target: ManualWorkoutEditorTarget): ManualWorkoutEditorTarget {
  return { ...target, ...(target.source ? { source: { ...target.source, target: cloneWorkoutTarget(target.source.target) } } : {}),
    ...(target.speedSource ? { speedSource: { ...target.speedSource,
      ...(target.speedSource.minimum ? { minimum: { ...target.speedSource.minimum } } : {}),
      ...(target.speedSource.maximum ? { maximum: { ...target.speedSource.maximum } } : {}),
      ...(target.speedSource.referenceValue ? { referenceValue: { ...target.speedSource.referenceValue } } : {}),
    } } : {}) };
}

export const WORKOUT_EDITOR_REFERENCE_OPTIONS: Record<WorkoutTargetKindV1, readonly { value: WorkoutEditorReferenceKind; label: string }[]> = {
  'heart-rate': [{ value: 'max-heart-rate', label: 'Maximum heart rate' }, { value: 'threshold-heart-rate', label: 'Threshold heart rate' }],
  power: [{ value: 'functional-threshold-power', label: 'Functional threshold power' }, { value: 'critical-power', label: 'Critical power' }],
  speed: [{ value: 'threshold-speed', label: 'Threshold speed / pace' }],
  cadence: [{ value: 'preferred-cadence', label: 'Preferred cadence' }],
};

export function createManualWorkoutEditorTarget(kind: WorkoutTargetKindV1 = 'heart-rate'): ManualWorkoutEditorTarget {
  return { kind, mode: 'absolute', presentation: 'pace', rangeMode: 'range', minimum: null, maximum: null,
    referenceKind: WORKOUT_EDITOR_REFERENCE_OPTIONS[kind][0].value, referenceValue: null };
}

function selectedData(data: DataInterface, units?: UserUnitSettingsInterface | null): DataInterface {
  return DynamicDataLoader.getUnitBasedDataFromDataInstance(data, normalizeUserUnitSettings(units))[0] ?? data;
}

function paceDistance(sport: ActivityTypes, units?: UserUnitSettingsInterface | null): number {
  if (isRowingWorkoutSportV1(sport)) return 500;
  const selected = normalizeUserUnitSettings(units);
  // Exact inverse distances: Sports Lib rounds its mile conversion factor for display.
  return isSwimmingWorkoutSportV1(sport)
    ? selected.swimPaceUnits[0] === SwimPaceUnits.MinutesPer100Yard ? 91.44 : 100
    : selected.paceUnits[0] === PaceUnits.MinutesPerMile ? 1609.344 : 1000;
}

function speedScale(units?: UserUnitSettingsInterface | null): number {
  return Number(selectedData(new DataSpeed(1), units).getValue());
}

function roundInput(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Number.isFinite(rounded) && (rounded !== 0 || value === 0) ? rounded : value;
}

function toSpeed(value: number, presentation: 'pace' | 'speed', sport: ActivityTypes, units?: UserUnitSettingsInterface | null): number {
  return presentation === 'pace' ? paceDistance(sport, units) / (value * 60) : value / speedScale(units);
}
function fromSpeed(value: number, presentation: 'pace' | 'speed', sport: ActivityTypes, units?: UserUnitSettingsInterface | null): number {
  return roundInput(presentation === 'pace' ? paceDistance(sport, units) / (value * 60) : value * speedScale(units));
}

export function workoutEditorTargetUnit(target: ManualWorkoutEditorTarget, sport: ActivityTypes, units?: UserUnitSettingsInterface | null): string {
  const unit = (data: DataInterface) => resolveUnitAwareDisplayStat(data, normalizeUserUnitSettings(units))!.unit;
  switch (target.kind) {
    case 'heart-rate': return unit(new DataHeartRate(1));
    case 'power': return unit(new DataPower(1));
    case 'cadence': return unit(new DataCadence(1));
    case 'speed': {
      if (target.presentation === 'speed') return unit(new DataSpeed(1));
      // Rowing has a fixed split denominator, independent of running/swimming preferences.
      if (isRowingWorkoutSportV1(sport)) {
        const minutes = resolveUnitAwareDisplayStat(new DataPace(1))!.unit.split('/')[0];
        const distance = resolveUnitAwareDisplayStat(new DataSwimDistance(500))!;
        return `${minutes}/${distance.value}${distance.unit}`;
      }
      return unit(isSwimmingWorkoutSportV1(sport) ? new DataSwimPace(100) : new DataPace(1000));
    }
  }
}

function bounds(target: WorkoutTargetV1): [number, number] {
  if (target.mode === 'relative') return [target.minimumPercent, target.maximumPercent];
  switch (target.kind) {
    case 'heart-rate': return [target.minimumBpm, target.maximumBpm];
    case 'power': return [target.minimumWatts, target.maximumWatts];
    case 'cadence': return [target.minimumRpm, target.maximumRpm];
    case 'speed': return [target.minimumMetersPerSecond, target.maximumMetersPerSecond];
  }
}
function referenceValue(target: RelativeTarget): number {
  switch (target.kind) {
    case 'heart-rate': return target.reference.bpm;
    case 'power': return target.reference.watts;
    case 'cadence': return target.reference.rpm;
    case 'speed': return target.reference.metersPerSecond;
  }
}

function cachedEditorSpeed(target: ManualWorkoutEditorTarget, field: SpeedEditorField): number | undefined {
  const source = target.speedSource;
  const snapshot = source?.[field];
  return target.kind === 'speed' && source?.mode === target.mode && source.presentation === target.presentation
    && snapshot?.editorValue === target[field] ? snapshot.metersPerSecond : undefined;
}

export function manualEditorTargetHasSavedReference(target: ManualWorkoutEditorTarget): boolean {
  const source = target.source;
  const saved = source?.target;
  return target.mode === 'relative' && saved?.mode === 'relative' && saved.kind === target.kind
    && source.referenceSaved !== false && saved.reference.kind === target.referenceKind
    && (saved.kind !== 'speed' || saved.presentation === target.presentation)
    && source.referenceValue === target.referenceValue;
}

export function workoutTargetToManualEditor(target: WorkoutTargetV1, sport: ActivityTypes, units?: UserUnitSettingsInterface | null): ManualWorkoutEditorTarget {
  const [low, high] = bounds(target);
  const presentation = target.kind === 'speed' ? target.presentation : 'pace';
  const inverse = target.kind === 'speed' && target.mode === 'absolute' && presentation === 'pace';
  const minimum = target.kind === 'speed' && target.mode === 'absolute' ? fromSpeed(inverse ? high : low, presentation, sport, units) : low;
  const maximum = target.kind === 'speed' && target.mode === 'absolute' ? fromSpeed(inverse ? low : high, presentation, sport, units) : high;
  const ref = target.mode === 'relative' ? target.kind === 'speed' ? fromSpeed(referenceValue(target), presentation, sport, units) : referenceValue(target) : null;
  return { ...createManualWorkoutEditorTarget(target.kind), mode: target.mode, presentation,
    rangeMode: low === high ? 'single' : 'range', minimum, maximum,
    ...(target.mode === 'relative' ? { referenceKind: target.reference.kind } : {}), referenceValue: ref,
    source: { target: cloneWorkoutTarget(target), minimum, maximum, referenceValue: ref, referenceSaved: target.mode === 'relative' } };
}

/** Preserve each untouched canonical bound independently, including inverted pace bounds. */
export function manualEditorTargetToWorkout(target: ManualWorkoutEditorTarget, sport: ActivityTypes, units?: UserUnitSettingsInterface | null): WorkoutTargetV1 {
  const minimum = target.minimum, maximum = target.rangeMode === 'single' ? target.minimum : target.maximum;
  if (typeof minimum !== 'number' || typeof maximum !== 'number') throw new Error('Target ranges need two numeric values.');
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) throw new Error('Target ranges need two finite values.');
  const pace = target.kind === 'speed' && target.mode === 'absolute' && target.presentation === 'pace';
  if (minimum < 0 || maximum < 0) throw new Error('Target ranges cannot be negative.');
  if (pace && (minimum === 0 || maximum === 0)) throw new Error('Pace target ranges need two positive values.');
  if (minimum > maximum) throw new Error(pace ? 'Faster pace must not exceed slower pace.' : 'The target minimum must not exceed its maximum.');
  const source = target.source?.target;
  const compatible = source?.kind === target.kind && source.mode === target.mode
    && (source.kind !== 'speed' || source.presentation === target.presentation);
  const saved = compatible && source ? bounds(source) : null;
  const canonical = (field: 'minimum' | 'maximum'): number => {
    const input = target[field]!;
    const index = pace ? field === 'minimum' ? 1 : 0 : field === 'minimum' ? 0 : 1;
    const speed = target.kind === 'speed' && target.mode === 'absolute' ? cachedEditorSpeed(target, field) : undefined;
    if (speed !== undefined) return speed;
    if (saved && target.source?.[field] === input) return saved[index];
    const other = field === 'minimum' ? 'maximum' : 'minimum';
    // An edited bound matching the untouched displayed bound means the same exact prescription.
    const otherSpeed = target.kind === 'speed' && target.mode === 'absolute' ? cachedEditorSpeed(target, other) : undefined;
    if (input === target[other] && otherSpeed !== undefined) return otherSpeed;
    if (saved && input === target[other] && target.source?.[other] === target[other]) return saved[1 - index];
    return target.kind === 'speed' && target.mode === 'absolute' ? toSpeed(input, target.presentation, sport, units) : input;
  };
  const low = canonical(target.rangeMode === 'single' ? 'minimum' : pace ? 'maximum' : 'minimum');
  const high = target.rangeMode === 'single' ? low : canonical(pace ? 'minimum' : 'maximum');
  if (target.mode === 'relative') {
    if (!WORKOUT_EDITOR_REFERENCE_OPTIONS[target.kind].some(option => option.value === target.referenceKind)) throw new Error('Choose a compatible target reference.');
    if (typeof target.referenceValue !== 'number' || !Number.isFinite(target.referenceValue) || target.referenceValue <= 0) {
      throw new Error('Relative targets need a positive reference value.');
    }
    const cachedReference = target.kind === 'speed' ? cachedEditorSpeed(target, 'referenceValue') : undefined;
    const ref = cachedReference ?? (compatible && source?.mode === 'relative' && source.reference.kind === target.referenceKind
      && target.source?.referenceValue === target.referenceValue ? referenceValue(source)
      : target.kind === 'speed' ? toSpeed(target.referenceValue, target.presentation, sport, units) : target.referenceValue);
    const range = { mode: 'relative' as const, minimumPercent: low, maximumPercent: high };
    switch (target.kind) {
      case 'heart-rate': return { ...range, kind: target.kind, reference: { kind: target.referenceKind as 'max-heart-rate' | 'threshold-heart-rate', bpm: ref } };
      case 'power': return { ...range, kind: target.kind, reference: { kind: target.referenceKind as 'functional-threshold-power' | 'critical-power', watts: ref } };
      case 'speed': return { ...range, kind: target.kind, presentation: target.presentation, reference: { kind: 'threshold-speed', metersPerSecond: ref } };
      case 'cadence': return { ...range, kind: target.kind, reference: { kind: 'preferred-cadence', rpm: ref } };
    }
  }
  switch (target.kind) {
    case 'heart-rate': return { kind: target.kind, mode: 'absolute', minimumBpm: low, maximumBpm: high };
    case 'power': return { kind: target.kind, mode: 'absolute', minimumWatts: low, maximumWatts: high };
    case 'speed': return { kind: target.kind, mode: 'absolute', presentation: target.presentation, minimumMetersPerSecond: low, maximumMetersPerSecond: high };
    case 'cadence': return { kind: target.kind, mode: 'absolute', minimumRpm: low, maximumRpm: high };
  }
}

function rehydrateConvertedTarget(canonical: WorkoutTargetV1, target: ManualWorkoutEditorTarget,
  sport: ActivityTypes, units?: UserUnitSettingsInterface | null): ManualWorkoutEditorTarget {
  const converted = workoutTargetToManualEditor(canonical, sport, units);
  return { ...converted, rangeMode: target.rangeMode,
    source: { ...converted.source!, referenceSaved: manualEditorTargetHasSavedReference(target) } };
}

/** Resolve each completed field without assigning canonical values to missing fields. */
function convertPartialSpeedTarget(target: ManualWorkoutEditorTarget, from: ActivityTypes, to: ActivityTypes,
  presentation: 'pace' | 'speed', units?: UserUnitSettingsInterface | null): ManualWorkoutEditorTarget {
  const previous = target.source?.target;
  const source = previous?.kind === 'speed' && previous.mode === target.mode && previous.presentation === target.presentation
    ? target.source : undefined;
  const convertedSource = source && previous?.kind === 'speed'
    ? workoutTargetToManualEditor({ ...previous, presentation }, to, units).source : undefined;
  const matches = (field: SpeedEditorField) => source && source[field] === target[field]
    && (field !== 'referenceValue' || (previous?.mode === 'relative' && previous.reference.kind === target.referenceKind));
  const convert = (field: SpeedEditorField): { value: number | null; snapshot?: EditorSpeedSnapshot } => {
    const value = target[field];
    let speed = cachedEditorSpeed(target, field);
    if (speed === undefined && matches(field) && previous?.kind === 'speed') {
      if (field === 'referenceValue' && previous.mode === 'relative') speed = previous.reference.metersPerSecond;
      else if (previous.mode === 'absolute') speed = bounds(previous)[target.presentation === 'pace'
        ? field === 'minimum' ? 1 : 0 : field === 'minimum' ? 0 : 1];
    }
    if (speed === undefined && typeof value === 'number' && Number.isFinite(value) && value >= 0
      && (target.presentation !== 'pace' || value > 0)) speed = toSpeed(value, target.presentation, from, units);
    if (speed === undefined || !Number.isFinite(speed) || speed < 0 || (field === 'referenceValue' && speed === 0)) return { value };
    const converted = fromSpeed(speed, presentation, to, units);
    return { value: converted, snapshot: { editorValue: converted, metersPerSecond: speed } };
  };
  const swap = target.mode === 'absolute' && target.presentation !== presentation;
  const minimumField = swap && target.rangeMode === 'range' ? 'maximum' : 'minimum';
  const maximumField = swap || target.rangeMode === 'single' ? 'minimum' : 'maximum';
  const minimum = target.mode === 'absolute' ? convert(minimumField) : { value: target.minimum };
  const maximum = target.mode === 'absolute' ? convert(maximumField) : { value: target.maximum };
  const ref = target.mode === 'relative' ? convert('referenceValue') : { value: target.referenceValue };
  return { ...target, presentation, minimum: minimum.value, maximum: maximum.value, referenceValue: ref.value,
    speedSource: { mode: target.mode, presentation,
      ...(minimum.snapshot ? { minimum: minimum.snapshot } : {}),
      ...(maximum.snapshot ? { maximum: maximum.snapshot } : {}),
      ...(ref.snapshot ? { referenceValue: ref.snapshot } : {}) },
    source: convertedSource ? { ...convertedSource,
      minimum: matches(target.mode === 'relative' ? 'minimum' : minimumField) ? minimum.value! : Number.NaN,
      maximum: matches(target.mode === 'relative' ? 'maximum' : maximumField) ? maximum.value! : Number.NaN,
      referenceValue: matches('referenceValue') ? ref.value : Number.NaN,
      referenceSaved: manualEditorTargetHasSavedReference(target),
    } : undefined };
}

/** Rehydrate a valid draft in a new presentation; convert completed fields in partial drafts independently. */
export function changeManualEditorTargetPresentation(target: ManualWorkoutEditorTarget, presentation: 'pace' | 'speed', sport: ActivityTypes, units?: UserUnitSettingsInterface | null): ManualWorkoutEditorTarget {
  if (target.kind !== 'speed' || target.presentation === presentation) return target;
  try {
    const canonical = manualEditorTargetToWorkout(target, sport, units);
    if (canonical.kind === 'speed') return rehydrateConvertedTarget({ ...canonical, presentation }, target, sport, units);
  } catch { /* Unfinished prescriptions retain only their completed fields. */ }
  return convertPartialSpeedTarget(target, sport, sport, presentation, units);
}

export function changeManualEditorTargetSport(target: ManualWorkoutEditorTarget, from: ActivityTypes, to: ActivityTypes, units?: UserUnitSettingsInterface | null): ManualWorkoutEditorTarget {
  if (target.kind !== 'speed' || from === to) return target;
  try { return rehydrateConvertedTarget(manualEditorTargetToWorkout(target, from, units), target, to, units); }
  catch {
    if (target.presentation !== 'pace') return target;
    return convertPartialSpeedTarget(target, from, to, target.presentation, units);
  }
}

export function manualEditorTargetPreview(target: ManualWorkoutEditorTarget, sport: ActivityTypes, units?: UserUnitSettingsInterface | null, locale?: string): string {
  try {
    const displayUnits = normalizeUserUnitSettings(units);
    const canonical = manualEditorTargetToWorkout(target, sport, displayUnits);
    if (canonical.mode === 'absolute') return formatWorkoutTargetV1(canonical, displayUnits, locale, sport);
    const scale = referenceValue(canonical) / 100;
    const low = canonical.minimumPercent * scale, high = canonical.maximumPercent * scale;
    if (canonical.kind === 'speed' && canonical.presentation === 'pace' && low === 0) return 'Resolved pace is unavailable at zero speed.';
    const range: WorkoutTargetV1 = canonical.kind === 'heart-rate' ? { kind: canonical.kind, mode: 'absolute', minimumBpm: low, maximumBpm: high }
      : canonical.kind === 'power' ? { kind: canonical.kind, mode: 'absolute', minimumWatts: low, maximumWatts: high }
      : canonical.kind === 'cadence' ? { kind: canonical.kind, mode: 'absolute', minimumRpm: low, maximumRpm: high }
      : { kind: canonical.kind, mode: 'absolute', presentation: canonical.presentation, minimumMetersPerSecond: low, maximumMetersPerSecond: high };
    return `Resolved · ${formatWorkoutTargetV1(range, displayUnits, locale, sport)}`;
  } catch (error) { return error instanceof Error ? error.message : 'Complete the target.'; }
}
