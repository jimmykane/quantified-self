import { ServiceNames } from '@sports-alliance/sports-lib';
import { PLANNED_WORKOUT_PROVIDER_IDS, type PlannedWorkoutProviderId } from '@shared/planned-workout-providers';
import { buildProviderPresentation, type ProviderPresentation } from '@shared/provider-presentation';
import type { ScheduledWorkoutV1, TrainingPlanV1 } from '@shared/training-plans';
import type { TrainingDeliveryScope, TrainingDeliverySettingsV1, TrainingDeliveryStatusV1 } from '@shared/training-provider-delivery';

export interface TrainingDeliverySummary {
  provider: PlannedWorkoutProviderId;
  presentation: ProviderPresentation;
  label: string;
  detail: string;
  icon: string;
}

const SERVICES: Record<PlannedWorkoutProviderId, ServiceNames> = {
  garmin: ServiceNames.GarminAPI, coros: ServiceNames.COROSAPI, wahoo: ServiceNames.WahooAPI, suunto: ServiceNames.SuuntoApp,
};
const ATTENTION = new Set(['failed', 'needs_attention', 'approval_required', 'unsupported', 'reconnect_required',
  'connection_repair', 'fresh_consent_required']);

/** Same JSON framing as the server's deliveryIdentity. Display matching only, never authority. */
export async function trainingDeliverySummaryIdentity(uid: string, provider: PlannedWorkoutProviderId,
  destinationKey: string, workoutId: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([uid, provider, destinationKey, workoutId])));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

type Outcome = { label: string; synced: boolean; attention: boolean; copy: boolean };

function workoutOutcome(workout: ScheduledWorkoutV1, status: TrainingDeliveryStatusV1 | undefined,
  setting: TrainingDeliverySettingsV1 | undefined, plan: TrainingPlanV1 | null): Outcome {
  const outcome = (label: string, synced = false, attention = false): Outcome => ({ label, synced, attention, copy: !!status?.hasRemoteCopy });
  // Independent live listeners may deliver authored data before the worker's new projection.
  if (status && (status.planId !== workout.planId || status.updatedAtMs < Math.max(workout.updatedAtMs, setting?.updatedAtMs ?? 0))) {
    return outcome('Awaiting latest check');
  }
  if (status && ATTENTION.has(status.status)) {
    const labels: Partial<Record<TrainingDeliveryStatusV1['status'], string>> = {
      unsupported: 'Not supported', approval_required: 'Needs approval', failed: 'Sync failed',
      needs_attention: 'Delivery unconfirmed', reconnect_required: 'Reconnect required',
      connection_repair: 'Check connection', fresh_consent_required: 'Needs sync setup',
    };
    return outcome(labels[status.status]!, false, true);
  }
  if (status?.status === 'past' || status?.status === 'completed') {
    const confirmed = status.hasRemoteCopy && !status.differsFromQS && status.lastAcceptedAtMs !== null;
    const skipped = workout.lifecycle === 'skipped';
    return outcome((skipped ? 'Skipped · ' : '') + (status.status === 'completed' ? 'Completed · left unchanged' : 'Past · left unchanged'), confirmed && !skipped);
  }
  if (workout.lifecycle === 'skipped') return outcome(status?.hasRemoteCopy ? 'Skipped · copy remains' : 'Skipped');
  if (plan && plan.lifecycle !== 'active') return outcome(status?.hasRemoteCopy ? 'Plan inactive · copy remains' : 'Plan inactive');
  if (setting && !setting.enabled) return outcome(status?.hasRemoteCopy ? 'Sync off · copy remains' : 'Sync off');
  if (!status) return outcome(setting?.enabled ? 'Waiting to sync' : 'Not synced');
  switch (status.status) {
    case 'delivered': return status.hasRemoteCopy && !status.differsFromQS && status.lastAcceptedAtMs !== null
      ? outcome('Synced', true) : outcome('Delivery unconfirmed');
    case 'pending': return outcome(status.hasRemoteCopy ? 'Updating' : 'Waiting to sync');
    case 'retrying': return outcome('Retry scheduled');
    case 'outside_horizon': return outcome('Scheduled for later');
    case 'paused_pro': return outcome('Paused · Pro required');
    case 'provider_unavailable': return outcome('Delivery unavailable');
    case 'removed': return outcome(status.hasRemoteCopy ? 'Removal unconfirmed' : 'Copy removed');
    case 'stopped': return outcome(status.hasRemoteCopy ? 'Removal pending' : 'Sync stopped');
    case 'paused_plan': return outcome(status.hasRemoteCopy ? 'Removal pending' : 'Plan inactive');
    default: return outcome('Status unconfirmed');
  }
}

/** Counts authored workouts, not ledger rows or native provider plan objects. No eligibility is guessed. */
export async function buildTrainingDeliverySummaries(input: {
  uid: string; scope: TrainingDeliveryScope; id: string; workouts: readonly ScheduledWorkoutV1[];
  plan: TrainingPlanV1 | null; settings: readonly TrainingDeliverySettingsV1[];
  statuses: readonly TrainingDeliveryStatusV1[]; complete: boolean;
}): Promise<TrainingDeliverySummary[]> {
  const workouts = input.workouts.filter(workout => workout.lifecycle !== 'deleted'
    && (input.scope === 'plan' ? workout.planId === input.id : workout.id === input.id));
  const workoutIds = new Set(workouts.map(workout => workout.id));
  return (await Promise.all(PLANNED_WORKOUT_PROVIDER_IDS.map(async provider => {
    const settingScope = input.scope === 'plan' ? input.id : workouts[0]?.planId;
    const setting = input.settings.find(item => item.provider === provider && (settingScope
      ? item.scope === 'plan' && item.scopeId === settingScope
      : item.scope === 'workout' && item.scopeId === input.id));
    const records = input.statuses.filter(item => item.provider === provider);
    if (!setting && !records.length) return null;
    const presentation = buildProviderPresentation({ serviceName: SERVICES[provider], mode: 'destination' })!;
    if (!input.complete) return { provider, presentation, label: 'Status incomplete',
      detail: input.scope === 'plan' ? 'More delivery records exist. Open sync details; this is not a complete plan total.'
        : 'More delivery records exist. Open sync details; current delivery is not fully checked.', icon: 'info' };
    const byId = new Map(records.map(item => [item.id, item]));
    const matchedIds = new Set<string>();
    const outcomes = await Promise.all(workouts.map(async workout => {
      const id = setting ? await trainingDeliverySummaryIdentity(input.uid, provider, setting.destinationKey, workout.id) : '';
      const status = byId.get(id);
      if (status) matchedIds.add(id);
      const override = input.settings.find(item => item.provider === provider && item.scope === 'workout'
        && item.scopeId === workout.id && item.associationPlanId === workout.planId);
      if (status && override && override.updatedAtMs > status.updatedAtMs) {
        return { label: 'Awaiting latest check', synced: false, attention: false, copy: status.hasRemoteCopy };
      }
      return workoutOutcome(workout, status, setting, input.plan);
    }));
    const earlier = records.filter(record => !matchedIds.has(record.id));
    const retained = earlier.filter(record => record.hasRemoteCopy);
    const synced = outcomes.filter(item => item.synced).length;
    const attention = outcomes.filter(item => item.attention).length;
    const notes = new Map<string, number>();
    for (const outcome of outcomes) if (input.scope === 'plan' && outcome.label !== 'Synced') notes.set(outcome.label, (notes.get(outcome.label) ?? 0) + 1);
    const detail = [...notes].map(([label, count]) => input.scope === 'plan' ? `${count} ${label.toLowerCase()}` : label);
    if (input.scope === 'workout' && outcomes[0]?.copy && !outcomes[0].synced) {
      detail.push('A provider copy remains; current delivery is not confirmed');
    }
    if (retained.length) detail.push(`${retained.length} retained ${retained.length === 1 ? 'copy' : 'copies'} from earlier sync; see details`);
    const earlierAttention = earlier.filter(record => ATTENTION.has(record.status)).length;
    if (earlierAttention) detail.push(`${earlierAttention} earlier ${earlierAttention === 1 ? 'delivery needs' : 'deliveries need'} attention`);
    // An out-of-scope retained record is history, not a current plan member.
    const historicalOnly = !setting && !records.some(record => workoutIds.has(record.workoutId));
    const countLabel = `${synced} of ${workouts.length} ${workouts.length === 1 ? 'workout' : 'workouts'} synced`;
    let label = input.scope === 'plan' ? countLabel : outcomes[0]?.label ?? 'Sync history';
    if (input.scope === 'workout' && synced && label !== 'Synced') label = `Synced · ${label.toLowerCase()}`;
    if (input.scope === 'workout' && !setting && retained.length) label = 'Earlier provider copy';
    if (historicalOnly) label = 'Sync history';
    else if (input.scope === 'plan' && !workouts.length) label = setting?.enabled ? 'Sync enabled · no workouts' : 'Sync off · no workouts';
    else if (input.scope === 'plan' && input.plan?.lifecycle !== 'active') label = `Plan inactive · ${countLabel}`;
    else if (input.scope === 'plan' && setting && !setting.enabled) label = `Sync off · ${countLabel}`;
    return { provider, presentation, label, detail: detail.join('. '),
      icon: attention ? 'error_outline' : synced > 0 && synced === workouts.length ? 'check_circle' : 'sync' };
  }))).filter((row): row is TrainingDeliverySummary => row !== null);
}
