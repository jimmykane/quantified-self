import { parseScheduledWorkoutV1, parseTrainingPlanV1 } from '@shared/training-plans';
import { parseWorkoutStructureV1 } from '@shared/planned-workout';
import {
  TRAINING_PLANS_PREVIEW_EMPTY_DATE,
  TRAINING_PLANS_PREVIEW_PLAN,
  TRAINING_PLANS_PREVIEW_WORKOUTS,
} from './training-plans-preview.data';

describe('training plans public preview data', () => {
  it('round-trips every synthetic plan and workout through the canonical contracts', () => {
    expect(parseTrainingPlanV1(JSON.parse(JSON.stringify(TRAINING_PLANS_PREVIEW_PLAN))))
      .toEqual(TRAINING_PLANS_PREVIEW_PLAN);
    for (const workout of TRAINING_PLANS_PREVIEW_WORKOUTS) {
      expect(parseScheduledWorkoutV1(JSON.parse(JSON.stringify(workout)))).toEqual(workout);
      expect(parseWorkoutStructureV1(JSON.parse(JSON.stringify(workout.structure)))).toEqual(workout.structure);
    }
  });

  it('covers multiple weeks and months, both sports, skips, repeats, and each initial target', () => {
    expect(TRAINING_PLANS_PREVIEW_PLAN.color).toBe('purple');
    expect(TRAINING_PLANS_PREVIEW_PLAN.lifecycle).toBe('active');
    expect(new Set(TRAINING_PLANS_PREVIEW_WORKOUTS.map(workout => workout.localDate.slice(0, 7))).size)
      .toBeGreaterThanOrEqual(2);
    expect(TRAINING_PLANS_PREVIEW_WORKOUTS.some(workout => workout.structure.sport.includes('Running'))).toBe(true);
    expect(TRAINING_PLANS_PREVIEW_WORKOUTS.some(workout => workout.structure.sport.includes('Cycling'))).toBe(true);
    expect(TRAINING_PLANS_PREVIEW_WORKOUTS.some(workout => workout.lifecycle === 'skipped')).toBe(true);
    const nodes = TRAINING_PLANS_PREVIEW_WORKOUTS.flatMap(workout => workout.structure.nodes);
    expect(nodes.some(node => node.kind === 'repeat')).toBe(true);
    const steps = nodes.flatMap(node => node.kind === 'step' ? [node] : node.steps);
    expect(new Set(steps.flatMap(step => step.targets.map(target => target.kind))))
      .toEqual(new Set(['heart-rate', 'power', 'speed']));
    expect(TRAINING_PLANS_PREVIEW_WORKOUTS.some(workout => workout.localDate === TRAINING_PLANS_PREVIEW_EMPTY_DATE))
      .toBe(false);
  });
});
