import { createHash } from 'node:crypto';
import { trainingDeliveryLocalDate } from '../../../../shared/training-provider-delivery';
import type { PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import { hashTrainingScheduleRequestPayload } from '../persistence';
import type { DeliveryContext, DeliveryIntent, DeliveryLedgerV1 } from './contracts';
import type { ScheduledWorkoutV1 } from '../../../../shared/training-plans';

export function deliveryIdentity(uid: string, provider: PlannedWorkoutProviderId, account: string, workoutId: string): string {
  return createHash('sha256').update(JSON.stringify([uid, provider, account, workoutId])).digest('hex');
}
export function deliveryContentDigest(workout: ScheduledWorkoutV1 | null, timeZone: string): string | null {
  return workout ? hashTrainingScheduleRequestPayload({ title: workout.title, localDate: workout.localDate, structure: workout.structure, timeZone }) : null;
}
export function resolveDeliveryIntent(context: DeliveryContext, ledger?: DeliveryLedgerV1): DeliveryIntent {
  const { workout, connection, transport, nowMs } = context;
  const setting = context.setting;
  const override = context.override?.scopeGeneration === context.scopeGeneration
    && context.override.associationPlanId === (workout?.planId ?? null) ? context.override : null;
  const timeZone = setting?.timeZone ?? ledger?.timeZone ?? 'UTC';
  const result = (desired: DeliveryIntent['desired'], status: DeliveryIntent['status'],
    digest = '', issues: string[] = [], approvalDigest: string | null = null): DeliveryIntent => ({
    desired, status, timeZone, digest: digest || hashTrainingScheduleRequestPayload({ desired, status, timeZone }), issues, approvalDigest,
  });
  const today = trainingDeliveryLocalDate(nowMs, timeZone);
  if (ledger?.actual?.completed) return result('preserve', 'completed');
  if ((ledger?.actual && ledger.actual.localDate < today) || (workout && workout.localDate < today)) return result('preserve', 'past');
  // Explicit disconnect ends consent, but must NOT withdraw provider copies.
  if (setting && setting.connectionEpoch !== connection.epoch) return result('preserve', 'fresh_consent_required');
  if (!setting && ledger && ledger.connectionEpoch !== connection.epoch) return result('preserve', 'fresh_consent_required');
  if (connection.state !== 'connected') return result('preserve', connection.state);
  if (ledger?.blockedConnectionGeneration === connection.generation) return result('preserve', ledger.status);
  if (ledger && ledger.destinationKey !== connection.destinationKey) return result('preserve', 'fresh_consent_required');
  if (setting && setting.destinationKey !== connection.destinationKey) return result('preserve', 'fresh_consent_required');
  const validConsent = setting?.enabled && (setting.scope === 'plan'
    || (setting.scopeGeneration === context.scopeGeneration && setting.associationPlanId === (workout?.planId ?? null)));
  const stopped = override?.suppressed || !validConsent || !workout || workout.lifecycle !== 'planned';
  if (stopped || (workout?.planId && !context.planActive)) {
    if (ledger?.actual && transport && !transport.canRemove(ledger.actual, today)) return result('preserve', 'needs_attention');
    return result('absent', workout?.planId && !context.planActive && !stopped ? 'paused_plan' : 'stopped');
  }
  if (!context.hasPro) return result('preserve', 'paused_pro');
  if (!transport) return result('preserve', 'provider_unavailable');
  const days = (Date.parse(`${workout!.localDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  if (days > transport.horizonDays) return result('preserve', 'outside_horizon');
  const assessment = transport.assess(workout!, connection.destinationKey, timeZone);
  if (assessment.level === 'unsupported') return result('preserve', 'unsupported', assessment.digest, assessment.issues);
  const approval = override?.approvedDigest ?? setting?.approvedDigest;
  if (assessment.level === 'degraded' && approval !== assessment.digest) {
    return result('preserve', 'approval_required', assessment.digest, assessment.issues, assessment.digest);
  }
  return result('present', ledger?.acceptedDigest === assessment.digest ? 'delivered' : 'pending', assessment.digest, assessment.issues);
}
