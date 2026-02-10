import {
  ActivityTypes,
  ActivityTypesHelper,
  DataAscent,
  DataDescent,
  DataSpeedAvg,
} from '@sports-alliance/sports-lib';
import { EVENT_SUMMARY_DEFAULT_STAT_TYPES } from '../constants/event-summary-metric-groups';
import { AppEventUtilities } from '../utils/app.event.utilities';

export interface SummaryStatsSettingsLike {
  removeAscentForEventTypes?: string[];
  removeDescentForEventTypes?: string[];
}

export const getDefaultSummaryStatTypes = (
  activityTypes: ActivityTypes[],
  summariesSettings?: SummaryStatsSettingsLike | null
): string[] => {
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
    if (statType === DataSpeedAvg.type) {
      const speedMetrics = activityTypes.reduce((speedMetricsAccu: string[], activityType: ActivityTypes) => {
        const metrics = ActivityTypesHelper.averageSpeedDerivedDataTypesToUseForActivityType(activityType);
        return [...new Set([...speedMetricsAccu, ...(metrics || [])]).values()];
      }, [] as string[]);
      return [...new Set([...statsAccu, ...speedMetrics]).values()];
    }
    return [...new Set([...statsAccu, statType]).values()];
  }, [] as string[]);
};
