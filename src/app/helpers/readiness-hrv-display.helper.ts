import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { HEALTH_METRIC_IDS } from '@shared/health';
import { formatCanonicalHealthMetricSportsLibValue } from '@shared/sports-lib-health-data';
import type { ReadinessHrvPersonalRange } from '@shared/readiness';

/** Shared wording and canonical HRV units for Dashboard Today and Training. */
export function buildReadinessHrvDisplay(
  range: ReadinessHrvPersonalRange | null | undefined,
  unitSettings: UserUnitSettingsInterface | null = null,
) {
  const format = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '—';
    const display = formatCanonicalHealthMetricSportsLibValue(HEALTH_METRIC_IDS.HeartRateVariability, value, unitSettings);
    return display ? [display.value, display.unit].filter(Boolean).join(' ') : '—';
  };
  const valueText = format(range?.currentAverage);
  const latestText = range?.latestMs ? `Latest night ${format(range.latestMs)}` : 'No recent HRV';
  if (!range || !range.normalRange) {
    const statusText = !range ? 'No recent HRV' : range.reason === 'building_baseline'
      ? `Building range · ${range.observationDayCount}/14 nights`
      : `Not enough recent HRV · ${range.currentObservationDayCount}/3 nights`;
    return { valueText, statusText, rangeText: '60-day personal range', latestText, tone: 'neutral' as const };
  }
  const lower = formatCanonicalHealthMetricSportsLibValue(HEALTH_METRIC_IDS.HeartRateVariability, Math.max(0, range.normalRange.min), unitSettings)!;
  const upper = formatCanonicalHealthMetricSportsLibValue(HEALTH_METRIC_IDS.HeartRateVariability, range.normalRange.max, unitSettings)!;
  const rangeValue = lower.unit === upper.unit ? `${lower.value}–${upper.value} ${upper.unit}`
    : `${format(Math.max(0, range.normalRange.min))}–${format(range.normalRange.max)}`;
  const direction = range.currentAverage < range.normalRange.min ? 'Below' : 'Above';
  const statusText = range.reason === 'within_range' ? 'Within personal range' : `${direction} personal range`;
  return { valueText, statusText,
    rangeText: `60-day range ${rangeValue}`,
    latestText, tone: range.tone === 'caution' ? 'neutral' as const : range.tone };
}
