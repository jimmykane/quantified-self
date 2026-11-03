import { DataDuration, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib/metrics';
import { formatUnitAwareDataValue } from '@shared/unit-aware-display';
import type { TrainingSummaryMetric } from '../shared/training-summary/training-summary.models';

export * from '../../helpers/dashboard-chart-example-signals.helper';

// Fixed synthetic examples for the public hero; no account reads or wall-clock drift.
// Duration and the imported recovery estimate are independent of the TSS-only Form model.
export function buildHomeHeroSummaryMetrics(unitSettings: UserUnitSettingsInterface | null = null): TrainingSummaryMetric[] {
  const duration = (seconds: number) => formatUnitAwareDataValue(DataDuration.type, seconds, unitSettings,
    { compactDuration: true, stripRepeatedUnit: true }) ?? '--';
  return [
    { id: 'volume', label: 'Training volume', valueText: duration(34920), detailText: 'Last 7 days' },
    { id: 'recovery', label: 'Recovery left', valueText: duration(30000), detailText: 'Imported post-workout estimate' },
  ];
}
