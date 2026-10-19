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
  readingOrder?: number;
}

const HEART_RATE_READINGS: Readonly<Record<string, readonly [string, string]>> = {
  daily_15_second: ['daytime', 'Heart rate throughout the day'],
  activity_interval_average: ['daytime', 'Heart rate throughout the day'],
  activity_interval_minimum: ['interval-minimum', 'Interval minimum HR'],
  activity_interval_maximum: ['interval-maximum', 'Interval maximum HR'],
  sleep_session_average_heart_rate: ['sleep-average', 'Average sleep HR'],
  sleep_session_minimum_heart_rate: ['sleep-minimum', 'Minimum sleep HR'],
  nap_average_heart_rate: ['nap-average', 'Average nap HR'],
  nap_minimum_heart_rate: ['nap-minimum', 'Minimum nap HR'],
  daily_minimum: ['daily-minimum', 'Daily minimum HR'],
  daily_maximum: ['daily-maximum', 'Daily maximum HR'],
  rolling_7_day_average: ['rolling-average', '7-day average HR'],
  qs_daily_sample_mean: ['daily-average', 'Daily average HR'],
  qs_daily_interval_mean: ['daily-average', 'Daily average HR'],
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
    ? 'Resting HR is a separate provider summary. This integration does not import Suunto resting HR; its daytime and sleep readings are available under Heart rate.' : null;
}

export function healthMetricReadingTitle(metric: string, series?: HealthWorkspaceSeries | null): string | null {
  if (!series) return null;
  if (metric === HEALTH_METRIC_IDS.HeartRate) return heartRateReading(series)?.label || null;
  if (metric === HEALTH_METRIC_IDS.RestingHeartRate || metric === HEALTH_METRIC_IDS.BloodOxygenSaturation) return healthChartReadingLabel(series);
  return null;
}

const SHORT_READINGS: Readonly<Record<string, string>> = {
  point: 'Recorded measurement',
  session_duration: 'Main sleep', session_score: 'Main sleep',
  nap_duration: 'Nap', nap_score: 'Nap',
  daily_resting: 'Daily resting HR',
  sleep_session_average_hrv: 'Average sleep HRV', sleep_overnight_hrv: 'Overnight HRV',
  sleep_session_average_heart_rate: 'Average sleep HR', sleep_session_minimum_heart_rate: 'Minimum sleep HR',
  sleep_session_resting_heart_rate: 'Sleep resting HR', sleep_session_maximum_spo2: 'Maximum sleep SpO₂',
  sleep_session_average_respiration: 'Sleep average', nap_average_heart_rate: 'Nap average',
  nap_minimum_heart_rate: 'Nap minimum', nap_resting_heart_rate: 'Nap resting',
  nap_maximum_spo2: 'Nap maximum', nap_average_respiration: 'Nap average',
  rolling_7_day_average: '7-day average',
  daily_15_second: '15-second samples',
  activity_interval_average: 'Interval averages', activity_interval_minimum: 'Interval minimums', activity_interval_maximum: 'Interval maximums',
};
const PROVENANCE = new Set(['provider summary', 'provider calculated', 'provider reported', 'recorded', 'device', 'manual',
  'quantified self derived', 'quantified self calculated', 'calculated by qs']);

/** Shorten presentation only; retain every source/reading identity and full meaning. */
export function healthChartSourceChoice(series: Pick<HealthWorkspaceSeries, 'id' | 'sourceLabel' | 'semanticLabel' | 'semanticVariant' | 'aggregation' | 'nativeOnly'> & Partial<Pick<HealthWorkspaceSeries, 'metricId'>>): ChartSourceChoice {
  const reading = healthChartReadingLabel(series);
  const detail = series.semanticLabel + (series.nativeOnly ? ' · Native provider scale' : '');
  const measurement = heartRateReading(series);
  const method = series.semanticVariant === 'daily_15_second' ? 'Recorded 15-second samples'
    : series.semanticVariant === 'activity_interval_average' ? 'Recorded interval averages'
      : series.semanticVariant.startsWith('qs_') ? 'Calculated by QS' : 'Provider-reported';
  return { key: series.id, sourceLabel: series.sourceLabel, detail,
    ...(measurement ? { readingKey: measurement.key, readingLabel: measurement.label, readingMethod: method,
      readingOrder: ['daytime', 'sleep-average', 'sleep-minimum', 'daily-average', 'daily-minimum', 'daily-maximum', 'rolling-average', 'nap-average', 'nap-minimum'].indexOf(measurement.key) } : {}),
    label: `${series.sourceLabel} · ${detail}`,
    shortLabel: `${series.sourceLabel} · ${reading}${series.nativeOnly ? ' · Provider scale' : ''}` };
}

/** A visible measurement label, not a replacement for its full provenance. */
export function healthChartReadingLabel(series: Pick<HealthWorkspaceSeries, 'semanticLabel' | 'semanticVariant' | 'aggregation'>): string {
  const parts = series.semanticLabel.split(' · ').filter(part => !PROVENANCE.has(part.toLowerCase()));
  const aggregation = series.aggregation.replace(/_/g, ' ').toLowerCase();
  if (parts.length > 1 && parts[0].toLowerCase() === aggregation) parts.shift();
  return SHORT_READINGS[series.semanticVariant] || parts.join(' · ') || series.semanticLabel;
}
