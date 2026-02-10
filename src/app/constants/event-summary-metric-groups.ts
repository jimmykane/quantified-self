import {
  DataAerobicTrainingEffect,
  DataAltitudeAvg,
  DataAltitudeMax,
  DataAltitudeMin,
  DataAscent,
  DataCadenceAvg,
  DataCadenceMax,
  DataCadenceMin,
  DataDescent,
  DataDistance,
  DataDuration,
  DataEnergy,
  DataFeeling,
  DataGradeAdjustedPaceAvg,
  DataGradeAdjustedSpeedAvg,
  DataHeartRateAvg,
  DataHeartRateMax,
  DataHeartRateMin,
  DataMovingTime,
  DataPaceAvg,
  DataPeakEPOC,
  DataPowerAvg,
  DataPowerMax,
  DataPowerMin,
  DataRecoveryTime,
  DataRPE,
  DataSpeedAvg,
  DataSwimPaceAvg,
  DataTemperatureAvg,
  DataTemperatureMax,
  DataTemperatureMin,
  DataVO2Max,
  DataVerticalSpeedAvg,
} from '@sports-alliance/sports-lib';

export type EventSummaryMetricGroupId =
  | 'overall'
  | 'speed'
  | 'power'
  | 'altitude'
  | 'technical'
  | 'environment'
  | 'physiological'
  | 'other';

export interface EventSummaryMetricGroupConfig {
  id: EventSummaryMetricGroupId;
  label: string;
  metricTypes: string[];
}

export const EVENT_SUMMARY_DEFAULT_GROUP_ID: EventSummaryMetricGroupId = 'overall';

export const EVENT_SUMMARY_METRIC_GROUPS: EventSummaryMetricGroupConfig[] = [
  {
    id: 'overall',
    label: 'Overall',
    metricTypes: [
      DataDuration.type,
      DataMovingTime.type,
      DataDistance.type,
      DataSpeedAvg.type,
      DataPaceAvg.type,
      DataSwimPaceAvg.type,
      DataGradeAdjustedPaceAvg.type,
      DataGradeAdjustedSpeedAvg.type,
      DataHeartRateAvg.type,
      DataPowerAvg.type,
      DataAscent.type,
      DataDescent.type,
      DataCadenceAvg.type,
    ],
  },
  {
    id: 'speed',
    label: 'Speed',
    metricTypes: [
      DataSpeedAvg.type,
      DataPaceAvg.type,
      DataSwimPaceAvg.type,
      DataGradeAdjustedPaceAvg.type,
      DataGradeAdjustedSpeedAvg.type,
      DataVerticalSpeedAvg.type,
    ],
  },
  {
    id: 'power',
    label: 'Power',
    metricTypes: [
      DataPowerAvg.type,
      DataPowerMax.type,
      DataPowerMin.type,
    ],
  },
  {
    id: 'altitude',
    label: 'Altitude',
    metricTypes: [
      DataAscent.type,
      DataDescent.type,
      DataAltitudeMax.type,
      DataAltitudeMin.type,
      DataAltitudeAvg.type,
    ],
  },
  {
    id: 'technical',
    label: 'Technical',
    metricTypes: [
      DataCadenceAvg.type,
      DataCadenceMax.type,
      DataCadenceMin.type,
    ],
  },
  {
    id: 'environment',
    label: 'Environment',
    metricTypes: [
      DataTemperatureAvg.type,
      DataTemperatureMax.type,
      DataTemperatureMin.type,
    ],
  },
  {
    id: 'physiological',
    label: 'Physiological',
    metricTypes: [
      DataHeartRateAvg.type,
      DataHeartRateMax.type,
      DataHeartRateMin.type,
      DataVO2Max.type,
      DataPeakEPOC.type,
      DataAerobicTrainingEffect.type,
      DataRecoveryTime.type,
      DataFeeling.type,
      DataRPE.type,
    ],
  },
  {
    id: 'other',
    label: 'Other',
    metricTypes: [],
  },
];

export const EVENT_SUMMARY_DEFAULT_STAT_TYPES: string[] = [
  DataDuration.type,
  DataMovingTime.type,
  DataDistance.type,
  DataSpeedAvg.type,
  DataVerticalSpeedAvg.type,
  DataEnergy.type,
  DataPowerAvg.type,
  DataPowerMax.type,
  DataPowerMin.type,
  DataAscent.type,
  DataDescent.type,
  DataAltitudeMax.type,
  DataAltitudeMin.type,
  DataAltitudeAvg.type,
  DataCadenceAvg.type,
  DataCadenceMax.type,
  DataCadenceMin.type,
  DataTemperatureAvg.type,
  DataTemperatureMax.type,
  DataTemperatureMin.type,
  DataHeartRateAvg.type,
  DataHeartRateMax.type,
  DataHeartRateMin.type,
  DataRecoveryTime.type,
  DataPeakEPOC.type,
  DataAerobicTrainingEffect.type,
  DataVO2Max.type,
  DataFeeling.type,
  DataRPE.type,
];
