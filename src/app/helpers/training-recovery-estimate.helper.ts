import type { DashboardDerivedMetricStatus } from './derived-metric-status.helper';
import {
  buildDashboardRecoveryPresentation,
  type DashboardRecoveryNowContext,
} from './dashboard-recovery-now.helper';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';

export interface TrainingRecoveryEstimateViewModel {
  valueText: string;
  finishTimeMs: number;
  finishText: string;
  detailText: string;
  isUpdating: boolean;
}

export function buildTrainingRecoveryEstimateViewModel(
  context: DashboardRecoveryNowContext | null | undefined,
  status: DashboardDerivedMetricStatus,
  nowMs = Date.now(),
  options: { locale?: string; unitSettings?: UserUnitSettingsInterface | null } = {},
): TrainingRecoveryEstimateViewModel | null {
  const recovery = buildDashboardRecoveryPresentation(context, {
    locale: options.locale,
    nowMs,
    unitSettings: options.unitSettings,
  });
  if (!recovery) {
    return null;
  }

  return {
    valueText: recovery.remainingText,
    finishTimeMs: recovery.finishTimeMs,
    finishText: recovery.finishText,
    detailText: 'Imported post-workout estimate. It is separate from Readiness and Freshness.',
    isUpdating: status !== 'ready' && status !== 'failed',
  };
}
