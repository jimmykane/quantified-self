import { ActivityInterface, LapInterface, LapTypes } from '@sports-alliance/sports-lib';

export type EventLapTypeInput = LapTypes | string | null | undefined;
type EventLapLike = Pick<LapInterface, 'type'>;
type EventLapActivityLike = Pick<ActivityInterface, 'getLaps'> & Partial<Pick<
  ActivityInterface, 'startDate' | 'endDate' | 'getDuration' | 'getDistance'
>>;

// Terminal chart/map markers remain separate from lap table visibility.
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
  const normalizedLapType = normalizeEventLapType(lapType);
  if (normalizedLapType === '' || EXCLUDED_EVENT_LAP_TYPE_SET.has(normalizedLapType)) {
    return false;
  }

  const allowedLapTypeSet = buildAllowedEventLapTypeSet(allowedLapTypes);
  return allowedLapTypeSet.size === 0 || allowedLapTypeSet.has(normalizedLapType);
}

function isWholeActivityLap(activity: EventLapActivityLike, lap: LapInterface): boolean {
  const activityStart = activity.startDate?.getTime();
  const activityEnd = activity.endDate?.getTime();
  const lapStart = lap.startDate?.getTime();
  const lapEnd = lap.endDate?.getTime();
  // FIT timestamps and summary totals can round independently. Keep uncertain
  // records visible; only suppress a confirmed duplicate of the activity.
  if (![activityStart, activityEnd, lapStart, lapEnd].every(Number.isFinite)
    || activityEnd <= activityStart
    || Math.abs(lapStart - activityStart) > 1000
    || Math.abs(lapEnd - activityEnd) > 1000) {
    return false;
  }

  const totals = [
    [activity.getDuration?.()?.getValue?.(), lap.getDuration?.()?.getValue?.()],
    [activity.getDistance?.()?.getValue?.(), lap.getDistance?.()?.getValue?.()],
  ].filter(([activityValue, lapValue]) => (
    Number.isFinite(activityValue) && Number.isFinite(lapValue)
    && activityValue >= 0 && lapValue >= 0
  ));

  // One second of timer rounding or one metre of distance rounding is allowed.
  return totals.length > 0 && totals.every(([activityValue, lapValue]) => (
    Math.abs(activityValue - lapValue) <= 1
  ));
}

export function getVisibleEventLaps(activity: EventLapActivityLike): LapInterface[] {
  const laps = activity.getLaps?.() || [];
  if (laps.length === 1 && isWholeActivityLap(activity, laps[0])) {
    return [];
  }

  // Session end is a real final segment after earlier laps, including short
  // remainders. The provider's trigger does not determine table visibility.
  return laps.filter((lap: EventLapLike) => normalizeEventLapType(lap.type) !== '');
}

export function hasVisibleEventLaps(activities: readonly EventLapActivityLike[] | null | undefined): boolean {
  return (activities || []).some((activity) => getVisibleEventLaps(activity).length > 0);
}
