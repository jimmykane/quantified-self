import type { EventRead } from '@shared/event-read';
import {
  ActivityTypes, ActivityTypesHelper, DataAscent, DataDistance, DataDuration,
  DataGradeAdjustedPaceAvg, type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib/metrics';
import { formatUnitAwareDataValue } from '@shared/unit-aware-display';
import { getAppLocale } from '../shared/adapters/app-locale';
import {
  formatActivityCalendarDateParam,
  parseActivityCalendarDate, resolveActivityCalendarPrimaryRange,
} from './activity-calendar.helper';
import { normalizeActivityExplorerCustomDates } from './activity-explorer.helper';
import { isNormalActivityEvent } from './normal-activity-event.helper';
import type { SummaryStatsSettingsLike } from './summary-stats.helper';
import { AppEventUtilities } from '../utils/app.event.utilities';

export const TRAINING_LOG_RUNNING_COLUMNS = [
  'Activity Types', DataDuration.type, DataDistance.type, DataAscent.type,
  'Average Speed', DataGradeAdjustedPaceAvg.type, 'Average Heart Rate', 'VO2 Max', 'Recovery Time',
];

/** Local calendar dates, with an exclusive next-week boundary (including DST changes). */
export function resolveTrainingLogWeek(anchor: string | null, now: Date, startOfWeek?: number | null) {
  const validAnchor = normalizeActivityExplorerCustomDates(anchor, anchor)?.startDate;
  const range = resolveActivityCalendarPrimaryRange('week', validAnchor ? parseActivityCalendarDate(validAnchor) : now, startOfWeek);
  const start = new Date(range.startMs);
  const end = new Date(range.endExclusiveMs);
  const lastDay = new Date(end);
  lastDay.setDate(lastDay.getDate() - 1);
  return { start, end, lastDay, dates: {
    startDate: formatActivityCalendarDateParam(start), endDate: formatActivityCalendarDateParam(lastDay),
  } };
}

export interface TrainingLogTotalMetric { value: string; coverage: string }
export interface TrainingLogSportTotal {
  sport: string;
  count: number;
  duration: TrainingLogTotalMetric;
  distance: TrainingLogTotalMetric;
  ascent: TrainingLogTotalMetric;
}

/** All matching summary rows, never a paginator page or hydrated child activities. */
export function buildTrainingLogSportTotals(
  events: readonly EventRead[],
  unitSettings?: UserUnitSettingsInterface | null,
  summariesSettings?: SummaryStatsSettingsLike | null,
  locale = getAppLocale(),
): TrainingLogSportTotal[] {
  const metricTypes = { duration: DataDuration.type, distance: DataDistance.type, ascent: DataAscent.type };
  const createMetric = () => ({ value: 0, recorded: 0, eligible: 0 });
  const sports = new Map<string, { count: number; duration: ReturnType<typeof createMetric>;
    distance: ReturnType<typeof createMetric>; ascent: ReturnType<typeof createMetric> }>();
  const excludedAscent = new Set((summariesSettings?.removeAscentForEventTypes || [])
    .map(type => ActivityTypesHelper.resolveActivityType(type)).filter(Boolean));
  for (const event of events) {
    if (!isNormalActivityEvent(event)) continue;
    const types = [...new Set(event.getActivityTypesAsArray().map(type => ActivityTypesHelper.resolveActivityType(type) || ActivityTypes.unknown))];
    const sport = types.length > 1 ? ActivityTypes.Multisport : types[0] || ActivityTypes.unknown;
    const group = sports.get(sport) || { count: 0, duration: createMetric(), distance: createMetric(), ascent: createMetric() };
    group.count++;
    for (const key of ['duration', 'distance', 'ascent'] as const) {
      // Match Calendar's sport/user elevation exclusions without reading unused metrics.
      if (key === 'ascent' && (AppEventUtilities.shouldExcludeAscent(types) || types.some(type => excludedAscent.has(type)))) continue;
      const metric = group[key];
      metric.eligible++;
      const stat = event.getStat(metricTypes[key]);
      const raw = stat ? stat.getValue() : null;
      if (raw === null || raw === undefined || raw === '') continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) continue;
      metric.value += value;
      metric.recorded++;
    }
    sports.set(sport, group);
  }
  const number = new Intl.NumberFormat(locale);
  return [...sports].sort(([left], [right]) => left.localeCompare(right, locale)).map(([sport, group]) => {
    const metric = (key: keyof typeof metricTypes): TrainingLogTotalMetric => {
      const { value, recorded, eligible } = group[key];
      return {
        value: recorded ? formatUnitAwareDataValue(metricTypes[key], value, unitSettings,
          { locale, stripRepeatedUnit: true }) || '--' : '--',
        coverage: recorded > 0 && recorded < eligible ? `${number.format(recorded)}/${number.format(eligible)} activities` : '',
      };
    };
    return { sport, count: group.count, duration: metric('duration'), distance: metric('distance'), ascent: metric('ascent') };
  });
}
