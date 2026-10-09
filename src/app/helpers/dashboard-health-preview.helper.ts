import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { HEALTH_METRIC_CATALOG, type HealthMetricId, type HealthSourceRecord } from '@shared/health';
import { projectLoadedHealthRange } from '@shared/health-query';
import type { SleepSession } from '@shared/sleep';
import type { AppDashboardHealthMetricSettings } from '../models/app-user.interface';
import type { HealthWorkspaceRangeLoad } from '../services/app.health.service';
import { buildDashboardHealthContext, type DashboardHealthContext } from './dashboard-health-context.helper';
import { localCalendarDate, type HealthWorkspaceWindow } from './health-workspace.helper';
import { healthExampleDay, healthExampleValue } from './health-example-days.helper';

const DAY = 86400000;
function dayOffset(timestamp: number, endDate: string): number {
  return Math.round((Date.parse(endDate) - Date.parse(localCalendarDate(timestamp))) / DAY);
}
function exampleRecords(metric: HealthMetricId, timestamps: number[], referenceEndDate: string): HealthSourceRecord[] {
  const definition = HEALTH_METRIC_CATALOG[metric];
  const measuredWeight = metric === 'body_weight';
  const fitnessEstimate = metric === 'vo2_max' || metric === 'fitness_age';
  const total = definition.category === 'movement' && metric !== 'altitude' || definition.category === 'energy'
    || metric === 'sleep_duration' || metric === 'stress_duration';
  return timestamps.flatMap<HealthSourceRecord>((timestamp, index) => {
    const value = healthExampleValue(metric, dayOffset(timestamp, referenceEndDate));
    if (value === null) return [];
    return [{
      schemaVersion: 1, id: `example-${metric}-${index}`, userID: 'example', kind: measuredWeight ? 'point_measurement' : 'daily_summary',
      calendarDate: localCalendarDate(timestamp), timezoneOffsetSeconds: -new Date(timestamp).getTimezoneOffset() * 60, startTimeMs: timestamp, endTimeMs: timestamp,
      source: { provider: measuredWeight ? 'QuantifiedSelf' : 'GarminAPI', accountKey: 'example', sourceRecordType: 'example', sourceRecordKey: String(index),
        revision: { order: 1, token: 'example', digest: 'example' }, receivedAtMs: timestamp },
      metricIds: [metric], metrics: [{ kind: 'value', metricId: metric, valueType: definition.valueType,
        aggregation: measuredWeight ? 'measurement' : fitnessEstimate ? 'latest' : total ? 'total' : 'average',
        semanticVariant: measuredWeight ? 'point' : metric === 'vo2_max' ? 'running' : metric === 'heart_rate_variability' ? 'sleep_overnight_hrv'
          : total ? 'daily_total' : 'daily_average',
        origin: measuredWeight ? 'recorded' : 'provider_summary', recordingMethod: measuredWeight ? 'manual' : 'provider_calculated',
        quality: { status: 'valid' }, normalizationStatus: 'canonical',
        native: { metric, value, unit: definition.canonicalUnit }, canonical: { value, unit: definition.canonicalUnit } }],
      coverage: { status: 'complete' }, sampleChunkIds: [], createdAtMs: timestamp, updatedAtMs: timestamp,
    }];
  });
}
function exampleLoad(metric: HealthMetricId, timestamps: number[], startDate: string, endDate: string, referenceEndDate = endDate): HealthWorkspaceRangeLoad {
  const records = exampleRecords(metric, timestamps, referenceEndDate);
  return { result: projectLoadedHealthRange(records, [], { metricIds: [metric], startDate, endDate, includeSamples: false },
    { sourceRecordsComplete: true, samplesComplete: true }), limitReached: null, sourceRecordCount: records.length,
    sampleChunkCount: 0, samplePointCount: 0, serializedBytes: 0, hasMatchingSourceRecords: true,
    hasSampleBackedMetric: false, providers: metric === 'body_weight' ? ['QuantifiedSelf'] : ['GarminAPI'], sampleBackedProviders: [] };
}
export function buildDashboardHealthExample(settings: AppDashboardHealthMetricSettings, window: HealthWorkspaceWindow,
  units: UserUnitSettingsInterface | null = null): DashboardHealthContext {
  const metric = settings.metric;
  const days = Math.max(1, Math.round((window.endTimeMs - window.startTimeMs + 1) / DAY));
  const count = Math.min(366, days);
  const timestamps = Array.from({ length: count }, (_, index) => {
    const date = new Date(window.startTimeMs);
    date.setDate(date.getDate() + index);
    date.setHours(12, 0, 0, 0);
    return date.getTime();
  });
  const historyEnd = Date.parse(window.startDate) - DAY;
  const historyTimes = Array.from({ length: 60 }, (_, index) => historyEnd - (59 - index) * DAY + 12 * 3600000);
  const sessions: SleepSession[] = metric === 'sleep' ? timestamps.map((timestamp, index) => {
    const day = healthExampleDay(dayOffset(timestamp, window.endDate));
    const durationSeconds = day.sleepMinutes * 60;
    const wakeTime = new Date(timestamp);
    wakeTime.setHours(0, day.wakeMinutes, 0, 0);
    const endTimeMs = wakeTime.getTime();
    return { id: `example-sleep-${index}`, userID: 'example', source: { provider: 'SuuntoApp', accountKey: 'example', providerUserId: 'example', sourceSessionKey: String(index) },
      sleepDate: localCalendarDate(timestamp), startTimeMs: endTimeMs - (durationSeconds + day.awakeMinutes * 60) * 1000, endTimeMs,
      durationSeconds, isNap: false, stages: [], stageDurationsSeconds: { deep: day.deepMinutes * 60, rem: day.remMinutes * 60,
        light: (day.sleepMinutes - day.deepMinutes - day.remMinutes) * 60, awake: day.awakeMinutes * 60 },
      score: { value: day.sleepScore }, vitals: { averageHrvMs: day.hrvMs, averageHeartRateBpm: day.sleepHeartRateBpm },
      createdAtMs: timestamp, updatedAtMs: timestamp };
  }) : [];
  const context = buildDashboardHealthContext({ window, sessions, activities: null, errors: [],
    health: metric === 'sleep' ? null : exampleLoad(metric, timestamps, window.startDate, window.endDate),
    history: metric === 'heart_rate_variability' ? exampleLoad(metric, historyTimes, localCalendarDate(historyTimes[0]), localCalendarDate(historyTimes.at(-1)!), window.endDate) : null,
  }, { metric, range: settings.range }, units, undefined, [], window.endTimeMs);
  // Keep illustration identities out of source selection and discovery eligibility.
  return { ...context, sources: [], selectedKey: null,
    selected: context.selected ? { ...context.selected, model: { ...context.selected.model,
      ariaLabel: `Example ${HEALTH_METRIC_CATALOG[metric]?.label || 'Health'} chart. Fictional readings; not your data.`,
      series: { ...context.selected.model.series, sourceLabel: 'Example data', providerLabel: 'Example' } } } : null,
    sleep: { ...context.sleep, points: context.sleep.points.map(point => ({ ...point, providerLabel: 'Example' })),
      latestPoint: context.sleep.latestPoint ? { ...context.sleep.latestPoint, providerLabel: 'Example' } : null },
    availability: { state: 'no-data', hasData: false, label: 'Example data', reason: 'Illustration only; these are not your readings.' } };
}
