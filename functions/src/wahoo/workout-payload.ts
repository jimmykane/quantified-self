export interface ParsedWahooWorkout {
  wahooUserID: string;
  workoutID: string;
  workoutSummaryID: string;
  summaryUpdatedAt: string;
  FITFileURI: string;
  starts: string;
  manual?: boolean;
  edited?: boolean;
  fitnessAppID?: number;
}

type ExternalRecord = Record<string, unknown>;

function asRecord(value: unknown): ExternalRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ExternalRecord : {};
}

function asIdentifier(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = `${value}`.trim();
  return normalized.length ? normalized : null;
}

function asISODate(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseWahooWorkout(
  wahooUserIDValue: unknown,
  workoutValue: unknown,
  summaryValue?: unknown,
): ParsedWahooWorkout | null {
  const workout = asRecord(workoutValue);
  const summary = Object.keys(asRecord(summaryValue)).length
    ? asRecord(summaryValue)
    : asRecord(workout.workout_summary);
  const file = asRecord(summary.file);
  const wahooUserID = asIdentifier(wahooUserIDValue);
  const workoutID = asIdentifier(workout.id);
  const workoutSummaryID = asIdentifier(summary.id);
  const summaryUpdatedAt = asISODate(summary.updated_at) || asISODate(summary.created_at);
  const starts = asISODate(workout.starts);
  const FITFileURI = typeof file.url === 'string' ? file.url.trim() : '';
  const fitnessAppID = asOptionalNumber(summary.fitness_app_id);

  if (!wahooUserID || !workoutID || !workoutSummaryID || !summaryUpdatedAt || !starts || !FITFileURI) {
    return null;
  }
  if (typeof fitnessAppID === 'number' && fitnessAppID > 1000) {
    return null;
  }
  return {
    wahooUserID,
    workoutID,
    workoutSummaryID,
    summaryUpdatedAt,
    FITFileURI,
    starts,
    manual: asOptionalBoolean(summary.manual),
    edited: asOptionalBoolean(summary.edited),
    fitnessAppID,
  };
}
