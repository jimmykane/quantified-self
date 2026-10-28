import { type ActivityInterface, type LapInterface, XAxisTypes } from '@sports-alliance/sports-lib/metrics';
import { getRejectedSwimTiming } from '@shared/swim-timing';
import type { EventChartRange } from './event-chart-range.helper';

export interface SwimChartFocus {
  key: string;
  label: string;
  activity: ActivityInterface;
  startTime: number;
  endTime: number;
}

/** Only trustworthy, activity-local windows may drive a chart focus. */
export function getSwimLapFocusWindow(activity: ActivityInterface, laps: readonly LapInterface[]): Pick<SwimChartFocus, 'startTime' | 'endTime'> | null {
  const activityStart = activity.startDate?.getTime();
  const activityEnd = activity.endDate?.getTime();
  if (!laps.length || !Number.isFinite(activityStart) || !Number.isFinite(activityEnd)) return null;
  const sorted = [...laps].sort((a, b) => +a.startDate - +b.startDate);
  let previousEnd: number | null = null;
  for (const lap of sorted) {
    const start = lap.startDate?.getTime();
    const end = lap.endDate?.getTime();
    if (getRejectedSwimTiming(lap) || !Number.isFinite(start) || !Number.isFinite(end)
      || end <= start || start < activityStart || end > activityEnd
      || (previousEnd !== null && start !== previousEnd)) return null;
    previousEnd = end;
  }
  return { startTime: +sorted[0].startDate, endTime: +sorted[sorted.length - 1].endDate };
}

export function resolveSwimChartFocusRange(focus: SwimChartFocus, axis: XAxisTypes, domain: EventChartRange | null): EventChartRange | null {
  if (!domain || (axis !== XAxisTypes.Duration && axis !== XAxisTypes.Time)) return null;
  const start = axis === XAxisTypes.Time ? focus.startTime : (focus.startTime - +focus.activity.startDate) / 1000;
  const end = axis === XAxisTypes.Time ? focus.endTime : (focus.endTime - +focus.activity.startDate) / 1000;
  if (![start, end, domain.start, domain.end].every(Number.isFinite) || end <= start) return null;
  const clipped = { start: Math.max(start, domain.start), end: Math.min(end, domain.end) };
  return clipped.end > clipped.start ? clipped : null;
}
