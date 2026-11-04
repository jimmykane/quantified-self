import { PLANNED_WORKOUT_PROVIDER_IDS, type PlannedWorkoutProviderId } from './planned-workout-providers';
import { normalizeDeliveryTimeZone, TrainingDeliveryContractError } from './training-provider-delivery';
import { parseMutateTrainingScheduleRequestV1, type MutateTrainingScheduleRequestV1,
  type MutateTrainingScheduleResponseV1 } from './training-plans';

/** First-party save envelope only; never an authored workout field or an MCP proposal option. */
export interface CreatedWorkoutDeliveryRequestV1 {
  providers: PlannedWorkoutProviderId[];
  timeZone: string;
}
export interface CreatedWorkoutDeliveryOutcomeV1 {
  provider: PlannedWorkoutProviderId;
  state: 'queued' | 'review-required' | 'failed';
}
export interface TrainingScheduleSaveResponseV1 extends MutateTrainingScheduleResponseV1 {
  deliveryOutcomes?: CreatedWorkoutDeliveryOutcomeV1[];
}
export type TrainingScheduleSaveRequestV1 = MutateTrainingScheduleRequestV1 & {
  deliveryAfterCreate?: CreatedWorkoutDeliveryRequestV1;
  /** First-party replacement guard; regular editing and MCP contracts remain unchanged. */
  requireUncompletedWorkout?: true;
};

export function parseTrainingScheduleSaveRequestV1(value: unknown): {
  request: MutateTrainingScheduleRequestV1; deliveryAfterCreate?: CreatedWorkoutDeliveryRequestV1; requireUncompletedWorkout?: true;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    // Preserve the ordinary schedule parser's error contract.
    return { request: parseMutateTrainingScheduleRequestV1(value) };
  }
  const { deliveryAfterCreate, requireUncompletedWorkout, ...schedule } = value as Record<string, unknown>;
  const request = parseMutateTrainingScheduleRequestV1(schedule);
  if (requireUncompletedWorkout !== undefined) {
    if (requireUncompletedWorkout !== true || request.operation.kind !== 'update-workout' || deliveryAfterCreate !== undefined) {
      throw new TrainingDeliveryContractError('The replacement guard requires a workout update without new delivery approval.');
    }
    return { request, requireUncompletedWorkout: true };
  }
  if (deliveryAfterCreate === undefined) return { request };
  if (request.operation.kind !== 'create-workout' || request.operation.planId !== null
    || !deliveryAfterCreate || typeof deliveryAfterCreate !== 'object' || Array.isArray(deliveryAfterCreate)) {
    throw new TrainingDeliveryContractError('Delivery with Add requires a new Standalone workout.');
  }
  const input = deliveryAfterCreate as Record<string, unknown>, providers = input.providers;
  if (Object.keys(input).some(key => !['providers', 'timeZone'].includes(key))
    || !Array.isArray(providers) || providers.length < 1 || providers.length > PLANNED_WORKOUT_PROVIDER_IDS.length
    || new Set(providers).size !== providers.length || providers.some(provider => !PLANNED_WORKOUT_PROVIDER_IDS.includes(provider))) {
    throw new TrainingDeliveryContractError('Choose one or more explicit supported delivery services.');
  }
  return { request, deliveryAfterCreate: {
    providers: PLANNED_WORKOUT_PROVIDER_IDS.filter(provider => providers.includes(provider)),
    timeZone: normalizeDeliveryTimeZone(input.timeZone),
  } };
}
