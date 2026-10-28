import { isPlannedWorkoutProviderDeliveryEnabled, type PlannedWorkoutProviderId } from './planned-workout-providers';

/** Backend callers must pass authenticated or server-owned job identity, never request data. */
export function isTrainingProviderDeliveryEnabled(provider: PlannedWorkoutProviderId, uid: string | null | undefined): boolean {
  return !!uid && isPlannedWorkoutProviderDeliveryEnabled(provider);
}
