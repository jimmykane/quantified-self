import {
  DataAccumulatedPower,
  DataAerobicTrainingEffect,
  DataAirPower,
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
  DataPower,
  DataPowerAvg,
  DataPowerLeft,
  DataPowerMax,
  DataPowerMin,
  DataPowerRight,
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
  | 'performance'
  | 'altitude'
  | 'environment'
  | 'device'
  | 'physiological'
  | 'other';

export interface EventSummaryMetricGroupConfig {
  id: EventSummaryMetricGroupId;
  label: string;
  metricTypes: string[];
  singleValueTypes?: string[];
}

// Non-exported sports-lib stat types (present at runtime in lib/esm/index.js).
const POWER_LIB_EXTRA_TYPE_STRINGS: string[] = [
  'Power Normalized',
  'Power Intensity Factor',
  'Power Training Stress Score',
  'Power Work',
  'PowerWattsPerKg',
  'CriticalPower',
  'WPrime',
  'Form Power',
  'Power Pod',
  'Average Air Power',
  'Maximum Air Power',
  'Minimum Air Power',
  'Power Pedal Smoothness Left',
  'Power Pedal Smoothness Right',
  'Power Torque Effectiveness Left',
  'Power Torque Effectiveness Right',
  'Power Zone Target',
];

const ALTITUDE_LIB_EXTRA_TYPE_STRINGS: string[] = [
  'Ascent Time',
  'Descent Time',
];

const PHYSIOLOGICAL_EXTRA_TYPE_STRINGS: string[] = [
  'Age',
  'Gender',
  'Height',
  'Weight',
];

const ENVIRONMENT_EXTRA_TYPE_STRINGS: string[] = [
  'Absolute Pressure',
];

const PERFORMANCE_EXTRA_TYPE_STRINGS: string[] = [
  'Effort Pace',
  'EPOC',
];

const DEVICE_EXTRA_TYPE_STRINGS: string[] = [
  'Battery Charge',
  'Battery Consumption',
  'Battery Current',
  'Battery Voltage',
  'Distance (Stryd)',
  'GNSS Distance',
];

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
      DataHeartRateAvg.type,
      DataPowerAvg.type,
      DataRecoveryTime.type,
      DataVO2Max.type,
      DataAscent.type,
      DataDescent.type,
      DataCadenceAvg.type,
    ],
    singleValueTypes: [
      DataHeartRateAvg.type,
      DataPowerAvg.type,
      DataSpeedAvg.type,
      DataPaceAvg.type,
      DataSwimPaceAvg.type,
      DataCadenceAvg.type,
    ],
  },
  {
    id: 'performance',
    label: 'Performance',
    metricTypes: [
      DataSpeedAvg.type,
      DataPaceAvg.type,
      DataSwimPaceAvg.type,
      DataGradeAdjustedPaceAvg.type,
      DataGradeAdjustedSpeedAvg.type,
      DataVerticalSpeedAvg.type,
      DataCadenceAvg.type,
      DataCadenceMax.type,
      DataCadenceMin.type,
      DataPower.type,
      DataPowerAvg.type,
      DataPowerMax.type,
      DataPowerMin.type,
      DataPowerLeft.type,
      DataPowerRight.type,
      DataAccumulatedPower.type,
      DataAirPower.type,
      ...PERFORMANCE_EXTRA_TYPE_STRINGS,
      ...POWER_LIB_EXTRA_TYPE_STRINGS,
    ],
    singleValueTypes: [
      DataVerticalSpeedAvg.type,
    ],
  },
  {
    id: 'altitude',
    label: 'Altitude',
    metricTypes: [],
  },
  {
    id: 'environment',
    label: 'Environment',
    metricTypes: [
      DataAscent.type,
      DataDescent.type,
      ...ALTITUDE_LIB_EXTRA_TYPE_STRINGS,
      DataAltitudeMax.type,
      DataAltitudeMin.type,
      DataAltitudeAvg.type,
      DataTemperatureAvg.type,
      DataTemperatureMax.type,
      DataTemperatureMin.type,
      ...ENVIRONMENT_EXTRA_TYPE_STRINGS,
    ],
  },
  {
    id: 'device',
    label: 'Device',
    metricTypes: [
      ...DEVICE_EXTRA_TYPE_STRINGS,
    ],
  },
  {
    id: 'physiological',
    label: 'Physiological',
    metricTypes: [
      DataEnergy.type,
      DataHeartRateAvg.type,
      DataHeartRateMax.type,
      DataHeartRateMin.type,
      DataVO2Max.type,
      DataPeakEPOC.type,
      DataAerobicTrainingEffect.type,
      DataRecoveryTime.type,
      DataFeeling.type,
      DataRPE.type,
      ...PHYSIOLOGICAL_EXTRA_TYPE_STRINGS,
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
  DataPower.type,
  DataPowerAvg.type,
  DataPowerMax.type,
  DataPowerMin.type,
  DataPowerLeft.type,
  DataPowerRight.type,
  DataAccumulatedPower.type,
  DataAirPower.type,
  ...PERFORMANCE_EXTRA_TYPE_STRINGS,
  ...POWER_LIB_EXTRA_TYPE_STRINGS,
  DataAscent.type,
  DataDescent.type,
  ...ALTITUDE_LIB_EXTRA_TYPE_STRINGS,
  DataAltitudeMax.type,
  DataAltitudeMin.type,
  DataAltitudeAvg.type,
  DataCadenceAvg.type,
  DataCadenceMax.type,
  DataCadenceMin.type,
  DataTemperatureAvg.type,
  DataTemperatureMax.type,
  DataTemperatureMin.type,
  ...ENVIRONMENT_EXTRA_TYPE_STRINGS,
  ...DEVICE_EXTRA_TYPE_STRINGS,
  DataHeartRateAvg.type,
  DataHeartRateMax.type,
  DataHeartRateMin.type,
  DataRecoveryTime.type,
  DataPeakEPOC.type,
  DataAerobicTrainingEffect.type,
  DataVO2Max.type,
  DataFeeling.type,
  DataRPE.type,
  ...PHYSIOLOGICAL_EXTRA_TYPE_STRINGS,
];
