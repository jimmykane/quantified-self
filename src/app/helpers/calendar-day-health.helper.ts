import { HEALTH_METRIC_IDS } from '@shared/health';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { HealthWorkspaceSeries, HealthWorkspaceSleepSession } from './health-workspace.helper';
import { formatHealthValue } from './health-workspace.helper';
import { buildDashboardSleepTrendContext, formatSleepDuration } from './dashboard-sleep-chart.helper';
import { buildDashboardReadinessSignalsContext } from './dashboard-training-insights.helper';
import {
  resolveDashboardFormNowContextFromPoints,
  resolveDashboardRampRateContextFromPoints,
} from './dashboard-derived-metrics.helper';
import { buildDashboardRecoveryPresentation } from './dashboard-recovery-now.helper';
import type { DashboardDerivedMetricsState } from '../services/dashboard-derived-metrics.service';
import { isDerivedMetricPendingStatus } from './derived-metric-status.helper';

export type CalendarDayMetricStatus = 'ready' | 'empty' | 'updating' | 'error';

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
  readinessError: boolean;
  recoveryError: boolean;
}

const empty = (detail: string): CalendarDayMetric => ({ status: 'empty', value: '—', detail });
const updating = (detail: string): CalendarDayMetric => ({ status: 'updating', value: '—', detail });
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
        ? { status: 'ready', value: formatSleepDuration(night.totalSeconds), detail: `${night.providerLabel} · overnight duration` }
        : empty(night ? 'No sleep duration or score recorded' : 'No sleep recorded for this day');

  const hrvReadings = evidence.hrvSeries
    .filter(series => series.metricId === HEALTH_METRIC_IDS.HeartRateVariability)
    .flatMap(series => series.points
      .filter(point => point.calendarDate === dateKey && typeof point.value === 'number' && Number.isFinite(point.value))
      .map(point => ({ series, point })))
    .sort((a, b) => b.point.timestampMs - a.point.timestampMs || a.series.id.localeCompare(b.series.id));
  const hrvReading = hrvReadings[0];
  const hrv: CalendarDayMetric = hrvReading
      ? {
        status: 'ready',
        value: formatHealthValue(HEALTH_METRIC_IDS.HeartRateVariability, hrvReading.point.value,
          hrvReading.series.unit, hrvReading.series.nativeOnly, options.unitSettings),
        detail: [hrvReading.series.sourceLabel, hrvReading.series.semanticLabel,
          evidence.hrvError ? 'Other HRV readings unavailable' : null].filter(Boolean).join(' · '),
      }
      : evidence.hrvError ? error('HRV could not be loaded') : empty('No HRV reading for this day');

  let readiness = empty(isToday ? 'No current readiness score' : 'No stored score for this day');
  if (isToday && evidence.derived) {
    const formNow = resolveDashboardFormNowContextFromPoints(evidence.derived.formPoints, options.nowMs)
      || evidence.derived.formNow;
    const rampRate = resolveDashboardRampRateContextFromPoints(evidence.derived.formPoints, options.nowMs)
      || evidence.derived.rampRate;
    const current = buildDashboardReadinessSignalsContext({
      formNow, rampRate,
      sleepTrend: buildDashboardSleepTrendContext(evidence.sessions, { nowMs: options.nowMs }),
      nowMs: options.nowMs,
    });
    if (current) readiness = { status: 'ready', value: `${current.label} ${current.score}/100`,
      detail: evidence.readinessError ? 'Current · some signals could not be refreshed' : 'Current · same signals as Today' };
  } else if (!evidence.readinessError && evidence.derived?.trainingReadinessStatus === 'ready') {
    const point = evidence.derived.trainingReadiness?.points.find(item =>
      new Date(item.dayMs).toISOString().slice(0, 10) === dateKey);
    if (point?.score != null && point.label) {
      readiness = { status: 'ready', value: `${point.label} ${point.score}/100`, detail: 'Recorded for this day' };
    }
  }
  if (readiness.status === 'empty' && evidence.readinessError) {
    readiness = error('Readiness could not be loaded');
  } else if (readiness.status === 'empty' && evidence.derived && (isToday
    ? [evidence.derived.formStatus, evidence.derived.formNowStatus, evidence.derived.rampRateStatus]
      .some(isDerivedMetricPendingStatus)
    : isDerivedMetricPendingStatus(evidence.derived.trainingReadinessStatus))) {
    readiness = updating('Readiness is being updated');
  }

  let recovery: CalendarDayMetric | null = null;
  if (isToday) {
    const presentation = buildDashboardRecoveryPresentation(evidence.derived?.recoveryNow, {
      nowMs: options.nowMs, locale: options.locale, unitSettings: options.unitSettings,
    });
    recovery = presentation
      ? { status: 'ready', value: presentation.remainingText,
        detail: evidence.recoveryError ? `Until ${presentation.finishText} · could not refresh estimate` : `Until ${presentation.finishText}` }
      : evidence.recoveryError
        ? error('Recovery could not be loaded')
        : isDerivedMetricPendingStatus(evidence.derived?.recoveryNowStatus)
          ? updating('Recovery is being updated')
          : empty('No active recovery estimate');
  }
  return { readiness, sleep, hrv, recovery };
}

function localDateKey(value: number): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}
