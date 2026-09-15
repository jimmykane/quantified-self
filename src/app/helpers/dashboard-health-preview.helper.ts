import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { HEALTH_METRIC_CATALOG, type HealthMetricId, type HealthSourceRecord } from '@shared/health';
import { projectLoadedHealthRange } from '@shared/health-query';
import type { SleepSession } from '@shared/sleep';
import type { AppDashboardHealthMetricSettings } from '../models/app-user.interface';
import type { HealthWorkspaceRangeLoad } from '../services/app.health.service';
import { buildDashboardHealthContext, type DashboardHealthContext } from './dashboard-health-context.helper';
import { localCalendarDate, type HealthWorkspaceWindow } from './health-workspace.helper';

const DAY = 86400000;
// Fictional canonical values, used only by the add/edit browser. Never persisted,
// emitted as availability evidence, or used to choose a saved source.
const EXAMPLE_VALUES: Record<HealthMetricId, readonly [number, number]> = {
  steps: [8200, 1800], wheelchair_pushes: [2400, 450], distance: [5200, 850],
  wheelchair_push_distance: [3400, 650], floors_climbed: [12, 4], active_duration: [3600, 900],
  moderate_intensity_duration: [2400, 600], vigorous_intensity_duration: [1200, 360], altitude: [140, 25],
  active_energy: [580, 140], basal_energy: [1650, 35], total_energy: [2230, 150],
  heart_rate: [72, 12], resting_heart_rate: [54, 3], heart_rate_variability: [58, 6],
  blood_oxygen_saturation: [97, 1], respiration_rate: [15, 1], stress_level: [35, 15],
  stress_state: [0, 0], stress_duration: [4200, 1200], body_energy: [65, 20],
  body_energy_change: [0, 18], recovery_score: [78, 10], body_weight: [73.5, 0.6],
  body_mass_index: [23.4, 0.2], body_fat: [20, 0.5], body_water: [58, 0.6],
  muscle_mass: [54, 0.4], bone_mass: [3.1, 0.06], blood_pressure_systolic: [118, 5],
  blood_pressure_diastolic: [76, 3], pulse_rate: [64, 6], skin_temperature_deviation: [0, 0.4],
  vo2_max: [48, 1.2], fitness_age: [32, 0.8], sleep_duration: [27600, 2400], sleep_score: [82, 8],
};
const VARIATION = [0.2, 0.6, 0.1, -0.4, 0.3, 0.8, -0.2, -0.7, 0.1, 0.5, 0.2, -0.1, -0.5, 0.4];

function exampleRecords(metric: HealthMetricId, timestamps: number[]): HealthSourceRecord[] {
  const definition = HEALTH_METRIC_CATALOG[metric];
  const [base, spread] = EXAMPLE_VALUES[metric];
  const total = definition.category === 'movement' || definition.category === 'energy'
    || metric === 'sleep_duration' || metric === 'stress_duration';
  return timestamps.map((timestamp, index) => {
    const value = metric === 'stress_state' ? ['relaxing', 'active', 'passive', 'stressful'][index % 4]
      : Number((base + VARIATION[index % VARIATION.length] * spread).toFixed(2));
    return {
      schemaVersion: 1, id: `example-${metric}-${index}`, userID: 'example', kind: 'daily_summary',
      calendarDate: localCalendarDate(timestamp), timezoneOffsetSeconds: -new Date(timestamp).getTimezoneOffset() * 60, startTimeMs: timestamp, endTimeMs: timestamp,
      source: { provider: 'GarminAPI', accountKey: 'example', sourceRecordType: 'example', sourceRecordKey: String(index),
        revision: { order: 1, token: 'example', digest: 'example' }, receivedAtMs: timestamp },
      metricIds: [metric], metrics: [{ kind: 'value', metricId: metric, valueType: definition.valueType,
        aggregation: total ? 'total' : 'average', semanticVariant: metric === 'heart_rate_variability' ? 'sleep_overnight_hrv'
          : metric === 'body_energy' ? 'garmin_body_battery' : total ? 'daily_total' : 'daily_average',
        origin: 'provider_summary', recordingMethod: 'provider_calculated', quality: { status: 'valid' }, normalizationStatus: 'canonical',
        native: { metric, value, unit: definition.canonicalUnit }, canonical: { value, unit: definition.canonicalUnit } }],
      coverage: { status: 'complete' }, sampleChunkIds: [], createdAtMs: timestamp, updatedAtMs: timestamp,
    };
  });
}
function exampleLoad(metric: HealthMetricId, timestamps: number[], startDate: string, endDate: string): HealthWorkspaceRangeLoad {
  const records = exampleRecords(metric, timestamps);
  return { result: projectLoadedHealthRange(records, [], { metricIds: [metric], startDate, endDate, includeSamples: false },
    { sourceRecordsComplete: true, samplesComplete: true }), limitReached: null, sourceRecordCount: records.length,
    sampleChunkCount: 0, samplePointCount: 0, serializedBytes: 0, hasMatchingSourceRecords: true,
    hasSampleBackedMetric: false, providers: ['GarminAPI'], sampleBackedProviders: [] };
}
export function buildDashboardHealthExample(settings: AppDashboardHealthMetricSettings, window: HealthWorkspaceWindow,
  units: UserUnitSettingsInterface | null = null): DashboardHealthContext {
  const metric = settings.metric;
  const days = Math.max(1, Math.round((window.endTimeMs - window.startTimeMs + 1) / DAY));
  const count = settings.range === 'today' && metric !== 'sleep' ? 12 : Math.min(42, days);
  const timestamps = Array.from({ length: count }, (_, index) => window.startTimeMs
    + (window.endTimeMs - window.startTimeMs) * (index + 0.5) / count);
  const historyEnd = Date.parse(window.startDate) - DAY;
  const historyTimes = Array.from({ length: 60 }, (_, index) => historyEnd - (59 - index) * DAY + 12 * 3600000);
  const sessions: SleepSession[] = metric === 'sleep' ? timestamps.map((timestamp, index) => {
    const durationSeconds = 27600 + VARIATION[index % VARIATION.length] * 2400;
    return { id: `example-sleep-${index}`, userID: 'example', source: { provider: 'SuuntoApp', accountKey: 'example', providerUserId: 'example', sourceSessionKey: String(index) },
      sleepDate: localCalendarDate(timestamp), startTimeMs: timestamp - durationSeconds * 1000, endTimeMs: timestamp,
      durationSeconds, isNap: false, stages: [], stageDurationsSeconds: { deep: 5400, rem: 6600, light: durationSeconds - 12000, awake: 600 },
      score: { value: 82 + index % 7 }, vitals: { averageHrvMs: 58 + index % 5, averageHeartRateBpm: 52 + index % 3 },
      createdAtMs: timestamp, updatedAtMs: timestamp };
  }) : [];
  const context = buildDashboardHealthContext({ window, sessions, activities: null, errors: [],
    health: metric === 'sleep' ? null : exampleLoad(metric, timestamps, window.startDate, window.endDate),
    history: metric === 'heart_rate_variability' ? exampleLoad(metric, historyTimes, localCalendarDate(historyTimes[0]), localCalendarDate(historyTimes.at(-1)!)) : null,
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
