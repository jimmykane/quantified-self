import { AppColors } from '../services/color/app.colors';

export interface DeviceColorSwatch {
  label: string;
  color: string;
}

// Published sRGB values by Masataka Okabe and Kei Ito, both strong protanopes:
// https://jfly.uni-koeln.de/color/index.html#pallet
// Start with four colors suitable for lines on white; retain the full palette.
export const OKABE_ITO_DEVICE_COLORS: readonly DeviceColorSwatch[] = [
  { label: 'Vermillion (red-orange)', color: '#D55E00' },
  { label: 'Blue', color: '#0072B2' },
  { label: 'Black', color: '#000000' },
  { label: 'Reddish purple', color: '#CC79A7' },
  { label: 'Bluish green', color: '#009E73' },
  { label: 'Sky blue', color: '#56B4E9' },
  { label: 'Orange', color: '#E69F00' },
  { label: 'Yellow', color: '#F0E442' },
];

export const STANDARD_DEVICE_COLORS: readonly DeviceColorSwatch[] = [
  { label: 'Blue', color: AppColors.Blue },
  { label: 'Orange', color: AppColors.StrongOrange },
  { label: 'Green', color: AppColors.Green },
  { label: 'Purple', color: AppColors.Purple },
  { label: 'Red', color: AppColors.Red },
  { label: 'Light blue', color: AppColors.LightBlue },
  { label: 'Pink', color: AppColors.Pink },
  { label: 'Light green', color: AppColors.LightGreen },
  { label: 'Deep blue', color: AppColors.DeepBlue },
  { label: 'Yellow', color: AppColors.Yellow },
  { label: 'Dark gray', color: AppColors.DarkestGray },
  { label: 'Tan', color: '#A68A5B' },
].map(swatch => ({ ...swatch, color: swatch.color.toUpperCase() }));
