export const GARMIN_HEALTH_SUMMARY_TYPES = [
  'dailies',
  'stressDetails',
  'hrv',
  'userMetrics',
  'bodyComps',
  'pulseox',
  'allDayRespiration',
  'bloodPressures',
  'skinTemp',
  'healthSnapshot',
] as const;

export type GarminHealthSummaryType = typeof GARMIN_HEALTH_SUMMARY_TYPES[number];

export const GARMIN_SUPPORTED_SUMMARY_TYPES = [
  'sleeps',
  ...GARMIN_HEALTH_SUMMARY_TYPES,
] as const;

export type GarminSupportedSummaryType = typeof GARMIN_SUPPORTED_SUMMARY_TYPES[number];

export function isGarminHealthSummaryType(value: unknown): value is GarminHealthSummaryType {
  return typeof value === 'string'
    && GARMIN_HEALTH_SUMMARY_TYPES.includes(value as GarminHealthSummaryType);
}

export function isGarminSupportedSummaryType(value: unknown): value is GarminSupportedSummaryType {
  return typeof value === 'string'
    && GARMIN_SUPPORTED_SUMMARY_TYPES.includes(value as GarminSupportedSummaryType);
}
