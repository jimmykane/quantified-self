export interface ParsedWahooWorkout {
  wahooUserID: string;
  workoutID: string;
  workoutToken?: string;
  planID?: string;
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

function exactPlanAssociation(workout: ExternalRecord): string | null {
  const values: unknown[] = [];
  if (workout.plan_id !== null && workout.plan_id !== undefined) values.push(workout.plan_id);
  if (workout.plan_ids !== null && workout.plan_ids !== undefined) {
    if (!Array.isArray(workout.plan_ids)) return null;
    values.push(...workout.plan_ids);
  }
  const identifiers = values.map(asIdentifier);
  if (identifiers.some(identifier => identifier === null)) return null;
  const unique = [...new Set(identifiers as string[])];
  return unique.length === 1 ? unique[0] : null;
}

function asISODate(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    return undefined;
  }
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
  const workoutToken = asIdentifier(workout.workout_token);
  const planID = exactPlanAssociation(workout);
  const workoutSummaryID = asIdentifier(summary.id);
  const summaryUpdatedAt = asISODate(summary.updated_at) || asISODate(summary.created_at);
  const starts = asISODate(workout.starts);
  const FITFileURI = typeof file.url === 'string' ? file.url.trim() : '';
  const manual = asOptionalBoolean(summary.manual);
  const edited = asOptionalBoolean(summary.edited);
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
    ...(workoutToken === null ? {} : { workoutToken }),
    ...(planID === null ? {} : { planID }),
    workoutSummaryID,
    summaryUpdatedAt,
    FITFileURI,
    starts,
    ...(manual === undefined ? {} : { manual }),
    ...(edited === undefined ? {} : { edited }),
    ...(fitnessAppID === undefined ? {} : { fitnessAppID }),
  };
}
