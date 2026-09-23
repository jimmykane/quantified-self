import { ActivityTypes, SwimPaceUnits, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import {
  formatWorkoutStepV1,
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

export type ManualWorkoutSport = ManualWorkoutEditorSportV1;
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

function distanceScale(sport: ManualWorkoutSport): number {
  return sport === ActivityTypes.Swimming ? 1 : 1000;
}

function paceDistanceMeters(sport: ManualWorkoutSport, units?: UserUnitSettingsInterface | null): number {
  if (sport !== ActivityTypes.Swimming) return 1000;
  return units?.swimPaceUnits?.[0] === SwimPaceUnits.MinutesPer100Yard ? 91.44 : 100;
}

function endingFromEditor(step: ManualWorkoutEditorStep, sport: ManualWorkoutSport): WorkoutEndingV1 {
  if (!Number.isFinite(step.endingValue) || step.endingValue <= 0) {
    throw new Error('Every step needs a positive duration or distance.');
  }
  return step.endingKind === 'time'
    ? { kind: 'time', seconds: step.endingValue * 60 }
    : { kind: 'distance', meters: step.endingValue * distanceScale(sport) };
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
    const fasterPaceMinutes = Math.min(minimum, maximum);
    const slowerPaceMinutes = Math.max(minimum, maximum);
    const distanceMeters = paceDistanceMeters(sport, units);
    return [{
      kind: 'speed',
      mode: 'absolute',
      minimumMetersPerSecond: distanceMeters / (slowerPaceMinutes * 60),
      maximumMetersPerSecond: distanceMeters / (fasterPaceMinutes * 60),
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
    ending: endingFromEditor(step, sport),
    targets: targetFromEditor(step, sport, units),
  };
  return step.note === undefined ? converted : { ...converted, note: step.note };
}

export function manualWorkoutEditorToStructure(
  value: ManualWorkoutEditorValue,
  units?: UserUnitSettingsInterface | null,
): WorkoutStructureV1 {
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
  return parseWorkoutStructureV1({ version: 1, sport: value.sport, nodes });
}

function editorTarget(
  target: WorkoutTargetV1 | undefined,
  sport: ManualWorkoutSport,
  units?: UserUnitSettingsInterface | null,
): Pick<
  ManualWorkoutEditorStep,
  'targetKind' | 'targetMinimum' | 'targetMaximum'
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
    case 'speed':
      if (target.presentation !== 'pace') {
        throw new Error('This workout uses a speed target that the first manual editor cannot change.');
      }
      return {
        targetKind: 'pace',
        targetMinimum: roundEditorNumber(paceDistanceMeters(sport, units) / target.maximumMetersPerSecond / 60),
        targetMaximum: roundEditorNumber(paceDistanceMeters(sport, units) / target.minimumMetersPerSecond / 60),
      };
    case 'cadence':
      throw new Error('This workout uses a cadence target that the first manual editor cannot change.');
  }
}

function roundEditorNumber(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
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
  return {
    kind: 'step',
    id: step.id,
    purpose: step.purpose,
    endingKind: step.ending.kind,
    endingValue: step.ending.kind === 'time' ? step.ending.seconds / 60 : step.ending.meters / distanceScale(sport),
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
  const fromDistance = distanceScale(value.sport);
  const toDistance = distanceScale(sport);
  const paceRatio = paceDistanceMeters(sport, units) / paceDistanceMeters(value.sport, units);
  const convert = (step: ManualWorkoutEditorStep): ManualWorkoutEditorStep => ({
    ...step,
    endingValue: step.endingKind === 'distance'
      ? roundEditorNumber(step.endingValue * fromDistance / toDistance)
      : step.endingValue,
    targetMinimum: step.targetKind === 'pace' && step.targetMinimum !== null
      ? roundEditorNumber(step.targetMinimum * paceRatio) : step.targetMinimum,
    targetMaximum: step.targetKind === 'pace' && step.targetMaximum !== null
      ? roundEditorNumber(step.targetMaximum * paceRatio) : step.targetMaximum,
  });
  return {
    ...value,
    sport,
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
  return structure.nodes.map(node => node.kind === 'step'
    ? formatWorkoutStepV1(node, unitSettings, locale, structure.sport)
    : `${node.count}× (${node.steps.map(step => formatWorkoutStepV1(step, unitSettings, locale, structure.sport)).join('; ')})`);
}
