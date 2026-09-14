import { isPlannedWorkoutProviderDeliveryEnabled, type PlannedWorkoutProviderId } from './planned-workout-providers';

// Separate from presentation-only Training UI access. An empty list disables the
// evaluation pilot; public provider readiness remains independently controlled.
const GARMIN_TRAINING_DELIVERY_PILOT_UIDS: readonly string[] = ['xcsAolLDDTWTgtRN9eYF3lW2YKL2'];

/** Backend callers must pass authenticated or server-owned job identity, never request data. */
export function isTrainingProviderDeliveryEnabled(provider: PlannedWorkoutProviderId, uid: string | null | undefined): boolean {
  if (!uid) return false;
  return isPlannedWorkoutProviderDeliveryEnabled(provider)
    || (provider === 'garmin' && GARMIN_TRAINING_DELIVERY_PILOT_UIDS.includes(uid));
}
