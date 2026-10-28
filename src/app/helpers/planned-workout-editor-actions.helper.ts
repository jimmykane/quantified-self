import { copyManualWorkoutEditorTarget } from './planned-workout-target-editor.helper';
import { formatWorkoutStepV1, WORKOUT_STRUCTURE_MAX_NODES, type WorkoutStepPurposeV1 } from '@shared/planned-workout';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import {
  manualWorkoutEditorToStructure,
  type ManualWorkoutEditorNode,
  type ManualWorkoutEditorStep,
  type ManualWorkoutEditorValue,
} from './planned-workout-editor.helper';

export function manualWorkoutEditorNodeCount(value: ManualWorkoutEditorValue): number {
  return value.nodes.reduce((count, node) => count + 1 + (node.kind === 'repeat' ? node.steps.length : 0), 0);
}

/** A repeat's children have their own ordering; operations never transfer nodes between lists. */
export function manualWorkoutEditorSiblings(value: ManualWorkoutEditorValue, repeatId: string | null): readonly ManualWorkoutEditorNode[] {
  if (repeatId === null) return value.nodes;
  const repeat = value.nodes.find(node => node.id === repeatId);
  return repeat?.kind === 'repeat' ? repeat.steps : [];
}

function replaceSiblings(value: ManualWorkoutEditorValue, repeatId: string | null, nodes: ManualWorkoutEditorNode[]): ManualWorkoutEditorValue {
  if (repeatId === null) return { ...value, nodes };
  return { ...value, nodes: value.nodes.map(node => node.id === repeatId && node.kind === 'repeat'
    ? { ...node, steps: nodes.filter((child): child is ManualWorkoutEditorStep => child.kind === 'step') } : node) };
}

export function moveManualWorkoutEditorNode(
  value: ManualWorkoutEditorValue, nodeId: string, destination: number, repeatId: string | null = null,
): ManualWorkoutEditorValue {
  const siblings = manualWorkoutEditorSiblings(value, repeatId);
  const index = siblings.findIndex(node => node.id === nodeId);
  if (index < 0 || !Number.isInteger(destination) || destination < 0 || destination >= siblings.length || index === destination) return value;
  const nodes = [...siblings];
  nodes.splice(destination, 0, ...nodes.splice(index, 1));
  return replaceSiblings(value, repeatId, nodes);
}

export function canDuplicateManualWorkoutEditorNode(value: ManualWorkoutEditorValue, nodeId: string, repeatId: string | null = null): boolean {
  const node = manualWorkoutEditorSiblings(value, repeatId).find(candidate => candidate.id === nodeId);
  return !!node && manualWorkoutEditorNodeCount(value) + 1 + (node.kind === 'repeat' ? node.steps.length : 0) <= WORKOUT_STRUCTURE_MAX_NODES;
}

/** Copy the draft, including invalid/partial fields and exact-unit caches, without shared mutable children. */
export function duplicateManualWorkoutEditorNode(
  value: ManualWorkoutEditorValue, nodeId: string, createId: (kind: 'step' | 'repeat') => string,
  repeatId: string | null = null,
): ManualWorkoutEditorValue {
  if (!canDuplicateManualWorkoutEditorNode(value, nodeId, repeatId)) return value;
  const siblings = manualWorkoutEditorSiblings(value, repeatId);
  const index = siblings.findIndex(node => node.id === nodeId);
  const source = siblings[index];
  const used = new Set(value.nodes.flatMap(node => node.kind === 'repeat' ? [node.id, ...node.steps.map(child => child.id)] : [node.id]));
  const freshId = (kind: 'step' | 'repeat'): string => {
    for (let attempt = 0; attempt <= WORKOUT_STRUCTURE_MAX_NODES; attempt++) {
      const id = createId(kind);
      if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id) && !used.has(id)) {
        used.add(id);
        return id;
      }
    }
    throw new Error('Could not create a unique workout step ID.');
  };
  const copyStep = (step: ManualWorkoutEditorStep): ManualWorkoutEditorStep => ({
    ...step, id: freshId('step'), untouchedDuration: undefined,
    ...(step.sourceDuration ? { sourceDuration: { ...step.sourceDuration } } : {}),
    ...(step.sourceDistance ? { sourceDistance: { ...step.sourceDistance } } : {}),
    targets: step.targets.map(copyManualWorkoutEditorTarget),
  });
  const copy: ManualWorkoutEditorNode = source.kind === 'repeat'
    ? { ...source, id: freshId('repeat'), steps: source.steps.map(copyStep) } : copyStep(source);
  return replaceSiblings(value, repeatId, [...siblings.slice(0, index + 1), copy, ...siblings.slice(index + 1)]);
}

export interface WorkoutEditorTimeContext {
  previousRestSeconds: number | null;
  nextStepLabel: string | null;
}

function timedSeconds(step: ManualWorkoutEditorStep): number | null {
  if (step.endingKind !== 'time') return null;
  const seconds = step.sourceDuration?.editorValue === step.endingValue
    ? step.sourceDuration.seconds : step.endingValue * 60;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** Read the first pass in recipe order, without expanding or assuming later repeat passes. */
export function manualWorkoutEditorTimeContexts(
  value: ManualWorkoutEditorValue,
  units?: UserUnitSettingsInterface | null,
  locale?: string,
): Record<string, WorkoutEditorTimeContext> {
  const rows = value.nodes.flatMap(node => node.kind === 'step' ? [{ step: node, loopEnd: false }]
    : node.steps.map((step, index) => ({ step, loopEnd: node.count > 1 && index === node.steps.length - 1 })));
  const contexts: Record<string, WorkoutEditorTimeContext> = Object.create(null);
  let previousRestSeconds: number | null = null;
  rows.forEach(({ step, loopEnd }, index) => {
    let nextStepLabel: string | null = null;
    const next = rows[index + 1]?.step;
    if (step.purpose === 'rest' && next && !loopEnd) {
      try {
        // The next ending can be useful even while its target fields are being edited.
        const structure = manualWorkoutEditorToStructure({ ...value, nodes: [{ ...next, targets: [] }] }, units);
        const nextStep = structure.nodes[0];
        if (nextStep.kind === 'step') nextStepLabel = `Next: ${formatWorkoutStepV1(nextStep, units, locale, value.sport)}`;
      } catch { /* An invalid draft has no reliable next-step description. */ }
    }
    contexts[step.id] = { previousRestSeconds, nextStepLabel };
    // A manual/invalid Rest breaks the reference instead of borrowing an older prescription.
    if (step.purpose === 'rest') previousRestSeconds = timedSeconds(step);
  });
  return contexts;
}

export function changeManualWorkoutEditorStepPurpose(
  step: ManualWorkoutEditorStep,
  purpose: WorkoutStepPurposeV1,
  previousRestSeconds: number | null,
): ManualWorkoutEditorStep {
  if (step.purpose === purpose) return step;
  if (purpose !== 'rest' || !step.untouchedDuration || step.endingKind !== 'time' || step.endingValue !== 10) {
    return { ...step, purpose };
  }
  const seconds = Number.isFinite(previousRestSeconds) && previousRestSeconds > 0 ? previousRestSeconds : 0;
  return { ...step, purpose, endingValue: seconds / 60, untouchedDuration: undefined,
    sourceDuration: seconds ? { editorValue: seconds / 60, seconds } : undefined };
}
