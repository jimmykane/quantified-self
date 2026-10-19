import type { HealthWorkspaceSeries } from './health-workspace.helper';
import { HEALTH_METRIC_IDS } from '@shared/health';

export interface ChartSourceChoice {
  key: string;
  /** Full attribution for accessibility and expanded details. */
  label: string;
  shortLabel: string;
  sourceLabel: string;
  detail: string;
  /** Frontend measurement choice; never a provider/account identity or stored field. */
  readingKey?: string;
  readingLabel?: string;
  readingMethod?: string;
  readingDescription?: string;
  readingOrder?: number;
  secondaryMeasurement?: boolean;
}

const HEART_RATE_READINGS: Readonly<Record<string, readonly [string, string]>> = {
  daily_15_second: ['daytime', 'Heart rate'],
  activity_interval_average: ['daytime', 'Heart rate'],
  activity_interval_minimum: ['interval-minimum', 'Lowest HR per recording period'],
  activity_interval_maximum: ['interval-maximum', 'Highest HR per recording period'],
  sleep_session_average_heart_rate: ['sleep-average', 'Average sleep HR'],
  sleep_session_minimum_heart_rate: ['sleep-minimum', 'Minimum sleep HR'],
  nap_average_heart_rate: ['nap-average', 'Average nap HR'],
  nap_minimum_heart_rate: ['nap-minimum', 'Minimum nap HR'],
  daily_minimum: ['daily-minimum', 'Daily minimum HR'],
  daily_maximum: ['daily-maximum', 'Daily maximum HR'],
  rolling_7_day_average: ['rolling-average', '7-day average HR'],
  qs_daily_sample_mean: ['daytime', 'Heart rate'],
  qs_daily_interval_mean: ['daytime', 'Heart rate'],
};

export function heartRateReading(series: Pick<HealthWorkspaceSeries, 'semanticVariant' | 'aggregation' | 'semanticLabel' | 'nativeOnly'> & Partial<Pick<HealthWorkspaceSeries, 'metricId'>>): { key: string; label: string } | null {
  if (series.metricId !== HEALTH_METRIC_IDS.HeartRate) return null;
  const variant = series.semanticVariant.replace(/^qs_sleep_/, 'sleep_');
  const known = !series.nativeOnly && HEART_RATE_READINGS[variant];
  return known ? { key: known[0], label: known[1] }
    : { key: `${series.nativeOnly ? 'native:' : ''}${variant}:${series.aggregation}`, label: healthChartReadingLabel(series) };
}

export function restingHeartRateSupportNote(metric: string): string | null {
  return metric === HEALTH_METRIC_IDS.RestingHeartRate
    ? 'Resting HR is a separate measurement. We do not currently import a resting-HR value from Suunto; its daytime and sleep readings are under Heart rate.' : null;
}

export function healthMetricReadingTitle(metric: string, series?: HealthWorkspaceSeries | null): string | null {
  if (!series) return null;
  if (metric === HEALTH_METRIC_IDS.HeartRate) return heartRateReading(series)?.label || null;
  if (metric === HEALTH_METRIC_IDS.RestingHeartRate || metric === HEALTH_METRIC_IDS.BloodOxygenSaturation) return healthChartReadingLabel(series);
  return null;
}

const SHORT_READINGS: Readonly<Record<string, string>> = {
  point: 'Recorded measurement', device_sample: 'Recorded reading', provider_state: 'Reported state',
  manual_measurement: 'Entered manually', provider_weight_measurement: 'Weight measurement',
  user_metrics_vo2_max: 'Fitness estimate', workout_profile_context: 'Workout profile weight',
  workout_imported_running: 'Running workout estimate', workout_imported_cycling: 'Cycling workout estimate',
  session_duration: 'Main sleep', session_score: 'Main sleep',
  nap_duration: 'Nap', nap_score: 'Nap',
  daily_resting: 'Daily resting HR',
  sleep_session_average_hrv: 'Average sleep HRV', sleep_overnight_hrv: 'Overnight HRV',
  sleep_session_average_heart_rate: 'Average sleep HR', sleep_session_minimum_heart_rate: 'Minimum sleep HR',
  sleep_session_resting_heart_rate: 'Sleep resting HR', sleep_session_maximum_spo2: 'Maximum sleep SpO₂',
  sleep_session_average_respiration: 'Average sleep breathing rate', nap_average_heart_rate: 'Average nap HR',
  nap_minimum_heart_rate: 'Minimum nap HR', nap_resting_heart_rate: 'Nap resting HR',
  nap_maximum_spo2: 'Maximum nap SpO₂', nap_average_respiration: 'Average nap breathing rate',
  rolling_7_day_average: '7-day average',
  daily_15_second: 'Heart rate throughout the day',
  activity_interval_average: 'Heart rate throughout the day', activity_interval_minimum: 'Lowest HR per recording period', activity_interval_maximum: 'Highest HR per recording period',
  qs_daily_sample_mean: 'Daily average HR', qs_daily_interval_mean: 'Daily average HR',
  qs_daily_interval_low: 'Daily lowest average HR', qs_daily_interval_high: 'Daily highest average HR',
  qs_daily_interval_minimum_low: 'Daily lowest HR', qs_daily_interval_maximum_high: 'Daily highest HR',
  qs_daily_sample_low: 'Daily lowest HR', qs_daily_sample_high: 'Daily highest HR',
};
const PROVENANCE = new Set(['provider summary', 'provider calculated', 'provider reported', 'recorded', 'device', 'manual',
  'quantified self derived', 'quantified self calculated', 'calculated by qs']);

/** Shorten presentation only; retain every source/reading identity and full meaning. */
export function healthChartSourceChoice(series: Pick<HealthWorkspaceSeries, 'id' | 'sourceLabel' | 'semanticLabel' | 'semanticVariant' | 'aggregation' | 'nativeOnly'> & Partial<Pick<HealthWorkspaceSeries, 'metricId' | 'origin' | 'recordingMethod'>>): ChartSourceChoice {
  const reading = healthChartReadingLabel(series);
  const calculated = series.origin === 'quantified_self_derived' || series.recordingMethod === 'quantified_self_calculated'
    || series.semanticVariant.startsWith('qs_') || /calculated by qs/i.test(series.semanticLabel);
  const detail = [reading, calculated ? 'Calculated by QS' : null,
    series.nativeOnly ? 'Original source format' : null].filter(Boolean).join(' · ');
  const measurement = heartRateReading(series);
  const method = calculated ? 'Calculated by QS'
    : ['daily_15_second', 'activity_interval_average'].includes(series.semanticVariant) ? 'Recorded by your watch' : 'Synced reading';
  return { key: series.id, sourceLabel: series.sourceLabel, detail,
    ...(measurement ? { readingKey: measurement.key, readingLabel: measurement.label, readingMethod: method,
      secondaryMeasurement: !['daytime', 'sleep-average'].includes(measurement.key),
      readingDescription: series.semanticVariant === 'daily_15_second'
        ? 'Garmin sends heart-rate readings for individual times during the day. These are not resting HR or average sleep HR.'
        : series.semanticVariant === 'activity_interval_average'
          ? 'Suunto sends the average heart rate for each short recording period. This is not an average for the whole day, resting HR or average sleep HR.'
          : ['qs_daily_sample_mean', 'qs_daily_interval_mean'].includes(series.semanticVariant)
            ? 'One average per recorded day, calculated by QS from available heart-rate readings. Missing readings are not filled in; this does not guarantee a complete day.'
            : detail,
      readingOrder: ['daytime', 'sleep-average', 'sleep-minimum', 'daily-average', 'daily-minimum', 'daily-maximum', 'rolling-average', 'nap-average', 'nap-minimum'].indexOf(measurement.key) } : {}),
    label: `${series.sourceLabel} · ${detail}`,
    shortLabel: `${series.sourceLabel} · ${reading}${calculated ? ' · Calculated by QS' : ''}${series.nativeOnly ? ' · Source format' : ''}` };
}

/** A visible measurement label, not a replacement for its full provenance. */
export function healthChartReadingLabel(series: Pick<HealthWorkspaceSeries, 'semanticLabel' | 'semanticVariant' | 'aggregation'>): string {
  const parts = series.semanticLabel.split(' · ').filter(part => !PROVENANCE.has(part.toLowerCase()) && !part.toLowerCase().startsWith('calculated by qs'));
  const aggregation = series.aggregation.replace(/_/g, ' ').toLowerCase();
  if (parts.length > 1 && parts[0].toLowerCase() === aggregation) parts.shift();
  return SHORT_READINGS[series.semanticVariant.replace(/^qs_(?=sleep_|nap_)/, '')]
    || (series.semanticVariant === 'provider_daily_summary' ? `Daily ${aggregation}` : null)
    || parts.join(' · ') || 'Recorded reading';
}
