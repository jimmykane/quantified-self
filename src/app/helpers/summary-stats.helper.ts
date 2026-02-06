import {
  ActivityTypes,
  ActivityTypesHelper,
  DataAerobicTrainingEffect,
  DataAltitudeMax,
  DataAltitudeMin,
  DataAscent,
  DataCadenceAvg,
  DataDescent,
  DataDistance,
  DataDuration,
  DataEnergy,
  DataHeartRateAvg,
  DataMovingTime,
  DataPeakEPOC,
  DataPowerAvg,
  DataRecoveryTime,
  DataSpeedAvg,
  DataTemperatureAvg,
  DataVO2Max,
} from '@sports-alliance/sports-lib';
import { AppEventUtilities } from '../utils/app.event.utilities';

export interface SummaryStatsSettingsLike {
  removeAscentForEventTypes?: string[];
  removeDescentForEventTypes?: string[];
}

export const getDefaultSummaryStatTypes = (
  activityTypes: ActivityTypes[],
  summariesSettings?: SummaryStatsSettingsLike | null
): string[] => {
  const statsToShow = [
    DataDuration.type,
    DataMovingTime.type,
    DataDistance.type,
    DataSpeedAvg.type,
    DataEnergy.type,
    DataHeartRateAvg.type,
    DataCadenceAvg.type,
    DataPowerAvg.type,
    DataAscent.type,
    DataDescent.type,
    DataAltitudeMax.type,
    DataAltitudeMin.type,
    DataRecoveryTime.type,
    DataPeakEPOC.type,
    DataAerobicTrainingEffect.type,
    DataVO2Max.type,
    DataTemperatureAvg.type,
  ];

  return statsToShow.reduce((statsAccu: string[], statType: string) => {
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
      return [...statsAccu, ...speedMetrics];
    }
    return [...statsAccu, statType];
  }, [] as string[]);
};
