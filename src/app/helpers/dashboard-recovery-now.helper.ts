import { DataDuration, DataRecoveryTime, type EventInterface } from '@sports-alliance/sports-lib';
import { DERIVED_RECOVERY_MAX_SUPPORTED_SECONDS } from '@shared/derived-metrics';

export interface DashboardRecoveryNowSegment {
  totalSeconds: number;
  endTimeMs: number;
}

export interface DashboardRecoveryNowContext {
  totalSeconds: number;
  endTimeMs: number;
  segments?: DashboardRecoveryNowSegment[];
  latestWorkoutSeconds?: number | null;
  latestWorkoutEndTimeMs?: number | null;
  maxSupportedRecoverySeconds?: number;
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

function toSupportedRecoverySeconds(value: unknown): number | null {
  const numericValue = toFinitePositiveNumber(value);
  if (numericValue === null || numericValue > DERIVED_RECOVERY_MAX_SUPPORTED_SECONDS) {
    return null;
  }
  return numericValue;
}

function resolveEventStatNumber(event: EventInterface, dataType: string): number | null {
  const stat = event?.getStat?.(dataType) as { getValue?: () => unknown } | null | undefined;
  return toFiniteNumber(stat?.getValue?.());
}

function resolveRecoveryTotalSeconds(event: EventInterface): number | null {
  return toSupportedRecoverySeconds(resolveEventStatNumber(event, DataRecoveryTime.type));
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
    totalSeconds: Math.floor(totalRecoverySeconds),
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
      const segmentTotalSeconds = toSupportedRecoverySeconds(segment?.totalSeconds);
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

  const totalSeconds = toSupportedRecoverySeconds(context.totalSeconds);
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

export function resolveActiveRecoveryTotalSeconds(
  context: DashboardRecoveryNowContext | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!context) {
    return null;
  }

  const segments = Array.isArray(context.segments) ? context.segments : [];
  if (segments.length > 0) {
    let activeTotalSeconds = 0;
    let hasValidSegment = false;

    for (const segment of segments) {
      const segmentTotalSeconds = toSupportedRecoverySeconds(segment?.totalSeconds);
      const segmentEndTimeMs = toFiniteNumber(segment?.endTimeMs);
      if (segmentTotalSeconds === null || segmentEndTimeMs === null) {
        continue;
      }

      hasValidSegment = true;
      const elapsedSeconds = Math.max(0, (nowMs - segmentEndTimeMs) / 1000);
      if ((segmentTotalSeconds - elapsedSeconds) > 0) {
        activeTotalSeconds += segmentTotalSeconds;
      }
    }

    if (!hasValidSegment || !Number.isFinite(activeTotalSeconds)) {
      return null;
    }

    return Math.max(0, Math.floor(activeTotalSeconds));
  }

  const totalSeconds = toSupportedRecoverySeconds(context.totalSeconds);
  const endTimeMs = toFiniteNumber(context.endTimeMs);
  if (totalSeconds === null || endTimeMs === null) {
    return null;
  }

  const elapsedSeconds = Math.max(0, (nowMs - endTimeMs) / 1000);
  if ((totalSeconds - elapsedSeconds) <= 0) {
    return 0;
  }
  return Math.floor(totalSeconds);
}

export function resolveLatestWorkoutRecoverySeconds(
  context: DashboardRecoveryNowContext | null | undefined,
): number | null {
  if (!context) {
    return null;
  }

  const latestFromPayload = toSupportedRecoverySeconds(context.latestWorkoutSeconds);
  if (latestFromPayload !== null) {
    return Math.floor(latestFromPayload);
  }

  const segments = Array.isArray(context.segments) ? context.segments : [];
  if (segments.length > 0) {
    let latestSegmentEndTimeMs = Number.NEGATIVE_INFINITY;
    let latestSegmentTotalSeconds = Number.NaN;

    for (const segment of segments) {
      const segmentTotalSeconds = toSupportedRecoverySeconds(segment?.totalSeconds);
      const segmentEndTimeMs = toFiniteNumber(segment?.endTimeMs);
      if (segmentTotalSeconds === null || segmentEndTimeMs === null) {
        continue;
      }

      if (segmentEndTimeMs >= latestSegmentEndTimeMs) {
        latestSegmentEndTimeMs = segmentEndTimeMs;
        latestSegmentTotalSeconds = segmentTotalSeconds;
      }
    }

    if (Number.isFinite(latestSegmentTotalSeconds)) {
      return Math.floor(latestSegmentTotalSeconds);
    }
  }

  const totalSeconds = toSupportedRecoverySeconds(context.totalSeconds);
  if (totalSeconds === null) {
    return null;
  }
  return Math.floor(totalSeconds);
}
