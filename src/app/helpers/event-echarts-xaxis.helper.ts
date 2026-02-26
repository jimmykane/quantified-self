import { DataDistance, DynamicDataLoader, EventInterface, XAxisTypes } from '@sports-alliance/sports-lib';

export interface EventChartRange {
  start: number;
  end: number;
}

export function resolveEventChartXAxisType(event: EventInterface | null | undefined, configuredType: XAxisTypes): XAxisTypes {
  if (event?.isMultiSport && event.isMultiSport()) {
    return XAxisTypes.Time;
  }
  return configuredType;
}

export function formatEventXAxisValue(value: number, axisType: XAxisTypes): string {
  if (!Number.isFinite(value)) {
    return '';
  }

  switch (axisType) {
    case XAxisTypes.Time: {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) {
        return '';
      }
      return date.toLocaleString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        day: '2-digit',
        month: 'short'
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
