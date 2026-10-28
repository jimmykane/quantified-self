import { formatWorkoutStepV1, type WorkoutEndingKindV1, type WorkoutStructureV1, type WorkoutTargetKindV1 } from '../../../shared/planned-workout';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';

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

/** Ordered ending/target sample. Never truncates a numeric value or expands repeat executions. */
export function describeTrainingRecipeSteps(structure: WorkoutStructureV1,
  units: UserUnitSettingsInterface | null, maxCharacters: number): string {
  const nodes = structure.nodes.map(node => node.kind === 'step'
    ? formatWorkoutStepV1(node, units, undefined, structure.sport)
    : `${node.count}× [${node.steps.map(step => formatWorkoutStepV1(step, units, undefined, structure.sport)).join('; ')}]`);
  for (let count = nodes.length; count >= 0; count--) {
    const omitted = nodes.length - count;
    const text = ` Endings/targets: ${nodes.slice(0, count).join(' → ')}`
      + (omitted ? `${count ? '; ' : ''}${omitted} node${omitted === 1 ? '' : 's'} not shown; review the full submitted recipe.` : '.');
    if (text.length <= maxCharacters) return text;
  }
  return ''; // Existing shape summary remains; do not displace lifecycle/range/Lap consent disclosures.
}
