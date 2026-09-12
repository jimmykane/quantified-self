import type { TrainingDeliveryStatus } from '@shared/training-provider-delivery';

export const TRAINING_DELIVERY_STATUS_LABELS: Record<TrainingDeliveryStatus, string> = {
  pending: 'Waiting to sync', delivered: 'Up to date', removed: 'Provider copy removed', stopped: 'Sync stopped',
  paused_plan: 'Plan inactive — withdrawing future copies', paused_pro: 'Paused — Pro required',
  provider_unavailable: 'Provider delivery is unavailable', reconnect_required: 'Reconnect the same provider account',
  connection_repair: 'Connection needs repair', fresh_consent_required: 'Send again to give fresh consent',
  outside_horizon: 'Waiting for the provider scheduling window', past: 'Past workout — left unchanged',
  completed: 'Completed on provider — left unchanged', unsupported: 'This workout cannot be mapped',
  approval_required: 'Review workout differences', retrying: 'Retry scheduled',
  needs_attention: 'Delivery uncertain — inspect before retrying', failed: 'Delivery failed',
};
