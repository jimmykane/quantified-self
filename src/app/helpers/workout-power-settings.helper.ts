import { DataPower, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { parseWorkoutPowerProfileV1, type WorkoutPowerProfileV1 } from '@shared/workout-power-settings';
import { resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';
export const POWER_PROVIDER_LABELS = { garmin: 'Garmin', suunto: 'Suunto', coros: 'COROS', wahoo: 'Wahoo', other: 'Other' } as const;
export function workoutPowerSummary(value: WorkoutPowerProfileV1, units?: UserUnitSettingsInterface | null): string {
  const p = parseWorkoutPowerProfileV1(value);
  const power = resolveUnitAwareDisplayFromValue(DataPower.type, p.reference.watts, units)?.text ?? '';
  return `${p.sport} · ${POWER_PROVIDER_LABELS[p.provider]} · ${p.source} · ${p.reference.kind === 'critical-power' ? 'Critical power' : 'FTP'} ${power} · Reference date ${p.referenceDate}`;
}
export function workoutPowerZones(value: WorkoutPowerProfileV1, units?: UserUnitSettingsInterface | null): string[] {
  const p = parseWorkoutPowerProfileV1(value);
  if (!p.zoneUpperBoundsWatts.length) return [];
  const power = (watts: number) => resolveUnitAwareDisplayFromValue(DataPower.type, watts, units)?.text ?? '';
  return [...p.zoneUpperBoundsWatts, null].map((upper, i) =>
    `Z${i + 1}: ${power(i ? p.zoneUpperBoundsWatts[i - 1] : 0)}${upper === null ? ' and above' : ` to below ${power(upper)}`}`);
}
export function parsePowerZoneInput(value: string): number[] {
  if (!value.trim()) return [];
  const tokens = value.split(',').map(token => token.trim());
  if (tokens.some(token => !/^\d+(?:\.\d+)?$/.test(token))) throw Error('Enter zone upper bounds as comma-separated numbers.');
  return tokens.map(Number);
}
