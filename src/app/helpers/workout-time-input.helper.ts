import { DataDuration } from '@sports-alliance/sports-lib';

/** Editable time parts, not a new canonical metric or persistence format. */
export interface WorkoutDurationParts {
  hours: number | null;
  minutes: number | null;
  seconds: number | null;
}

export function splitWorkoutEditorMinutes(value: number | null): WorkoutDurationParts {
  const total = value === null ? Number.NaN : value * 60;
  if (!Number.isFinite(total) || total < 0) return { hours: 0, minutes: 0, seconds: null };
  // Remove arithmetic noise at the input boundary; unchanged prescriptions keep their exact source value.
  const rounded = Number(total.toPrecision(12));
  return {
    hours: Math.floor(rounded / 3600),
    minutes: Math.floor((rounded % 3600) / 60),
    seconds: Number((rounded % 60).toPrecision(12)),
  };
}

export function workoutDurationPartsToSeconds(parts: WorkoutDurationParts): number {
  const { hours, minutes, seconds } = parts;
  if (hours === null || minutes === null || seconds === null
    || !Number.isSafeInteger(hours) || hours < 0
    || !Number.isInteger(minutes) || minutes < 0 || minutes >= 60
    || !Number.isFinite(seconds) || seconds < 0 || seconds >= 60) return Number.NaN;
  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) && total > 0 ? total : Number.NaN;
}

export function workoutDurationPartsToMinutes(parts: WorkoutDurationParts): number {
  return workoutDurationPartsToSeconds(parts) / 60;
}

/** Pace input is already expressed in the editor's selected distance denominator. */
export function formatWorkoutEditorPace(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return '';
  const duration = new DataDuration(value * 60);
  const display = duration.getStopwatchDisplayValue(3).replace(/\.([0-9]*?)0+$/, '.$1').replace(/\.$/, '');
  return value * 60 < 0.0005 ? String(value) : display;
}

/** Accept m:ss (or h:mm:ss), with decimal minutes retained for existing users. */
export function parseWorkoutEditorPace(text: string): number | null {
  const value = text.trim().replace(',', '.');
  if (!value) return null;
  let seconds: number;
  if (/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
    seconds = Number(value) * 60;
  } else {
    const match = /^(?:(\d+):)?(\d+):([0-5]?\d(?:\.\d+)?)$/.exec(value);
    if (!match || (match[1] !== undefined && Number(match[2]) >= 60)) return Number.NaN;
    seconds = Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }
  return Number.isFinite(seconds) && seconds > 0 ? seconds / 60 : Number.NaN;
}
