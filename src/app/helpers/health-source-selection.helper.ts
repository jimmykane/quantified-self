import { HEALTH_METRIC_IDS, type HealthMetricId } from '@shared/health';

export interface HealthSourceSelectionCandidate {
  key: string;
  metricId: HealthMetricId;
  nativeOnly?: boolean;
  semanticVariant?: string;
  alternateResolutionKey?: string;
  points: readonly { value: number | string | boolean; timestampMs: number; calendarDate: string }[];
}

// These readings can meaningfully stay at zero. Other metrics retain zeros too,
// but an all-zero stream should not win the default merely by provider name.
const MEANINGFUL_ZERO_METRICS = new Set<HealthMetricId>([
  HEALTH_METRIC_IDS.Altitude, HEALTH_METRIC_IDS.SkinTemperatureDeviation,
  HEALTH_METRIC_IDS.StressLevel, HEALTH_METRIC_IDS.StressDuration,
  HEALTH_METRIC_IDS.BodyEnergy, HEALTH_METRIC_IDS.BodyEnergyChange,
  HEALTH_METRIC_IDS.RecoveryScore, HEALTH_METRIC_IDS.SleepScore,
]);
const DAYTIME_HEART_RATE_VARIANTS = new Set(['daily_15_second', 'activity_interval_average', 'qs_daily_sample_mean', 'qs_daily_interval_mean']);

/** Follow only an exact same-account daytime/daily-average pair; never replace a missing pin. */
export function resolveHealthSourceKey(candidates: readonly HealthSourceSelectionCandidate[], preferred: string | null | undefined): string | null {
  if (!preferred) return selectDefaultHealthSourceKey(candidates);
  if (candidates.some(candidate => candidate.key === preferred)) return preferred;
  const alternatives = candidates.filter(candidate => candidate.metricId === HEALTH_METRIC_IDS.HeartRate
    && !candidate.nativeOnly && DAYTIME_HEART_RATE_VARIANTS.has(candidate.semanticVariant || '')
    && candidate.alternateResolutionKey === preferred
    && candidate.points.some(point => typeof point.value === 'number' && Number.isFinite(point.value) && Number.isFinite(point.timestampMs)));
  return alternatives.length === 1 ? alternatives[0].key : preferred;
}

/** Choose from bounded evidence; never remove zeros or combine sources. */
export function selectDefaultHealthSourceKey(candidates: readonly HealthSourceSelectionCandidate[]): string | null {
  const ranked = candidates.flatMap(candidate => {
    const points = candidate.points.filter(point => Number.isFinite(point.timestampMs)
      && (typeof point.value === 'number' ? Number.isFinite(point.value)
        : typeof point.value === 'boolean' || point.value.trim().length > 0));
    if (!points.length) return [];
    const useful = points.filter(point => point.value !== 0 || MEANINGFUL_ZERO_METRICS.has(candidate.metricId));
    const rankedPoints = useful.length ? useful : points;
    const latest = rankedPoints.reduce((left, right) => right.calendarDate > left.calendarDate
      || right.calendarDate === left.calendarDate && right.timestampMs > left.timestampMs ? right : left);
    return [{ candidate, useful: useful.length > 0, latest,
      days: new Set(rankedPoints.map(point => point.calendarDate)).size }];
  });
  ranked.sort((left, right) => Number(right.useful) - Number(left.useful)
    || Number(!!left.candidate.semanticVariant?.startsWith('nap_')) - Number(!!right.candidate.semanticVariant?.startsWith('nap_'))
    || Number(!!left.candidate.nativeOnly) - Number(!!right.candidate.nativeOnly)
    || right.latest.calendarDate.localeCompare(left.latest.calendarDate)
    || heartRatePriority(left.candidate) - heartRatePriority(right.candidate)
    || right.latest.timestampMs - left.latest.timestampMs
    || right.days - left.days);
  return ranked[0]?.candidate.key || null;
}

function heartRatePriority(candidate: HealthSourceSelectionCandidate): number {
  if (candidate.metricId !== HEALTH_METRIC_IDS.HeartRate) return 0;
  return DAYTIME_HEART_RATE_VARIANTS.has(candidate.semanticVariant || '') ? 0
    : /^(qs_)?sleep_session_average_heart_rate$/.test(candidate.semanticVariant || '') ? 1 : 2;
}
