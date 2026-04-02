import { DataDuration, DataRecoveryTime, type EventInterface } from '@sports-alliance/sports-lib';

export interface DashboardRecoveryNowSegment {
  totalSeconds: number;
  endTimeMs: number;
}

export interface DashboardRecoveryNowContext {
  totalSeconds: number;
  endTimeMs: number;
  segments?: DashboardRecoveryNowSegment[];
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function toFinitePositiveNumber(value: unknown): number | null {
  const numericValue = toFiniteNumber(value);
  if (numericValue === null || numericValue <= 0) {
    return null;
  }
  return numericValue;
}

function resolveEventStatNumber(event: EventInterface, dataType: string): number | null {
  const stat = event?.getStat?.(dataType) as { getValue?: () => unknown } | null | undefined;
  return toFiniteNumber(stat?.getValue?.());
}

function resolveRecoveryTotalSeconds(event: EventInterface): number | null {
  return toFinitePositiveNumber(resolveEventStatNumber(event, DataRecoveryTime.type));
}

function resolveEventStartTimeMs(event: EventInterface): number | null {
  const startDate = event?.startDate;
  if (!(startDate instanceof Date)) {
    return null;
  }

  const startTimeMs = startDate.getTime();
  return Number.isFinite(startTimeMs) ? startTimeMs : null;
}

export function resolveRecoveryEventEndTimeMs(event: EventInterface): number | null {
  const endDate = event?.endDate;
  if (endDate instanceof Date) {
    const endTimeMs = endDate.getTime();
    if (Number.isFinite(endTimeMs)) {
      return endTimeMs;
    }
  }

  const startTimeMs = resolveEventStartTimeMs(event);
  if (startTimeMs === null) {
    return null;
  }

  const durationFromEvent = toFinitePositiveNumber(
    (event as { getDuration?: () => { getValue?: () => unknown } | null | undefined })?.getDuration?.()?.getValue?.(),
  );
  if (durationFromEvent !== null) {
    return startTimeMs + (durationFromEvent * 1000);
  }

  const durationFromStat = toFinitePositiveNumber(resolveEventStatNumber(event, DataDuration.type));
  if (durationFromStat !== null) {
    return startTimeMs + (durationFromStat * 1000);
  }

  return null;
}

export function resolveAggregatedRecoveryNowContext(
  events: readonly EventInterface[] | null | undefined,
): DashboardRecoveryNowContext | null {
  const safeEvents = Array.isArray(events) ? events : [];
  const segments: DashboardRecoveryNowSegment[] = [];
  let totalRecoverySeconds = 0;
  let latestEndTimeMs = Number.NEGATIVE_INFINITY;

  for (const event of safeEvents) {
    const totalSeconds = resolveRecoveryTotalSeconds(event);
    if (totalSeconds === null) {
      continue;
    }

    const endTimeMs = resolveRecoveryEventEndTimeMs(event);
    if (endTimeMs === null) {
      continue;
    }

    totalRecoverySeconds += totalSeconds;
    latestEndTimeMs = Math.max(latestEndTimeMs, endTimeMs);
    segments.push({ totalSeconds, endTimeMs });
  }

  if (!segments.length || !Number.isFinite(totalRecoverySeconds) || totalRecoverySeconds <= 0) {
    return null;
  }

  return {
    totalSeconds: totalRecoverySeconds,
    endTimeMs: latestEndTimeMs,
    segments,
  };
}

/**
 * @deprecated Use resolveAggregatedRecoveryNowContext instead.
 */
export function resolveLatestRecoveryNowContext(
  events: readonly EventInterface[] | null | undefined,
): DashboardRecoveryNowContext | null {
  return resolveAggregatedRecoveryNowContext(events);
}

export function resolveRemainingRecoverySeconds(
  context: DashboardRecoveryNowContext | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!context) {
    return null;
  }

  const segments = Array.isArray(context.segments) ? context.segments : [];
  if (segments.length > 0) {
    let totalRemainingSeconds = 0;
    let hasValidSegment = false;

    for (const segment of segments) {
      const segmentTotalSeconds = toFinitePositiveNumber(segment?.totalSeconds);
      const segmentEndTimeMs = toFiniteNumber(segment?.endTimeMs);
      if (segmentTotalSeconds === null || segmentEndTimeMs === null) {
        continue;
      }

      hasValidSegment = true;
      const elapsedSeconds = Math.max(0, (nowMs - segmentEndTimeMs) / 1000);
      const remainingSeconds = segmentTotalSeconds - elapsedSeconds;
      if (!Number.isFinite(remainingSeconds)) {
        continue;
      }

      totalRemainingSeconds += Math.max(0, remainingSeconds);
    }

    if (!hasValidSegment || !Number.isFinite(totalRemainingSeconds)) {
      return null;
    }

    return Math.max(0, Math.floor(totalRemainingSeconds));
  }

  const totalSeconds = toFinitePositiveNumber(context.totalSeconds);
  const endTimeMs = toFiniteNumber(context.endTimeMs);
  if (totalSeconds === null || endTimeMs === null) {
    return null;
  }

  const elapsedSeconds = Math.max(0, (nowMs - endTimeMs) / 1000);
  const remainingSeconds = totalSeconds - elapsedSeconds;

  if (!Number.isFinite(remainingSeconds)) {
    return null;
  }

  return Math.max(0, Math.floor(remainingSeconds));
}
