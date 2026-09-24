import { ActivityTypes, DataWeight, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { resolveUnitAwareDisplayStat } from './unit-aware-display';
import { parseWorkoutStructureV1, type WorkoutStructureV1, type WorkoutStepV1 } from './planned-workout';

export const STRENGTH_WORKOUT_VERSION = 1 as const;
export const STRENGTH_DETAILS_COLLECTION_ID = 'strengthDetails';
export const STRENGTH_DETAILS_DOCUMENT_ID = 'current';

export type StrengthSetV1 = {
  id: string;
  ending: { kind: 'repetitions'; repetitions: number } | { kind: 'time'; seconds: number };
  externalLoadKg?: number;
  restAfterSeconds?: number;
};

export interface StrengthExerciseV1 {
  id: string;
  name: string;
  sets: StrengthSetV1[];
}

/** Owner-scoped companion, deliberately separate from old-client ScheduledWorkoutV1. */
export interface StrengthWorkoutDetailsV1 {
  version: typeof STRENGTH_WORKOUT_VERSION;
  workoutId: string;
  revision: number;
  exercises: StrengthExerciseV1[];
}

export interface StrengthWorkoutDraftV1 {
  version: typeof STRENGTH_WORKOUT_VERSION;
  exercises: StrengthExerciseV1[];
}

export class StrengthWorkoutValidationError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'StrengthWorkoutValidationError';
  }
}

function record(value: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new StrengthWorkoutValidationError(path, 'Expected an object.');
  }
  const result = value as Record<string, unknown>;
  const unknown = Object.keys(result).find(key => !allowed.includes(key));
  if (unknown) throw new StrengthWorkoutValidationError(`${path}.${unknown}`, 'Unknown field.');
  return result;
}

function id(value: unknown, path: string, maximum = 64): string {
  if (typeof value !== 'string' || !new RegExp(`^[A-Za-z0-9][A-Za-z0-9_-]{0,${maximum - 1}}$`).test(value)) {
    throw new StrengthWorkoutValidationError(path, `Expected a safe ID of at most ${maximum} characters.`);
  }
  return value;
}

function integer(value: unknown, path: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new StrengthWorkoutValidationError(path, `Expected an integer from 1 to ${maximum}.`);
  }
  return value as number;
}

function nonnegativeFinite(value: unknown, path: string, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new StrengthWorkoutValidationError(path, `Expected a finite value from 0 to ${maximum}.`);
  }
  return value;
}

export function parseStrengthWorkoutDetailsV1(value: unknown): StrengthWorkoutDetailsV1 {
  const root = record(value, '$', ['version', 'workoutId', 'revision', 'exercises']);
  if (root.version !== STRENGTH_WORKOUT_VERSION) {
    throw new StrengthWorkoutValidationError('$.version', 'Unsupported strength prescription version.');
  }
  if (!Array.isArray(root.exercises) || root.exercises.length < 1 || root.exercises.length > 50) {
    throw new StrengthWorkoutValidationError('$.exercises', 'Expected 1 to 50 ordered exercises.');
  }
  const seen = new Set<string>();
  let projectedNodeCount = 0;
  const exercises = root.exercises.map((value, exerciseIndex): StrengthExerciseV1 => {
    const path = `$.exercises[${exerciseIndex}]`;
    const exercise = record(value, path, ['id', 'name', 'sets']);
    const exerciseId = id(exercise.id, `${path}.id`);
    if (seen.has(exerciseId)) throw new StrengthWorkoutValidationError(`${path}.id`, 'Duplicate ID.');
    seen.add(exerciseId);
    if (typeof exercise.name !== 'string' || !exercise.name.trim() || exercise.name.trim().length > 80) {
      throw new StrengthWorkoutValidationError(`${path}.name`, 'Expected 1 to 80 characters.');
    }
    if (!Array.isArray(exercise.sets) || exercise.sets.length < 1 || exercise.sets.length > 50) {
      throw new StrengthWorkoutValidationError(`${path}.sets`, 'Expected 1 to 50 ordered sets.');
    }
    const sets = exercise.sets.map((value, setIndex): StrengthSetV1 => {
      const setPath = `${path}.sets[${setIndex}]`;
      const set = record(value, setPath, ['id', 'ending', 'externalLoadKg', 'restAfterSeconds']);
      const setId = id(set.id, `${setPath}.id`);
      if (seen.has(setId)) throw new StrengthWorkoutValidationError(`${setPath}.id`, 'Duplicate ID.');
      seen.add(setId);
      const ending = record(set.ending, `${setPath}.ending`, ['kind', 'repetitions', 'seconds']);
      let parsedEnding: StrengthSetV1['ending'];
      if (ending.kind === 'repetitions') {
        if (ending.seconds !== undefined) throw new StrengthWorkoutValidationError(`${setPath}.ending.seconds`, 'Not valid for repetitions.');
        parsedEnding = { kind: 'repetitions', repetitions: integer(ending.repetitions, `${setPath}.ending.repetitions`, 1000) };
      } else if (ending.kind === 'time') {
        if (ending.repetitions !== undefined) throw new StrengthWorkoutValidationError(`${setPath}.ending.repetitions`, 'Not valid for a timed hold.');
        parsedEnding = { kind: 'time', seconds: integer(ending.seconds, `${setPath}.ending.seconds`, 86400) };
      } else {
        throw new StrengthWorkoutValidationError(`${setPath}.ending.kind`, 'Expected repetitions or time.');
      }
      const externalLoadKg = set.externalLoadKg === undefined ? undefined
        : nonnegativeFinite(set.externalLoadKg, `${setPath}.externalLoadKg`, 1000);
      const restAfterSeconds = set.restAfterSeconds === undefined ? undefined
        : integer(set.restAfterSeconds, `${setPath}.restAfterSeconds`, 86400);
      projectedNodeCount += restAfterSeconds === undefined ? 1 : 2;
      if (projectedNodeCount > 100) {
        throw new StrengthWorkoutValidationError('$.exercises', 'The V1 projection cannot exceed 100 nodes.');
      }
      return { id: setId, ending: parsedEnding,
        ...(externalLoadKg === undefined ? {} : { externalLoadKg }),
        ...(restAfterSeconds === undefined ? {} : { restAfterSeconds }) };
    });
    return { id: exerciseId, name: exercise.name.trim(), sets };
  });
  return {
    version: STRENGTH_WORKOUT_VERSION,
    workoutId: id(root.workoutId, '$.workoutId', 128),
    revision: integer(root.revision, '$.revision', Number.MAX_SAFE_INTEGER),
    exercises,
  };
}

export function parseStrengthWorkoutDraftV1(value: unknown): StrengthWorkoutDraftV1 {
  const draft = record(value, '$', ['version', 'exercises']);
  const parsed = parseStrengthWorkoutDetailsV1({ ...draft, workoutId: 'draft', revision: 1 });
  return { version: parsed.version, exercises: parsed.exercises };
}

/** Compatibility-only summary. Never use it as the complete strength prescription. */
export function projectStrengthWorkoutToV1(detailsValue: unknown): WorkoutStructureV1 {
  const details = parseStrengthWorkoutDetailsV1(detailsValue);
  const nodes: WorkoutStepV1[] = [];
  details.exercises.forEach(exercise => exercise.sets.forEach((set, index) => {
    nodes.push({ kind: 'step', id: `set-${set.id}`, purpose: 'work',
      ending: set.ending, targets: [], note: `${exercise.name} · set ${index + 1}` });
    if (set.restAfterSeconds !== undefined) {
      nodes.push({ kind: 'step', id: `rest-${set.id}`, purpose: 'rest',
        ending: { kind: 'time', seconds: set.restAfterSeconds }, targets: [], note: `Rest after ${exercise.name}` });
    }
  }));
  return parseWorkoutStructureV1({ version: 1, sport: ActivityTypes.StrengthTraining, nodes });
}

export function strengthProjectionMatchesDetails(structure: WorkoutStructureV1, details: StrengthWorkoutDetailsV1): boolean {
  return JSON.stringify(parseWorkoutStructureV1(structure)) === JSON.stringify(projectStrengthWorkoutToV1(details));
}

export function formatStrengthLoadKg(kg: number, settings?: UserUnitSettingsInterface | null): string {
  nonnegativeFinite(kg, '$.externalLoadKg', 1000);
  const data = new DataWeight(kg);
  return resolveUnitAwareDisplayStat(data, settings)?.text || `${data.getDisplayValue()} ${data.getDisplayUnit()}`;
}
