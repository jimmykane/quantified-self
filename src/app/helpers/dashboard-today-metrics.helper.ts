import {
  DataAscent,
  DataDistance,
  DataDuration,
  type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import type { EventRead } from '@shared/event-read';
import { resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';
import { getNumberFormatter } from './number-format.helper';
import {
  resolveDashboardFormTrainingStressScore,
  DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
} from './dashboard-form.helper';
import type { SummaryStatsSettingsLike } from './summary-stats.helper';
import { buildActivityCalendarPeriodSummary } from './activity-calendar.helper';
import type { DashboardTodayMetricId } from '../models/app-user.interface';

export interface DashboardTodayMetricValue {
  value: string;
  detail: string;
  status: 'loading' | 'ready' | 'empty' | 'error';
}
export type DashboardTodayMetricValues = Partial<
  Record<DashboardTodayMetricId, DashboardTodayMetricValue>
>;
export const TODAY_ACTIVITY_METRICS: readonly DashboardTodayMetricId[] = [
  'tss',
  'ascent',
  'duration',
  'distance',
  'activities',
];

export function buildTodayActivityMetrics(
  events: readonly EventRead[],
  complete: boolean,
  units?: UserUnitSettingsInterface,
  preferences?: SummaryStatsSettingsLike,
  locale?: string,
  selected: readonly DashboardTodayMetricId[] = TODAY_ACTIVITY_METRICS
): DashboardTodayMetricValues {
  const unique = [
    ...new Map(events.map((event) => [event.getID(), event])).values(),
  ];
  const number = getNumberFormatter(locale, { maximumFractionDigits: 0 });
  const elevation = selected.includes('ascent')
    ? buildActivityCalendarPeriodSummary(unique, preferences)
    : null;
  const result: DashboardTodayMetricValues = selected.includes('activities')
    ? {
        activities: {
          value: number.format(unique.length),
          detail: complete
            ? 'Recorded today · all sports'
            : 'Activities loaded so far',
          status: 'ready',
        },
      }
    : {};
  for (const [id, type] of [
    ['tss', DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE],
    ['ascent', DataAscent.type],
    ['duration', DataDuration.type],
    ['distance', DataDistance.type],
  ] as const) {
    if (!selected.includes(id)) continue;
    let sum = 0,
      count = 0;
    for (const event of id === 'ascent' ? [] : unique) {
      const stat = id === 'tss' ? null : event.getStat(type);
      const value =
        id === 'tss'
          ? resolveDashboardFormTrainingStressScore(event)
          : stat
            ? stat.getValue()
            : null;
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        sum += value;
        count++;
      }
    }
    if (id === 'ascent') {
      sum = elevation.totalAscentMeters;
      count = elevation.families.reduce(
        (total, family) => total + family.metrics.ascent.recordedEventCount,
        0
      );
    }
    const knownEmpty = complete && unique.length === 0;
    const display =
      count || knownEmpty
        ? resolveUnitAwareDisplayFromValue(type, sum, units, {
            compactDuration: true,
          })
        : null;
    result[id] = {
      value: display?.text ?? '—',
      status: display ? 'ready' : 'empty',
      detail: !display
        ? 'No recorded value today'
        : knownEmpty
          ? 'No activities yet today'
          : complete && count === unique.length
            ? 'Recorded today · all sports'
            : `From ${number.format(count)} of ${number.format(unique.length)} activities loaded`,
    };
  }
  return result;
}
