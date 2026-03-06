import { DataDistance, DynamicDataLoader, EventInterface, XAxisTypes } from '@sports-alliance/sports-lib';
import { getBrowserLocale } from '../shared/adapters/date-locale.config';

export interface EventChartRange {
  start: number;
  end: number;
}

export interface EventXAxisFormatOptions {
  includeDateForTime?: boolean;
  locale?: string;
}

const EVENT_X_AXIS_TARGET_TICK_COUNT = 6;
const CANONICAL_DURATION_INTERVALS_SECONDS = [
  1,
  2,
  5,
  10,
  15,
  30,
  60,
  120,
  300,
  600,
  900,
  1800,
  3600,
  7200,
  10800,
  21600,
  43200,
  86400,
  172800,
  604800,
];

export function resolveEventChartXAxisType(event: EventInterface | null | undefined, configuredType: XAxisTypes): XAxisTypes {
  if (event?.isMultiSport && event.isMultiSport()) {
    return XAxisTypes.Time;
  }
  return configuredType;
}

export function formatEventXAxisValue(value: number, axisType: XAxisTypes, options?: EventXAxisFormatOptions): string {
  if (!Number.isFinite(value)) {
    return '';
  }

  const locale = options?.locale || getBrowserLocale();

  switch (axisType) {
    case XAxisTypes.Time: {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) {
        return '';
      }
      const includeDate = options?.includeDateForTime !== false;
      if (includeDate) {
        return date.toLocaleString(locale, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          day: '2-digit',
          month: 'short'
        });
      }
      return date.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }
    case XAxisTypes.Duration:
      return formatDurationSeconds(value);
    case XAxisTypes.Distance:
      return formatDistance(value);
    default:
      return `${value}`;
  }
}

export function buildEventCanonicalXAxisScaleOptions(
  axisType: XAxisTypes,
  range: EventChartRange | null | undefined
): { interval: number; minInterval: number; maxInterval: number; splitNumber: number } | null {
  const interval = getCanonicalEventXAxisInterval(axisType, range);
  if (!Number.isFinite(interval)) {
    return null;
  }

  return {
    interval: interval as number,
    minInterval: interval as number,
    maxInterval: interval as number,
    splitNumber: EVENT_X_AXIS_TARGET_TICK_COUNT,
  };
}

export function getCanonicalEventXAxisInterval(
  axisType: XAxisTypes,
  range: EventChartRange | null | undefined
): number | null {
  const normalized = normalizeEventRange(range);
  if (!normalized) {
    return null;
  }

  const span = normalized.end - normalized.start;
  if (!Number.isFinite(span) || span <= 0) {
    return null;
  }

  switch (axisType) {
    case XAxisTypes.Duration:
      return pickCanonicalInterval(span, CANONICAL_DURATION_INTERVALS_SECONDS);
    case XAxisTypes.Time:
      return pickCanonicalInterval(
        span,
        CANONICAL_DURATION_INTERVALS_SECONDS.map((seconds) => seconds * 1000)
      );
    default:
      return null;
  }
}

export function normalizeEventRange(range: EventChartRange | null | undefined): EventChartRange | null {
  if (!range) {
    return null;
  }

  const start = Number(range.start);
  const end = Number(range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  return {
    start: Math.min(start, end),
    end: Math.max(start, end)
  };
}

export function clampEventRange(range: EventChartRange | null | undefined, domainStart: number, domainEnd: number): EventChartRange | null {
  const normalized = normalizeEventRange(range);
  if (!normalized) {
    return null;
  }

  if (!Number.isFinite(domainStart) || !Number.isFinite(domainEnd) || domainEnd <= domainStart) {
    return normalized;
  }

  const start = Math.max(domainStart, Math.min(domainEnd, normalized.start));
  const end = Math.max(domainStart, Math.min(domainEnd, normalized.end));

  if (end <= start) {
    return {
      start: domainStart,
      end: domainEnd
    };
  }

  return {
    start,
    end
  };
}

export function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return '';
  }

  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}`;
  }

  return `${pad2(minutes)}:${pad2(secs)}`;
}

export function formatDistance(distanceMeters: number): string {
  try {
    const distanceInstance = DynamicDataLoader.getDataInstanceFromDataType(DataDistance.type, distanceMeters);
    return `${distanceInstance.getDisplayValue()}${distanceInstance.getDisplayUnit()}`;
  } catch {
    return `${distanceMeters.toFixed(0)}m`;
  }
}

function pad2(value: number): string {
  return `${value}`.padStart(2, '0');
}

function pickCanonicalInterval(span: number, candidates: number[]): number | null {
  if (!Number.isFinite(span) || span <= 0 || !Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  let bestCandidate: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!Number.isFinite(candidate) || candidate <= 0) {
      continue;
    }

    const tickCount = span / candidate;
    const score = Math.abs(tickCount - EVENT_X_AXIS_TARGET_TICK_COUNT);
    if (score < bestScore || (score === bestScore && (bestCandidate === null || candidate < bestCandidate))) {
      bestCandidate = candidate;
      bestScore = score;
    }
  }

  return bestCandidate;
}
