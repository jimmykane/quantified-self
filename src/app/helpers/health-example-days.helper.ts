import type { HealthMetricId } from '@shared/health';

// An authored fictional month: ordinary days, a weekend away, a busy evening, and quieter days.
// Values and dates are invented. Never copy account records, identities, or exports into these fixtures.
const STEPS = [6240, 7580, 4910, 8630, 7100, 12480, 16320, 3780, 6890, 9320,
  5740, 8060, 11890, 14620, 4270, 6820, 9570, 7380, 5160, 13240,
  10870, 5940, 3420, 6670, 8210, 4580, 9720, 2860, 3190, 7140];
const WEIGHT = [73.8, null, null, 73.7, null, null, 73.9, null, 73.6, null,
  null, 73.6, null, 73.5, null, null, 73.7, null, null, 73.6,
  null, null, 73.5, null, 73.4, null, null, 73.5, null, 73.4];
const HRV = [45, 43, 47, 49, 46, 42, 40, 44, 48, 51,
  47, 46, 44, 41, 45, 48, 50, 46, 43, 38,
  34, 32, 37, 42, 44, 36, 40, 30, 33, 38];
const RESTING_HR = [61, 62, 60, 59, 60, 62, 63, 61, 59, 58,
  60, 61, 60, 63, 61, 59, 58, 60, 62, 64,
  66, 65, 63, 61, 60, 64, 62, 68, 67, 64];
const VO2 = [null, null, 52.2, null, null, null, null, null, null, null,
  null, 52, null, null, null, null, null, null, null, null,
  52.1, null, null, null, null, null, null, null, null, 52.1];

// Asleep, deep, REM, awake minutes; score; wake-up minute of day. Light sleep is the remainder.
const NIGHTS: readonly (readonly [number, number, number, number, number, number])[] = [
  [465, 72, 96, 18, 79, 430], [438, 58, 87, 24, 75, 415],
  [502, 81, 108, 14, 84, 425], [488, 68, 103, 21, 82, 420],
  [451, 64, 91, 27, 77, 405], [416, 53, 79, 32, 72, 450],
  [543, 89, 116, 19, 87, 525], [481, 76, 98, 16, 81, 420],
  [497, 83, 104, 12, 85, 410], [516, 79, 112, 23, 86, 435],
  [462, 65, 94, 31, 78, 415], [479, 74, 101, 20, 81, 420],
  [430, 61, 85, 29, 74, 460], [558, 92, 121, 17, 89, 510],
  [473, 70, 97, 22, 80, 425], [505, 86, 109, 15, 85, 420],
  [491, 77, 102, 13, 83, 410], [447, 62, 88, 28, 76, 415],
  [424, 56, 82, 35, 71, 405], [372, 48, 67, 42, 65, 470],
  [335, 39, 58, 51, 61, 485], [402, 51, 73, 38, 68, 455],
  [468, 66, 92, 25, 77, 425], [499, 82, 106, 18, 83, 415],
  [482, 75, 99, 21, 81, 420], [355, 43, 63, 47, 63, 400],
  [458, 63, 93, 26, 76, 420], [452, 54, 86, 44, 67, 475],
  [508, 78, 110, 33, 74, 505], [520, 84, 114, 24, 80, 445],
];

/** Stable, independent variation for the older baseline and less prominent sample metrics. */
function noise(day: number, salt: number): number {
  let hash = Math.imul(day + 1009, 374761393) ^ Math.imul(salt + 17, 668265263);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295 * 2 - 1;
}
function settledNoise(day: number, salt: number): number {
  return noise(day, salt) * 0.5 + noise(day + 1, salt) * 0.3 + noise(day + 2, salt) * 0.2;
}
function rounded(value: number, digits = 0): number { return Number(value.toFixed(digits)); }

export function healthExampleDay(daysBeforeEnd: number) {
  const offset = Math.max(0, Math.round(daysBeforeEnd));
  const index = 29 - offset;
  const night = NIGHTS[index] ?? [
    rounded(480 + settledNoise(offset, 7) * 100), rounded(72 + noise(offset, 8) * 26),
    rounded(98 + noise(offset, 9) * 25), rounded(24 + noise(offset, 10) * 16),
    rounded(79 + settledNoise(offset, 11) * 12), rounded(425 + noise(offset, 12) * 35),
  ];
  const [sleepMinutes, deepMinutes, remMinutes, awakeMinutes, sleepScore, wakeMinutes] = night;
  const hrvMs = HRV[index] ?? rounded(45 + settledNoise(offset, 3) * 11);
  const restingHeartRateBpm = RESTING_HR[index] ?? rounded(61 + settledNoise(offset, 4) * 5);
  return {
    steps: STEPS[index] ?? rounded(7400 + noise(offset, 1) * 4700),
    weightKg: index >= 0 ? WEIGHT[index] : offset % 3 === 0 ? rounded(74 + settledNoise(offset, 2) * 0.2, 1) : null,
    vo2Max: index >= 0 ? VO2[index] : offset % 6 === 0 ? 51.8 : null,
    hrvMs, restingHeartRateBpm, sleepMinutes, deepMinutes, remMinutes, awakeMinutes, sleepScore, wakeMinutes,
    sleepHeartRateBpm: restingHeartRateBpm - 3 + rounded(noise(offset, 5)),
  };
}

/** Canonical illustrative readings. Null means no observation, never a fabricated zero. */
export function healthExampleValue(metric: HealthMetricId, offset: number): number | string | null {
  const day = healthExampleDay(offset);
  const variation = settledNoise(offset, metric.length + metric.charCodeAt(0));
  const activeMinutes = rounded(18 + day.steps / 190 + noise(offset, 20) * 12);
  const vigorousMinutes = day.steps > 9000 ? rounded(20 + noise(offset, 21) * 12) : 0;
  const activeEnergy = rounded(activeMinutes * 7 + vigorousMinutes * 4);
  const basalEnergy = rounded(1680 + noise(offset, 22) * 16);
  switch (metric) {
    case 'steps': return day.steps;
    case 'heart_rate_variability': return day.hrvMs;
    case 'resting_heart_rate': return day.restingHeartRateBpm;
    case 'body_weight': return day.weightKg;
    case 'vo2_max': return day.vo2Max;
    case 'fitness_age': return day.vo2Max === null ? null : 34;
    case 'sleep_duration': return day.sleepMinutes * 60;
    case 'sleep_score': return day.sleepScore;
    case 'distance': return rounded(day.steps * 0.73);
    case 'floors_climbed': return Math.max(1, rounded(day.steps / 950 + noise(offset, 23) * 4));
    case 'active_duration': return activeMinutes * 60;
    case 'moderate_intensity_duration': return (activeMinutes - vigorousMinutes) * 60;
    case 'vigorous_intensity_duration': return vigorousMinutes * 60;
    case 'active_energy': return activeEnergy;
    case 'basal_energy': return basalEnergy;
    case 'total_energy': return activeEnergy + basalEnergy;
    case 'heart_rate': return rounded(day.restingHeartRateBpm + 10 + noise(offset, 24) * 4);
    case 'blood_oxygen_saturation': return rounded(97 + variation);
    case 'respiration_rate': return rounded(14.5 + variation * 0.6, 1);
    case 'stress_level': return rounded(34 + variation * 17);
    case 'stress_state': return noise(offset, 25) < -0.3 ? 'relaxing' : noise(offset, 25) > 0.5 ? 'stressful' : 'active';
    case 'stress_duration': return rounded(70 + variation * 35) * 60;
    case 'body_energy': return rounded(67 + variation * 22);
    case 'body_energy_change': return rounded(noise(offset, 26) * 22);
    case 'recovery_score': return day.sleepScore + rounded(variation * 4);
    case 'body_mass_index': return day.weightKg === null ? null : rounded(day.weightKg / 1.78 ** 2, 1);
    case 'body_fat': return day.weightKg === null ? null : rounded(19.5 + variation * 0.3, 1);
    case 'body_water': return day.weightKg === null ? null : rounded(58.2 + variation * 0.4, 1);
    case 'muscle_mass': return day.weightKg === null ? null : rounded(54.5 + variation * 0.2, 1);
    case 'bone_mass': return day.weightKg === null ? null : 3.1;
    case 'blood_pressure_systolic': return offset % 3 === 0 ? rounded(118 + variation * 6) : null;
    case 'blood_pressure_diastolic': return offset % 3 === 0 ? rounded(76 + noise(offset, 27) * 4) : null;
    case 'pulse_rate': return offset % 3 === 0 ? day.restingHeartRateBpm + 4 : null;
    case 'skin_temperature_deviation': return rounded(variation * 0.3, 2);
    case 'wheelchair_pushes': return rounded(2200 + noise(offset, 28) * 1200);
    case 'wheelchair_push_distance': return rounded(3100 + noise(offset, 28) * 1500);
    case 'altitude': return rounded(140 + variation * 18);
  }
}
