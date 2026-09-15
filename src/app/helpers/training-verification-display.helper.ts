import type { TrainingDeliveryStatusV1 } from '@shared/training-provider-delivery';
import type { TrainingVerificationV1 } from '@shared/training-provider-verification';
import { TRAINING_DELIVERY_STATUS_LABELS } from './training-delivery-display.helper';

export function trainingVerificationLabel(status: TrainingDeliveryStatusV1, verification?: TrainingVerificationV1): string {
  if (['removed', 'stopped', 'paused_plan', 'paused_pro', 'past', 'completed', 'fresh_consent_required',
    'reconnect_required', 'connection_repair', 'provider_unavailable'].includes(status.status)) return TRAINING_DELIVERY_STATUS_LABELS[status.status];
  if (verification?.state === 'restoring') return 'Restoring missing workout…';
  if (verification?.state === 'deferred') return verification.missing ? 'Restoration paused · will try later' : 'Check queued · waiting for provider capacity';
  if (verification?.state === 'checking') return 'Checking workout…';
  if (verification?.state === 'confirmed_missing') return 'Missing from provider';
  if (verification?.state === 'suspected_missing') return 'Workout not found · checking again';
  if (verification?.state === 'unknown') return 'Could not check workout';
  if (status.status !== 'delivered') return TRAINING_DELIVERY_STATUS_LABELS[status.status];
  if (!verification || verification.state === 'unsupported') return 'Sent · remote checking unavailable';
  if (verification.state === 'present') return 'Found in connected app';
  return 'Sent · awaiting remote check';
}
