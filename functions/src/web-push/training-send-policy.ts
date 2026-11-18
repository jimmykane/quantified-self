import { ServiceNames } from '@sports-alliance/sports-lib';
import { createHash } from 'node:crypto';
import type { PlannedWorkoutProviderId } from '../../../shared/planned-workout-providers';
import { PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1 } from '../../../shared/planned-workout-providers';
import { deliverySettingsId, type TrainingDeliveryScope } from '../../../shared/training-provider-delivery';
import { isAutomaticPushOrigin } from '../../../shared/web-push';

export const TRAINING_SEND = { lifetimeMs: 86400000, expiryMs: 600000, deviceLimit: 10, memberLimit: 400 } as const;
export const TRAINING_SEND_SERVICES = { garmin: ServiceNames.GarminAPI, suunto: ServiceNames.SuuntoApp,
  coros: ServiceNames.COROSAPI, wahoo: ServiceNames.WahooAPI } as const;
export const trainingSendId = (scope: TrainingDeliveryScope, scopeId: string, provider: PlannedWorkoutProviderId) =>
  `trainingSend_${deliverySettingsId(scope, scopeId, provider)}`;
export interface TrainingSendMember {
  workoutId: string; planId: string | null; updatedAt: number; contentDigest: string;
  result: 'waiting' | 'sent' | 'failed' | 'unchanged'; observedAt: number;
}
export interface TrainingSendState {
  schemaVersion: 1; expireAt?: Date; requestId: string; scope: TrainingDeliveryScope; scopeId: string; provider: PlannedWorkoutProviderId;
  planId: string | null; total: number; unchanged: number;
  settingsRevision: number; destinationKey: string; connectionEpoch: number; categoryRevision: number;
  createdAt: number; remaining: number; sent: number; failed: number;
  members: Record<string, TrainingSendMember>;
  targets: { id: string; generation: string; origin: string }[];
  dueAt?: number; readyAt?: number; finished?: boolean; claimId?: string;
}
export const trainingSendTerminal = (status: string): TrainingSendMember['result'] | 'cancelled' =>
  status === 'delivered' ? 'sent' : ['failed', 'needs_attention', 'reconnect_required', 'connection_repair',
    'unsupported', 'approval_required', 'provider_unavailable', 'paused_pro'].includes(status) ? 'failed'
    : ['pending', 'retrying'].includes(status) ? 'waiting' : 'cancelled';

export function trainingSendPayload(origin: string, state: Pick<TrainingSendState, 'scope' | 'scopeId' | 'provider' | 'requestId'>,
  sent: number, failed: number) {
  if (!isAutomaticPushOrigin(origin) || sent + failed < 1) throw new Error('Invalid Training send result.');
  const provider = PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[state.provider].label;
  const total = sent + failed;
  const path = state.scope === 'plan' ? `/training/plans/plan/${encodeURIComponent(state.scopeId)}?sync=attention`
    : '/training/plans?sync=attention';
  const body = failed === 0 ? `Your ${total} workout${total === 1 ? ' was' : 's were'} sent to ${provider}.`
    : sent > 0 ? `${sent} of ${total} workouts were sent to ${provider}. ${failed} need attention.`
      : `Your ${total === 1 ? 'workout' : 'workouts'} could not be sent to ${provider}. Review Training sync.`;
  return { web_push: 8030, notification: { title: 'Quantified Self', body,
    tag: `qs-training-send-${state.provider}-${createHash('sha256').update(state.requestId).digest('hex').slice(0, 24)}`,
    renotify: true, icon: `${origin}/assets/favicons/android-chrome-192x192.png`,
    navigate: origin + path, data: { onActionClick: { default: { operation: 'openWindow', url: path } } },
  } };
}
