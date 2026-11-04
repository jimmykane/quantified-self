import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { formatUnitAwareDataValue } from '@shared/unit-aware-display';
import {
  type ActivityCalendarViewModel,
  type ActivityCalendarVolumeMetric,
  formatActivityCalendarSummaryMetrics,
} from './activity-calendar.helper';
import { DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE, resolveDashboardFormTrainingStressScore } from './dashboard-form.helper';

export interface ActivityCalendarPeriodTotal {
  label: string;
  icon: string;
  value: string;
  coverage: string;
}

/** Completed activities in the primary period, using the calendar's existing projection and totals. */
export function formatActivityCalendarPeriodTotals(
  model: ActivityCalendarViewModel | null,
  unitSettings?: UserUnitSettingsInterface | null,
  locale?: string,
): ActivityCalendarPeriodTotal[] {
  const number = new Intl.NumberFormat(locale);
  const summary = model?.summary ?? null;
  const count = summary?.families.reduce((total, family) => total + family.eventCount, 0) ?? 0;
  const metrics = formatActivityCalendarSummaryMetrics(summary, unitSettings, locale);
  const volume = (index: number, label: string, metric: ActivityCalendarVolumeMetric): ActivityCalendarPeriodTotal => {
    const recorded = summary?.families.reduce((total, family) => total + family.metrics[metric].recordedEventCount, 0) ?? 0;
    const eligible = summary?.families.reduce((total, family) => total + family.metrics[metric].eligibleEventCount, 0) ?? 0;
    return {
      ...metrics[index], label,
      value: count > 0 && recorded === 0 ? '--' : metrics[index].value,
      coverage: recorded > 0 && recorded < eligible ? `${number.format(recorded)}/${number.format(eligible)} activities` : '',
    };
  };
  let tss = 0;
  let tssCount = 0;
  for (const month of model?.months ?? []) for (const day of month.days) {
    if (!day.inPrimaryPeriod) continue;
    for (const event of day.events) {
      const value = resolveDashboardFormTrainingStressScore(event);
      if (value === null) continue;
      tss += value;
      tssCount++;
    }
  }
  return [
    { label: 'Activities', icon: 'exercise', value: model ? number.format(count) : '--', coverage: '' },
    volume(1, 'Time', 'duration'),
    volume(0, 'Distance', 'distance'),
    volume(2, 'Ascent', 'ascent'),
    {
      label: 'Recorded TSS', icon: 'bolt',
      value: tssCount > 0 ? formatUnitAwareDataValue(DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE, tss, unitSettings, { locale }) || '--' : '--',
      coverage: tssCount > 0 && tssCount < count ? `${number.format(tssCount)}/${number.format(count)} activities` : '',
    },
  ];
}
