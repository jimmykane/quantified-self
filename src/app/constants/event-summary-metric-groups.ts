import {
  DataStore,
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

const POWER_LIB_EXTRA_TYPE_STRINGS: string[] = [
  DataStore.DataPowerNormalized.type,
  DataStore.DataPowerIntensityFactor.type,
  DataStore.DataPowerTrainingStressScore.type,
  DataStore.DataFTP.type,
  DataStore.DataPowerWork.type,
  DataStore.DataPowerWattsPerKg.type,
  DataStore.DataCriticalPower.type,
  DataStore.DataWPrime.type,
  DataStore.DataFormPower.type,
  DataStore.DataPowerPodUsed.type,
  DataStore.DataAirPowerAvg.type,
  DataStore.DataAirPowerMax.type,
  DataStore.DataAirPowerMin.type,
  DataStore.DataPowerPedalSmoothnessLeft.type,
  DataStore.DataPowerPedalSmoothnessRight.type,
  DataStore.DataPowerTorqueEffectivenessLeft.type,
  DataStore.DataPowerTorqueEffectivenessRight.type,
  DataStore.DataTargetPowerZone.type,
];

const ALTITUDE_LIB_EXTRA_TYPE_STRINGS: string[] = [
  DataStore.DataAscentTime.type,
  DataStore.DataDescentTime.type,
];

const PHYSIOLOGICAL_EXTRA_TYPE_STRINGS: string[] = [
  DataStore.DataAvgRespirationRate.type,
  DataStore.DataMinRespirationRate.type,
  DataStore.DataMaxRespirationRate.type,
  DataStore.DataWeight.type,
  DataStore.DataHeight.type,
  DataStore.DataGender.type,
  DataStore.DataFitnessAge.type,
  DataStore.DataAge.type,
];

const PERFORMANCE_EXTRA_TYPE_STRINGS: string[] = [
  DataStore.DataEffortPace.type,
  DataStore.DataAvgVAM.type,
  DataStore.DataEPOC.type,
  DataStore.DataJumpCount.type,
  DataStore.DataFlow.type,
  DataStore.DataAvgFlow.type,
  DataStore.DataTotalFlow.type,
  DataStore.DataGrit.type,
  DataStore.DataAvgGrit.type,
  DataStore.DataTotalGrit.type,
];

export const EVENT_SUMMARY_GRADE_ADJUSTED_SPEED_TYPES: string[] = [
  DataGradeAdjustedSpeedAvg.type,
  DataStore.DataGradeAdjustedSpeedMin.type,
  DataStore.DataGradeAdjustedSpeedMax.type,
];

export const EVENT_SUMMARY_GRADE_ADJUSTED_PACE_TYPES: string[] = [
  DataGradeAdjustedPaceAvg.type,
  DataStore.DataGradeAdjustedPaceMin.type,
  DataStore.DataGradeAdjustedPaceMax.type,
];

const PERFORMANCE_RUN_DYNAMICS_TYPE_STRINGS: string[] = [
  DataStore.DataGroundContactTimeAvg.type,
  DataStore.DataGroundContactTimeMin.type,
  DataStore.DataGroundContactTimeMax.type,
  DataStore.DataStanceTime.type,
  DataStore.DataStanceTimeBalanceLeft.type,
  DataStore.DataStanceTimeBalanceRight.type,
  DataStore.DataGroundContactTimeBalanceLeft.type,
  DataStore.DataGroundContactTimeBalanceRight.type,
  DataStore.DataVerticalOscillation.type,
  DataStore.DataVerticalRatio.type,
  DataStore.DataVerticalRatioAvg.type,
  DataStore.DataVerticalRatioMin.type,
  DataStore.DataVerticalRatioMax.type,
  DataStore.DataLegStiffness.type,
  DataStore.DataLegStiffnessAvg.type,
  DataStore.DataLegStiffnessMin.type,
  DataStore.DataLegStiffnessMax.type,
];

const DEVICE_EXTRA_TYPE_STRINGS: string[] = [
  DataStore.DataBatteryCharge.type,
  DataStore.DataBatteryConsumption.type,
  DataStore.DataBatteryCurrent.type,
  DataStore.DataBatteryVoltage.type,
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
  DataStore.DataGrade.type,
  DataStore.DataGradeAvg.type,
  DataStore.DataGradeMin.type,
  DataStore.DataGradeMax.type,
];

const ENVIRONMENT_DISTANCE_TYPE_STRINGS: string[] = [
  DataStore.DataStrydDistance.type,
  DataStore.DataGNSSDistance.type,
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
      DataVO2Max.type,
      DataPeakEPOC.type,
      DataAerobicTrainingEffect.type,
      DataStore.DataAnaerobicTrainingEffect.type,
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
  DataStore.DataAnaerobicTrainingEffect.type,
  DataVO2Max.type,
  DataFeeling.type,
  DataRPE.type,
  ...PHYSIOLOGICAL_EXTRA_TYPE_STRINGS,
];
