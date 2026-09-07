import { HEALTH_METRIC_IDS, HEALTH_PROVIDERS, HEALTH_RECORDING_METHODS, HEALTH_VALUE_ORIGINS, HEALTH_VALUE_TYPES, getHealthMetricDefinition } from '@shared/health';
import { MANUAL_HEALTH_AGGREGATION, MANUAL_POINT_SEMANTIC_VARIANT } from '@shared/manual-health';
import type { DashboardSleepTrendContext, DashboardSleepTrendPoint } from '../../helpers/dashboard-sleep-chart.helper';
import type { HealthWorkspaceSeries } from '../../helpers/health-workspace.helper';

export type HealthPreviewKind = 'sleep' | 'hrv' | 'weight';
const DAY = 86_400_000;
export const HEALTH_PREVIEW_END = Date.UTC(2026, 7, 31, 23, 59, 59);
export const HEALTH_PREVIEW_START = Date.UTC(2026, 7, 18);

/** Deterministic sample measurements; no account data or runtime reads. */
export function buildHealthPreviewSeries(kind: HealthPreviewKind): HealthWorkspaceSeries {
  const metricId = kind === 'hrv' ? HEALTH_METRIC_IDS.HeartRateVariability
    : kind === 'weight' ? HEALTH_METRIC_IDS.BodyWeight : HEALTH_METRIC_IDS.SleepDuration;
  const count = kind === 'hrv' ? 74 : 14;
  const variations = [0, 3, -2, 1, 5, -4, 2, 0, -3, 4, -1, 2, -2, 1];
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
    chartKind: kind === 'sleep' ? 'bar' : 'line',
    points: Array.from({ length: count }, (_, index) => {
      const timestampMs = Date.UTC(2026, 7, 31, 7) - (count - 1 - index) * DAY;
      const variation = variations[index % variations.length];
      const value = kind === 'sleep' ? 27_000 + variation * 660
        : kind === 'weight' ? 73.8 - index * 0.035 + variation * 0.08
          : 58 + variation + (index >= 63 && index <= 66 ? -10 : 0);
      return { timestampMs, calendarDate: new Date(timestampMs).toISOString().slice(0, 10), timezoneOffsetSeconds: 0, value, qualityCode: null };
    }),
    deviceLabel: null, coverageText: 'Sample data', freshnessText: 'August 2026', hasConflict: false,
  };
}

export const HEALTH_PREVIEW_SLEEP: DashboardSleepTrendPoint = {
  id: 'sample-night', sleepDate: '2026-08-31', provider: 'SuuntoApp', providerLabel: 'Suunto', categoryLabel: '31 Aug',
  startTimeMs: Date.UTC(2026, 7, 30, 23, 30), endTimeMs: Date.UTC(2026, 7, 31, 7, 20),
  totalSeconds: 27_660, deepSeconds: 5_100, lightSeconds: 15_660, remSeconds: 6_900, awakeSeconds: 540, unknownSeconds: 0,
  score: null, averageHeartRateBpm: null, minimumHeartRateBpm: null, averageHrvMs: null, maxSpo2Percent: null,
  isNap: false, napSeconds: 0, napCount: 0, napAverageHrvMs: null, napAverageHeartRateBpm: null, napStartTimeMs: null, napEndTimeMs: null,
};

/** The same normalized sleep model consumed by the dashboard and Health workspace. */
export function buildHealthPreviewSleepTrend(): DashboardSleepTrendContext {
  const nightlyHrv = new Map(buildHealthPreviewSeries('hrv').points.map(point => [point.calendarDate, Number(point.value)]));
  const points = buildHealthPreviewSeries('sleep').points.map((point, index) => {
    const totalSeconds = Number(point.value);
    const deepSeconds = 4_500 + (index % 4) * 600;
    const remSeconds = 6_600 + (index % 3) * 300;
    const endTimeMs = point.timestampMs + 20 * 60_000;
    return {
      ...HEALTH_PREVIEW_SLEEP,
      id: `sample-night-${index}`, sleepDate: point.calendarDate,
      categoryLabel: `${18 + index} Aug`,
      endTimeMs, startTimeMs: endTimeMs - (totalSeconds + HEALTH_PREVIEW_SLEEP.awakeSeconds) * 1000,
      totalSeconds, deepSeconds, remSeconds, lightSeconds: totalSeconds - deepSeconds - remSeconds,
      score: 78 + index % 8, averageHrvMs: nightlyHrv.get(point.calendarDate) ?? null,
      averageHeartRateBpm: 49 + index % 4, minimumHeartRateBpm: 43 + index % 3,
    };
  });
  return { points, latestPoint: points.at(-1) ?? null, hasRealPoints: true };
}
