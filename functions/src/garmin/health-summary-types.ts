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

export const GARMIN_HEALTH_SUMMARY_ENDPOINT_PATHS:
Readonly<Record<GarminHealthSummaryType, string>> = {
  dailies: 'dailies',
  stressDetails: 'stressDetails',
  hrv: 'hrv',
  userMetrics: 'userMetrics',
  bodyComps: 'bodyComps',
  pulseox: 'pulseOx',
  allDayRespiration: 'respiration',
  bloodPressures: 'bloodPressures',
  skinTemp: 'skinTemp',
  healthSnapshot: 'healthSnapshot',
};

export const GARMIN_SUPPORTED_SUMMARY_ENDPOINT_PATHS:
Readonly<Record<GarminSupportedSummaryType, string>> = {
  sleeps: 'sleeps',
  ...GARMIN_HEALTH_SUMMARY_ENDPOINT_PATHS,
};

export function getGarminSummaryTypeForEndpointPath(
  value: unknown,
): GarminSupportedSummaryType | null {
  if (typeof value !== 'string') return null;
  return GARMIN_SUPPORTED_SUMMARY_TYPES.find(
    summaryType => GARMIN_SUPPORTED_SUMMARY_ENDPOINT_PATHS[summaryType] === value,
  ) || null;
}

export function isGarminHealthSummaryType(value: unknown): value is GarminHealthSummaryType {
  return typeof value === 'string'
    && GARMIN_HEALTH_SUMMARY_TYPES.includes(value as GarminHealthSummaryType);
}

export function isGarminSupportedSummaryType(value: unknown): value is GarminSupportedSummaryType {
  return typeof value === 'string'
    && GARMIN_SUPPORTED_SUMMARY_TYPES.includes(value as GarminSupportedSummaryType);
}
