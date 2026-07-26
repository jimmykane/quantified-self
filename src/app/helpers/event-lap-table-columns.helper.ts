import {
  ActivityTypeGroups,
  ActivityTypesHelper,
  DataAscent,
  DataCadenceAvg,
  DataDescent,
  DataDistance,
  DataDuration,
  DataEnergy,
  DataEHPE,
  DataEHPEAvg,
  DataEHPEMax,
  DataEHPEMin,
  DataEVPE,
  DataEVPEAvg,
  DataEVPEMax,
  DataEVPEMin,
  DataHeartRateAvg,
  DataHeartRateMax,
  DataInterface,
  DataNumberOfSatellites,
  DataNumberOfSatellitesAvg,
  DataNumberOfSatellitesMax,
  DataNumberOfSatellitesMin,
  DataPowerAvg,
  DataSatellite5BestSNR,
  DataSatellite5BestSNRAvg,
  DataSatellite5BestSNRMax,
  DataSatellite5BestSNRMin,
  DataSpeedAvg,
  DataSwimPaceAvg,
  DynamicDataLoader,
  LapInterface,
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

export interface EventLapAverageMetric {
  type: string;
  display: string;
}

const SPORT_FAMILY_PRESENTATIONS: EventLapSportFamilyPresentation[] = [
  { family: 'running', label: 'Running', icon: 'directions_run' },
  { family: 'cycling', label: 'Cycling', icon: 'directions_bike' },
  { family: 'swimming', label: 'Swimming', icon: 'pool' },
  { family: 'other', label: 'Other activities', icon: 'sports' },
];

const EVENT_LAP_SPORT_FAMILIES: readonly AppEventLapSportFamily[] = [
  'running',
  'cycling',
  'swimming',
  'other',
];

const EXCLUDED_EVENT_LAP_METRIC_TYPES = new Set([
  DataEHPE.type,
  DataEHPEAvg.type,
  DataEHPEMin.type,
  DataEHPEMax.type,
  DataEVPE.type,
  DataEVPEAvg.type,
  DataEVPEMin.type,
  DataEVPEMax.type,
  DataNumberOfSatellites.type,
  DataNumberOfSatellitesAvg.type,
  DataNumberOfSatellitesMin.type,
  DataNumberOfSatellitesMax.type,
  DataSatellite5BestSNR.type,
  DataSatellite5BestSNRAvg.type,
  DataSatellite5BestSNRMin.type,
  DataSatellite5BestSNRMax.type,
]);

interface EventLapCatalogMetric {
  type: string;
  parentGroupID: string;
  parentGroupLabel: string;
  order: number;
}

interface EventLapMetricVariant {
  family: string;
  label: string;
}

interface OrderedEventLapMetricOptionGroup extends EventLapMetricOptionGroup {
  order: number;
}

const EVENT_LAP_METRIC_TYPES = new Set<string>();
const EVENT_LAP_CATALOG_METRICS: EventLapCatalogMetric[] = [];

const resolveEventLapMetricVariant = (type: string): EventLapMetricVariant | null => {
  const prefixMatch = /^(Average|Avg|Maximum|Max|Minimum|Min)\s+(.+)$/i.exec(type);
  const suffixMatch = /^(.+)\s+(Average|Avg|Maximum|Max|Minimum|Min)$/i.exec(type);
  const variantMatch = prefixMatch || suffixMatch;
  if (!variantMatch) {
    return null;
  }

  const token = (prefixMatch ? prefixMatch[1] : suffixMatch?.[2] || '').toLowerCase();
  const family = (prefixMatch ? prefixMatch[2] : suffixMatch?.[1] || '').trim();
  if (!family) {
    return null;
  }

  return {
    family,
    label: token === 'avg' || token === 'average'
      ? 'Average'
      : token === 'max' || token === 'maximum'
        ? 'Maximum'
        : 'Minimum',
  };
};

EVENT_SUMMARY_METRIC_GROUPS.forEach((summaryGroup) => {
  summaryGroup.metricTypes.forEach((type) => {
    if (EXCLUDED_EVENT_LAP_METRIC_TYPES.has(type) || EVENT_LAP_METRIC_TYPES.has(type)) {
      return;
    }
    EVENT_LAP_METRIC_TYPES.add(type);
    EVENT_LAP_CATALOG_METRICS.push({
      type,
      parentGroupID: summaryGroup.id,
      parentGroupLabel: summaryGroup.label,
      order: EVENT_LAP_CATALOG_METRICS.length,
    });
  });
});

const metricVariantCounts = new Map<string, number>();
EVENT_LAP_CATALOG_METRICS.forEach(({ type }) => {
  const variant = resolveEventLapMetricVariant(type);
  if (variant) {
    metricVariantCounts.set(variant.family, (metricVariantCounts.get(variant.family) || 0) + 1);
  }
});

const EVENT_LAP_METRIC_OPTION_GROUPS: EventLapMetricOptionGroup[] = Array
  .from(EVENT_LAP_CATALOG_METRICS.reduce((groups, metric) => {
    const variant = resolveEventLapMetricVariant(metric.type);
    const isVariantFamily = variant && (metricVariantCounts.get(variant.family) || 0) > 1;
    const id = isVariantFamily
      ? `metric-${variant.family.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
      : metric.parentGroupID;
    const label = isVariantFamily ? variant.family : metric.parentGroupLabel;
    const existing = groups.get(id);
    const option = {
      type: metric.type,
      label: isVariantFamily ? variant.label : metric.type,
    };

    if (existing) {
      existing.metrics.push(option);
      return groups;
    }

    groups.set(id, {
      id,
      label,
      metrics: [option],
      order: metric.order,
    });
    return groups;
  }, new Map<string, OrderedEventLapMetricOptionGroup>()).values())
  .sort((left, right) => left.order - right.order)
  .map(({ order: _order, ...group }) => group);

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

export const isEventLapSportFamily = (value: unknown): value is AppEventLapSportFamily => (
  typeof value === 'string'
  && EVENT_LAP_SPORT_FAMILIES.includes(value as AppEventLapSportFamily)
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
    ) || DataSpeedAvg.type;

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

  EVENT_LAP_SPORT_FAMILIES.forEach((family) => {
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

export const getEventLapMetricStat = (
  lap: LapInterface,
  metricType: string,
): DataInterface | null => {
  try {
    if (metricType === DataDuration.type) {
      return lap.getDuration?.() || null;
    }
    if (metricType === DataDistance.type) {
      return lap.getDistance?.() || null;
    }
    return lap.getStat?.(metricType) || null;
  } catch {
    return null;
  }
};

export const getAverageEventLapMetrics = (
  laps: readonly LapInterface[],
  metricTypes: readonly string[],
  unitSettings: UserUnitSettingsInterface | null | undefined,
  activityType: unknown,
): EventLapAverageMetric[] => (
  metricTypes.reduce<EventLapAverageMetric[]>((averages, metricType) => {
    const values = laps
      .map((lap) => getEventLapMetricStat(lap, metricType)?.getValue?.())
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (values.length === 0) {
      return averages;
    }

    try {
      const averageValue = values.reduce((total, value) => total + value, 0) / values.length;
      const averageStat = DynamicDataLoader.getDataInstanceFromDataType(metricType, averageValue);
      const display = formatEventLapMetric(averageStat, metricType, unitSettings, activityType);
      if (display) {
        averages.push({ type: metricType, display });
      }
    } catch {
      // A malformed or non-numeric sports-lib metric should not block the Laps table.
    }

    return averages;
  }, [])
);
