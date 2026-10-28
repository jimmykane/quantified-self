import { PLANNED_WORKOUT_PROVIDER_IDS, type PlannedWorkoutProviderId } from './planned-workout-providers';
import { TrainingDeliveryContractError } from './training-provider-delivery';

/** Separate projection: delivery status v1 remains an exact, unchanged public contract. */
export const TRAINING_DELIVERY_VERIFICATIONS = 'trainingDeliveryVerifications';
export type TrainingVerificationState = 'pending' | 'checking' | 'present' | 'suspected_missing'
  | 'confirmed_missing' | 'restoring' | 'deferred' | 'unknown' | 'unsupported';
export interface TrainingVerificationV1 {
  schemaVersion: 1;
  id: string;
  workoutId: string;
  planId: string | null;
  provider: PlannedWorkoutProviderId;
  state: TrainingVerificationState;
  canCheck: boolean;
  missing: boolean;
  lastCheckedAtMs: number | null;
  nextCheckAtMs: number | null;
  updatedAtMs: number;
}
export interface TrainingVerificationReceiptV1 {
  schemaVersion: 1;
  action: 'check';
  result: 'queued' | 'coalesced' | 'deferred';
  requestedAtMs: number;
  notBeforeMs: number;
}
export function parseTrainingVerificationV1(value: unknown): TrainingVerificationV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TrainingDeliveryContractError('Invalid verification.');
  const row = value as TrainingVerificationV1;
  const keys = ['schemaVersion', 'id', 'workoutId', 'planId', 'provider', 'state', 'canCheck', 'missing',
    'lastCheckedAtMs', 'nextCheckAtMs', 'updatedAtMs'];
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))
    || row.schemaVersion !== 1 || typeof row.id !== 'string' || !/^[a-f0-9]{64}$/.test(row.id)
    || typeof row.workoutId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(row.workoutId)
    || !(row.planId === null || typeof row.planId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(row.planId))
    || !PLANNED_WORKOUT_PROVIDER_IDS.includes(row.provider)
    || !['pending', 'checking', 'present', 'suspected_missing', 'confirmed_missing', 'restoring', 'deferred', 'unknown', 'unsupported'].includes(row.state)
    || typeof row.canCheck !== 'boolean' || typeof row.missing !== 'boolean'
    || [row.lastCheckedAtMs, row.nextCheckAtMs].some(time => time !== null && (!Number.isSafeInteger(time) || time < 0))
    || !Number.isSafeInteger(row.updatedAtMs) || row.updatedAtMs < 0) throw new TrainingDeliveryContractError('Invalid verification.');
  return { ...row };
}
