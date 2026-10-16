import { ActivityInterface, LapInterface, LapTypes } from '@sports-alliance/sports-lib';

export type EventLapTypeInput = LapTypes | string | null | undefined;
type EventLapActivityLike = Pick<ActivityInterface, 'getLaps'> & Partial<Pick<
  ActivityInterface, 'startDate' | 'endDate' | 'getDuration' | 'getDistance' | 'type'
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
    || lapEnd <= lapStart
    || Math.abs(lapStart - activityStart) > 1000
    || Math.abs(lapEnd - activityEnd) > 1000) {
    return false;
  }

  const totals = [
    [activity.getDuration?.(), lap.getDuration?.()],
    [activity.getDistance?.(), lap.getDistance?.()],
  ]
    // A metric omitted by both records provides no evidence. A missing or
    // invalid value on just one side must prevent duplicate suppression.
    .filter(([activityStat, lapStat]) => activityStat || lapStat)
    .map(([activityStat, lapStat]) => [activityStat?.getValue?.(), lapStat?.getValue?.()]);

  // One second of timer rounding or one metre of distance rounding is allowed.
  // Matching zero distance alone cannot confirm a whole-activity duplicate.
  return totals.some(([activityValue]) => activityValue > 0)
    && totals.every(([activityValue, lapValue]) => (
      Number.isFinite(activityValue) && Number.isFinite(lapValue)
      && activityValue >= 0 && lapValue >= 0
      && Math.abs(activityValue - lapValue) <= 1
    ));
}

/** An endpoint outside this leg must not be clamped to its last map/chart sample. */
export function isEventLapEndpointInActivity(activity: EventLapActivityLike, lap: LapInterface): boolean {
  const start = activity.startDate?.getTime();
  const end = activity.endDate?.getTime();
  const point = lap.endDate?.getTime();
  if (![start, end, point].every(Number.isFinite)) return true;
  // Some saved laps have collapsed dates but an explicit, leg-local sample index.
  // Retain the existing index fallback without accepting a shared boundary on both legs.
  if (point === start && lap.startDate?.getTime() === start) {
    const index = lap.getEndIndex?.(activity as ActivityInterface);
    return Number.isFinite(index) && index > 0;
  }
  return point > start && point <= end;
}

export function getEventLapContextLabel(
  activity: EventLapActivityLike,
  lap: LapInterface,
  activities: readonly EventLapActivityLike[] = [],
): string {
  const start = lap.startDate?.getTime();
  const end = lap.endDate?.getTime();
  const activityStart = activity.startDate?.getTime();
  const activityEnd = activity.endDate?.getTime();
  if (![start, end, activityStart, activityEnd].every(Number.isFinite)
    || (start >= activityStart && end <= activityEnd)) {
    return '';
  }
  const overlapping = activities.filter(a => Math.min(end, +a.endDate) > Math.max(start, +a.startDate));
  // A later source end alone does not establish another sport or activity leg.
  if (start >= activityStart && !overlapping.some(a => a !== activity)) {
    return '';
  }
  const sports = new Set(overlapping.map(a => a.type).filter(Boolean));
  return sports.size > 1 ? 'Multisport lap' : 'Across activity legs';
}

export function getVisibleEventLaps(
  activity: EventLapActivityLike, activities: readonly EventLapActivityLike[] = [],
): LapInterface[] {
  const laps = activity.getLaps?.() || [];
  if (laps.length === 1 && isWholeActivityLap(activity, laps[0])) {
    return [];
  }

  // Session end is a real final segment after earlier laps, including short
  // remainders. The provider's trigger does not determine table visibility.
  return laps.filter(lap => {
    if (!normalizeEventLapType(lap.type)) return false;
    if (isEventLapEndpointInActivity(activity, lap)) return true;
    const owners = activities.filter(a => a !== activity && isEventLapEndpointInActivity(a, lap)
      && Number.isFinite(a.startDate?.getTime()) && Number.isFinite(a.endDate?.getTime())
      && a.getLaps().filter(other => +other.startDate === +lap.startDate && +other.endDate === +lap.endDate
        && normalizeEventLapType(other.type) === normalizeEventLapType(lap.type)).length === 1);
    // Missing or ambiguous ownership stays visible. This is a display projection;
    // stored laps and source statistics are never rewritten here.
    return owners.length !== 1;
  });
}

export function hasVisibleEventLaps(activities: readonly EventLapActivityLike[] | null | undefined): boolean {
  return (activities || []).some((activity) => getVisibleEventLaps(activity).length > 0);
}
