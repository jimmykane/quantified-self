import { convertToParamMap } from '@angular/router';
import {
  parseTrainingPlansRoute,
  trainingPlansBrowseRoute,
  trainingPlansCreateRoute,
  trainingPlansWorkoutRoute,
} from './training-plans-navigation.helper';

describe('training plans navigation', () => {
  it('reads entity IDs from path parameters and keeps only the date in query parameters', () => {
    expect(parseTrainingPlansRoute(
      convertToParamMap({ workoutId: 'workout-1' }),
      convertToParamMap({ date: '2026-09-10', workout: 'ignored', planId: 'ignored' }),
      { trainingPlansMode: 'edit', trainingPlansScope: 'plans' },
    )).toEqual({
      mode: 'edit',
      workoutId: 'workout-1',
      planId: null,
      standalone: false,
      localDate: '2026-09-10',
    });
  });

  it('parses plan and standalone paths from route data without accepting legacy query IDs', () => {
    expect(parseTrainingPlansRoute(
      convertToParamMap({ planId: 'plan-1' }),
      convertToParamMap({ workout: 'legacy-workout', plan: 'legacy-plan' }),
      { trainingPlansMode: 'browse', trainingPlansScope: 'plans' },
    )).toMatchObject({ mode: 'browse', workoutId: null, planId: 'plan-1', standalone: false });
    expect(parseTrainingPlansRoute(
      convertToParamMap({}),
      convertToParamMap({ scope: 'plans' }),
      { trainingPlansMode: 'create', trainingPlansScope: 'standalone' },
    )).toMatchObject({ mode: 'create', workoutId: null, planId: null, standalone: true });
  });

  it('ignores invalid date queries instead of changing the selected scope', () => {
    expect(parseTrainingPlansRoute(
      convertToParamMap({ planId: 'plan-1' }),
      convertToParamMap({ date: '2026-02-30' }),
      { trainingPlansMode: 'browse' },
    ).localDate).toBeNull();
  });

  it('builds path-segment routes for plans, creation, and workout editing', () => {
    expect(trainingPlansBrowseRoute('plan-1', false)).toEqual(['/training/plans/plan', 'plan-1']);
    expect(trainingPlansBrowseRoute(null, true)).toEqual(['/training/plans/standalone']);
    expect(trainingPlansCreateRoute('plan-1', false)).toEqual(['/training/plans/plan', 'plan-1', 'new']);
    expect(trainingPlansCreateRoute(null, false)).toEqual(['/training/plans/new']);
    expect(trainingPlansCreateRoute(null, true)).toEqual(['/training/plans/standalone/new']);
    expect(trainingPlansWorkoutRoute('workout-1')).toEqual(['/training/plans/workout', 'workout-1']);
  });
});
