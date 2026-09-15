import type { HealthWorkspaceSeries } from './health-workspace.helper';

export interface ChartSourceChoice {
  key: string;
  /** Full attribution for accessibility and expanded details. */
  label: string;
  shortLabel: string;
  sourceLabel: string;
  detail: string;
}

const SHORT_READINGS: Readonly<Record<string, string>> = {
  session_duration: 'Main sleep', session_score: 'Main sleep',
  nap_duration: 'Nap', nap_score: 'Nap',
  sleep_session_average_hrv: 'Sleep average', sleep_overnight_hrv: 'Overnight average',
  sleep_session_average_heart_rate: 'Sleep average', sleep_session_minimum_heart_rate: 'Sleep minimum',
  sleep_session_resting_heart_rate: 'Sleep resting', sleep_session_maximum_spo2: 'Sleep maximum',
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
export function healthChartSourceChoice(series: Pick<HealthWorkspaceSeries, 'id' | 'sourceLabel' | 'semanticLabel' | 'semanticVariant' | 'aggregation' | 'nativeOnly'>): ChartSourceChoice {
  const parts = series.semanticLabel.split(' · ').filter(part => !PROVENANCE.has(part.toLowerCase()));
  const aggregation = series.aggregation.replace(/_/g, ' ').toLowerCase();
  if (parts.length > 1 && parts[0].toLowerCase() === aggregation) parts.shift();
  const reading = SHORT_READINGS[series.semanticVariant] || parts.join(' · ') || series.semanticLabel;
  const detail = series.semanticLabel + (series.nativeOnly ? ' · Native provider scale' : '');
  return { key: series.id, sourceLabel: series.sourceLabel, detail,
    label: `${series.sourceLabel} · ${detail}`,
    shortLabel: `${series.sourceLabel} · ${reading}${series.nativeOnly ? ' · Provider scale' : ''}` };
}
