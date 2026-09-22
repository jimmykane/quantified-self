import { ServiceNames } from '@sports-alliance/sports-lib';
import { PLANNED_WORKOUT_PROVIDER_IDS, type PlannedWorkoutProviderId } from './planned-workout-providers';
import { buildProviderPresentation, type ProviderPresentation } from './provider-presentation';
import type { ScheduledWorkoutV1, TrainingPlanV1 } from './training-plans';
import { trainingDeliveryLocalDate, type TrainingDeliveryScope, type TrainingDeliverySettingsV1,
  type TrainingDeliveryStatusV1 } from './training-provider-delivery';
import type { TrainingWorkoutCompletionV1 } from './training-workout-completion';

export const TRAINING_SYNC_OUTCOMES = ['awaiting_latest_check', 'skipped', 'plan_inactive', 'sync_off',
  'not_synced', 'waiting', 'unconfirmed', 'pending', 'delivered', 'removed', 'stopped', 'paused_plan',
  'paused_pro', 'provider_unavailable', 'reconnect_required', 'connection_repair', 'fresh_consent_required',
  'outside_horizon', 'past', 'completed', 'unsupported', 'approval_required', 'retrying', 'needs_attention', 'failed'] as const;
export type TrainingSyncOutcome = typeof TRAINING_SYNC_OUTCOMES[number];
export type TrainingSyncWorkout = Pick<ScheduledWorkoutV1, 'id' | 'planId' | 'localDate' | 'lifecycle' | 'updatedAtMs'>;
export type TrainingSyncPlan = Pick<TrainingPlanV1, 'lifecycle'>;
export type TrainingSyncSetting = Pick<TrainingDeliverySettingsV1, 'scope' | 'scopeId' | 'provider' | 'enabled' | 'suppressed' | 'timeZone' | 'destinationKey' | 'associationPlanId' | 'updatedAtMs'>;
export type TrainingSyncStatus = Pick<TrainingDeliveryStatusV1, 'id' | 'workoutId' | 'planId' | 'provider' | 'status' | 'differsFromQS' | 'hasRemoteCopy' | 'timeZone' | 'lastAttemptAtMs' | 'lastAcceptedAtMs' | 'updatedAtMs'>;
export type TrainingSyncCompletion = Pick<TrainingWorkoutCompletionV1, 'workoutId' | 'planId' | 'provider'>;
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
  /** UI-only current/future emphasis. The public MCP projection remains the all-workout aggregate above. */
  planFocus: TrainingPlanSyncFocus | null;
}

export interface TrainingPlanSyncFocus {
  totalWorkouts: number | null;
  syncedWorkouts: number | null;
  earlierWorkouts: number | null;
  label: string;
  detail: string;
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
    'Sync unconfirmed': ['sync unconfirmed', 'syncs unconfirmed'],
    'Send unconfirmed': ['send unconfirmed', 'sends unconfirmed'],
    'Copy removed': ['copy removed', 'copies removed'],
    'No active delivery': ['no active delivery', 'no active deliveries'],
    'Removal pending': ['removal pending', 'removals pending'],
    'Removal unconfirmed': ['removal unconfirmed', 'removals unconfirmed'],
    'Sync failed': ['sync failed', 'syncs failed'],
    'Send failed': ['send failed', 'sends failed'],
    'Sync stopped': ['sync stopped', 'syncs stopped'],
    'Sync off': ['not syncing', 'not syncing'],
    'Sync unavailable': ['sync unavailable', 'syncs unavailable'],
    'Delivery unavailable': ['delivery unavailable', 'deliveries unavailable'],
    'Status unconfirmed': ['status unconfirmed', 'statuses unconfirmed'],
    'Check connection': ['needs a connection check', 'need a connection check'],
    'Reconnect required': ['requires reconnection', 'require reconnection'],
    'Plan inactive': ['in an inactive plan', 'in an inactive plan'],
    'Plan inactive · copy remains': ['in an inactive plan · sent copy kept', 'in an inactive plan · sent copies kept'],
    'Sync off · copy remains': ['not syncing · sent copy kept', 'not syncing · sent copies kept'],
    'Skipped · copy remains': ['skipped · sent copy kept', 'skipped · sent copies kept'],
    'Completed · activity linked': ['completed · activity linked', 'completed · activities linked'],
    'Sent · workout completed': ['sent · workout completed', 'sent · workouts completed'],
    'Past date · copy kept': ['past date · copy kept', 'past dates · copies kept'],
    'Completed in connected app · copy kept': ['completed in connected app · copy kept', 'completed in connected app · copies kept'],
    'Completed workout · sent Guide kept': ['completed workout · sent Guide kept', 'completed workouts · sent Guides kept'],
  };
  // Lowercase only the leading letter, preserving names such as Pro and QS.
  return `${count} ${forms[label]?.[count === 1 ? 0 : 1] ?? label.charAt(0).toLowerCase() + label.slice(1)}`;
}

function workoutOutcome(workout: TrainingSyncWorkout, status: TrainingSyncStatus | undefined,
  setting: TrainingSyncSetting | undefined, plan: TrainingSyncPlan | null,
  completion: TrainingSyncCompletion | undefined, provider: PlannedWorkoutProviderId): Outcome {
  const suunto = provider === 'suunto';
  const sentLabel = suunto ? 'Sent to Suunto' : 'Synced';
  const outcome = (label: string, synced = false, attention = false,
    code: TrainingSyncOutcome = status?.status ?? 'not_synced'): Outcome => ({ label, code, synced, attention, copy: !!status?.hasRemoteCopy });
  // Independent live listeners may deliver authored data before the worker's new projection.
  if (status && (status.planId !== workout.planId || status.updatedAtMs < Math.max(workout.updatedAtMs, setting?.updatedAtMs ?? 0))) {
    return outcome('Awaiting latest check', false, false, 'awaiting_latest_check');
  }
  if (status && ATTENTION.has(status.status)) {
    const labels: Partial<Record<TrainingDeliveryStatusV1['status'], string>> = {
      unsupported: 'Not supported', approval_required: 'Needs approval', failed: suunto ? 'Send failed' : 'Sync failed',
      needs_attention: suunto ? 'Send unconfirmed' : 'Sync unconfirmed', reconnect_required: 'Reconnect required',
      connection_repair: 'Check connection', fresh_consent_required: 'Needs sync setup',
    };
    return outcome(labels[status.status]!, false, true);
  }
  const confirmedCopy = !!status?.hasRemoteCopy && !status.differsFromQS && status.lastAcceptedAtMs !== null;
  if (completion && confirmedCopy) {
    return outcome(completion.provider === status.provider ? 'Completed · activity linked' : 'Sent · workout completed',
      workout.lifecycle !== 'skipped', false, 'completed');
  }
  if (status?.status === 'past' || status?.status === 'completed') {
    const skipped = workout.lifecycle === 'skipped';
    const label = status.status === 'completed'
      ? suunto ? 'Completed workout · sent Guide kept' : 'Completed in connected app · copy kept'
      : 'Past date · copy kept';
    return outcome((skipped ? 'Skipped · ' : '') + label, confirmedCopy && !skipped);
  }
  if (workout.lifecycle === 'skipped') return outcome(status?.hasRemoteCopy ? 'Skipped · copy remains' : 'Skipped', false, false, 'skipped');
  if (plan && plan.lifecycle !== 'active') return outcome(status?.hasRemoteCopy ? 'Plan inactive · copy remains' : 'Plan inactive', false, false, 'plan_inactive');
  if (setting && !setting.enabled) return outcome(status?.hasRemoteCopy ? 'Sync off · copy remains' : 'Sync off', false, false, 'sync_off');
  if (!status) return outcome(setting?.enabled ? suunto ? 'Waiting to send' : 'Waiting to sync' : suunto ? 'Not sent' : 'Not synced',
    false, false, setting?.enabled ? 'waiting' : 'not_synced');
  switch (status.status) {
    case 'delivered': return status.hasRemoteCopy && !status.differsFromQS && status.lastAcceptedAtMs !== null
      ? outcome(sentLabel, true) : outcome(suunto ? 'Send unconfirmed' : 'Sync unconfirmed', false, false, 'unconfirmed');
    case 'pending': return outcome(status.hasRemoteCopy ? 'Updating' : suunto ? 'Waiting to send' : 'Waiting to sync');
    case 'retrying': return outcome('Retry scheduled');
    case 'outside_horizon': return outcome('Scheduled for later');
    case 'paused_pro': return outcome('Paused · Pro required');
    case 'provider_unavailable': return outcome(suunto ? 'Delivery unavailable' : 'Sync unavailable');
    case 'removed': return outcome(status.hasRemoteCopy ? 'Removal unconfirmed' : suunto ? 'No active delivery' : 'Copy removed');
    case 'stopped': return outcome(status.hasRemoteCopy ? 'Removal pending' : 'Sync stopped');
    case 'paused_plan': return outcome(status.hasRemoteCopy ? 'Removal pending' : 'Plan inactive');
    default: return outcome('Status unconfirmed');
  }
}

/** Counts authored workouts, not ledger rows or native provider plan objects. No eligibility is guessed. */
export async function buildTrainingDeliverySummaries(input: {
  uid: string; scope: TrainingDeliveryScope; id: string; workouts: readonly TrainingSyncWorkout[];
  plan: TrainingSyncPlan | null; settings: readonly TrainingSyncSetting[];
  statuses: readonly TrainingSyncStatus[]; completions: readonly TrainingSyncCompletion[]; complete: boolean; nowMs?: number;
}): Promise<TrainingDeliverySummary[]> {
  const workouts = input.workouts.filter(workout => workout.lifecycle !== 'deleted'
    && (input.scope === 'plan' ? workout.planId === input.id : workout.id === input.id));
  const workoutIds = new Set(workouts.map(workout => workout.id));
  return (await Promise.all(PLANNED_WORKOUT_PROVIDER_IDS.map(async provider => {
    const deliveryVerb = provider === 'suunto' ? 'sent' : 'synced';
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
      projection: { ...projection, state: 'incomplete' as const },
      planFocus: input.scope === 'plan' ? { totalWorkouts: null, syncedWorkouts: null, earlierWorkouts: null,
        label: 'Upcoming status incomplete', detail: 'Open sync details to see the latest workout status' } : null };
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
      return workoutOutcome(workout, status, setting, input.plan,
        input.completions.find(completion => completion.workoutId === workout.id && completion.planId === workout.planId), provider);
    }));
    const earlier = records.filter(record => !matchedIds.has(record.id));
    const retained = earlier.filter(record => record.hasRemoteCopy);
    const synced = outcomes.filter(item => item.synced).length;
    const attention = outcomes.filter(item => item.attention).length;
    const notes = new Map<string, number>();
    const successLabel = provider === 'suunto' ? 'Sent to Suunto' : 'Synced';
    for (const outcome of outcomes) if (input.scope === 'plan' && outcome.label !== successLabel) notes.set(outcome.label, (notes.get(outcome.label) ?? 0) + 1);
    const detail = [...notes].map(([label, count]) => countedOutcome(label, count));
    if (input.scope === 'workout' && outcomes[0]?.copy && !outcomes[0].synced) {
      detail.push('A sent copy remains; the latest sync is not confirmed');
    }
    if (retained.length) detail.push(`${retained.length} retained ${retained.length === 1 ? 'copy' : 'copies'} from earlier ${provider === 'suunto' ? 'delivery' : 'sync'}; see details`);
    const earlierAttention = earlier.filter(record => ATTENTION.has(record.status)).length;
    if (earlierAttention) detail.push(`${earlierAttention} earlier ${earlierAttention === 1 ? 'delivery needs' : 'deliveries need'} attention`);
    // An out-of-scope retained record is history, not a current plan member.
    const historicalOnly = !setting && !records.some(record => workoutIds.has(record.workoutId));
    const countLabel = `${synced} of ${workouts.length} ${workouts.length === 1 ? 'workout' : 'workouts'} ${deliveryVerb}`;
    let label = input.scope === 'plan' ? countLabel : outcomes[0]?.label ?? 'Sync history';
    if (input.scope === 'workout' && synced && label !== successLabel && !['past', 'completed'].includes(outcomes[0]?.code ?? '')) {
      label = `${provider === 'suunto' ? 'Sent' : 'Synced'} · ${label.toLowerCase()}`;
    }
    if (input.scope === 'workout' && !setting && retained.length) label = provider === 'suunto' ? 'Earlier sent copy' : 'Earlier synced copy';
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
    let planFocus: TrainingPlanSyncFocus | null = null;
    if (input.scope === 'plan') {
      const nowMs = input.nowMs ?? Date.now();
      let today: string;
      try { today = trainingDeliveryLocalDate(nowMs, setting?.timeZone ?? records[0]?.timeZone ?? 'UTC'); }
      catch { today = trainingDeliveryLocalDate(nowMs, 'UTC'); }
      const dated = outcomes.map((outcome, index) => ({ outcome, workout: workouts[index] }));
      const focused = dated.filter(item => item.workout.localDate >= today
        && item.workout.lifecycle !== 'skipped' && !['completed', 'outside_horizon'].includes(item.outcome.code));
      const earlierCount = dated.filter(item => item.workout.localDate < today).length;
      const completedCount = dated.filter(item => item.workout.localDate >= today && item.outcome.code === 'completed').length;
      const skippedCount = dated.filter(item => item.workout.localDate >= today
        && item.outcome.code !== 'completed' && item.workout.lifecycle === 'skipped').length;
      const laterCount = dated.filter(item => item.workout.localDate >= today
        && item.workout.lifecycle !== 'skipped' && item.outcome.code === 'outside_horizon').length;
      const focusedSynced = focused.filter(item => item.outcome.synced).length;
      const focusedNotes = new Map<string, number>();
      for (const item of focused) if (!item.outcome.synced) {
        focusedNotes.set(item.outcome.label, (focusedNotes.get(item.outcome.label) ?? 0) + 1);
      }
      const focusedDetail = [...focusedNotes].map(([outcomeLabel, count]) => countedOutcome(outcomeLabel, count));
      if (earlierCount) focusedDetail.push(`${earlierCount} earlier ${earlierCount === 1 ? 'workout' : 'workouts'}`);
      if (completedCount) focusedDetail.push(`${completedCount} completed ${completedCount === 1 ? 'workout' : 'workouts'}`);
      if (skippedCount) focusedDetail.push(`${skippedCount} skipped ${skippedCount === 1 ? 'workout' : 'workouts'}`);
      const focusedCount = focused.length;
      if (laterCount && focusedCount) focusedDetail.push(`${laterCount} scheduled for later`);
      const focusedLabel = focusedCount === 0 ? laterCount ? `${laterCount} ${laterCount === 1 ? 'workout' : 'workouts'} scheduled for later` : 'No upcoming workouts'
        : laterCount ? focusedSynced === focusedCount
          ? focusedCount === 1 ? `Next workout ${deliveryVerb}` : `All ${focusedCount} workouts due soon ${deliveryVerb}`
          : `${focusedSynced} of ${focusedCount} ${focusedCount === 1 ? 'workout' : 'workouts'} due soon ${deliveryVerb}`
          : focusedSynced === focusedCount ? focusedCount === 1 ? `Upcoming workout ${deliveryVerb}` : `All ${focusedCount} upcoming workouts ${deliveryVerb}`
            : `${focusedSynced} of ${focusedCount} upcoming ${focusedCount === 1 ? 'workout' : 'workouts'} ${deliveryVerb}`;
      planFocus = { totalWorkouts: focusedCount, syncedWorkouts: focusedSynced, earlierWorkouts: earlierCount,
        label: focusedLabel, detail: focusedDetail.join(' · ') };
    }
    return { provider, presentation, label, detail: detail.join('. '),
      icon: attention ? 'error_outline' : synced > 0 && synced === workouts.length ? 'check_circle' : 'sync', projection, planFocus };
  }))).filter((row): row is TrainingDeliverySummary => row !== null);
}
