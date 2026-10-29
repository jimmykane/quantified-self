import { normalizeDashboardPerformanceContext } from './dashboard-chart-display-settings.helper';
import { formatTrainingPowerSystemsTrendValue } from './training-power-systems.helper';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib/metrics';
import type { TrainingPowerSystemsActivityTypeViewModel, TrainingPowerSystemsTrendViewModel } from './training-power-systems.helper';
import type { TrainingDurabilityScopeViewModel, TrainingDurabilityTrajectoryViewModel } from './training-durability-view.helper';
import { DASHBOARD_CRITICAL_POWER_CHART_TYPE, DASHBOARD_W_PRIME_CHART_TYPE, DASHBOARD_MAXIMUM_POWER_CHART_TYPE, DASHBOARD_DURABILITY_CHART_TYPE } from './dashboard-special-chart-types';

export interface DashboardPerformanceTrendContext {
  options: { value: string; label: string }[];
  selectedKey: string | null;
  powerTrend: TrainingPowerSystemsTrendViewModel | null;
  trajectory: TrainingDurabilityTrajectoryViewModel | null;
  valueText: string;
  detailText: string;
  evidenceText: string;
}

const POWER_KEYS: Record<string, TrainingPowerSystemsTrendViewModel['key']> = {
  [DASHBOARD_CRITICAL_POWER_CHART_TYPE]: 'criticalPowerWatts',
  [DASHBOARD_W_PRIME_CHART_TYPE]: 'wPrimeJoules',
  [DASHBOARD_MAXIMUM_POWER_CHART_TYPE]: 'maximumPowerWatts',
};

/** Select from the existing Training view models. No fitting, stream reads or
 * cross-sport aggregation belongs to this dashboard adapter. */
export function buildDashboardPerformanceTrend(chartType: string,
  power: readonly TrainingPowerSystemsActivityTypeViewModel[],
  durability: readonly TrainingDurabilityScopeViewModel[], selection?: string | null,
  units?: UserUnitSettingsInterface | null): DashboardPerformanceTrendContext {
  const key = normalizeDashboardPerformanceContext(selection);
  const result: DashboardPerformanceTrendContext = {
    options: [], selectedKey: key || null, powerTrend: null, trajectory: null,
    valueText: 'Unavailable', detailText: '', evidenceText: '',
  };
  if (chartType === DASHBOARD_DURABILITY_CHART_TYPE) {
    const contexts = durability.flatMap(scope => scope.contexts.map(context => ({ scope, context })));
    const selected = contexts.find(item => item.context.contextKey === key)
      || (!key ? contexts.find(item => item.context.trajectory.points.some(point => point.value !== null)) || contexts[0] : null);
    result.options = contexts.map(({ context }) => ({ value: context.contextKey, label: context.label }));
    if (selected) {
      result.selectedKey = selected.context.contextKey;
      result.trajectory = selected.context.trajectory;
      result.detailText = selected.context.trajectory.metricDescription;
      result.evidenceText = selected.scope.evidenceQualityText;
    }
  } else {
    const trendKey = POWER_KEYS[chartType];
    const selected = power.find(item => item.activityType === key)
      || (!key ? power.find(item => item.trends.find(trend => trend.key === trendKey)?.points.some(point => point.value !== null)) || power[0] : null);
    result.options = power.map(item => ({ value: item.activityType, label: item.activityType }));
    if (selected) {
      result.selectedKey = selected.activityType;
      result.powerTrend = selected.trends.find(trend => trend.key === trendKey) || null;
      const current = result.powerTrend?.points.find(point => point.isCurrent);
      result.valueText = current?.value != null ? formatTrainingPowerSystemsTrendValue(result.powerTrend!, current.value, units).text : 'Unavailable';
      result.detailText = current?.value != null ? 'Modeled capacity · preceding 42 completed UTC days'
        : current?.statusText || selected.reasonText;
      result.evidenceText = selected.evidenceText;
    }
  }
  // A saved context that disappears stays explicit; never silently switch sports.
  if (key && !result.options.some(option => option.value === key)) result.options.push({ value: key, label: 'Selected context unavailable' });
  return result;
}
