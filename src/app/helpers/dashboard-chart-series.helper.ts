import { AppColors } from '../services/color/app.colors';

/** Shared with full dashboard renderers so decorative previews retain series identity. */
export const DASHBOARD_CATEGORY_PALETTE = [
  AppColors.Blue, AppColors.Green, AppColors.Orange, AppColors.Purple, AppColors.LightBlue,
  AppColors.Yellow, AppColors.Pink, AppColors.Red, AppColors.DeepBlue, AppColors.LightGreen,
];
export const DASHBOARD_SLEEP_STAGE_SERIES = [
  { key: 'deepSeconds', name: 'Deep', color: AppColors.DeepBlue },
  { key: 'lightSeconds', name: 'Light', color: AppColors.LightBlue },
  { key: 'remSeconds', name: 'REM', color: AppColors.Purple },
  { key: 'unknownSeconds', name: 'Unknown', color: AppColors.MediumGray },
  { key: 'awakeSeconds', name: 'Awake', color: AppColors.Orange },
] as const;
