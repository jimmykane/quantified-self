import {
  DataAscent,
  DataDescent,
  DataDistance,
  type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import { formatUnitAwareDataValue } from '@shared/unit-aware-display';
import { AppActivityTypeGroupIcons } from '../services/color/app.activity-type-group.icons';
import {
  type ActivityCalendarMetricAggregate,
  type ActivityCalendarPeriodSummary,
  type ActivityCalendarVolumeMetric,
  formatActivityCalendarDuration,
} from './activity-calendar.helper';

interface ActivityCalendarVolumeMetricOption {
  value: ActivityCalendarVolumeMetric;
  label: string;
  icon: string;
  dataType: string | null;
}

export interface ActivityCalendarFamilyVolumeStat {
  metric: ActivityCalendarVolumeMetric;
  icon: string;
  valueLabel: string;
  isBarMetric: boolean;
  ariaLabel: string;
}

export interface ActivityCalendarFamilyVolumeRow {
  id: string;
  label: string;
  icon: string;
  color: string;
  eventCountLabel: string;
  value: number;
  maximumValue: number;
  valueLabel: string;
  barPercent: number;
  hasData: boolean;
  progressLabel: string;
  ariaLabel: string;
  stats: ActivityCalendarFamilyVolumeStat[];
}

export interface BuildActivityCalendarVolumeStatsOptions {
  includeDuration?: boolean;
}

export const ACTIVITY_CALENDAR_VOLUME_TOOLTIP =
  'Bar length compares recorded duration within this period. The longest activity group fills the track.';

const ACTIVITY_CALENDAR_VOLUME_METRIC_OPTIONS: ReadonlyArray<ActivityCalendarVolumeMetricOption> = [
  { value: 'duration', label: 'Duration', icon: 'schedule', dataType: null },
  { value: 'distance', label: 'Distance', icon: 'route', dataType: DataDistance.type },
  { value: 'ascent', label: 'Ascent', icon: 'trending_up', dataType: DataAscent.type },
  { value: 'descent', label: 'Descent', icon: 'trending_down', dataType: DataDescent.type },
];

export function buildActivityCalendarFamilyVolumeRows(
  summary: ActivityCalendarPeriodSummary,
  unitSettings?: UserUnitSettingsInterface | null,
  locale?: string,
): ActivityCalendarFamilyVolumeRow[] {
  const barMetric = ACTIVITY_CALENDAR_VOLUME_METRIC_OPTIONS[0];
  const metric = barMetric.value;
  const maximumValue = summary.families.reduce((maximum, family) => {
    const aggregate = family.metrics[metric];
    return aggregate.recordedEventCount > 0 ? Math.max(maximum, aggregate.value) : maximum;
  }, 0);

  return summary.families.map((family) => {
    const aggregate = family.metrics[metric];
    const hasData = aggregate.recordedEventCount > 0;
    const valueLabel = hasData ? formatActivityCalendarVolumeMetricValue(barMetric, aggregate.value, unitSettings, locale) : '--';
    const metricStatus = hasData
      ? `${barMetric.label} ${valueLabel}`
      : `${barMetric.label} unavailable`;
    const stats = buildActivityCalendarVolumeStats(family.metrics, unitSettings, locale);

    return {
      id: family.id,
      label: family.label,
      icon: AppActivityTypeGroupIcons[family.activityTypeGroup],
      color: family.color,
      eventCountLabel: `${family.eventCount} ${family.eventCount === 1 ? 'activity' : 'activities'}`,
      value: aggregate.value,
      maximumValue: Math.max(1, maximumValue),
      valueLabel,
      barPercent: hasData && aggregate.value > 0 && maximumValue > 0
        ? aggregate.value / maximumValue * 100
        : 0,
      hasData,
      progressLabel: `${family.label} ${barMetric.label}`,
      ariaLabel: `${family.label}, ${family.eventCount} ${family.eventCount === 1 ? 'activity' : 'activities'}, ${metricStatus}`,
      stats,
    };
  }).sort((left, right) => (
    Number(right.hasData) - Number(left.hasData)
    || right.value - left.value
    || left.label.localeCompare(right.label)
  ));
}

export function buildActivityCalendarVolumeStats(
  metrics: Record<ActivityCalendarVolumeMetric, ActivityCalendarMetricAggregate>,
  unitSettings?: UserUnitSettingsInterface | null,
  locale?: string,
  options: BuildActivityCalendarVolumeStatsOptions = {},
): ActivityCalendarFamilyVolumeStat[] {
  const includeDuration = options.includeDuration ?? true;
  return ACTIVITY_CALENDAR_VOLUME_METRIC_OPTIONS.flatMap((option): ActivityCalendarFamilyVolumeStat[] => {
    if (option.value === 'duration' && !includeDuration) {
      return [];
    }

    const aggregate = metrics[option.value];
    if (aggregate.recordedEventCount <= 0 || aggregate.value <= 0) {
      return [];
    }

    const valueLabel = formatActivityCalendarVolumeMetricValue(option, aggregate.value, unitSettings, locale);
    return [{
      metric: option.value,
      icon: option.icon,
      valueLabel,
      isBarMetric: option.value === 'duration',
      ariaLabel: `${option.label} ${valueLabel}`,
    }];
  });
}

function formatActivityCalendarVolumeMetricValue(
  option: ActivityCalendarVolumeMetricOption,
  value: number,
  unitSettings?: UserUnitSettingsInterface | null,
  locale?: string,
): string {
  return option.value === 'duration'
    ? formatActivityCalendarDuration(value)
    : formatUnitAwareDataValue(option.dataType || undefined, value, unitSettings, {
      stripRepeatedUnit: true,
      locale,
    }) || `${value}`;
}
