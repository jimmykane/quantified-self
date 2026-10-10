import type { WorkoutEndingKindV1, WorkoutStructureV1, WorkoutTargetKindV1 } from '../../../shared/planned-workout';

// Exhaustive labels, not another recipe parser or a title/note inference mechanism.
const ENDINGS: Record<WorkoutEndingKindV1, string> = {
  time: 'time', distance: 'distance', kilojoules: 'energy', repetitions: 'reps', manual: 'Lap',
};
const TARGETS: Record<WorkoutTargetKindV1, string> = {
  'heart-rate': 'HR', power: 'power', speed: 'pace/speed', cadence: 'cadence',
};

/** Compact definition counts, not duration estimates, executed counts or source-fidelity certification. */
export function describeTrainingRecipeReview(structure: WorkoutStructureV1): string {
  const steps = structure.nodes.flatMap(node => node.kind === 'step' ? [node] : node.steps);
  const repeats = structure.nodes.filter(node => node.kind === 'repeat');
  const endings = [...new Set(steps.map(step => ENDINGS[step.ending.kind]))];
  const targets = [...new Set(steps.flatMap(step => step.targets.map(target => TARGETS[target.kind])))];
  const repeatText = `${repeats.length} repeat block${repeats.length === 1 ? ` ×${repeats[0].count}` : 's'}`;
  return `Recipe: ${steps.length} defined step${steps.length === 1 ? '' : 's'}, ${repeatText}; ${endings.join('/')} endings; targets ${targets.join('/') || 'none'}.`;
}
