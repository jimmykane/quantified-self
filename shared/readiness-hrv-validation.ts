import type { ReadinessHrvPersonalRange } from './readiness';

/** Strict identity-free normalization of persisted range evidence. */
export function normalizeReadinessHrvPersonalRange(value: unknown): ReadinessHrvPersonalRange | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const s = value as Record<string, unknown>;
  const count = (n: unknown, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max;
  const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
  if (!count(s.observationDayCount, 61) || !count(s.currentObservationDayCount, 8)
    || s.requiredObservationDayCount !== 14 || s.requiredCurrentObservationDayCount !== 3
    || !positive(s.latestMs) || !positive(s.latestAtMs) || !Number.isInteger(s.latestAtMs)) return null;
  const base = { observationDayCount: s.observationDayCount, currentObservationDayCount: s.currentObservationDayCount,
    requiredObservationDayCount: 14, requiredCurrentObservationDayCount: 3, latestMs: s.latestMs, latestAtMs: s.latestAtMs };
  if (s.reason === 'building_baseline' || s.reason === 'insufficient_current') {
    if (s.tone !== 'neutral' || s.baselineAverage !== null || s.currentAverage !== null || s.normalRange !== null
      || (s.reason === 'building_baseline' ? s.observationDayCount >= 14
        : s.observationDayCount < 14 || s.currentObservationDayCount >= 3)) return null;
    return { ...base, tone: 'neutral', reason: s.reason, baselineAverage: null, currentAverage: null, normalRange: null };
  }
  const r = s.normalRange as Record<string, unknown> | null;
  if (s.observationDayCount < 14 || s.currentObservationDayCount < 3 || s.currentObservationDayCount > s.observationDayCount
    || !positive(s.baselineAverage) || !positive(s.currentAverage) || !r
    || typeof r.min !== 'number' || !Number.isFinite(r.min) || !positive(r.max)
    || r.min > r.max || Math.abs((r.min + r.max) / 2 - s.baselineAverage) > 1e-8) return null;
  const sd = (r.max - r.min) / 2;
  const distance = Math.abs(s.currentAverage - s.baselineAverage);
  const reason = sd === 0 || distance <= sd ? 'within_range' : distance <= sd * 2 ? 'outside_range' : 'far_outside_range';
  // Reconstructing SD from two serialized bounds can round across an exact threshold.
  // Accept only the two adjacent classifications at that threshold, never an arbitrary state.
  const epsilon = Number.EPSILON * Math.max(1, s.baselineAverage) * 8;
  const adjacent = (a: string, b: string) => [a, b].includes(reason) && [a, b].includes(String(s.reason));
  const boundaryRounding = sd > 0 && (
    Math.abs(distance - sd) <= epsilon && adjacent('within_range', 'outside_range')
    || Math.abs(distance - sd * 2) <= epsilon && adjacent('outside_range', 'far_outside_range'));
  if (sd === 0 && distance > epsilon || s.reason !== reason && !boundaryRounding) return null;
  const normalizedReason = s.reason as typeof reason;
  const tone = normalizedReason === 'within_range' ? 'positive' : normalizedReason === 'outside_range' ? 'caution' : 'negative';
  if (s.tone !== tone) return null;
  return { ...base, reason: normalizedReason, tone, baselineAverage: s.baselineAverage, currentAverage: s.currentAverage,
    normalRange: { min: r.min, max: r.max } };
}
