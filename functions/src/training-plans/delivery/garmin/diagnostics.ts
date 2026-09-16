import * as logger from 'firebase-functions/logger';
import { TrainingDeliveryTransportError } from '../contracts';
import type { GarminTrainingRequest, GarminTrainingResponse } from './http';

function shape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
function context(request: GarminTrainingRequest) {
  return {
    method: ['GET', 'POST', 'PUT', 'DELETE'].includes(request.method) ? request.method : 'unknown',
    resource: request.path.startsWith('/training-api/schedule?') ? 'schedule-list'
      : request.path.startsWith('/training-api/schedule/') ? 'schedule'
        : request.path.startsWith('/training-api/workout/v2/') || request.path === '/workoutportal/workout/v2' ? 'workout' : 'unknown',
  };
}

/** Shapes of fixed fields only: no values, arbitrary field names, URLs, IDs, dates or workout content. */
export function logGarminTrainingResponse(request: GarminTrainingRequest, response: GarminTrainingResponse): void {
  const body = response.body && typeof response.body === 'object' && !Array.isArray(response.body)
    ? response.body as Record<string, unknown> : null;
  logger.info('[TrainingDelivery]', { event: 'garmin_response', provider: 'garmin', ...context(request),
    ...(Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? { httpStatus: response.status } : {}),
    responseShape: shape(response.body),
    ...(body ? { workoutIdShape: shape(body.workoutId), scheduleIdShape: shape(body.scheduleId),
      ownerIdShape: shape(body.ownerId), dateShape: shape(body.date) } : {}),
  });
}

export function logGarminTrainingRequestFailure(request: GarminTrainingRequest, error: unknown): void {
  const failure = error instanceof TrainingDeliveryTransportError ? error : null;
  logger.warn('[TrainingDelivery]', { event: 'garmin_request_incomplete', provider: 'garmin', ...context(request),
    category: failure?.kind ?? 'unknown', ...failure?.diagnostics });
}

export function garminContractFailure(reason: 'expected_object' | 'invalid_schedule' | 'invalid_workout_identity'
  | 'workout_identity_mismatch' | 'schedule_identity_mismatch' | 'empty_lookup'): TrainingDeliveryTransportError {
  logger.warn('[TrainingDelivery]', { event: 'garmin_contract_failure', provider: 'garmin', reason });
  return new TrainingDeliveryTransportError('uncertain', 0, { failurePhase: 'contract' });
}

export function logGarminScheduleLookup(outcome: 'invalid_response' | 'too_many_results' | 'no_match' | 'multiple_matches' | 'matched'): void {
  logger.info('[TrainingDelivery]', { event: 'garmin_schedule_lookup', provider: 'garmin', outcome });
}
