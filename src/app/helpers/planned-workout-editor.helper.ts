import { ActivityTypes, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import {
  formatWorkoutStepV1,
  parseWorkoutStructureV1,
  type WorkoutEndingV1,
  type WorkoutNodeV1,
  type WorkoutStepPurposeV1,
  type WorkoutStepV1,
  type WorkoutStructureV1,
  type WorkoutTargetV1,
} from '@shared/planned-workout';

export type ManualWorkoutSport = typeof ActivityTypes.Running | typeof ActivityTypes.Cycling;
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

function endingFromEditor(step: ManualWorkoutEditorStep): WorkoutEndingV1 {
  if (!Number.isFinite(step.endingValue) || step.endingValue <= 0) {
    throw new Error('Every step needs a positive duration or distance.');
  }
  return step.endingKind === 'time'
    ? { kind: 'time', seconds: step.endingValue * 60 }
    : { kind: 'distance', meters: step.endingValue * 1000 };
}

function targetFromEditor(step: ManualWorkoutEditorStep): WorkoutTargetV1[] {
  if (step.targetKind === 'none') return [];
  const minimum = Number(step.targetMinimum);
  const maximum = Number(step.targetMaximum);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum <= 0 || maximum <= 0) {
    throw new Error('Target ranges need two positive values.');
  }
  if (step.targetKind === 'pace') {
    const fasterMinutesPerKilometer = Math.min(minimum, maximum);
    const slowerMinutesPerKilometer = Math.max(minimum, maximum);
    return [{
      kind: 'speed',
      mode: 'absolute',
      minimumMetersPerSecond: 1000 / (slowerMinutesPerKilometer * 60),
      maximumMetersPerSecond: 1000 / (fasterMinutesPerKilometer * 60),
      presentation: 'pace',
    }];
  }
  if (minimum > maximum) throw new Error('The target minimum must not exceed its maximum.');
  return step.targetKind === 'heart-rate'
    ? [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: minimum, maximumBpm: maximum }]
    : [{ kind: 'power', mode: 'absolute', minimumWatts: minimum, maximumWatts: maximum }];
}

function stepFromEditor(step: ManualWorkoutEditorStep): WorkoutStepV1 {
  return {
    kind: 'step',
    id: step.id,
    purpose: step.purpose,
    ending: endingFromEditor(step),
    targets: targetFromEditor(step),
  };
}

export function manualWorkoutEditorToStructure(value: ManualWorkoutEditorValue): WorkoutStructureV1 {
  if (!value.nodes.length) throw new Error('Add at least one workout step.');
  const nodes: WorkoutNodeV1[] = value.nodes.map((node) => {
    if (node.kind === 'step') return stepFromEditor(node);
    if (!Number.isSafeInteger(node.count) || node.count < 1 || node.count > 100) {
      throw new Error('Repeat counts must be between 1 and 100.');
    }
    if (!node.steps.length) throw new Error('A repeat needs at least one step.');
    return {
      kind: 'repeat',
      id: node.id,
      count: node.count,
      steps: node.steps.map(stepFromEditor),
    };
  });
  return parseWorkoutStructureV1({ version: 1, sport: value.sport, nodes });
}

function editorTarget(target: WorkoutTargetV1 | undefined): Pick<
  ManualWorkoutEditorStep,
  'targetKind' | 'targetMinimum' | 'targetMaximum'
> {
  if (!target || target.mode !== 'absolute') {
    return { targetKind: 'none', targetMinimum: null, targetMaximum: null };
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
      if (target.presentation !== 'pace') return { targetKind: 'none', targetMinimum: null, targetMaximum: null };
      return {
        targetKind: 'pace',
        targetMinimum: roundEditorNumber(1000 / target.maximumMetersPerSecond / 60),
        targetMaximum: roundEditorNumber(1000 / target.minimumMetersPerSecond / 60),
      };
    case 'cadence':
      return { targetKind: 'none', targetMinimum: null, targetMaximum: null };
  }
}

function roundEditorNumber(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function editorStep(step: WorkoutStepV1): ManualWorkoutEditorStep {
  if (step.ending.kind !== 'time' && step.ending.kind !== 'distance') {
    throw new Error('This workout uses an ending that the first manual editor cannot change.');
  }
  if (step.targets.length > 1) throw new Error('This workout has more targets than the first manual editor supports.');
  const target = editorTarget(step.targets[0]);
  return {
    kind: 'step',
    id: step.id,
    purpose: step.purpose,
    endingKind: step.ending.kind,
    endingValue: step.ending.kind === 'time' ? step.ending.seconds / 60 : step.ending.meters / 1000,
    ...target,
  };
}

export function workoutStructureToManualEditor(
  title: string,
  localDate: string,
  structure: WorkoutStructureV1,
): ManualWorkoutEditorValue {
  if (structure.sport !== ActivityTypes.Running && structure.sport !== ActivityTypes.Cycling) {
    throw new Error('The first manual editor supports running and cycling workouts.');
  }
  return {
    title,
    localDate,
    sport: structure.sport,
    nodes: structure.nodes.map(node => node.kind === 'step'
      ? editorStep(node)
      : { kind: 'repeat', id: node.id, count: node.count, steps: node.steps.map(editorStep) }),
  };
}

export function formatManualWorkoutStructure(
  structure: WorkoutStructureV1,
  unitSettings?: UserUnitSettingsInterface | null,
  locale?: string,
): string[] {
  return structure.nodes.map(node => node.kind === 'step'
    ? formatWorkoutStepV1(node, unitSettings, locale)
    : `${node.count}× (${node.steps.map(step => formatWorkoutStepV1(step, unitSettings, locale)).join('; ')})`);
}
