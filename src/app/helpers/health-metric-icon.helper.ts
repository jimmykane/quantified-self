import { HEALTH_METRIC_IDS, HealthMetricId } from '@shared/health';

export type HealthMetricIconTarget = HealthMetricId | 'sleep';

const HEALTH_METRIC_ICONS: Readonly<Record<HealthMetricIconTarget, string>> = Object.freeze({
  sleep: 'bedtime',
  [HEALTH_METRIC_IDS.Steps]: 'directions_walk',
  [HEALTH_METRIC_IDS.WheelchairPushes]: 'accessible',
  [HEALTH_METRIC_IDS.Distance]: 'route',
  [HEALTH_METRIC_IDS.WheelchairPushDistance]: 'accessible',
  [HEALTH_METRIC_IDS.FloorsClimbed]: 'stairs',
  [HEALTH_METRIC_IDS.ActiveDuration]: 'timer',
  [HEALTH_METRIC_IDS.ModerateIntensityDuration]: 'timer',
  [HEALTH_METRIC_IDS.VigorousIntensityDuration]: 'timer',
  [HEALTH_METRIC_IDS.Altitude]: 'landscape',
  [HEALTH_METRIC_IDS.ActiveEnergy]: 'local_fire_department',
  [HEALTH_METRIC_IDS.BasalEnergy]: 'local_fire_department',
  [HEALTH_METRIC_IDS.TotalEnergy]: 'local_fire_department',
  [HEALTH_METRIC_IDS.HeartRate]: 'favorite',
  [HEALTH_METRIC_IDS.RestingHeartRate]: 'favorite_border',
  [HEALTH_METRIC_IDS.HeartRateVariability]: 'ecg_heart',
  [HEALTH_METRIC_IDS.BloodOxygenSaturation]: 'water_drop',
  [HEALTH_METRIC_IDS.RespirationRate]: 'air',
  [HEALTH_METRIC_IDS.StressLevel]: 'bolt',
  [HEALTH_METRIC_IDS.StressState]: 'bolt',
  [HEALTH_METRIC_IDS.StressDuration]: 'timer',
  [HEALTH_METRIC_IDS.BodyEnergy]: 'battery_full',
  [HEALTH_METRIC_IDS.BodyEnergyChange]: 'battery_charging_full',
  [HEALTH_METRIC_IDS.RecoveryScore]: 'battery_charging_full',
  [HEALTH_METRIC_IDS.BodyWeight]: 'monitor_weight',
  [HEALTH_METRIC_IDS.BodyMassIndex]: 'monitor_weight',
  [HEALTH_METRIC_IDS.BodyFat]: 'percent',
  [HEALTH_METRIC_IDS.BodyWater]: 'water_drop',
  [HEALTH_METRIC_IDS.MuscleMass]: 'fitness_center',
  [HEALTH_METRIC_IDS.BoneMass]: 'accessibility_new',
  [HEALTH_METRIC_IDS.BloodPressureSystolic]: 'bloodtype',
  [HEALTH_METRIC_IDS.BloodPressureDiastolic]: 'bloodtype',
  [HEALTH_METRIC_IDS.PulseRate]: 'favorite',
  [HEALTH_METRIC_IDS.SkinTemperatureDeviation]: 'device_thermostat',
  [HEALTH_METRIC_IDS.Vo2Max]: 'directions_run',
  [HEALTH_METRIC_IDS.FitnessAge]: 'cake',
  [HEALTH_METRIC_IDS.SleepDuration]: 'bedtime',
  [HEALTH_METRIC_IDS.SleepScore]: 'bedtime',
});

/** Shared Material icon vocabulary for Health catalog, priority, and detail surfaces. */
export function healthMetricIcon(metric: HealthMetricIconTarget): string {
  return HEALTH_METRIC_ICONS[metric];
}
