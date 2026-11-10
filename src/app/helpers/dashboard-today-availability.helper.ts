import type { DashboardChartAvailability } from './dashboard-chart-availability.helper';
import type { DashboardDerivedMetricsState } from '../services/dashboard-derived-metrics.service';
import type { DashboardTodayMetricId } from '../models/app-user.interface';
import type { DashboardTodayMetricValues } from './dashboard-today-metrics.helper';
import type { DashboardSleepTrendContext } from './dashboard-sleep-chart.helper';
import { buildCurrentTrainingStateContext } from './current-training-state.helper';
import { buildDashboardReadinessSignalsContext } from './dashboard-training-insights.helper';
import { buildDashboardTodaySleepStatus } from './dashboard-relative-date.helper';
import { resolveRemainingRecoverySeconds } from './dashboard-recovery-now.helper';
import { isDerivedMetricPendingStatus, type DashboardDerivedMetricStatus } from './derived-metric-status.helper';
import { DASHBOARD_TODAY_METRICS } from './dashboard-today-settings.helper';

export type DashboardTodayAvailabilityId = DashboardTodayMetricId | 'trainingState' | 'readiness' | 'recovery';
export type DashboardTodayAvailability = Record<DashboardTodayAvailabilityId, DashboardChartAvailability>;
export type TodayAvailabilitySnapshots = Pick<DashboardDerivedMetricsState,
  'formPoints' | 'formStatus' | 'formNow' | 'formNowStatus' | 'rampRate' | 'rampRateStatus' | 'recoveryNow' | 'recoveryNowStatus'>;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const availability = (state: DashboardChartAvailability['state'], label: string, hasData = false,
  reason = ''): DashboardChartAvailability => ({ state, label, hasData, reason });
const ready = () => availability('ready', 'Ready with your data', true);
const loading = () => availability('loading', 'Checking data…');
const noData = (label: string) => availability('no-data', label);

function derivedAvailability(statuses: readonly DashboardDerivedMetricStatus[], hasData: boolean,
  emptyLabel: string): DashboardChartAvailability {
  if (statuses.includes('failed')) return availability('error', hasData ? 'Some data unavailable' : 'Could not check data', hasData);
  if (statuses.some(isDerivedMetricPendingStatus)) return availability('updating', 'Updating data…', hasData);
  if (hasData) return ready();
  if (statuses.includes('missing')) return noData('Not calculated yet');
  return noData(emptyLabel);
}

/** The same eligible evidence and local-day rule as Today; never infer data from a connection. */
export function buildDashboardTodayAvailability(input: {
  metrics: DashboardTodayMetricValues;
  derived: TodayAvailabilitySnapshots | null;
  sleep: DashboardSleepTrendContext | null;
  sleepStatus: 'loading' | 'ready' | 'error';
  nowMs: number;
}): DashboardTodayAvailability {
  const result = Object.fromEntries([...DASHBOARD_TODAY_METRICS.map(row => row.id), 'trainingState', 'readiness', 'recovery']
    .map(id => [id, loading()])) as DashboardTodayAvailability;
  for (const id of ['weight', 'steps', 'tss', 'ascent', 'duration', 'distance', 'activities'] as const) {
    const metric = input.metrics[id];
    if (!metric || metric.status === 'loading') continue;
    const hasData = metric.hasData ?? metric.status === 'ready';
    result[id] = metric.status === 'error'
      ? availability('error', hasData ? 'Some data unavailable' : 'Could not check data', hasData, metric.detail)
      : hasData ? ready() : noData(metric.detail);
  }
  const derived = input.derived;
  const training = buildCurrentTrainingStateContext({
    formPoints: derived?.formStatus === 'ready' ? derived.formPoints : null,
    fallbackFormNow: derived?.formNowStatus === 'ready' ? derived.formNow : null,
    fallbackRampRate: derived?.rampRateStatus === 'ready' ? derived.rampRate : null,
    nowMs: input.nowMs,
  });
  const context = buildDashboardReadinessSignalsContext({
    formNow: training.formNow, rampRate: training.rampRate,
    sleepTrend: input.sleepStatus === 'ready' ? input.sleep : null, nowMs: input.nowMs,
  });
  // Only the snapshots actually used by Today can affect its availability. A ready
  // Form series can supply Form even before it contains a seven-day ramp comparison.
  const statuses = derived ? [
    training.formNowFromSeries ? derived.formStatus : derived.formNowStatus,
    training.rampRateFromSeries ? derived.formStatus : derived.rampRateStatus,
  ] : [];
  if (derived) {
    result.trainingState = derivedAvailability(statuses, !!training.state.label, 'No training data yet');
    result.load = derivedAvailability(statuses, finite(context?.form) || finite(context?.rampRate), 'No load data yet');
    result.recovery = derivedAvailability([derived.recoveryNowStatus],
      derived.recoveryNowStatus === 'ready' && (resolveRemainingRecoverySeconds(derived.recoveryNow, input.nowMs) ?? 0) > 0,
      'No active recovery estimate');
  }
  if (input.sleepStatus === 'error') {
    result.sleep = result.hrv = result['overnight-hr'] = result.readiness = availability('error', 'Could not check sleep data');
    return result;
  }
  if (input.sleepStatus === 'loading') return result;
  const sleepDay = buildDashboardTodaySleepStatus(context?.latestSleepAtMs, { nowMs: input.nowMs });
  const sleepReading = () => sleepDay.awaitingSleep
    ? availability('history', 'Last available night', true, sleepDay.contextText) : ready();
  result.sleep = finite(context?.sleepScore) || finite(context?.sleepDurationSeconds)
    ? sleepReading() : noData('No eligible sleep reading');
  const hrv = context?.hrvPersonalRange;
  result.hrv = finite(hrv?.currentAverage) ? ready() : hrv
    ? availability('history', 'Needs more HRV history', true) : noData('No current HRV reading');
  result['overnight-hr'] = finite(context?.averageHeartRateBpm) || finite(context?.minimumHeartRateBpm)
    ? sleepReading() : noData('No overnight heart rate reading');
  if (derived) result.readiness = sleepDay.awaitingSleep
    ? availability('no-data', 'Awaiting today’s sleep')
    : derivedAvailability(statuses, finite(context?.score), 'Not enough readiness data');
  return result;
}
