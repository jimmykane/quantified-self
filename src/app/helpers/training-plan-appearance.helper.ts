import { TRAINING_PLAN_COLORS, type TrainingPlanColor, type TrainingPlanV1 } from '@shared/training-plans';
import { AppColors } from '../services/color/app.colors';

const LABELS: Record<TrainingPlanColor, string> = {
  default: 'Default', blue: 'Blue', purple: 'Purple', pink: 'Pink', orange: 'Orange', red: 'Red', green: 'Green',
};
const PALETTE: Record<Exclude<TrainingPlanColor, 'default'>, string> = {
  blue: AppColors.Blue, purple: AppColors.Purple, pink: AppColors.Pink,
  orange: AppColors.StrongOrange, red: AppColors.LightRed, green: AppColors.Green,
};

export const TRAINING_PLAN_COLOR_OPTIONS = TRAINING_PLAN_COLORS.map(id => ({
  id,
  label: LABELS[id],
  // Blend towards theme text for legible small markers in both light and dark themes.
  color: id === 'default' ? 'var(--mat-sys-primary)'
    : `color-mix(in srgb, ${PALETTE[id]} 65%, var(--mat-sys-on-surface) 35%)`,
}));

export function trainingPlanAppearance(plan: Pick<TrainingPlanV1, 'color'> | null | undefined) {
  return TRAINING_PLAN_COLOR_OPTIONS.find(option => option.id === plan?.color) ?? TRAINING_PLAN_COLOR_OPTIONS[0];
}

export const STANDALONE_WORKOUT_COLOR = 'var(--mat-sys-on-surface-variant)';
