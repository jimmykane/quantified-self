import { ActivityTypes, DistanceUnits, PaceUnits, SwimPaceUnits, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import {
  formatWorkoutEndingV1,
  formatWorkoutStepV1,
  isSwimmingWorkoutSportV1,
  isRowingWorkoutSportV1,
  MANUAL_WORKOUT_EDITOR_SPORTS_V1,
  parseWorkoutStructureV1,
  type ManualWorkoutEditorSportV1,
  type WorkoutEndingV1,
  type WorkoutNodeV1,
  type WorkoutStepPurposeV1,
  type WorkoutStepV1,
  type WorkoutStructureV1,
  type WorkoutTargetV1,
} from '@shared/planned-workout';

export type ManualWorkoutSport = ManualWorkoutEditorSportV1 | ActivityTypes.StrengthTraining;
export type ManualWorkoutEnding = 'time' | 'distance';
export type ManualWorkoutTarget = 'none' | 'heart-rate' | 'power' | 'pace';

export interface ManualWorkoutEditorStep {
  kind: 'step';
  id: string;
  purpose: WorkoutStepPurposeV1;
  endingKind: ManualWorkoutEnding;
  endingValue: number;
  targetKind: ManualWorkoutTarget;
  targetMinimum: number | null;
  targetMaximum: number | null;
  note?: string;
  /** Editor-only: keep the exact saved metres when a rounded unit conversion was not edited. */
  sourceDistance?: { editorValue: number; meters: number };
  /** Editor-only: keep the exact saved speed range when displayed pace was not edited. */
  sourcePace?: {
    editorMinimum: number;
    editorMaximum: number;
    minimumMetersPerSecond: number;
    maximumMetersPerSecond: number;
  };
}

export interface ManualWorkoutEditorRepeat {
  kind: 'repeat';
  id: string;
  count: number;
  steps: ManualWorkoutEditorStep[];
}

export type ManualWorkoutEditorNode = ManualWorkoutEditorStep | ManualWorkoutEditorRepeat;

export interface ManualWorkoutEditorValue {
  title: string;
  localDate: string;
  sport: ManualWorkoutSport;
  poolLengthValue?: number | null;
  poolLengthUnit?: 'meters' | 'yards';
  nodes: ManualWorkoutEditorNode[];
}

export function createManualWorkoutEditorStep(id: string): ManualWorkoutEditorStep {
  return {
    kind: 'step',
    id,
    purpose: 'work',
    endingKind: 'time',
    endingValue: 10,
    targetKind: 'none',
    targetMinimum: null,
    targetMaximum: null,
  };
}

export function createManualWorkoutEditorValue(
  localDate: string,
  nodeId = 'step-1',
): ManualWorkoutEditorValue {
  return {
    title: '',
    localDate,
    sport: ActivityTypes.Running,
    nodes: [createManualWorkoutEditorStep(nodeId)],
  };
}

const METERS_PER_MILE = 1609.344;

function distanceScale(sport: ManualWorkoutSport, units?: UserUnitSettingsInterface | null): number {
  if (isSwimmingWorkoutSportV1(sport) || isRowingWorkoutSportV1(sport)) return 1;
  return units?.distanceUnits === DistanceUnits.Miles ? METERS_PER_MILE : 1000;
}

function paceDistanceMeters(sport: ManualWorkoutSport, units?: UserUnitSettingsInterface | null): number {
  if (isRowingWorkoutSportV1(sport)) return 500;
  if (!isSwimmingWorkoutSportV1(sport)) {
    return units?.paceUnits?.[0] === PaceUnits.MinutesPerMile ? METERS_PER_MILE : 1000;
  }
  return units?.swimPaceUnits?.[0] === SwimPaceUnits.MinutesPer100Yard ? 91.44 : 100;
}

function distanceMetersFromEditor(
  step: ManualWorkoutEditorStep,
  sport: ManualWorkoutSport,
  units?: UserUnitSettingsInterface | null,
): number {
  return step.sourceDistance?.editorValue === step.endingValue
    ? step.sourceDistance.meters : step.endingValue * distanceScale(sport, units);
}

function paceSpeedRangeFromEditor(
  step: ManualWorkoutEditorStep,
  minimum: number,
  maximum: number,
  sport: ManualWorkoutSport,
  units?: UserUnitSettingsInterface | null,
): { minimumMetersPerSecond: number; maximumMetersPerSecond: number } {
  if (step.sourcePace?.editorMinimum === minimum && step.sourcePace.editorMaximum === maximum) {
    return {
      minimumMetersPerSecond: step.sourcePace.minimumMetersPerSecond,
      maximumMetersPerSecond: step.sourcePace.maximumMetersPerSecond,
    };
  }
  const distanceMeters = paceDistanceMeters(sport, units);
  return {
    minimumMetersPerSecond: distanceMeters / (Math.max(minimum, maximum) * 60),
    maximumMetersPerSecond: distanceMeters / (Math.min(minimum, maximum) * 60),
  };
}

function endingFromEditor(
  step: ManualWorkoutEditorStep,
  sport: ManualWorkoutSport,
  units?: UserUnitSettingsInterface | null,
): WorkoutEndingV1 {
  if (!Number.isFinite(step.endingValue) || step.endingValue <= 0) {
    throw new Error('Every step needs a positive duration or distance.');
  }
  return step.endingKind === 'time'
    ? { kind: 'time', seconds: step.endingValue * 60 }
    : { kind: 'distance', meters: distanceMetersFromEditor(step, sport, units) };
}

function targetFromEditor(
  step: ManualWorkoutEditorStep,
  sport: ManualWorkoutSport,
  units?: UserUnitSettingsInterface | null,
): WorkoutTargetV1[] {
  if (step.targetKind === 'none') return [];
  if (typeof step.targetMinimum !== 'number' || typeof step.targetMaximum !== 'number') {
    throw new Error('Target ranges need two numeric values.');
  }
  const minimum = step.targetMinimum;
  const maximum = step.targetMaximum;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    throw new Error('Target ranges need two finite values.');
  }
  if (step.targetKind === 'pace') {
    if (minimum <= 0 || maximum <= 0) {
      throw new Error('Pace target ranges need two positive values.');
    }
    if (minimum > maximum) {
      throw new Error('Faster pace must not exceed slower pace.');
    }
    return [{
      kind: 'speed',
      mode: 'absolute',
      ...paceSpeedRangeFromEditor(step, minimum, maximum, sport, units),
      presentation: 'pace',
    }];
  }
  if (minimum < 0 || maximum < 0) {
    throw new Error('Heart-rate and power target ranges cannot be negative.');
  }
  if (minimum > maximum) throw new Error('The target minimum must not exceed its maximum.');
  return step.targetKind === 'heart-rate'
    ? [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: minimum, maximumBpm: maximum }]
    : [{ kind: 'power', mode: 'absolute', minimumWatts: minimum, maximumWatts: maximum }];
}

function stepFromEditor(
  step: ManualWorkoutEditorStep,
  sport: ManualWorkoutSport,
  units?: UserUnitSettingsInterface | null,
): WorkoutStepV1 {
  const converted: WorkoutStepV1 = {
    kind: 'step',
    id: step.id,
    purpose: step.purpose,
    ending: endingFromEditor(step, sport, units),
    targets: targetFromEditor(step, sport, units),
  };
  return step.note === undefined ? converted : { ...converted, note: step.note };
}

export function manualWorkoutEditorToStructure(
  value: ManualWorkoutEditorValue,
  units?: UserUnitSettingsInterface | null,
): WorkoutStructureV1 {
  if (value.sport === ActivityTypes.StrengthTraining) {
    throw new Error('Strength Training requires its exercise-aware editor.');
  }
  if (!value.nodes.length) throw new Error('Add at least one workout step.');
  const nodes: WorkoutNodeV1[] = value.nodes.map((node) => {
    if (node.kind === 'step') return stepFromEditor(node, value.sport, units);
    if (!Number.isSafeInteger(node.count) || node.count < 1 || node.count > 100) {
      throw new Error('Repeat counts must be between 1 and 100.');
    }
    if (!node.steps.length) throw new Error('A repeat needs at least one step.');
    return {
      kind: 'repeat',
      id: node.id,
      count: node.count,
      steps: node.steps.map(step => stepFromEditor(step, value.sport, units)),
    };
  });
  const poolLength = value.sport === ActivityTypes.Swimming && value.poolLengthValue != null
    ? {
      meters: value.poolLengthUnit === 'yards' ? value.poolLengthValue * 0.9144 : value.poolLengthValue,
      presentation: value.poolLengthUnit ?? 'meters',
    }
    : undefined;
  return parseWorkoutStructureV1({ version: 1, sport: value.sport, ...(poolLength ? { poolLength } : {}), nodes });
}

function editorTarget(
  target: WorkoutTargetV1 | undefined,
  sport: ManualWorkoutSport,
  units?: UserUnitSettingsInterface | null,
): Pick<
  ManualWorkoutEditorStep,
  'targetKind' | 'targetMinimum' | 'targetMaximum' | 'sourcePace'
> {
  if (!target || target.mode !== 'absolute') {
    if (!target) return { targetKind: 'none', targetMinimum: null, targetMaximum: null };
    throw new Error('This workout uses a relative target that the first manual editor cannot change.');
  }
  switch (target.kind) {
    case 'heart-rate':
      return {
        targetKind: 'heart-rate',
        targetMinimum: target.minimumBpm,
        targetMaximum: target.maximumBpm,
      };
    case 'power':
      return {
        targetKind: 'power',
        targetMinimum: target.minimumWatts,
        targetMaximum: target.maximumWatts,
      };
    case 'speed': {
      if (target.presentation !== 'pace') {
        throw new Error('This workout uses a speed target that the first manual editor cannot change.');
      }
      const targetMinimum = roundEditorNumber(paceDistanceMeters(sport, units) / target.maximumMetersPerSecond / 60);
      const targetMaximum = roundEditorNumber(paceDistanceMeters(sport, units) / target.minimumMetersPerSecond / 60);
      return {
        targetKind: 'pace',
        targetMinimum,
        targetMaximum,
        sourcePace: {
          editorMinimum: targetMinimum,
          editorMaximum: targetMaximum,
          minimumMetersPerSecond: target.minimumMetersPerSecond,
          maximumMetersPerSecond: target.maximumMetersPerSecond,
        },
      };
    }
    case 'cadence':
      throw new Error('This workout uses a cadence target that the first manual editor cannot change.');
  }
}

function roundEditorNumber(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Number.isFinite(rounded) && (rounded !== 0 || value === 0) ? rounded : value;
}

function editorStep(
  step: WorkoutStepV1,
  sport: ManualWorkoutSport,
  units?: UserUnitSettingsInterface | null,
): ManualWorkoutEditorStep {
  if (step.ending.kind !== 'time' && step.ending.kind !== 'distance') {
    throw new Error('This workout uses an ending that the first manual editor cannot change.');
  }
  if (step.targets.length > 1) throw new Error('This workout has more targets than the first manual editor supports.');
  const target = editorTarget(step.targets[0], sport, units);
  const endingValue = step.ending.kind === 'time'
    ? step.ending.seconds / 60
    : roundEditorNumber(step.ending.meters / distanceScale(sport, units));
  return {
    kind: 'step',
    id: step.id,
    purpose: step.purpose,
    endingKind: step.ending.kind,
    endingValue,
    ...(step.ending.kind === 'distance' ? {
      sourceDistance: { editorValue: endingValue, meters: step.ending.meters },
    } : {}),
    ...target,
    ...(step.note === undefined ? {} : { note: step.note }),
  };
}

export function workoutStructureToManualEditor(
  title: string,
  localDate: string,
  structure: WorkoutStructureV1,
  units?: UserUnitSettingsInterface | null,
): ManualWorkoutEditorValue {
  if (!MANUAL_WORKOUT_EDITOR_SPORTS_V1.includes(structure.sport as ManualWorkoutEditorSportV1)) {
    throw new Error('This workout sport is not supported by the manual editor.');
  }
  return {
    title,
    localDate,
    sport: structure.sport as ManualWorkoutEditorSportV1,
    ...(structure.poolLength ? {
      poolLengthValue: structure.poolLength.presentation === 'yards'
        ? roundEditorNumber(structure.poolLength.meters / 0.9144)
        : structure.poolLength.meters,
      poolLengthUnit: structure.poolLength.presentation,
    } : {}),
    nodes: structure.nodes.map(node => node.kind === 'step'
      ? editorStep(node, structure.sport as ManualWorkoutSport, units)
      : { kind: 'repeat', id: node.id, count: node.count,
        steps: node.steps.map(step => editorStep(step, structure.sport as ManualWorkoutSport, units)) }),
  };
}

/** Preserve canonical distance and speed when switching editor sports. */
export function changeManualWorkoutEditorSport(
  value: ManualWorkoutEditorValue,
  sport: ManualWorkoutSport,
  units?: UserUnitSettingsInterface | null,
): ManualWorkoutEditorValue {
  if (value.sport === sport) return value;
  const toDistance = distanceScale(sport, units);
  const paceRatio = paceDistanceMeters(sport, units) / paceDistanceMeters(value.sport, units);
  const convert = (step: ManualWorkoutEditorStep): ManualWorkoutEditorStep => {
    const meters = step.endingKind === 'distance'
      ? distanceMetersFromEditor(step, value.sport, units) : null;
    const endingValue = meters !== null ? roundEditorNumber(meters / toDistance) : step.endingValue;
    const canConvertPace = step.targetKind === 'pace'
      && typeof step.targetMinimum === 'number' && Number.isFinite(step.targetMinimum) && step.targetMinimum > 0
      && typeof step.targetMaximum === 'number' && Number.isFinite(step.targetMaximum) && step.targetMaximum > 0;
    const sourceSpeed = canConvertPace
      ? paceSpeedRangeFromEditor(step, step.targetMinimum!, step.targetMaximum!, value.sport, units)
      : null;
    const targetMinimum = canConvertPace
      ? roundEditorNumber(paceDistanceMeters(sport, units) / sourceSpeed!.maximumMetersPerSecond / 60)
      : step.targetKind === 'pace' && step.targetMinimum !== null
        ? roundEditorNumber(step.targetMinimum * paceRatio) : step.targetMinimum;
    const targetMaximum = canConvertPace
      ? roundEditorNumber(paceDistanceMeters(sport, units) / sourceSpeed!.minimumMetersPerSecond / 60)
      : step.targetKind === 'pace' && step.targetMaximum !== null
        ? roundEditorNumber(step.targetMaximum * paceRatio) : step.targetMaximum;
    return {
      ...step,
      endingValue,
      ...(meters !== null ? {
        sourceDistance: { editorValue: endingValue, meters },
      } : {}),
      targetMinimum,
      targetMaximum,
      ...(sourceSpeed && typeof targetMinimum === 'number' && typeof targetMaximum === 'number' ? {
        sourcePace: {
          editorMinimum: targetMinimum,
          editorMaximum: targetMaximum,
          minimumMetersPerSecond: sourceSpeed.minimumMetersPerSecond,
          maximumMetersPerSecond: sourceSpeed.maximumMetersPerSecond,
        },
      } : { sourcePace: undefined }),
    };
  };
  return {
    ...value,
    sport,
    ...(sport === ActivityTypes.Swimming ? {} : { poolLengthValue: null }),
    nodes: value.nodes.map(node => node.kind === 'step'
      ? convert(node)
      : { ...node, steps: node.steps.map(convert) }),
  };
}

export function formatManualWorkoutStructure(
  structure: WorkoutStructureV1,
  unitSettings?: UserUnitSettingsInterface | null,
  locale?: string,
): string[] {
  const steps = structure.nodes.map(node => node.kind === 'step'
    ? formatWorkoutStepV1(node, unitSettings, locale, structure.sport)
    : `${node.count}× (${node.steps.map(step => formatWorkoutStepV1(step, unitSettings, locale, structure.sport)).join('; ')})`);
  return structure.poolLength
    ? [`Pool · ${formatWorkoutEndingV1({ kind: 'distance', meters: structure.poolLength.meters }, unitSettings, locale, structure.sport)}`, ...steps]
    : steps;
}
