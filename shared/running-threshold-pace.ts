import { DataPace, DataPaceMinutesPerMile, convertPaceToPaceInMinutesPerMile, convertSpeedToPace } from '@sports-alliance/sports-lib';

export type RunningPaceUnit = 'km' | 'mi';

/** Explicit per-kilometre/per-mile input to canonical m/s, using Sports Lib's conversion. */
export function runningThresholdSpeed(paceSeconds: number, unit: RunningPaceUnit): number {
  return Number.isFinite(paceSeconds) && paceSeconds > 0
    ? 1000 * (unit === 'mi' ? convertPaceToPaceInMinutesPerMile(1) : 1) / paceSeconds : NaN;
}

export function parseRunningThresholdPace(text: string, unit: RunningPaceUnit): number | undefined {
  if (!text.trim()) return undefined;
  if (!/^\d{1,2}:[0-5]\d$/.test(text.trim())) return NaN;
  const [minutes, seconds] = text.trim().split(':').map(Number);
  return runningThresholdSpeed(minutes * 60 + seconds, unit);
}

/** Draft display only; callers retain the original canonical speed when text is unchanged. */
export function displayRunningThresholdPace(speed: number, unit: RunningPaceUnit): string {
  const pace = new DataPace(convertSpeedToPace(speed));
  return unit === 'mi' ? new DataPaceMinutesPerMile(Math.round(pace.getValue(DataPaceMinutesPerMile.type))).getDisplayValue()
    : new DataPace(Math.round(pace.getValue())).getDisplayValue();
}
