export { buildTrainingDeliverySummaries, trainingDeliverySummaryIdentity } from '@shared/training-delivery-summary';
export type { TrainingDeliverySummary, TrainingPlanSyncFocus } from '@shared/training-delivery-summary';

import { trainingDeliverySummaryIdentity, type TrainingDeliverySummary } from '@shared/training-delivery-summary';
import type { ScheduledWorkoutV1 } from '@shared/training-plans';
import type { TrainingDeliveryView } from '../services/training-delivery.service';

/** UI-only: an accepted send is not a fresh Garmin cloud confirmation. */
export async function withGarminWorkoutCheck(summary: TrainingDeliverySummary, uid: string,
  workout: ScheduledWorkoutV1 | undefined, view: TrainingDeliveryView): Promise<TrainingDeliverySummary> {
  if (summary.provider !== 'garmin' || summary.label !== 'Synced' || !workout) return summary;
  const scope = workout.planId ? 'plan' : 'workout';
  const scopeId = workout.planId ?? workout.id;
  const setting = view.settings.find(item => item.provider === 'garmin' && item.scope === scope && item.scopeId === scopeId);
  if (!setting) return summary;
  const id = await trainingDeliverySummaryIdentity(uid, 'garmin', setting.destinationKey, workout.id);
  const status = view.statuses.find(item => item.id === id && item.provider === 'garmin' && item.workoutId === workout.id
    && item.planId === workout.planId && item.status === 'delivered' && item.hasRemoteCopy && !item.differsFromQS);
  const verification = view.verifications?.find(item => item.id === id && item.provider === 'garmin' && item.workoutId === workout.id
    && item.planId === workout.planId);
  if (!status || !verification || status.lastAcceptedAtMs === null || verification.lastCheckedAtMs === null
    || verification.lastCheckedAtMs < status.lastAcceptedAtMs) return summary;
  if (verification.state === 'present') return { ...summary, label: 'Cloud copy confirmed', icon: 'check_circle',
    detail: 'Workout and calendar entry confirmed in Garmin cloud; watch receipt is not verified' };
  if (verification.state === 'unknown') return { ...summary, label: 'Cloud check inconclusive', icon: 'help_outline',
    detail: 'Last send was accepted, but the latest check could not confirm both Garmin records; no automatic workout replacement' };
  return summary;
}
