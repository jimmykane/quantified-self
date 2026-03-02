import { ActivityInterface, LapInterface, LapTypes } from '@sports-alliance/sports-lib';

export type EventLapTypeInput = LapTypes | string | null | undefined;
type EventLapLike = Pick<LapInterface, 'type'>;
type EventLapActivityLike = Pick<ActivityInterface, 'getLaps'>;

export const EXCLUDED_EVENT_LAP_TYPES = [LapTypes.session_end] as const satisfies readonly LapTypes[];

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
const EXCLUDED_EVENT_LAP_TYPE_SET = new Set(
  EXCLUDED_EVENT_LAP_TYPES.map((lapType) => `${lapType}`)
);

export function normalizeEventLapType(lapType: EventLapTypeInput): string {
  const rawValue = `${lapType ?? ''}`.trim();
  if (!rawValue) {
    return '';
  }

  const normalizedLookupKey = rawValue.toLowerCase();
  return NORMALIZED_LAP_TYPE_ALIASES.get(normalizedLookupKey)
    || LAP_TYPE_ALIASES[rawValue]
    || rawValue;
}

export function isExcludedEventLapType(lapType: EventLapTypeInput): boolean {
  const normalizedLapType = normalizeEventLapType(lapType);
  return normalizedLapType !== '' && EXCLUDED_EVENT_LAP_TYPE_SET.has(normalizedLapType);
}

export function buildAllowedEventLapTypeSet(lapTypes: readonly EventLapTypeInput[]): Set<string> {
  return new Set(
    (lapTypes || [])
      .map((lapType) => normalizeEventLapType(lapType))
      .filter((lapType) => lapType !== '' && !EXCLUDED_EVENT_LAP_TYPE_SET.has(lapType))
  );
}

export function isEventLapTypeAllowed(lapType: EventLapTypeInput, allowedLapTypes: readonly EventLapTypeInput[]): boolean {
  if (isExcludedEventLapType(lapType)) {
    return false;
  }

  const allowedLapTypeSet = buildAllowedEventLapTypeSet(allowedLapTypes);
  return allowedLapTypeSet.size === 0 || allowedLapTypeSet.has(normalizeEventLapType(lapType));
}

export function hasVisibleEventLaps(activities: readonly EventLapActivityLike[] | null | undefined): boolean {
  return (activities || []).some((activity) =>
    (activity.getLaps() || []).some((lap: EventLapLike) => !isExcludedEventLapType(lap.type))
  );
}
