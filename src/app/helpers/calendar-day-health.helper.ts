import { HEALTH_METRIC_IDS } from '@shared/health';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { HealthWorkspaceSeries, HealthWorkspaceSleepSession } from './health-workspace.helper';
import { formatHealthValue } from './health-workspace.helper';
import { buildDashboardSleepTrendContext } from './dashboard-sleep-chart.helper';
import { buildDashboardReadinessSignalsContext } from './dashboard-training-insights.helper';
import {
  resolveDashboardFormNowContextFromPoints,
  resolveDashboardRampRateContextFromPoints,
} from './dashboard-derived-metrics.helper';
import { buildDashboardRecoveryPresentation } from './dashboard-recovery-now.helper';
import { formatActivityCalendarDuration } from './activity-calendar.helper';
import type { DashboardDerivedMetricsState } from '../services/dashboard-derived-metrics.service';

export type CalendarDayMetricStatus = 'ready' | 'empty' | 'error';

export interface CalendarDayMetric {
  status: CalendarDayMetricStatus;
  value: string;
  detail: string;
}

export interface CalendarDayHealthSummary {
  readiness: CalendarDayMetric;
  sleep: CalendarDayMetric;
  hrv: CalendarDayMetric;
  recovery: CalendarDayMetric | null;
}

export interface CalendarDayHealthEvidence {
  sessions: readonly HealthWorkspaceSleepSession[];
  hrvSeries: readonly HealthWorkspaceSeries[];
  derived: DashboardDerivedMetricsState | null;
  sleepError: boolean;
  hrvError: boolean;
  derivedError: boolean;
}

const empty = (detail: string): CalendarDayMetric => ({ status: 'empty', value: '—', detail });
const error = (detail: string): CalendarDayMetric => ({ status: 'error', value: '—', detail });

/** Date-key matching is deliberate: a nearby night or a last-known reading is not this day's data. */
export function buildCalendarDayHealthSummary(
  dateKey: string,
  evidence: CalendarDayHealthEvidence,
  options: { nowMs: number; locale?: string; unitSettings?: UserUnitSettingsInterface | null },
): CalendarDayHealthSummary {
  const todayKey = localDateKey(options.nowMs);
  const isToday = dateKey === todayKey;
  const nights = buildDashboardSleepTrendContext(evidence.sessions)
    .points.filter(point => !point.isPlaceholder && !point.isNap && point.sleepDate === dateKey)
    .sort((a, b) => b.endTimeMs - a.endTimeMs);
  const night = nights[0] ?? null;
  const sleep: CalendarDayMetric = evidence.sleepError
    ? error('Sleep could not be loaded')
    : night?.score != null
      ? { status: 'ready', value: `${Math.round(night.score)}/100`, detail: `${night.providerLabel} · overnight` }
      : night && night.totalSeconds > 0
        ? { status: 'ready', value: formatActivityCalendarDuration(night.totalSeconds), detail: `${night.providerLabel} · overnight duration` }
        : empty(night ? 'No sleep duration or score recorded' : 'No sleep recorded for this day');

  const hrvReadings = evidence.hrvSeries
    .filter(series => series.metricId === HEALTH_METRIC_IDS.HeartRateVariability)
    .flatMap(series => series.points
      .filter(point => point.calendarDate === dateKey && typeof point.value === 'number' && Number.isFinite(point.value))
      .map(point => ({ series, point })))
    .sort((a, b) => b.point.timestampMs - a.point.timestampMs || a.series.id.localeCompare(b.series.id));
  const hrvReading = hrvReadings[0];
  const hrv: CalendarDayMetric = evidence.hrvError
    ? error('HRV could not be loaded')
    : hrvReading
      ? {
        status: 'ready',
        value: formatHealthValue(HEALTH_METRIC_IDS.HeartRateVariability, hrvReading.point.value,
          hrvReading.series.unit, hrvReading.series.nativeOnly, options.unitSettings),
        detail: [hrvReading.series.sourceLabel, hrvReading.series.semanticLabel].filter(Boolean).join(' · '),
      }
      : empty('No HRV reading for this day');

  let readiness = empty(isToday ? 'No current readiness score' : 'No stored score for this day');
  if (evidence.derivedError) {
    readiness = error('Readiness could not be loaded');
  } else if (isToday && evidence.derived) {
    const formNow = resolveDashboardFormNowContextFromPoints(evidence.derived.formPoints, options.nowMs)
      || evidence.derived.formNow;
    const rampRate = resolveDashboardRampRateContextFromPoints(evidence.derived.formPoints, options.nowMs)
      || evidence.derived.rampRate;
    const current = buildDashboardReadinessSignalsContext({
      formNow, rampRate,
      sleepTrend: buildDashboardSleepTrendContext(evidence.sessions, { nowMs: options.nowMs }),
      nowMs: options.nowMs,
    });
    if (current) readiness = { status: 'ready', value: `${current.label} ${current.score}/100`, detail: 'Current · same signals as Today' };
  } else if (evidence.derived?.trainingReadinessStatus === 'ready') {
    const point = evidence.derived.trainingReadiness?.points.find(item =>
      new Date(item.dayMs).toISOString().slice(0, 10) === dateKey);
    if (point?.score != null && point.label) {
      readiness = { status: 'ready', value: `${point.label} ${point.score}/100`, detail: 'Recorded for this day' };
    }
  }

  let recovery: CalendarDayMetric | null = null;
  if (isToday) {
    const presentation = buildDashboardRecoveryPresentation(evidence.derived?.recoveryNow, {
      nowMs: options.nowMs, locale: options.locale, unitSettings: options.unitSettings,
    });
    recovery = evidence.derivedError
      ? error('Recovery could not be loaded')
      : presentation
        ? { status: 'ready', value: presentation.remainingText, detail: `Until ${presentation.finishText}` }
        : empty('No active recovery estimate');
  }
  return { readiness, sleep, hrv, recovery };
}

function localDateKey(value: number): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}
