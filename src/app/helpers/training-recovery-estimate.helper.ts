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
    detailText: 'Imported post-workout estimate; it is not readiness and does not change your Training state',
    isUpdating: status !== 'ready' && status !== 'failed',
  };
}
