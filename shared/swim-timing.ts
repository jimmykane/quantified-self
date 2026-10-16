/** Additive Sports Lib timing-validity JSON, readable before coordinated package adoption.
 * Classification belongs to the parser. Consumers never infer corruption from a value's size.
 */
export interface RejectedSwimTiming {
  version: 1;
  reason: 'exceeds-workout-envelope';
  elapsedTime?: number;
  timerTime?: number;
}

export function getRejectedSwimTiming(value: unknown): RejectedSwimTiming | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = (value as { timingValidity?: unknown }).timingValidity;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  const timing = record as Record<string, unknown>;
  if (timing.version !== 1 || timing.reason !== 'exceeds-workout-envelope') return undefined;
  const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (!positive(timing.timerTime) && !positive(timing.elapsedTime)) return undefined;
  return { version: 1, reason: 'exceeds-workout-envelope',
    ...(positive(timing.timerTime) ? { timerTime: timing.timerTime } : {}),
    ...(positive(timing.elapsedTime) ? { elapsedTime: timing.elapsedTime } : {}),
  };
}

/** Same read policy for saved scalars and hydrated DataDuration values. */
export function resolveSwimTiming(value: { elapsedTime?: unknown; timerTime?: unknown; timingValidity?: unknown }) {
  const rejected = getRejectedSwimTiming(value);
  const seconds = (v: unknown): number | null => {
    const raw = v && typeof v === 'object' && 'getValue' in v && typeof v.getValue === 'function' ? v.getValue() : v;
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null;
  };
  const elapsedTime = rejected?.elapsedTime === undefined ? seconds(value.elapsedTime) : null;
  const timerTime = rejected?.timerTime === undefined ? seconds(value.timerTime) : null;
  return { elapsedTime, timerTime, duration: rejected?.timerTime !== undefined ? null
    : value.timerTime === null || value.timerTime === undefined ? elapsedTime : timerTime };
}

export const SWIM_TIMING_UNAVAILABLE_REASON = 'Recorded timing exceeds the workout timeline. Time-based totals and calculations are unavailable where that timing is required.';
