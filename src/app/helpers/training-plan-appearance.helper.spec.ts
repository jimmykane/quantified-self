import { TRAINING_PLAN_COLORS, type TrainingPlanColor } from '@shared/training-plans';
import { TRAINING_PLAN_COLOR_OPTIONS, trainingPlanAppearance } from './training-plan-appearance.helper';

describe('training plan appearance', () => {
  it('offers every named color with a label and theme-aware marker contrast', () => {
    expect(TRAINING_PLAN_COLOR_OPTIONS.map(option => option.id)).toEqual(TRAINING_PLAN_COLORS);
    for (const option of TRAINING_PLAN_COLOR_OPTIONS) {
      expect(option.label).toBeTruthy();
      expect(trainingPlanAppearance({ color: option.id })).toBe(option);
      expect(option.color).toContain(option.id === 'default' ? 'var(--mat-sys-primary)' : 'var(--mat-sys-on-surface)');
    }
  });

  it('keeps old plans on the theme default and never forwards arbitrary CSS', () => {
    for (const plan of [undefined, null, {}, { color: 'toString' as TrainingPlanColor }, { color: 'url(https://example.com)' as TrainingPlanColor }]) {
      expect(trainingPlanAppearance(plan)).toBe(TRAINING_PLAN_COLOR_OPTIONS[0]);
    }
  });
});
