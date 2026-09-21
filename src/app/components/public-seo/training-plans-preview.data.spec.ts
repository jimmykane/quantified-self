import { parseScheduledWorkoutV1, parseTrainingPlanV1 } from '@shared/training-plans';
import { parseWorkoutStructureV1 } from '@shared/planned-workout';
import {
  buildTrainingPlansPreviewFixture,
} from './training-plans-preview.data';

describe('training plans public preview data', () => {
  const fixture = buildTrainingPlansPreviewFixture(new Date(2026, 11, 12, 9));

  it('round-trips every synthetic plan and workout through the canonical contracts', () => {
    expect(parseTrainingPlanV1(JSON.parse(JSON.stringify(fixture.plan))))
      .toEqual(fixture.plan);
    for (const workout of fixture.workouts) {
      expect(parseScheduledWorkoutV1(JSON.parse(JSON.stringify(workout)))).toEqual(workout);
      expect(parseWorkoutStructureV1(JSON.parse(JSON.stringify(workout.structure)))).toEqual(workout.structure);
    }
  });

  it('covers multiple weeks and months, both sports, skips, repeats, and each initial target', () => {
    expect(fixture.plan.color).toBe('purple');
    expect(fixture.plan.lifecycle).toBe('active');
    expect(new Set(fixture.workouts.map(workout => workout.localDate.slice(0, 7))).size)
      .toBeGreaterThanOrEqual(2);
    expect(fixture.workouts.some(workout => workout.structure.sport.includes('Running'))).toBe(true);
    expect(fixture.workouts.some(workout => workout.structure.sport.includes('Cycling'))).toBe(true);
    expect(fixture.workouts.some(workout => workout.lifecycle === 'skipped')).toBe(true);
    const nodes = fixture.workouts.flatMap(workout => workout.structure.nodes);
    expect(nodes.some(node => node.kind === 'repeat')).toBe(true);
    const steps = nodes.flatMap(node => node.kind === 'step' ? [node] : node.steps);
    expect(new Set(steps.flatMap(step => step.targets.map(target => target.kind))))
      .toEqual(new Set(['heart-rate', 'power', 'speed']));
    expect(fixture.workouts.some(workout => workout.localDate === fixture.emptyDate))
      .toBe(false);
  });

  it('moves the fixed recipe with the visitor month and shows an exact synthetic completion on the selected day', () => {
    expect(fixture.today).toBe('2026-12-12');
    expect(fixture.plan.startLocalDate).toBe('2026-11-26');
    expect(fixture.plan.endLocalDate).toBe('2027-01-16');
    expect(fixture.workouts.find(workout => fixture.completedWorkoutIds.includes(workout.id))?.localDate)
      .toBe(fixture.today);
    expect(fixture.completedWorkoutIds).toEqual(['threshold-bike-blocks']);
  });
});
