import { ServiceNames } from '@sports-alliance/sports-lib';
import { PLANNED_WORKOUT_PROVIDER_IDS, type PlannedWorkoutProviderId } from './planned-workout-providers';
import { buildProviderPresentation, type ProviderPresentation } from './provider-presentation';
import type { ScheduledWorkoutV1, TrainingPlanV1 } from './training-plans';
import type { TrainingDeliveryScope, TrainingDeliverySettingsV1, TrainingDeliveryStatusV1 } from './training-provider-delivery';

export const TRAINING_SYNC_OUTCOMES = ['awaiting_latest_check', 'skipped', 'plan_inactive', 'sync_off',
  'not_synced', 'waiting', 'unconfirmed', 'pending', 'delivered', 'removed', 'stopped', 'paused_plan',
  'paused_pro', 'provider_unavailable', 'reconnect_required', 'connection_repair', 'fresh_consent_required',
  'outside_horizon', 'past', 'completed', 'unsupported', 'approval_required', 'retrying', 'needs_attention', 'failed'] as const;
export type TrainingSyncOutcome = typeof TRAINING_SYNC_OUTCOMES[number];
export type TrainingSyncWorkout = Pick<ScheduledWorkoutV1, 'id' | 'planId' | 'lifecycle' | 'updatedAtMs'>;
export type TrainingSyncPlan = Pick<TrainingPlanV1, 'lifecycle'>;
export type TrainingSyncSetting = Pick<TrainingDeliverySettingsV1, 'scope' | 'scopeId' | 'provider' | 'enabled' | 'suppressed' | 'timeZone' | 'destinationKey' | 'associationPlanId' | 'updatedAtMs'>;
export type TrainingSyncStatus = Pick<TrainingDeliveryStatusV1, 'id' | 'workoutId' | 'planId' | 'provider' | 'status' | 'differsFromQS' | 'hasRemoteCopy' | 'timeZone' | 'lastAttemptAtMs' | 'lastAcceptedAtMs' | 'updatedAtMs'>;
export interface TrainingSyncProjection {
  provider: PlannedWorkoutProviderId;
  state: 'current' | 'history' | 'inactive' | 'off' | 'empty' | 'incomplete';
  timeZone: string | null;
  totalWorkouts: number | null;
  syncedWorkouts: number | null;
  outcomes: { status: TrainingSyncOutcome; count: number }[];
  hasRemoteCopy: boolean;
  differsFromQS: boolean | null;
  retainedCopies: number | null;
  lastAttemptAtMs: number | null;
  lastAcceptedAtMs: number | null;
  updatedAtMs: number | null;
}

export interface TrainingDeliverySummary {
  provider: PlannedWorkoutProviderId;
  presentation: ProviderPresentation;
  label: string;
  detail: string;
  icon: string;
  projection: TrainingSyncProjection;
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

type Outcome = { label: string; code: TrainingSyncOutcome; synced: boolean; attention: boolean; copy: boolean };

/** Counted plan summaries need noun and verb agreement, unlike single-workout labels. */
function countedOutcome(label: string, count: number): string {
  const forms: Record<string, readonly [string, string]> = {
    'Retry scheduled': ['retry scheduled', 'retries scheduled'],
    'Needs approval': ['needs approval', 'need approval'],
    'Needs sync setup': ['needs sync setup', 'need sync setup'],
    'Delivery unconfirmed': ['delivery unconfirmed', 'deliveries unconfirmed'],
    'Copy removed': ['copy removed', 'copies removed'],
    'Removal pending': ['removal pending', 'removals pending'],
    'Removal unconfirmed': ['removal unconfirmed', 'removals unconfirmed'],
    'Sync failed': ['sync failed', 'syncs failed'],
    'Sync stopped': ['sync stopped', 'syncs stopped'],
    'Sync off': ['not syncing', 'not syncing'],
    'Delivery unavailable': ['delivery unavailable', 'deliveries unavailable'],
    'Status unconfirmed': ['status unconfirmed', 'statuses unconfirmed'],
    'Check connection': ['needs a connection check', 'need a connection check'],
    'Reconnect required': ['requires reconnection', 'require reconnection'],
    'Plan inactive': ['in an inactive plan', 'in an inactive plan'],
    'Plan inactive · copy remains': ['in an inactive plan · provider copy kept', 'in an inactive plan · provider copies kept'],
    'Sync off · copy remains': ['not syncing · provider copy kept', 'not syncing · provider copies kept'],
    'Skipped · copy remains': ['skipped · provider copy kept', 'skipped · provider copies kept'],
  };
  // Lowercase only the leading letter, preserving names such as Pro and QS.
  return `${count} ${forms[label]?.[count === 1 ? 0 : 1] ?? label.charAt(0).toLowerCase() + label.slice(1)}`;
}

function workoutOutcome(workout: TrainingSyncWorkout, status: TrainingSyncStatus | undefined,
  setting: TrainingSyncSetting | undefined, plan: TrainingSyncPlan | null): Outcome {
  const outcome = (label: string, synced = false, attention = false,
    code: TrainingSyncOutcome = status?.status ?? 'not_synced'): Outcome => ({ label, code, synced, attention, copy: !!status?.hasRemoteCopy });
  // Independent live listeners may deliver authored data before the worker's new projection.
  if (status && (status.planId !== workout.planId || status.updatedAtMs < Math.max(workout.updatedAtMs, setting?.updatedAtMs ?? 0))) {
    return outcome('Awaiting latest check', false, false, 'awaiting_latest_check');
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
  if (workout.lifecycle === 'skipped') return outcome(status?.hasRemoteCopy ? 'Skipped · copy remains' : 'Skipped', false, false, 'skipped');
  if (plan && plan.lifecycle !== 'active') return outcome(status?.hasRemoteCopy ? 'Plan inactive · copy remains' : 'Plan inactive', false, false, 'plan_inactive');
  if (setting && !setting.enabled) return outcome(status?.hasRemoteCopy ? 'Sync off · copy remains' : 'Sync off', false, false, 'sync_off');
  if (!status) return outcome(setting?.enabled ? 'Waiting to sync' : 'Not synced', false, false, setting?.enabled ? 'waiting' : 'not_synced');
  switch (status.status) {
    case 'delivered': return status.hasRemoteCopy && !status.differsFromQS && status.lastAcceptedAtMs !== null
      ? outcome('Synced', true) : outcome('Delivery unconfirmed', false, false, 'unconfirmed');
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
  uid: string; scope: TrainingDeliveryScope; id: string; workouts: readonly TrainingSyncWorkout[];
  plan: TrainingSyncPlan | null; settings: readonly TrainingSyncSetting[];
  statuses: readonly TrainingSyncStatus[]; complete: boolean;
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
    const latest = (key: 'lastAttemptAtMs' | 'lastAcceptedAtMs' | 'updatedAtMs') => {
      const values = records.map(item => item[key]).filter((value): value is number => value !== null);
      return values.length ? Math.max(...values) : null;
    };
    const projection: TrainingSyncProjection = { provider, state: 'current', timeZone: setting?.timeZone ?? null,
      totalWorkouts: null, syncedWorkouts: null, outcomes: [], hasRemoteCopy: records.some(item => item.hasRemoteCopy),
      differsFromQS: input.complete ? records.some(item => item.differsFromQS) : null, retainedCopies: null,
      lastAttemptAtMs: latest('lastAttemptAtMs'), lastAcceptedAtMs: latest('lastAcceptedAtMs'), updatedAtMs: latest('updatedAtMs') };
    if (!input.complete) return { provider, presentation, label: 'Status incomplete',
      detail: input.scope === 'plan' ? 'More delivery records exist. Open sync details; this is not a complete plan total.'
        : 'More delivery records exist. Open sync details; current delivery is not fully checked.', icon: 'info',
      projection: { ...projection, state: 'incomplete' as const } };
    const byId = new Map(records.map(item => [item.id, item]));
    const matchedIds = new Set<string>();
    const outcomes = await Promise.all(workouts.map(async workout => {
      const id = setting ? await trainingDeliverySummaryIdentity(input.uid, provider, setting.destinationKey, workout.id) : '';
      const status = byId.get(id);
      if (status) matchedIds.add(id);
      const override = input.settings.find(item => item.provider === provider && item.scope === 'workout'
        && item.scopeId === workout.id && item.associationPlanId === workout.planId);
      if (status && override && override.updatedAtMs > status.updatedAtMs) {
        return { label: 'Awaiting latest check', code: 'awaiting_latest_check' as const, synced: false, attention: false, copy: status.hasRemoteCopy };
      }
      return workoutOutcome(workout, status, setting, input.plan);
    }));
    const earlier = records.filter(record => !matchedIds.has(record.id));
    const retained = earlier.filter(record => record.hasRemoteCopy);
    const synced = outcomes.filter(item => item.synced).length;
    const attention = outcomes.filter(item => item.attention).length;
    const notes = new Map<string, number>();
    for (const outcome of outcomes) if (input.scope === 'plan' && outcome.label !== 'Synced') notes.set(outcome.label, (notes.get(outcome.label) ?? 0) + 1);
    const detail = [...notes].map(([label, count]) => countedOutcome(label, count));
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
    projection.state = historicalOnly ? 'history' : !workouts.length ? 'empty'
      : input.plan && input.plan.lifecycle !== 'active' ? 'inactive' : setting && !setting.enabled ? 'off' : 'current';
    projection.totalWorkouts = workouts.length; projection.syncedWorkouts = synced; projection.retainedCopies = retained.length;
    projection.outcomes = TRAINING_SYNC_OUTCOMES.map(status => ({ status, count: outcomes.filter(item => item.code === status).length }))
      .filter(item => item.count > 0);
    if (outcomes.some(item => item.code === 'awaiting_latest_check')) projection.differsFromQS = null;
    return { provider, presentation, label, detail: detail.join('. '),
      icon: attention ? 'error_outline' : synced > 0 && synced === workouts.length ? 'check_circle' : 'sync', projection };
  }))).filter((row): row is TrainingDeliverySummary => row !== null);
}
