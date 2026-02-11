import {
  ActivityTypes,
  ActivityTypesHelper,
  DataAscent,
  DataDescent,
  DataGradeAdjustedPaceAvg,
  DataGradeAdjustedSpeedAvg,
  DataPaceAvg,
  DataSpeedAvg,
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

export const getDefaultSummaryStatTypes = (
  activityTypes: ActivityTypes[],
  summariesSettings?: SummaryStatsSettingsLike | null
): string[] => {
  const speedDerivedAverageTypes = activityTypes.reduce((speedMetricsAccu: string[], activityType: ActivityTypes) => {
    const metrics = ActivityTypesHelper.averageSpeedDerivedDataTypesToUseForActivityType(activityType);
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
        AppEventUtilities.shouldExcludeAscent(activityTypes)
        || (summariesSettings?.removeAscentForEventTypes || []).some((type: string) => (activityTypes as string[]).includes(type))
      ) {
        return statsAccu;
      }
    }
    if (statType === DataDescent.type) {
      if (
        AppEventUtilities.shouldExcludeDescent(activityTypes)
        || (summariesSettings?.removeDescentForEventTypes || []).some((type: string) => (activityTypes as string[]).includes(type))
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
