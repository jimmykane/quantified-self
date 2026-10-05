import { ActivityTypes, DistanceUnits, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
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
} from '@shared/planned-workout';

import { changeManualEditorTargetSport, manualEditorTargetToWorkout, workoutTargetToManualEditor, type ManualWorkoutEditorTarget } from './planned-workout-target-editor.helper';

export type ManualWorkoutSport = ManualWorkoutEditorSportV1 | ActivityTypes.StrengthTraining;
export type ManualWorkoutEnding = 'time' | 'distance' | 'manual';

export interface ManualWorkoutEditorStep {
  kind: 'step';
  id: string;
  purpose: WorkoutStepPurposeV1;
  endingKind: ManualWorkoutEnding;
  endingValue: number;
  allowEarlyLap?: boolean;
  targets: ManualWorkoutEditorTarget[];
  note?: string;
  /** Editor-only: preserve exact saved seconds through display and temporary lap endings. */
  sourceDuration?: { editorValue: number; seconds: number };
  /** Editor-only: preserve exact metres through rounded display and temporary lap endings. */
  sourceDistance?: { editorValue: number; meters: number };
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
  sourcePoolLength?: { editorValue: number; presentation: 'meters' | 'yards'; meters: number };
  nodes: ManualWorkoutEditorNode[];
}

export function createManualWorkoutEditorStep(id: string): ManualWorkoutEditorStep {
  return {
    kind: 'step',
    id,
    purpose: 'work',
    endingKind: 'time',
    endingValue: 10,
    targets: [],
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

function distanceMetersFromEditor(
  step: ManualWorkoutEditorStep,
  sport: ManualWorkoutSport,
  units?: UserUnitSettingsInterface | null,
): number {
  return step.sourceDistance?.editorValue === step.endingValue
    ? step.sourceDistance.meters : step.endingValue * distanceScale(sport, units);
}

/** Keep time/distance drafts through lap toggles without reusing the other ending's unit cache. */
export function changeManualWorkoutEditorStepEnding(
  step: ManualWorkoutEditorStep,
  endingKind: ManualWorkoutEnding,
  sport: ManualWorkoutSport,
  units?: UserUnitSettingsInterface | null,
): ManualWorkoutEditorStep {
  if (step.endingKind === endingKind) return step;
  let sourceDistance: ManualWorkoutEditorStep['sourceDistance'];
  let sourceDuration: ManualWorkoutEditorStep['sourceDuration'];
  if (step.endingKind === 'distance' && endingKind === 'manual'
    && Number.isFinite(step.endingValue) && step.endingValue > 0) {
    const meters = distanceMetersFromEditor(step, sport, units);
    if (Number.isFinite(meters) && meters > 0) {
      sourceDistance = { editorValue: step.endingValue, meters };
    }
  } else if (step.endingKind === 'manual' && endingKind === 'distance') {
    sourceDistance = step.sourceDistance;
  }
  if (step.endingKind === 'time' && endingKind === 'manual'
    && Number.isFinite(step.endingValue) && step.endingValue > 0) {
    sourceDuration = { editorValue: step.endingValue,
      seconds: step.sourceDuration?.editorValue === step.endingValue ? step.sourceDuration.seconds : step.endingValue * 60 };
  } else if (step.endingKind === 'manual' && endingKind === 'time') {
    sourceDuration = step.sourceDuration;
  }
  return { ...step, endingKind, sourceDistance, sourceDuration };
}

function endingFromEditor(
  step: ManualWorkoutEditorStep,
  sport: ManualWorkoutSport,
  units?: UserUnitSettingsInterface | null,
): WorkoutEndingV1 {
  if (step.endingKind === 'manual') return { kind: 'manual' };
  if (!Number.isFinite(step.endingValue) || step.endingValue <= 0) {
    throw new Error('Every step needs a positive duration or distance.');
  }
  return step.endingKind === 'time'
    ? { kind: 'time', ...(step.allowEarlyLap === undefined ? {} : { allowEarlyLap: step.allowEarlyLap }), seconds: step.sourceDuration?.editorValue === step.endingValue
      ? step.sourceDuration.seconds : step.endingValue * 60 }
    : { kind: 'distance', ...(step.allowEarlyLap === undefined ? {} : { allowEarlyLap: step.allowEarlyLap }), meters: distanceMetersFromEditor(step, sport, units) };
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
    targets: step.targets.map(target => manualEditorTargetToWorkout(target, sport, units)),
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
      meters: value.sourcePoolLength?.editorValue === value.poolLengthValue
        && value.sourcePoolLength.presentation === (value.poolLengthUnit ?? 'meters') ? value.sourcePoolLength.meters
        : value.poolLengthUnit === 'yards' ? value.poolLengthValue * 0.9144 : value.poolLengthValue,
      presentation: value.poolLengthUnit ?? 'meters',
    }
    : undefined;
  return parseWorkoutStructureV1({ version: 1, sport: value.sport, ...(poolLength ? { poolLength } : {}), nodes });
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
  if (step.ending.kind !== 'time' && step.ending.kind !== 'distance' && step.ending.kind !== 'manual') {
    throw new Error('This workout uses an ending that the first manual editor cannot change.');
  }
  const endingValue = step.ending.kind === 'time'
    ? step.ending.seconds / 60
    : step.ending.kind === 'distance'
      ? roundEditorNumber(step.ending.meters / distanceScale(sport, units))
      // Editor-only default for switching back to a numeric ending; never part of a manual prescription.
      : createManualWorkoutEditorStep(step.id).endingValue;
  return {
    kind: 'step',
    id: step.id,
    purpose: step.purpose,
    endingKind: step.ending.kind,
    ...('allowEarlyLap' in step.ending ? { allowEarlyLap: step.ending.allowEarlyLap } : {}),
    endingValue,
    ...(step.ending.kind === 'time' ? {
      sourceDuration: { editorValue: endingValue, seconds: step.ending.seconds },
    } : {}),
    ...(step.ending.kind === 'distance' ? {
      sourceDistance: { editorValue: endingValue, meters: step.ending.meters },
    } : {}),
    targets: step.targets.map(target => workoutTargetToManualEditor(target, sport, units)),
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
      sourcePoolLength: { editorValue: structure.poolLength.presentation === 'yards'
        ? roundEditorNumber(structure.poolLength.meters / 0.9144) : structure.poolLength.meters,
        ...structure.poolLength },
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
  const convert = (step: ManualWorkoutEditorStep): ManualWorkoutEditorStep => {
    const hasDistanceDraft = step.endingKind === 'manual'
      && step.sourceDistance?.editorValue === step.endingValue;
    const meters = step.endingKind === 'distance' || hasDistanceDraft
      ? distanceMetersFromEditor(step, value.sport, units) : null;
    const endingValue = meters !== null ? roundEditorNumber(meters / toDistance) : step.endingValue;
    return {
      ...step,
      endingValue,
      ...(meters !== null ? {
        sourceDistance: { editorValue: endingValue, meters },
      } : {}),
      targets: step.targets.map(target => changeManualEditorTargetSport(target, value.sport, sport, units)),
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
