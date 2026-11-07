import { DataFTP, DataPower, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { parseWorkoutPowerReferenceV1, type WorkoutPowerReferenceV1 } from '@shared/workout-power-settings';
import { resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';
import { getDateTimeFormatter } from './date-time-format.helper';
export const POWER_PROVIDER_LABELS = { garmin: 'Garmin', suunto: 'Suunto', coros: 'COROS', wahoo: 'Wahoo', other: 'Other' } as const;
export function workoutPowerSummary(value: WorkoutPowerReferenceV1, units?: UserUnitSettingsInterface | null, timeZone?: string): string {
  const p = parseWorkoutPowerReferenceV1(value);
  if ('kind' in p) {
    const ftp = resolveUnitAwareDisplayFromValue(DataFTP.type, p.reference.watts, units)?.text ?? '';
    if (p.kind === 'imported-ftp') {
      const source = p.source?.split(/[-_\s]+/u).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
      const date = getDateTimeFormatter(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone }).format(p.lastSeenAtMs);
      return `${p.sport} · Imported FTP ${ftp} · ${source || 'Imported workout data'} · Last seen ${date}`;
    }
    return `${p.sport} · Shared ${p.family === 'running' ? 'Running' : 'Cycling'} FTP ${ftp} · Effective since ${new Date(p.effectiveAtMs).toISOString()}`;
  }
  const power = resolveUnitAwareDisplayFromValue(DataPower.type, p.reference.watts, units)?.text ?? '';
  return `${p.sport} · ${POWER_PROVIDER_LABELS[p.provider]} · ${p.source} · ${p.reference.kind === 'critical-power' ? 'Critical power' : 'FTP'} ${power} · Reference date ${p.referenceDate}`;
}
export function workoutPowerZones(value: WorkoutPowerReferenceV1, units?: UserUnitSettingsInterface | null): string[] {
  const p = parseWorkoutPowerReferenceV1(value);
  if ('kind' in p || !p.zoneUpperBoundsWatts.length) return [];
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
