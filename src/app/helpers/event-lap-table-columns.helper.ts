import {
  ActivityTypeGroups,
  ActivityTypesHelper,
  DataAscent,
  DataCadenceAvg,
  DataDescent,
  DataDistance,
  DataDuration,
  DataEnergy,
  DataHeartRateAvg,
  DataHeartRateMax,
  DataInterface,
  DataPowerAvg,
  DataSwimPaceAvg,
  type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import { resolvePrimaryUnitAwareDisplayStat } from './summary-display.helper';
import { resolvePreferredSpeedDerivedAverageTypeForActivity } from './summary-stats.helper';
import { EVENT_SUMMARY_METRIC_GROUPS } from '../constants/event-summary-metric-groups';
import {
  AppEventDetailsSettingsInterface,
  AppEventLapSportFamily,
} from '../models/app-user.interface';

export interface EventLapMetricOption {
  type: string;
  label: string;
}

export interface EventLapMetricOptionGroup {
  id: string;
  label: string;
  metrics: EventLapMetricOption[];
}

export interface EventLapSportFamilyPresentation {
  family: AppEventLapSportFamily;
  label: string;
  icon: string;
}

const SPORT_FAMILY_PRESENTATIONS: EventLapSportFamilyPresentation[] = [
  { family: 'running', label: 'Running', icon: 'directions_run' },
  { family: 'cycling', label: 'Cycling', icon: 'directions_bike' },
  { family: 'swimming', label: 'Swimming', icon: 'pool' },
  { family: 'other', label: 'Other activities', icon: 'sports' },
];

const EVENT_LAP_METRIC_OPTION_GROUPS: EventLapMetricOptionGroup[] = [];
const EVENT_LAP_METRIC_TYPES = new Set<string>();

EVENT_SUMMARY_METRIC_GROUPS.forEach((summaryGroup) => {
  const metrics = summaryGroup.metricTypes
    .filter((type) => {
      if (EVENT_LAP_METRIC_TYPES.has(type)) {
        return false;
      }
      EVENT_LAP_METRIC_TYPES.add(type);
      return true;
    })
    .map((type) => ({ type, label: type }));

  if (metrics.length > 0) {
    EVENT_LAP_METRIC_OPTION_GROUPS.push({
      id: summaryGroup.id,
      label: summaryGroup.label,
      metrics,
    });
  }
});

const CORE_LAP_METRIC_TYPES = [
  DataDuration.type,
  DataDistance.type,
  DataHeartRateAvg.type,
  DataHeartRateMax.type,
  DataCadenceAvg.type,
  DataPowerAvg.type,
  DataAscent.type,
  DataDescent.type,
  DataEnergy.type,
];

export const EVENT_LAP_TABLE_FIXED_COLUMN = '#';

export const getEventLapMetricOptionGroups = (): EventLapMetricOptionGroup[] => (
  EVENT_LAP_METRIC_OPTION_GROUPS.map((group) => ({
    ...group,
    metrics: [...group.metrics],
  }))
);

export const getEventLapSportFamilyPresentation = (
  family: AppEventLapSportFamily,
): EventLapSportFamilyPresentation => (
  SPORT_FAMILY_PRESENTATIONS.find((presentation) => presentation.family === family)
    || SPORT_FAMILY_PRESENTATIONS[SPORT_FAMILY_PRESENTATIONS.length - 1]
);

export const resolveEventLapSportFamily = (activityType: unknown): AppEventLapSportFamily => {
  const resolvedActivityType = ActivityTypesHelper.resolveActivityType(activityType);
  if (!resolvedActivityType) {
    return 'other';
  }

  const group = ActivityTypesHelper.getActivityGroupForActivityType(resolvedActivityType);
  if (group === ActivityTypeGroups.RunningGroup || group === ActivityTypeGroups.TrailRunningGroup) {
    return 'running';
  }
  if (group === ActivityTypeGroups.CyclingGroup || group === ActivityTypeGroups.MountainBikingGroup) {
    return 'cycling';
  }
  if (group === ActivityTypeGroups.SwimmingGroup) {
    return 'swimming';
  }
  return 'other';
};

export const getDefaultEventLapMetricTypes = (
  family: AppEventLapSportFamily,
): string[] => {
  const effortType = family === 'swimming'
    ? DataSwimPaceAvg.type
    : resolvePreferredSpeedDerivedAverageTypeForActivity(
      family === 'running' ? 'Running' : family === 'cycling' ? 'Cycling' : 'Other',
    );

  return [
    DataDuration.type,
    DataDistance.type,
    effortType,
    ...CORE_LAP_METRIC_TYPES.filter((type) => type !== DataDuration.type && type !== DataDistance.type),
  ].filter((type, index, values) => values.indexOf(type) === index);
};

export const normalizeEventLapMetricTypes = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalizedMetricTypes: string[] = [];
  const seenMetricTypes = new Set<string>();
  value.forEach((entry) => {
    if (typeof entry !== 'string') {
      return;
    }
    const metricType = entry.trim();
    if (!metricType || !EVENT_LAP_METRIC_TYPES.has(metricType) || seenMetricTypes.has(metricType)) {
      return;
    }
    seenMetricTypes.add(metricType);
    normalizedMetricTypes.push(metricType);
  });

  return value.length > 0 && normalizedMetricTypes.length === 0 ? null : normalizedMetricTypes;
};

export const normalizeEventDetailsSettings = (value: unknown): AppEventDetailsSettingsInterface => {
  const rawSettings = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { lapTableColumnsBySportFamily?: unknown }
    : {};
  const rawColumnsBySportFamily = rawSettings.lapTableColumnsBySportFamily;
  const columnsBySportFamily = rawColumnsBySportFamily
    && typeof rawColumnsBySportFamily === 'object'
    && !Array.isArray(rawColumnsBySportFamily)
    ? rawColumnsBySportFamily as Record<string, unknown>
    : {};
  const normalizedColumnsBySportFamily: Partial<Record<AppEventLapSportFamily, string[]>> = {};

  SPORT_FAMILY_PRESENTATIONS.forEach(({ family }) => {
    const normalizedMetricTypes = normalizeEventLapMetricTypes(columnsBySportFamily[family]);
    if (normalizedMetricTypes !== null) {
      normalizedColumnsBySportFamily[family] = normalizedMetricTypes;
    }
  });

  return {
    lapTableColumnsBySportFamily: normalizedColumnsBySportFamily,
  };
};

export const getSelectedEventLapMetricTypes = (
  settings: AppEventDetailsSettingsInterface | null | undefined,
  family: AppEventLapSportFamily,
): string[] => {
  const normalizedSettings = normalizeEventDetailsSettings(settings);
  const selectedMetricTypes = normalizedSettings.lapTableColumnsBySportFamily?.[family];
  return selectedMetricTypes === undefined
    ? getDefaultEventLapMetricTypes(family)
    : selectedMetricTypes;
};

export const formatEventLapMetric = (
  stat: DataInterface | null | undefined,
  metricType: string,
  unitSettings: UserUnitSettingsInterface | null | undefined,
  activityType: unknown,
): string => {
  if (!stat) {
    return '';
  }

  const rawValue = stat.getValue?.();
  if (typeof rawValue === 'number' && !Number.isFinite(rawValue)) {
    return '';
  }

  if (metricType === DataDuration.type) {
    const duration = stat as DataInterface & {
      getStopwatchDisplayValue?: () => string;
    };
    if (typeof duration.getStopwatchDisplayValue === 'function') {
      return duration.getStopwatchDisplayValue();
    }

    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      const centiseconds = Math.round(rawValue * 100);
      const sign = centiseconds < 0 ? '-' : '';
      const absoluteCentiseconds = Math.abs(centiseconds);
      const minutes = Math.floor(absoluteCentiseconds / 6000);
      const seconds = Math.floor((absoluteCentiseconds % 6000) / 100);
      const fraction = (absoluteCentiseconds % 100).toString().padStart(2, '0');
      return `${sign}${minutes}:${seconds.toString().padStart(2, '0')}.${fraction}`;
    }
  }

  const display = resolvePrimaryUnitAwareDisplayStat(stat, unitSettings, metricType, [activityType]);
  return display?.text || '';
};
