import type { DashboardDerivedMetricStatus } from './derived-metric-status.helper';
import {
  resolveRecoveryFinishTimeMs,
  resolveRemainingRecoverySeconds,
  type DashboardRecoveryNowContext,
} from './dashboard-recovery-now.helper';
import { formatSleepDuration } from './dashboard-sleep-chart.helper';

export interface TrainingRecoveryEstimateViewModel {
  valueText: string;
  finishTimeMs: number;
  detailText: string;
  isUpdating: boolean;
}

export function buildTrainingRecoveryEstimateViewModel(
  context: DashboardRecoveryNowContext | null | undefined,
  status: DashboardDerivedMetricStatus,
  nowMs = Date.now(),
): TrainingRecoveryEstimateViewModel | null {
  const remainingSeconds = resolveRemainingRecoverySeconds(context, nowMs);
  const finishTimeMs = resolveRecoveryFinishTimeMs(context, nowMs);
  if (remainingSeconds === null || remainingSeconds <= 0 || finishTimeMs === null) {
    return null;
  }

  return {
    valueText: formatSleepDuration(remainingSeconds),
    finishTimeMs,
    detailText: 'Imported post-workout estimate. It is separate from Readiness and Freshness.',
    isUpdating: status !== 'ready' && status !== 'failed',
  };
}
