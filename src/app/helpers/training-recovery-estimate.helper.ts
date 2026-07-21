import type { DashboardDerivedMetricStatus } from './derived-metric-status.helper';
import {
  resolveRemainingRecoverySeconds,
  type DashboardRecoveryNowContext,
} from './dashboard-recovery-now.helper';
import { formatSleepDuration } from './dashboard-sleep-chart.helper';

export interface TrainingRecoveryEstimateViewModel {
  valueText: string;
  detailText: string;
  isUpdating: boolean;
}

export function buildTrainingRecoveryEstimateViewModel(
  context: DashboardRecoveryNowContext | null | undefined,
  status: DashboardDerivedMetricStatus,
  nowMs = Date.now(),
): TrainingRecoveryEstimateViewModel | null {
  const remainingSeconds = resolveRemainingRecoverySeconds(context, nowMs);
  if (remainingSeconds === null || remainingSeconds <= 0) {
    return null;
  }

  return {
    valueText: formatSleepDuration(remainingSeconds),
    detailText: 'Active post-workout timer. It is separate from Readiness and Freshness.',
    isUpdating: status !== 'ready' && status !== 'failed',
  };
}
