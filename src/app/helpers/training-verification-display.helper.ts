import type { TrainingDeliveryStatusV1 } from '@shared/training-provider-delivery';
import type { TrainingVerificationV1 } from '@shared/training-provider-verification';
import type { TrainingWorkoutCompletionV1 } from '@shared/training-workout-completion';
import { TRAINING_DELIVERY_STATUS_LABELS, trainingDeliveryCommandError, trainingDeliveryStatusLabel } from './training-delivery-display.helper';

const SUUNTO_DELIVERY_STATUS_LABELS: Partial<Record<TrainingDeliveryStatusV1['status'], string>> = {
  pending: 'Waiting to send', removed: 'No active Suunto Guide delivery', stopped: 'Sending stopped',
  paused_plan: 'Plan inactive — withdrawing future Guides', provider_unavailable: 'Suunto workout delivery is unavailable',
  needs_attention: 'Send could not be confirmed — inspect before retrying', failed: 'Send failed',
  completed: 'Completed workout · sent Guide retained',
};

export function trainingVerificationCommandError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  return code === 'aborted' || code === 'functions/aborted'
    ? 'The schedule or sync settings changed. Check again using the latest version.'
    : trainingDeliveryCommandError(error, false);
}

export function trainingVerificationLabel(status: TrainingDeliveryStatusV1, verification?: TrainingVerificationV1,
  completion?: Pick<TrainingWorkoutCompletionV1, 'workoutId' | 'provider'>): string {
  const suunto = status.provider === 'suunto';
  if (status.status === 'approval_required') {
    if (status.hasRemoteCopy || status.lastAcceptedAtMs != null) return 'Update needs review';
    // An interrupted attempt may have been accepted before QS could save the ID.
    return status.lastAttemptAtMs == null ? 'Not sent · Needs review' : 'Needs review';
  }
  if (['fresh_consent_required', 'reconnect_required', 'connection_repair', 'failed', 'needs_attention', 'unsupported']
    .includes(status.status)) return suunto
      ? SUUNTO_DELIVERY_STATUS_LABELS[status.status] ?? TRAINING_DELIVERY_STATUS_LABELS[status.status]
      : TRAINING_DELIVERY_STATUS_LABELS[status.status];
  if (suunto) {
    if (completion && status.hasRemoteCopy && !status.differsFromQS && status.lastAcceptedAtMs !== null) {
      return trainingDeliveryStatusLabel(status, completion);
    }
    if (['removed', 'stopped', 'paused_plan', 'paused_pro', 'past', 'completed', 'provider_unavailable', 'outside_horizon']
      .includes(status.status)) return SUUNTO_DELIVERY_STATUS_LABELS[status.status] ?? TRAINING_DELIVERY_STATUS_LABELS[status.status];
    return status.status === 'delivered'
      ? 'Sent to Suunto · app and watch visibility cannot be checked'
      : SUUNTO_DELIVERY_STATUS_LABELS[status.status] ?? TRAINING_DELIVERY_STATUS_LABELS[status.status];
  }
  // A live check can disprove an older acceptance. Never let the authored completion hide
  // missing/uncertain provider evidence while an otherwise active copy is being inspected.
  if (completion && !['past', 'completed'].includes(status.status)) {
    if (verification?.state === 'restoring') return 'Restoring missing workout…';
    if (verification?.state === 'deferred') return verification.missing
      ? 'Restoration paused · will try later' : 'Check queued · will try again later';
    if (verification?.state === 'checking') return 'Checking workout…';
    if (verification?.state === 'confirmed_missing') return 'Missing from connected app';
    if (verification?.state === 'suspected_missing') return 'Workout not found · checking again';
    if (verification?.state === 'unknown') return 'Could not check workout';
  }
  if (completion && status.hasRemoteCopy && !status.differsFromQS && status.lastAcceptedAtMs !== null) {
    return trainingDeliveryStatusLabel(status, completion);
  }
  if (['removed', 'stopped', 'paused_plan', 'paused_pro', 'past', 'completed', 'provider_unavailable', 'outside_horizon']
    .includes(status.status)) return TRAINING_DELIVERY_STATUS_LABELS[status.status];
  if (verification?.state === 'restoring') return 'Restoring missing workout…';
  if (verification?.state === 'deferred') return verification.missing ? 'Restoration paused · will try later' : 'Check queued · will try again later';
  if (verification?.state === 'checking') return 'Checking workout…';
  if (verification?.state === 'confirmed_missing') return 'Missing from connected app';
  if (verification?.state === 'suspected_missing') return 'Workout not found · checking again';
  if (verification?.state === 'unknown') return 'Could not check workout';
  if (status.status !== 'delivered') return TRAINING_DELIVERY_STATUS_LABELS[status.status];
  if (!verification || verification.state === 'unsupported') return 'Sent · automatic checking unavailable';
  if (verification.state === 'present') return 'Found in connected app';
  return 'Sent · awaiting remote check';
}
