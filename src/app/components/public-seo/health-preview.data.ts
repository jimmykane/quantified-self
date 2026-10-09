import { HEALTH_METRIC_IDS, HEALTH_PROVIDERS, HEALTH_RECORDING_METHODS, HEALTH_VALUE_ORIGINS, HEALTH_VALUE_TYPES, getHealthMetricDefinition } from '@shared/health';
import { MANUAL_HEALTH_AGGREGATION, MANUAL_POINT_SEMANTIC_VARIANT } from '@shared/manual-health';
import type { DashboardSleepTrendContext, DashboardSleepTrendPoint } from '../../helpers/dashboard-sleep-chart.helper';
import { localCalendarDate, type HealthWorkspaceSeries } from '../../helpers/health-workspace.helper';
import type { TimelineNote } from '@shared/timeline-notes';
import { healthExampleDay, healthExampleValue } from '../../helpers/health-example-days.helper';

export type HealthPreviewKind = 'sleep' | 'hrv' | 'weight';
export const HEALTH_PREVIEW_END = new Date(2026, 7, 31, 23, 59, 59).getTime();
export const HEALTH_PREVIEW_START = new Date(2026, 7, 18).getTime();

/** Fictional, closed periods: public examples never read or write account notes. */
export const HEALTH_PREVIEW_NOTES: readonly TimelineNote[] = [
  { id: 'sample-travel', category: 'travel', title: 'Weekend away',
    details: 'Away for the weekend; different sleep schedule.', startDate: '2026-08-21', endDate: '2026-08-24',
    timeZone: 'UTC', revision: 1, createdAtMs: HEALTH_PREVIEW_END, updatedAtMs: HEALTH_PREVIEW_END },
  { id: 'sample-stress', category: 'stress', title: 'Busy week at work',
    details: 'A deadline and a late evening at work.', startDate: '2026-08-27', endDate: '2026-08-27',
    timeZone: 'UTC', revision: 1, createdAtMs: HEALTH_PREVIEW_END, updatedAtMs: HEALTH_PREVIEW_END },
  { id: 'sample-sickness', category: 'sickness', title: 'Feeling unwell',
    details: 'Sore throat and a couple of quiet days at home.', startDate: '2026-08-29', endDate: '2026-08-30',
    timeZone: 'UTC', revision: 1, createdAtMs: HEALTH_PREVIEW_END, updatedAtMs: HEALTH_PREVIEW_END },
];

/** Deterministic sample measurements; no account data or runtime reads. */
export function buildHealthPreviewSeries(kind: HealthPreviewKind): HealthWorkspaceSeries {
  const metricId = kind === 'hrv' ? HEALTH_METRIC_IDS.HeartRateVariability
    : kind === 'weight' ? HEALTH_METRIC_IDS.BodyWeight : HEALTH_METRIC_IDS.SleepDuration;
  const count = kind === 'hrv' ? 74 : 14;
  const provider = kind === 'weight' ? HEALTH_PROVIDERS.QuantifiedSelf : HEALTH_PROVIDERS.SuuntoApp;
  return {
    id: `sample-health-${kind}`, metricId, provider,
    providerLabel: kind === 'weight' ? 'Manual' : 'Suunto',
    sourceLabel: kind === 'weight' ? 'Manual measurements' : 'Suunto',
    accountLabel: null,
    semanticLabel: kind === 'hrv' ? 'Overnight HRV' : kind === 'weight' ? 'Measured weight' : 'Sleep duration',
    aggregation: kind === 'weight' ? MANUAL_HEALTH_AGGREGATION : kind === 'sleep' ? 'total' : 'average',
    semanticVariant: kind === 'hrv' ? 'overnight_average' : kind === 'weight' ? MANUAL_POINT_SEMANTIC_VARIANT : 'sleep_duration',
    origin: kind === 'weight' ? HEALTH_VALUE_ORIGINS.Recorded : HEALTH_VALUE_ORIGINS.ProviderSummary,
    recordingMethod: kind === 'weight' ? HEALTH_RECORDING_METHODS.Manual : HEALTH_RECORDING_METHODS.ProviderCalculated,
    unit: getHealthMetricDefinition(metricId).canonicalUnit,
    normalizationStatus: 'canonical', nativeOnly: false, valueType: HEALTH_VALUE_TYPES.Number,
    chartKind: kind === 'sleep' ? 'bar' : 'line', sampleBased: false,
    points: Array.from({ length: count }, (_, index) => {
      const date = new Date(2026, 7, 31 - (count - 1 - index), 7);
      const timestampMs = date.getTime();
      const value = healthExampleValue(metricId, count - 1 - index);
      if (value === null) return null;
      return { timestampMs, calendarDate: localCalendarDate(timestampMs), timezoneOffsetSeconds: -date.getTimezoneOffset() * 60, value, qualityCode: null };
    }).filter(point => point !== null),
    deviceLabel: null, coverageText: 'Sample data', freshnessText: 'August 2026', hasConflict: false,
  };
}

const latestNight = healthExampleDay(0);
const latestWakeTime = new Date(2026, 7, 31, 0, latestNight.wakeMinutes).getTime();
export const HEALTH_PREVIEW_SLEEP: DashboardSleepTrendPoint = {
  id: 'sample-night', sourceSessionIds: ['sample-night'], sleepDate: '2026-08-31', provider: 'SuuntoApp', providerLabel: 'Suunto', categoryLabel: '31 Aug',
  startTimeMs: latestWakeTime - (latestNight.sleepMinutes + latestNight.awakeMinutes) * 60_000, endTimeMs: latestWakeTime,
  totalSeconds: latestNight.sleepMinutes * 60, deepSeconds: latestNight.deepMinutes * 60,
  lightSeconds: (latestNight.sleepMinutes - latestNight.deepMinutes - latestNight.remMinutes) * 60,
  remSeconds: latestNight.remMinutes * 60, awakeSeconds: latestNight.awakeMinutes * 60, unknownSeconds: 0,
  score: latestNight.sleepScore, averageHeartRateBpm: latestNight.sleepHeartRateBpm,
  minimumHeartRateBpm: latestNight.sleepHeartRateBpm - 5, restingHeartRateBpm: null,
  averageHrvMs: latestNight.hrvMs, maxSpo2Percent: null, averageRespirationBrpm: null,
  isNap: false, napSeconds: 0, napCount: 0, napAverageHrvMs: null, napAverageHeartRateBpm: null, napStartTimeMs: null, napEndTimeMs: null,
};

/** The same normalized sleep model consumed by the dashboard and Health workspace. */
export function buildHealthPreviewSleepTrend(): DashboardSleepTrendContext {
  const nightlyHrv = new Map(buildHealthPreviewSeries('hrv').points.map(point => [point.calendarDate, Number(point.value)]));
  const points = buildHealthPreviewSeries('sleep').points.map((point, index) => {
    const night = healthExampleDay(13 - index);
    const totalSeconds = Number(point.value);
    const deepSeconds = night.deepMinutes * 60;
    const remSeconds = night.remMinutes * 60;
    const endTimeMs = new Date(2026, 7, 18 + index, 0, night.wakeMinutes).getTime();
    return {
      ...HEALTH_PREVIEW_SLEEP,
      id: `sample-night-${index}`, sourceSessionIds: [`sample-night-${index}`], sleepDate: point.calendarDate,
      categoryLabel: `${18 + index} Aug`,
      endTimeMs, startTimeMs: endTimeMs - (totalSeconds + night.awakeMinutes * 60) * 1000,
      totalSeconds, deepSeconds, remSeconds, awakeSeconds: night.awakeMinutes * 60, lightSeconds: totalSeconds - deepSeconds - remSeconds,
      score: night.sleepScore, averageHrvMs: nightlyHrv.get(point.calendarDate) ?? null,
      averageHeartRateBpm: night.sleepHeartRateBpm, minimumHeartRateBpm: night.sleepHeartRateBpm - 5,
    };
  });
  return { points, latestPoint: points.at(-1) ?? null, hasRealPoints: true };
}
