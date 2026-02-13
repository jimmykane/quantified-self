import {
  ActivityTypes,
  ActivityTypesHelper,
  DataAscent,
  DataDescent,
  DataGradeAdjustedPaceAvg,
  DataGradeAdjustedSpeedAvg,
  DataPaceAvg,
  DataSpeedAvg,
  DataSwimPaceAvg,
} from '@sports-alliance/sports-lib';
import {
  EVENT_SUMMARY_DEFAULT_STAT_TYPES,
  EVENT_SUMMARY_GRADE_ADJUSTED_PACE_TYPES,
  EVENT_SUMMARY_GRADE_ADJUSTED_SPEED_TYPES,
} from '../constants/event-summary-metric-groups';
import { AppEventUtilities } from '../utils/app.event.utilities';

export interface SummaryStatsSettingsLike {
  removeAscentForEventTypes?: string[];
  removeDescentForEventTypes?: string[];
}

const ACTIVITY_TYPE_KEY_TO_CANONICAL = Object.keys(ActivityTypes).reduce((acc, key) => {
  const canonical = ActivityTypes[key as keyof typeof ActivityTypes];
  if (!canonical || typeof canonical !== 'string') {
    return acc;
  }
  acc.set(key.trim().toLowerCase(), canonical as ActivityTypes);
  return acc;
}, new Map<string, ActivityTypes>());

const ACTIVITY_TYPE_VALUE_TO_CANONICAL = Array
  .from(new Set(Object.values(ActivityTypes) as ActivityTypes[]).values())
  .reduce((acc, value) => {
    acc.set(value.trim().toLowerCase(), value as ActivityTypes);
    return acc;
  }, new Map<string, ActivityTypes>());

const normalizeActivityType = (activityType: ActivityTypes): ActivityTypes => {
  if (typeof activityType !== 'string') {
    return activityType;
  }
  const normalizedInput = activityType.trim();
  if (!normalizedInput) {
    return activityType;
  }

  const exactKeyMatch = ActivityTypes[normalizedInput as keyof typeof ActivityTypes];
  if (exactKeyMatch) {
    return exactKeyMatch as ActivityTypes;
  }

  const normalizedLookupKey = normalizedInput.toLowerCase();
  return ACTIVITY_TYPE_KEY_TO_CANONICAL.get(normalizedLookupKey)
    || ACTIVITY_TYPE_VALUE_TO_CANONICAL.get(normalizedLookupKey)
    || activityType;
};

const resolvePreferredSpeedDerivedAverageTypesForActivity = (activityType: ActivityTypes): string[] => {
  const metrics = ActivityTypesHelper.averageSpeedDerivedDataTypesToUseForActivityType(activityType) || [];
  const hasPaceMetric = metrics.includes(DataPaceAvg.type);
  const hasSwimPaceMetric = metrics.includes(DataSwimPaceAvg.type);

  // Intentional app-side exception vs sports-lib default derived families:
  // when both pace/swim-pace and speed are available (e.g. Trail Running),
  // summary defaults keep pace-family metrics and suppress speed-family defaults.
  if (hasPaceMetric || hasSwimPaceMetric) {
    return metrics.filter((type) => {
      return type !== DataSpeedAvg.type && type !== DataGradeAdjustedSpeedAvg.type;
    });
  }

  return metrics;
};

export const getDefaultSummaryStatTypes = (
  activityTypes: ActivityTypes[],
  summariesSettings?: SummaryStatsSettingsLike | null
): string[] => {
  const normalizedActivityTypes = activityTypes
    .map((activityType) => normalizeActivityType(activityType));

  const speedDerivedAverageTypes = normalizedActivityTypes.reduce((speedMetricsAccu: string[], activityType: ActivityTypes) => {
    const metrics = resolvePreferredSpeedDerivedAverageTypesForActivity(activityType);
    return [...new Set([...speedMetricsAccu, ...(metrics || [])]).values()];
  }, [] as string[]);

  const hasSpeedActivity = speedDerivedAverageTypes.includes(DataSpeedAvg.type)
    || speedDerivedAverageTypes.includes(DataGradeAdjustedSpeedAvg.type);
  const hasPaceActivity = speedDerivedAverageTypes.includes(DataPaceAvg.type)
    || speedDerivedAverageTypes.includes(DataGradeAdjustedPaceAvg.type);
  const gradeAdjustedSpeedSet = new Set(EVENT_SUMMARY_GRADE_ADJUSTED_SPEED_TYPES);
  const gradeAdjustedPaceSet = new Set(EVENT_SUMMARY_GRADE_ADJUSTED_PACE_TYPES);

  return EVENT_SUMMARY_DEFAULT_STAT_TYPES.reduce((statsAccu: string[], statType: string) => {
    if (statType === DataAscent.type) {
      if (
        AppEventUtilities.shouldExcludeAscent(normalizedActivityTypes)
        || (summariesSettings?.removeAscentForEventTypes || []).some((type: string) => (normalizedActivityTypes as string[]).includes(type))
      ) {
        return statsAccu;
      }
    }
    if (statType === DataDescent.type) {
      if (
        AppEventUtilities.shouldExcludeDescent(normalizedActivityTypes)
        || (summariesSettings?.removeDescentForEventTypes || []).some((type: string) => (normalizedActivityTypes as string[]).includes(type))
      ) {
        return statsAccu;
      }
    }
    if (gradeAdjustedSpeedSet.has(statType) && !hasSpeedActivity) {
      return statsAccu;
    }
    if (gradeAdjustedPaceSet.has(statType) && !hasPaceActivity) {
      return statsAccu;
    }
    if (statType === DataSpeedAvg.type) {
      const activityAwareGradeAdjustedTypes: string[] = [
        ...(hasSpeedActivity ? EVENT_SUMMARY_GRADE_ADJUSTED_SPEED_TYPES : []),
        ...(hasPaceActivity ? EVENT_SUMMARY_GRADE_ADJUSTED_PACE_TYPES : []),
      ];
      return [...new Set([...statsAccu, ...speedDerivedAverageTypes, ...activityAwareGradeAdjustedTypes]).values()];
    }
    return [...new Set([...statsAccu, statType]).values()];
  }, [] as string[]);
};
