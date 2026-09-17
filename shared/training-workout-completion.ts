import { PLANNED_WORKOUT_PROVIDER_IDS, type PlannedWorkoutProviderId } from './planned-workout-providers';

export const TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID = 'trainingWorkoutCompletions';
export const TRAINING_ACTIVITY_COMPLETION_LINKS_COLLECTION_ID = 'trainingActivityCompletionLinks';

export const TRAINING_WORKOUT_COMPLETION_TIMINGS = ['on_date', 'early', 'late', 'unknown'] as const;
export type TrainingWorkoutCompletionTiming = typeof TRAINING_WORKOUT_COMPLETION_TIMINGS[number];

export interface TrainingWorkoutCompletionV1 {
  schemaVersion: 1;
  workoutId: string;
  planId: string | null;
  provider: PlannedWorkoutProviderId;
  matchMethod: 'provider_marker' | 'manual_confirmation';
  eventId: string;
  activityId: string | null;
  sourceSessionIndex: number | null;
  activityStartAtMs: number | null;
  scheduledLocalDate: string;
  workoutRevisionAtLink: number;
  timing: TrainingWorkoutCompletionTiming;
  linkedAtMs: number;
  updatedAtMs: number;
}

export class TrainingWorkoutCompletionContractError extends Error {}

const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const FIRESTORE_ID = /^[^/]{1,1500}$/u;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isTrainingLocalDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = LOCAL_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseTrainingWorkoutCompletionV1(value: unknown): TrainingWorkoutCompletionV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TrainingWorkoutCompletionContractError('Invalid workout completion.');
  }
  const record = value as TrainingWorkoutCompletionV1;
  const keys = ['schemaVersion', 'workoutId', 'planId', 'provider', 'matchMethod', 'eventId', 'activityId',
    'sourceSessionIndex', 'activityStartAtMs', 'scheduledLocalDate', 'workoutRevisionAtLink', 'timing',
    'linkedAtMs', 'updatedAtMs'];
  const nullableFirestoreId = (candidate: unknown): candidate is string | null => candidate === null
    || (typeof candidate === 'string' && FIRESTORE_ID.test(candidate));
  const nullableSafeInteger = (candidate: unknown): candidate is number | null => candidate === null
    || (Number.isSafeInteger(candidate) && (candidate as number) >= 0);
  if (record.schemaVersion !== 1 || Object.keys(record).some(key => !keys.includes(key))
    || typeof record.workoutId !== 'string' || !ENTITY_ID.test(record.workoutId)
    || !(record.planId === null || (typeof record.planId === 'string' && ENTITY_ID.test(record.planId)))
    || !PLANNED_WORKOUT_PROVIDER_IDS.includes(record.provider)
    || !['provider_marker', 'manual_confirmation'].includes(record.matchMethod)
    || typeof record.eventId !== 'string' || !FIRESTORE_ID.test(record.eventId)
    || !nullableFirestoreId(record.activityId)
    || !nullableSafeInteger(record.sourceSessionIndex)
    || !nullableSafeInteger(record.activityStartAtMs)
    || !isTrainingLocalDate(record.scheduledLocalDate)
    || !Number.isSafeInteger(record.workoutRevisionAtLink) || record.workoutRevisionAtLink < 1
    || !TRAINING_WORKOUT_COMPLETION_TIMINGS.includes(record.timing)
    || !Number.isSafeInteger(record.linkedAtMs) || record.linkedAtMs < 0
    || !Number.isSafeInteger(record.updatedAtMs) || record.updatedAtMs < record.linkedAtMs) {
    throw new TrainingWorkoutCompletionContractError('Invalid workout completion.');
  }
  return { ...record };
}
