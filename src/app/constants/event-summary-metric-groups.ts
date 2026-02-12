import {
  DataAccumulatedPower,
  DataAbsolutePressure,
  DataAbsolutePressureAvg,
  DataAbsolutePressureMax,
  DataAbsolutePressureMin,
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
  DataEHPE,
  DataEHPEAvg,
  DataEHPEMax,
  DataEHPEMin,
  DataEVPE,
  DataEVPEAvg,
  DataEVPEMax,
  DataEVPEMin,
  DataMovingTime,
  DataNumberOfSatellites,
  DataNumberOfSatellitesAvg,
  DataNumberOfSatellitesMax,
  DataNumberOfSatellitesMin,
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
  DataSatellite5BestSNR,
  DataSatellite5BestSNRAvg,
  DataSatellite5BestSNRMax,
  DataSatellite5BestSNRMin,
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
  'FTP',
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
  'Avg Respiration Rate',
  'Min Respiration Rate',
  'Max Respiration Rate',
  'Weight',
  'Height',
  'Gender',
  'Fitness Age',
  // Backward-compatible fallback if older payloads still emit plain Age.
  'Age',
];

const PERFORMANCE_EXTRA_TYPE_STRINGS: string[] = [
  'Effort Pace',
  'Avg VAM',
  'EPOC',
  'Jump Count',
  'Flow',
  'Avg Flow',
  'Total Flow',
  'Grit',
  'Avg Grit',
  'Total Grit',
];

export const EVENT_SUMMARY_GRADE_ADJUSTED_SPEED_TYPES: string[] = [
  DataGradeAdjustedSpeedAvg.type,
  'Minimum Grade Adjusted Speed',
  'Maximum Grade Adjusted Speed',
];

export const EVENT_SUMMARY_GRADE_ADJUSTED_PACE_TYPES: string[] = [
  DataGradeAdjustedPaceAvg.type,
  'Minimum Grade Adjusted Pace',
  'Maximum Grade Adjusted Pace',
];

const PERFORMANCE_RUN_DYNAMICS_TYPE_STRINGS: string[] = [
  'Average Ground Contact Time',
  'Minimum Ground Contact Time',
  'Maximum Ground Contact Time',
  'Stance Time',
  'Stance Time Balance Left',
  'Stance Time Balance Right',
  'Ground Contact Time Balance Left',
  'Ground Contact Time Balance Right',
  'Vertical Oscillation',
  'Vertical Ratio',
  'Average Vertical Ratio',
  'Minimum Vertical Ratio',
  'Maximum Vertical Ratio',
  'Leg Stiffness',
  'Average Leg Stiffness',
  'Minimum Leg Stiffness',
  'Maximum Leg Stiffness',
];

const DEVICE_EXTRA_TYPE_STRINGS: string[] = [
  'Battery Charge',
  'Battery Consumption',
  'Battery Current',
  'Battery Voltage',
];

const DEVICE_SIGNAL_EXTRA_TYPE_STRINGS: string[] = [
  DataEVPE.type,
  DataEVPEAvg.type,
  DataEVPEMin.type,
  DataEVPEMax.type,
  DataEHPE.type,
  DataEHPEAvg.type,
  DataEHPEMin.type,
  DataEHPEMax.type,
  DataSatellite5BestSNR.type,
  DataSatellite5BestSNRAvg.type,
  DataSatellite5BestSNRMin.type,
  DataSatellite5BestSNRMax.type,
  DataNumberOfSatellites.type,
  DataNumberOfSatellitesAvg.type,
  DataNumberOfSatellitesMin.type,
  DataNumberOfSatellitesMax.type,
];

const ENVIRONMENT_ABSOLUTE_PRESSURE_TYPE_STRINGS: string[] = [
  DataAbsolutePressure.type,
  DataAbsolutePressureAvg.type,
  DataAbsolutePressureMin.type,
  DataAbsolutePressureMax.type,
];

const ENVIRONMENT_GRADE_TYPE_STRINGS: string[] = [
  'Grade',
  'Average Grade',
  'Minimum Grade',
  'Maximum Grade',
];

const ENVIRONMENT_DISTANCE_TYPE_STRINGS: string[] = [
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
      ...EVENT_SUMMARY_GRADE_ADJUSTED_PACE_TYPES,
      ...EVENT_SUMMARY_GRADE_ADJUSTED_SPEED_TYPES,
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
      DataHeartRateAvg.type,
      DataHeartRateMax.type,
      DataHeartRateMin.type,
      ...PERFORMANCE_EXTRA_TYPE_STRINGS,
      ...PERFORMANCE_RUN_DYNAMICS_TYPE_STRINGS,
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
      ...ENVIRONMENT_ABSOLUTE_PRESSURE_TYPE_STRINGS,
      ...ENVIRONMENT_GRADE_TYPE_STRINGS,
      ...ENVIRONMENT_DISTANCE_TYPE_STRINGS,
    ],
  },
  {
    id: 'device',
    label: 'Device',
    metricTypes: [
      ...DEVICE_EXTRA_TYPE_STRINGS,
      ...DEVICE_SIGNAL_EXTRA_TYPE_STRINGS,
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
      'Anaerobic Training Effect',
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
  ...EVENT_SUMMARY_GRADE_ADJUSTED_SPEED_TYPES,
  ...EVENT_SUMMARY_GRADE_ADJUSTED_PACE_TYPES,
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
  ...PERFORMANCE_RUN_DYNAMICS_TYPE_STRINGS,
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
  ...ENVIRONMENT_ABSOLUTE_PRESSURE_TYPE_STRINGS,
  ...ENVIRONMENT_GRADE_TYPE_STRINGS,
  ...ENVIRONMENT_DISTANCE_TYPE_STRINGS,
  ...DEVICE_EXTRA_TYPE_STRINGS,
  ...DEVICE_SIGNAL_EXTRA_TYPE_STRINGS,
  DataHeartRateAvg.type,
  DataHeartRateMax.type,
  DataHeartRateMin.type,
  DataRecoveryTime.type,
  DataPeakEPOC.type,
  DataAerobicTrainingEffect.type,
  'Anaerobic Training Effect',
  DataVO2Max.type,
  DataFeeling.type,
  DataRPE.type,
  ...PHYSIOLOGICAL_EXTRA_TYPE_STRINGS,
];
