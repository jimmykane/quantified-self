import { TrainingDeliveryContractError, type TrainingDeliveryStatus, type TrainingDeliveryStatusV1 } from '@shared/training-provider-delivery';
import type { TrainingWorkoutCompletionV1 } from '@shared/training-workout-completion';

export const TRAINING_DELIVERY_STATUS_LABELS: Record<TrainingDeliveryStatus, string> = {
  pending: 'Waiting to sync', delivered: 'Up to date', removed: 'Provider copy removed', stopped: 'Sync stopped',
  paused_plan: 'Plan inactive — withdrawing future copies', paused_pro: 'Paused — Pro required',
  provider_unavailable: 'Provider delivery is unavailable', reconnect_required: 'Reconnect the same provider account',
  connection_repair: 'Connection needs repair', fresh_consent_required: 'Send again to give fresh consent',
  outside_horizon: 'Scheduled for later', past: 'Past date · provider copy kept',
  completed: 'Completed on provider · provider copy kept', unsupported: 'This workout cannot be mapped',
  approval_required: 'Review workout differences', retrying: 'Retry scheduled',
  needs_attention: 'Delivery uncertain — inspect before retrying', failed: 'Delivery failed',
};

/** Completion belongs to the authored workout; the provider remains delivery/provenance context. */
export function trainingDeliveryStatusLabel(status: TrainingDeliveryStatusV1,
  completion?: Pick<TrainingWorkoutCompletionV1, 'workoutId' | 'provider'>): string {
  const confirmedCopy = status.hasRemoteCopy && !status.differsFromQS && status.lastAcceptedAtMs !== null;
  if (completion?.workoutId === status.workoutId && confirmedCopy) {
    return completion.provider === status.provider ? 'Completed · activity linked' : 'Sent · workout completed';
  }
  return TRAINING_DELIVERY_STATUS_LABELS[status.status];
}

/** Show the latest transport event, not an older success ahead of a newer failure. */
export function trainingDeliveryLatestEvent(status: Pick<TrainingDeliveryStatusV1, 'lastAcceptedAtMs' | 'lastAttemptAtMs' | 'updatedAtMs'>): {
  timestamp: number; timestampLabel: string;
} {
  if (status.lastAcceptedAtMs !== null && (status.lastAttemptAtMs === null || status.lastAcceptedAtMs >= status.lastAttemptAtMs)) {
    return { timestamp: status.lastAcceptedAtMs, timestampLabel: 'Last confirmed' };
  }
  if (status.lastAttemptAtMs !== null) return { timestamp: status.lastAttemptAtMs, timestampLabel: 'Last attempt' };
  return { timestamp: status.updatedAtMs, timestampLabel: 'Updated' };
}

/** A retained artifact is not proof that the full workout/calendar delivery finished. */
export function trainingDeliveryCopyMessage(status: TrainingDeliveryStatusV1): string | null {
  if (!status.differsFromQS) return null;
  if (status.status === 'paused_plan') return 'The plan is inactive. Eligible future copies are awaiting removal.';
  if (status.lastAcceptedAtMs === null) return 'A provider copy exists, but delivery is not fully confirmed yet.';
  return 'Your latest changes have not been confirmed by the provider.';
}

export function trainingDeliveryCommandError(error: unknown, saving: boolean): string {
  const code = (error as { code?: unknown } | null)?.code;
  const name = (error as { name?: unknown } | null)?.name;
  if (code === 'functions/aborted' || code === 'aborted') return 'The schedule or sync settings changed. Cancel and review the latest version.';
  if (code === 'functions/unauthenticated' || code === 'unauthenticated') return 'Your session expired. Sign in again to manage delivery.';
  if (code === 'functions/permission-denied' || code === 'permission-denied') return 'This account cannot make this delivery change. Check your access and Pro subscription.';
  if (saving) return 'Saving was not confirmed. Retry this confirmation safely with the same request, or close and check the delivery status.';
  if (code === 'functions/deadline-exceeded' || code === 'deadline-exceeded' || name === 'TimeoutError') {
    return 'The delivery check timed out. No sync settings were changed. Check your connection and try again.';
  }
  if (code === 'functions/invalid-argument' || code === 'invalid-argument' || error instanceof TrainingDeliveryContractError) {
    return 'Check the delivery time zone and review again using the latest schedule.';
  }
  return 'Unable to check delivery right now. No sync settings were changed. Check your connection and try again.';
}
