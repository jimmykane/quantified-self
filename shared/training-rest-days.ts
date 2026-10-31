import { normalizeTrainingLocalDate } from './training-plans';

export const TRAINING_REST_DAYS_COLLECTION = 'trainingRestDays';
export const TRAINING_REST_DAYS_MAX_RANGE = 366;

/** Calendar intent, independent of plans, workouts and recorded activities. False retains a revision for safe retries. */
export interface TrainingRestDayV1 {
  schemaVersion: 1;
  localDate: string;
  isRestDay: boolean;
  revision: number;
}

export function parseTrainingRestDayV1(value: unknown, documentId?: string): TrainingRestDayV1 {
  const record = value as Partial<TrainingRestDayV1> | null;
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || Object.keys(record).some(key => !['schemaVersion', 'localDate', 'isRestDay', 'revision'].includes(key))
    || record.schemaVersion !== 1 || typeof record.isRestDay !== 'boolean'
    || !Number.isSafeInteger(record.revision) || record.revision! < 1) throw Error('Invalid calendar rest day.');
  const localDate = normalizeTrainingLocalDate(record.localDate);
  if (documentId !== undefined && localDate !== documentId) throw Error('Calendar rest-day identity changed.');
  return { schemaVersion: 1, localDate, isRestDay: record.isRestDay, revision: record.revision! };
}

export function validateTrainingRestDayRange(startDate: string, endDate: string): void {
  normalizeTrainingLocalDate(startDate); normalizeTrainingLocalDate(endDate);
  const days = (Date.parse(`${endDate}T00:00Z`) - Date.parse(`${startDate}T00:00Z`)) / 86_400_000 + 1;
  if (days < 1 || days > TRAINING_REST_DAYS_MAX_RANGE) throw Error('Choose at most 366 calendar dates.');
}
