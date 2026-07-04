import { DataDuration, type EventInterface } from '@sports-alliance/sports-lib';
import {
  buildPowerCurveEnvelope,
  filterPowerCurvePointsByMaxDuration,
  normalizePowerCurvePoints,
  POWER_CURVE_STAT_TYPE,
  type PowerCurvePoint,
} from '@shared/power-curve';

export interface DashboardPowerCurveSeries {
  seriesKey: 'best' | 'latest' | 'latestAndBest';
  label: string;
  colorKey: string;
  points: PowerCurvePoint[];
  eventId?: string | null;
  eventStartMs?: number | null;
}

export interface DashboardPowerCurveSummaryPoint {
  duration: number;
  power: number;
  wattsPerKg?: number;
}

export interface DashboardPowerCurveContext {
  matchedEventCount: number;
  sourceEventCount: number;
  latestEventId: string | null;
  latestEventStartMs: number | null;
  series: DashboardPowerCurveSeries[];
  summaryPoints: DashboardPowerCurveSummaryPoint[];
}

export interface DashboardPowerCurveContextOptions {
  latestSeriesLabel?: string;
}

interface ResolvedPowerCurveEvent {
  event: EventInterface;
  eventId: string | null;
  startMs: number | null;
  points: PowerCurvePoint[];
}

const SUMMARY_DURATIONS_SECONDS = [5, 60, 300, 1200, 3600];

export function buildDashboardPowerCurveContext(
  events: EventInterface[],
  options: DashboardPowerCurveContextOptions = {},
): DashboardPowerCurveContext {
  const resolvedEvents = (events || [])
    .map(resolvePowerCurveEvent)
    .filter((entry): entry is ResolvedPowerCurveEvent => entry !== null)
    .sort((left, right) => compareResolvedPowerCurveEvents(left, right));

  const latestEvent = resolvedEvents[resolvedEvents.length - 1] || null;
  const envelope = buildPowerCurveEnvelope(resolvedEvents.map(entry => entry.points));
  const summaryPoints = buildDashboardPowerCurveSummaryPoints(envelope);
  const sourceEventCount = Array.isArray(events) ? events.length : 0;

  if (!resolvedEvents.length || !envelope.length) {
    return {
      matchedEventCount: 0,
      sourceEventCount,
      latestEventId: null,
      latestEventStartMs: null,
      series: [],
      summaryPoints,
    };
  }

  const latestSeries: DashboardPowerCurveSeries | null = latestEvent
    ? {
      seriesKey: 'latest',
      label: options.latestSeriesLabel || 'Latest power activity',
      colorKey: 'latest',
      points: latestEvent.points,
      eventId: latestEvent.eventId,
      eventStartMs: latestEvent.startMs,
    }
    : null;
  const latestEqualsBest = latestSeries !== null && powerCurvePointsEqual(latestSeries.points, envelope);
  const series = latestEqualsBest
    ? [{
      seriesKey: 'latestAndBest' as const,
      label: 'Latest and best',
      colorKey: 'best',
      points: envelope,
      eventId: latestSeries.eventId,
      eventStartMs: latestSeries.eventStartMs,
    }]
    : [
      {
        seriesKey: 'best' as const,
        label: 'Best in range',
        colorKey: 'best',
        points: envelope,
      },
      ...(latestSeries ? [latestSeries] : []),
    ];

  return {
    matchedEventCount: resolvedEvents.length,
    sourceEventCount,
    latestEventId: latestEvent?.eventId ?? null,
    latestEventStartMs: latestEvent?.startMs ?? null,
    series,
    summaryPoints,
  };
}

function resolvePowerCurveEvent(event: EventInterface): ResolvedPowerCurveEvent | null {
  const stat = event?.getStat?.(POWER_CURVE_STAT_TYPE) as { getValue?: () => unknown } | null | undefined;
  const durationSeconds = resolveEventDurationSeconds(event);
  const points = filterPowerCurvePointsByMaxDuration(
    normalizePowerCurvePoints(stat?.getValue?.()).points,
    durationSeconds,
  );
  if (!points.length) {
    return null;
  }
  return {
    event,
    eventId: resolveEventId(event),
    startMs: resolveEventStartMs(event),
    points,
  };
}

function resolveEventId(event: EventInterface): string | null {
  const candidate = `${event?.getID?.() || (event as { id?: unknown })?.id || ''}`.trim();
  return candidate.length > 0 ? candidate : null;
}

function resolveEventStartMs(event: EventInterface): number | null {
  const rawValue = (event as { startDate?: unknown })?.startDate;
  return resolveDateLikeMs(rawValue);
}

function resolveEventDurationSeconds(event: EventInterface): number | null {
  const candidates = [
    (event as { getDuration?: () => { getValue?: () => unknown } | null | undefined })?.getDuration?.()?.getValue?.(),
    (event?.getStat?.(DataDuration.type) as { getValue?: () => unknown } | null | undefined)?.getValue?.(),
    (event as { duration?: unknown })?.duration,
  ];

  for (const candidate of candidates) {
    const duration = toFinitePositiveNumber(candidate);
    if (duration !== null) {
      return duration;
    }
  }

  const startMs = resolveEventStartMs(event);
  const endMs = resolveEventEndMs(event);
  if (startMs === null || endMs === null || endMs <= startMs) {
    return null;
  }
  return (endMs - startMs) / 1000;
}

function resolveEventEndMs(event: EventInterface): number | null {
  const rawValue = (event as { endDate?: unknown })?.endDate;
  return resolveDateLikeMs(rawValue);
}

function resolveDateLikeMs(rawValue: unknown): number | null {
  if (rawValue instanceof Date) {
    const time = rawValue.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return rawValue;
  }
  if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
    const time = new Date(rawValue).getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (rawValue && typeof rawValue === 'object') {
    const date = (rawValue as { toDate?: () => Date }).toDate?.();
    if (date instanceof Date) {
      const time = date.getTime();
      return Number.isFinite(time) ? time : null;
    }
    const seconds = (rawValue as { seconds?: unknown }).seconds;
    const nanoseconds = (rawValue as { nanoseconds?: unknown }).nanoseconds;
    if (typeof seconds === 'number' && Number.isFinite(seconds)) {
      return (seconds * 1000) + (typeof nanoseconds === 'number' && Number.isFinite(nanoseconds)
        ? Math.floor(nanoseconds / 1000000)
        : 0);
    }
  }
  return null;
}

function toFinitePositiveNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function compareResolvedPowerCurveEvents(left: ResolvedPowerCurveEvent, right: ResolvedPowerCurveEvent): number {
  const leftStart = left.startMs ?? Number.NEGATIVE_INFINITY;
  const rightStart = right.startMs ?? Number.NEGATIVE_INFINITY;
  if (leftStart !== rightStart) {
    return leftStart - rightStart;
  }
  return `${left.eventId || ''}`.localeCompare(`${right.eventId || ''}`);
}

function buildDashboardPowerCurveSummaryPoints(points: PowerCurvePoint[]): DashboardPowerCurveSummaryPoint[] {
  return SUMMARY_DURATIONS_SECONDS
    .map(duration => points.find(point => point.duration === duration))
    .filter((point): point is PowerCurvePoint => !!point)
    .map(point => ({ ...point }));
}

function powerCurvePointsEqual(left: PowerCurvePoint[], right: PowerCurvePoint[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((leftPoint, index) => {
    const rightPoint = right[index];
    return rightPoint
      && leftPoint.duration === rightPoint.duration
      && leftPoint.power === rightPoint.power
      && (leftPoint.wattsPerKg ?? null) === (rightPoint.wattsPerKg ?? null);
  });
}
