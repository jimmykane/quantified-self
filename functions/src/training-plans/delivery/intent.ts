import { createHash } from 'node:crypto';
import { trainingDeliveryLocalDate } from '../../../../shared/training-provider-delivery';
import type { PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import { hashTrainingScheduleRequestPayload } from '../persistence';
import type { DeliveryContext, DeliveryIntent, DeliveryLedgerV1 } from './contracts';
import type { ScheduledWorkoutV1 } from '../../../../shared/training-plans';
import type { StrengthWorkoutDetailsV1 } from '../../../../shared/strength-workout';

export function deliveryIdentity(uid: string, provider: PlannedWorkoutProviderId, account: string, workoutId: string): string {
  return createHash('sha256').update(JSON.stringify([uid, provider, account, workoutId])).digest('hex');
}
export function deliveryContentDigest(workout: ScheduledWorkoutV1 | null, timeZone: string,
  strength?: StrengthWorkoutDetailsV1 | null): string | null {
  return workout ? hashTrainingScheduleRequestPayload({ title: workout.title, localDate: workout.localDate,
    structure: workout.structure, ...(strength ? { strength: strength.exercises } : {}), timeZone }) : null;
}
export function resolveDeliveryIntent(context: DeliveryContext, ledger?: DeliveryLedgerV1): DeliveryIntent {
  const { workout, connection, transport, nowMs } = context;
  const setting = context.setting;
  const override = context.override?.scopeGeneration === context.scopeGeneration
    && context.override.associationPlanId === (workout?.planId ?? null) ? context.override : null;
  const timeZone = setting?.timeZone ?? ledger?.timeZone ?? 'UTC';
  const result = (desired: DeliveryIntent['desired'], status: DeliveryIntent['status'],
    digest = '', issues: string[] = [], approvalDigest: string | null = null): DeliveryIntent => ({
    desired, status, timeZone, digest: digest || hashTrainingScheduleRequestPayload({ desired, status, timeZone,
      ...(context.pastCleanup ? { pastCleanupMutationId: context.pastCleanup.mutationId } : {}) }), issues, approvalDigest,
  });
  const today = trainingDeliveryLocalDate(nowMs, timeZone);
  const retained = [ledger?.actual, ledger?.repair?.original].filter(artifact => !!artifact);
  if (retained.some(artifact => artifact.completed)) return result('preserve', 'completed');
  const past = retained.some(artifact => artifact.localDate < (artifact.timeZone
    ? trainingDeliveryLocalDate(nowMs, artifact.timeZone) : today)) || (workout && workout.localDate < today);
  const validConsent = setting?.enabled && (setting.scope === 'plan'
    || (setting.scopeGeneration === context.scopeGeneration && setting.associationPlanId === (workout?.planId ?? null)));
  const stopped = override?.suppressed || !validConsent || !workout || workout.lifecycle !== 'planned';
  const noLongerActive = !!workout?.planId && !context.planActive;
  const cleanupPast = !!context.pastCleanup && (stopped || noLongerActive);
  if (past && !cleanupPast) return result('preserve', 'past');
  if (past && cleanupPast && transport && retained.some(artifact => !transport.canRemove(artifact, today, true))) {
    return result('preserve', 'past', '', ledger?.provider === 'coros'
      ? ['COROS permits removal only for unexecuted workouts dated today or later.']
      : ['This past provider copy cannot be safely removed.']);
  }
  // Explicit disconnect ends consent, but must NOT withdraw provider copies.
  if (setting && setting.connectionEpoch !== connection.epoch) return result('preserve', 'fresh_consent_required');
  if (!setting && ledger && ledger.connectionEpoch !== connection.epoch) return result('preserve', 'fresh_consent_required');
  if (connection.state !== 'connected') return result('preserve', connection.state, '', connection.issues ?? []);
  if (ledger?.blockedConnectionGeneration === connection.generation) return result('preserve', ledger.status, '', ledger.issues);
  if (ledger && ledger.destinationKey !== connection.destinationKey) return result('preserve', 'fresh_consent_required');
  if (setting && setting.destinationKey !== connection.destinationKey) return result('preserve', 'fresh_consent_required');
  if (stopped || noLongerActive) {
    if (transport && retained.some(artifact => !transport.canRemove(artifact, today, cleanupPast))) return result('preserve', 'needs_attention');
    return result('absent', workout?.planId && !context.planActive && !stopped ? 'paused_plan' : 'stopped');
  }
  if (!context.hasPro) return result('preserve', 'paused_pro');
  if (!transport) return result('preserve', 'provider_unavailable');
  const days = (Date.parse(`${workout!.localDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  if (days > transport.horizonDays) return result(transport.withdrawOutsideHorizon ? 'absent' : 'preserve', 'outside_horizon');
  const assessment = transport.assess(workout!, connection.destinationKey, timeZone, context.strength);
  if (assessment.level === 'unsupported') return result('preserve', 'unsupported', assessment.digest, assessment.issues);
  const approval = override?.approvedDigest ?? setting?.approvedDigest;
  if (assessment.level === 'degraded' && approval !== assessment.digest) {
    return result('preserve', 'approval_required', assessment.digest, assessment.issues, assessment.digest);
  }
  return result('present', ledger?.acceptedDigest === assessment.digest ? 'delivered' : 'pending', assessment.digest, assessment.issues);
}
