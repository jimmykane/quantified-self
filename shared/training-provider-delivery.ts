import { PLANNED_WORKOUT_PROVIDER_IDS, type PlannedWorkoutProviderId } from './planned-workout-providers';

/** Scheduling/consent contracts, deliberately separate from WorkoutStructureV1 and history. */
export const TRAINING_DELIVERY_SETTINGS = 'trainingDeliverySettings';
export const TRAINING_DELIVERY_STATUSES = 'trainingDeliveryStatuses';
export const TRAINING_DELIVERY_PAGE_SIZE = 25;
export type TrainingDeliveryScope = 'plan' | 'workout';
export type TrainingDeliveryAction = 'configure' | 'send' | 'resume' | 'stop' | 'approve' | 'retry';
export type TrainingDeliveryStatus = 'pending' | 'delivered' | 'removed' | 'stopped' | 'paused_plan'
  | 'paused_pro' | 'provider_unavailable' | 'reconnect_required' | 'connection_repair'
  | 'fresh_consent_required' | 'outside_horizon' | 'past' | 'completed' | 'unsupported'
  | 'approval_required' | 'retrying' | 'needs_attention' | 'failed';

export interface TrainingDeliverySettingsV1 {
  schemaVersion: 1;
  scope: TrainingDeliveryScope;
  scopeId: string;
  provider: PlannedWorkoutProviderId;
  revision: number;
  enabled: boolean;
  suppressed: boolean;
  timeZone: string;
  /** Opaque, user-scoped server fingerprint. Not a provider ID or credential. */
  destinationKey: string;
  connectionEpoch: number;
  scopeGeneration: number;
  associationPlanId: string | null;
  approvedDigest: string | null;
  updatedAtMs: number;
}

export interface TrainingDeliveryStatusV1 {
  schemaVersion: 1;
  id: string;
  workoutId: string;
  planId: string | null;
  provider: PlannedWorkoutProviderId;
  status: TrainingDeliveryStatus;
  differsFromQS: boolean;
  hasRemoteCopy: boolean;
  timeZone: string;
  approvalDigest: string | null;
  issues: string[];
  lastAttemptAtMs: number | null;
  lastAcceptedAtMs: number | null;
  retryCount: number;
  nextRetryAtMs: number | null;
  updatedAtMs: number;
}

export interface TrainingDeliveryCommandV1 {
  schemaVersion: 1;
  mutationId: string;
  scope: TrainingDeliveryScope;
  scopeId: string;
  provider: PlannedWorkoutProviderId;
  action: TrainingDeliveryAction;
  expectedScheduleRevision: number;
  expectedScopeRevision: number;
  expectedSettingsRevision: number;
  timeZone?: string;
  approvalDigest?: string;
}

export interface TrainingDeliveryPreviewV1 {
  schemaVersion: 1;
  available: boolean;
  connection: 'connected' | 'reconnect_required' | 'connection_repair';
  hasPro: boolean;
  timeZone: string;
  effect: 'enable' | 'remove-future-copies' | 'retry' | 'approve';
  settingsRevision: number;
  eligibleCount: number;
  warningCount: number;
  issues: string[];
  approvalDigest: string | null;
}

export class TrainingDeliveryContractError extends Error {}

export function normalizeDeliveryTimeZone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) {
    throw new TrainingDeliveryContractError('Choose a valid IANA time zone.');
  }
  try { return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone; }
  catch { throw new TrainingDeliveryContractError('Choose a valid IANA time zone.'); }
}

export function trainingDeliveryLocalDate(nowMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(nowMs);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function deliverySettingsId(scope: TrainingDeliveryScope, scopeId: string, provider: PlannedWorkoutProviderId): string {
  return `${scope}_${scopeId}_${provider}`;
}

export function parseTrainingDeliveryCommandV1(value: unknown): TrainingDeliveryCommandV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TrainingDeliveryContractError('Invalid command.');
  const input = value as Record<string, unknown>;
  const keys = ['schemaVersion', 'mutationId', 'scope', 'scopeId', 'provider', 'action',
    'expectedScheduleRevision', 'expectedScopeRevision', 'expectedSettingsRevision', 'timeZone', 'approvalDigest'];
  if (Object.keys(input).some(key => !keys.includes(key)) || input.schemaVersion !== 1) {
    throw new TrainingDeliveryContractError('Unsupported delivery command.');
  }
  for (const key of ['scopeId', 'mutationId']) {
    if (typeof input[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input[key] as string)) {
      throw new TrainingDeliveryContractError(`Invalid ${key}.`);
    }
  }
  if (!['plan', 'workout'].includes(input.scope as string)
    || !PLANNED_WORKOUT_PROVIDER_IDS.includes(input.provider as PlannedWorkoutProviderId)
    || !['configure', 'send', 'resume', 'stop', 'approve', 'retry'].includes(input.action as string)) {
    throw new TrainingDeliveryContractError('Unknown delivery action, scope, or provider.');
  }
  for (const key of ['expectedScheduleRevision', 'expectedScopeRevision', 'expectedSettingsRevision']) {
    if (!Number.isSafeInteger(input[key]) || (input[key] as number) < 0) throw new TrainingDeliveryContractError(`Invalid ${key}.`);
  }
  if (input.scope === 'plan' && ['send', 'resume', 'approve'].includes(input.action as string)) {
    throw new TrainingDeliveryContractError('This action requires a workout.');
  }
  if (input.scope === 'workout' && input.action === 'configure') throw new TrainingDeliveryContractError('Configure requires a plan.');
  if (input.action === 'approve') {
    if (typeof input.approvalDigest !== 'string' || !/^[a-f0-9]{64}$/.test(input.approvalDigest)) {
      throw new TrainingDeliveryContractError('Approval requires the current preview digest.');
    }
  } else if ('approvalDigest' in input) throw new TrainingDeliveryContractError('Unexpected approval digest.');
  const command = { ...input } as unknown as TrainingDeliveryCommandV1;
  if ('timeZone' in input) command.timeZone = normalizeDeliveryTimeZone(input.timeZone);
  if (['configure', 'send'].includes(command.action) && !command.timeZone) {
    throw new TrainingDeliveryContractError('Initial consent requires a time zone.');
  }
  return command;
}

const STATUS_VALUES: readonly TrainingDeliveryStatus[] = ['pending', 'delivered', 'removed', 'stopped', 'paused_plan',
  'paused_pro', 'provider_unavailable', 'reconnect_required', 'connection_repair', 'fresh_consent_required',
  'outside_horizon', 'past', 'completed', 'unsupported', 'approval_required', 'retrying', 'needs_attention', 'failed'];

export function parseTrainingDeliveryStatusV1(value: unknown): TrainingDeliveryStatusV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TrainingDeliveryContractError('Invalid delivery status.');
  const record = value as TrainingDeliveryStatusV1;
  const keys = ['schemaVersion', 'id', 'workoutId', 'planId', 'provider', 'status', 'differsFromQS', 'hasRemoteCopy',
    'timeZone', 'approvalDigest', 'issues', 'lastAttemptAtMs', 'lastAcceptedAtMs', 'retryCount', 'nextRetryAtMs', 'updatedAtMs'];
  if (Object.keys(value).some(key => !keys.includes(key)) || record.schemaVersion !== 1
    || typeof record.id !== 'string' || typeof record.workoutId !== 'string'
    || !(record.planId === null || typeof record.planId === 'string')
    || !PLANNED_WORKOUT_PROVIDER_IDS.includes(record.provider) || !STATUS_VALUES.includes(record.status)
    || typeof record.differsFromQS !== 'boolean' || typeof record.hasRemoteCopy !== 'boolean'
    || !Array.isArray(record.issues) || record.issues.length > 20 || record.issues.some(issue => typeof issue !== 'string' || issue.length > 1000)
    || !(record.approvalDigest === null || /^[a-f0-9]{64}$/.test(record.approvalDigest))
    || [record.lastAttemptAtMs, record.lastAcceptedAtMs, record.nextRetryAtMs].some(value => value !== null && (!Number.isSafeInteger(value) || value < 0))
    || !Number.isSafeInteger(record.retryCount) || record.retryCount < 0
    || !Number.isFinite(record.updatedAtMs)) throw new TrainingDeliveryContractError('Invalid delivery status.');
  return { ...record, timeZone: normalizeDeliveryTimeZone(record.timeZone), issues: [...record.issues] };
}

export function parseTrainingDeliverySettingsV1(value: unknown): TrainingDeliverySettingsV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TrainingDeliveryContractError('Invalid delivery settings.');
  const record = value as TrainingDeliverySettingsV1;
  const keys = ['schemaVersion', 'scope', 'scopeId', 'provider', 'revision', 'enabled', 'suppressed', 'timeZone',
    'destinationKey', 'connectionEpoch', 'scopeGeneration', 'associationPlanId', 'approvedDigest', 'updatedAtMs'];
  if (Object.keys(value).some(key => !keys.includes(key)) || record.schemaVersion !== 1
    || !['plan', 'workout'].includes(record.scope) || typeof record.scopeId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(record.scopeId)
    || !PLANNED_WORKOUT_PROVIDER_IDS.includes(record.provider) || typeof record.enabled !== 'boolean'
    || typeof record.suppressed !== 'boolean' || typeof record.destinationKey !== 'string'
    || !(record.associationPlanId === null || typeof record.associationPlanId === 'string')
    || [record.revision, record.connectionEpoch, record.scopeGeneration, record.updatedAtMs].some(number => !Number.isSafeInteger(number) || number < 0)
    || !(record.approvedDigest === null || /^[a-f0-9]{64}$/.test(record.approvedDigest))) {
    throw new TrainingDeliveryContractError('Invalid delivery settings.');
  }
  return { ...record, timeZone: normalizeDeliveryTimeZone(record.timeZone) };
}
