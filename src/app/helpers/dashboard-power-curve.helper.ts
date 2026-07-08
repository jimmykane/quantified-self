import { DataDuration, type EventInterface } from '@sports-alliance/sports-lib';
import {
  buildPowerCurveEnvelope,
  filterPowerCurvePointsByMaxDuration,
  normalizePowerCurvePoints,
  POWER_CURVE_STAT_TYPE,
  type PowerCurvePoint,
} from '@shared/power-curve';
import type { AppDashboardPowerCurveCompareMode } from '../models/app-user.interface';

export interface DashboardPowerCurveSeries {
  seriesKey: 'best' | 'latest' | 'comparisonBest' | 'latestAndBest';
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
  latestSeriesLabel: string;
  compareMode: AppDashboardPowerCurveCompareMode;
  comparisonSeriesLabel: string;
  comparisonEventCount: number;
  series: DashboardPowerCurveSeries[];
  summaryPoints: DashboardPowerCurveSummaryPoint[];
}

export interface DashboardPowerCurveContextOptions {
  latestSeriesLabel?: string;
  compareMode?: AppDashboardPowerCurveCompareMode | null;
  nowMs?: number;
}

interface ResolvedPowerCurveEvent {
  event: EventInterface;
  eventId: string | null;
  startMs: number | null;
  points: PowerCurvePoint[];
}

const SUMMARY_DURATIONS_SECONDS = [5, 60, 300, 1200, 3600];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const DASHBOARD_POWER_CURVE_DEFAULT_COMPARE_MODE: AppDashboardPowerCurveCompareMode = 'latest';

export interface DashboardPowerCurveCompareModeOption {
  mode: AppDashboardPowerCurveCompareMode;
  label: string;
  shortLabel: string;
  menuLabel: string;
  windowDays?: number;
}

export const DASHBOARD_POWER_CURVE_COMPARE_MODE_OPTIONS: ReadonlyArray<DashboardPowerCurveCompareModeOption> = [
  {
    mode: 'latest',
    label: 'Latest',
    shortLabel: 'Latest',
    menuLabel: 'Latest activity',
  },
  {
    mode: 'best30d',
    label: '30d',
    shortLabel: '30d',
    menuLabel: 'Best last 30d',
    windowDays: 30,
  },
  {
    mode: 'best90d',
    label: '90d',
    shortLabel: '90d',
    menuLabel: 'Best last 90d',
    windowDays: 90,
  },
];

const DASHBOARD_POWER_CURVE_COMPARE_MODES = new Set<AppDashboardPowerCurveCompareMode>(
  DASHBOARD_POWER_CURVE_COMPARE_MODE_OPTIONS.map(option => option.mode),
);

export function normalizeDashboardPowerCurveCompareMode(value: unknown): AppDashboardPowerCurveCompareMode {
  const stringValue = `${value || ''}`;
  return DASHBOARD_POWER_CURVE_COMPARE_MODES.has(stringValue as AppDashboardPowerCurveCompareMode)
    ? stringValue as AppDashboardPowerCurveCompareMode
    : DASHBOARD_POWER_CURVE_DEFAULT_COMPARE_MODE;
}

export function resolveDashboardPowerCurveComparisonLabel(
  mode: AppDashboardPowerCurveCompareMode,
  latestSeriesLabel: string,
): string {
  const normalizedMode = normalizeDashboardPowerCurveCompareMode(mode);
  if (normalizedMode === 'latest') {
    return latestSeriesLabel;
  }
  return DASHBOARD_POWER_CURVE_COMPARE_MODE_OPTIONS
    .find(option => option.mode === normalizedMode)?.menuLabel || latestSeriesLabel;
}

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
  const latestSeriesLabel = options.latestSeriesLabel || 'Latest power activity';
  const compareMode = normalizeDashboardPowerCurveCompareMode(options.compareMode);
  const comparisonSeriesLabel = resolveDashboardPowerCurveComparisonLabel(compareMode, latestSeriesLabel);
  const comparisonAnchorMs = options.nowMs ?? latestEvent?.startMs ?? Date.now();
  const comparisonEvents = resolveComparisonPowerCurveEvents(resolvedEvents, compareMode, comparisonAnchorMs);
  const comparisonPoints = compareMode === 'latest'
    ? comparisonEvents[0]?.points || []
    : buildPowerCurveEnvelope(comparisonEvents.map(entry => entry.points));

  if (!resolvedEvents.length || !envelope.length) {
    return {
      matchedEventCount: 0,
      sourceEventCount,
      latestEventId: null,
      latestEventStartMs: null,
      latestSeriesLabel,
      compareMode,
      comparisonSeriesLabel,
      comparisonEventCount: 0,
      series: [],
      summaryPoints,
    };
  }

  const comparisonSeries: DashboardPowerCurveSeries | null = comparisonPoints.length
    ? {
      seriesKey: compareMode === 'latest' ? 'latest' : 'comparisonBest',
      label: comparisonSeriesLabel,
      colorKey: 'latest',
      points: comparisonPoints,
      ...(compareMode === 'latest' ? {
        eventId: comparisonEvents[0]?.eventId ?? null,
        eventStartMs: comparisonEvents[0]?.startMs ?? null,
      } : {}),
    }
    : null;
  const comparisonEqualsBest = comparisonSeries !== null && powerCurvePointsEqual(comparisonSeries.points, envelope);
  const series = comparisonEqualsBest
    ? [{
      seriesKey: 'latestAndBest' as const,
      label: compareMode === 'latest' ? 'Latest and best' : `${comparisonSeriesLabel} and best`,
      colorKey: 'best',
      points: envelope,
      eventId: comparisonSeries.eventId,
      eventStartMs: comparisonSeries.eventStartMs,
    }]
    : [
      {
        seriesKey: 'best' as const,
        label: 'Best in range',
        colorKey: 'best',
        points: envelope,
      },
      ...(comparisonSeries ? [comparisonSeries] : []),
    ];

  return {
    matchedEventCount: resolvedEvents.length,
    sourceEventCount,
    latestEventId: latestEvent?.eventId ?? null,
    latestEventStartMs: latestEvent?.startMs ?? null,
    latestSeriesLabel,
    compareMode,
    comparisonSeriesLabel,
    comparisonEventCount: comparisonEvents.length,
    series,
    summaryPoints,
  };
}

function resolveComparisonPowerCurveEvents(
  events: ResolvedPowerCurveEvent[],
  compareMode: AppDashboardPowerCurveCompareMode,
  nowMs = Date.now(),
): ResolvedPowerCurveEvent[] {
  if (compareMode === 'latest') {
    const latestEvent = events[events.length - 1] || null;
    return latestEvent ? [latestEvent] : [];
  }

  const windowDays = DASHBOARD_POWER_CURVE_COMPARE_MODE_OPTIONS
    .find(option => option.mode === compareMode)?.windowDays ?? null;
  if (!windowDays || !Number.isFinite(nowMs)) {
    return [];
  }

  const cutoffMs = nowMs - (windowDays * MS_PER_DAY);
  return events.filter(entry => (
    entry.startMs !== null
    && entry.startMs >= cutoffMs
    && entry.startMs <= nowMs
  ));
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
