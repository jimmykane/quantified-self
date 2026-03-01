import { LapTypes } from '@sports-alliance/sports-lib';

const LAP_TYPE_ALIASES = LapTypes as unknown as Record<string, string>;
const NORMALIZED_LAP_TYPE_ALIASES = new Map<string, string>([
  ['auto', LapTypes.AutoLap],
  ['autolap', LapTypes.AutoLap],
  ['auto lap', LapTypes.AutoLap],
  ['manual', LapTypes.Manual],
  ['distance', LapTypes.Distance],
  ['time', LapTypes.Time],
  ['location', LapTypes.Location],
  ['interval', LapTypes.Interval],
  ['heart rate', LapTypes.HeartRate],
  ['heartrate', LapTypes.HeartRate],
]);

export function normalizeEventLapType(lapType: unknown): string {
  const rawValue = `${lapType ?? ''}`.trim();
  if (!rawValue) {
    return '';
  }

  const normalizedLookupKey = rawValue.toLowerCase();
  return NORMALIZED_LAP_TYPE_ALIASES.get(normalizedLookupKey)
    || LAP_TYPE_ALIASES[rawValue]
    || rawValue;
}

export function buildAllowedEventLapTypeSet(lapTypes: readonly unknown[]): Set<string> {
  return new Set((lapTypes || []).map((lapType) => normalizeEventLapType(lapType)).filter(Boolean));
}

export function isEventLapTypeAllowed(lapType: unknown, allowedLapTypes: readonly unknown[]): boolean {
  const allowedLapTypeSet = buildAllowedEventLapTypeSet(allowedLapTypes);
  return allowedLapTypeSet.size === 0 || allowedLapTypeSet.has(normalizeEventLapType(lapType));
}
