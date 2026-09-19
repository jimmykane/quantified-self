import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  parseMutateTrainingScheduleRequestV1,
  parseScheduledWorkoutV1,
  parseTrainingPlanStateV1,
  parseTrainingPlanV1,
  type ExpectedTrainingScheduleRevision,
  type MutateTrainingScheduleRequestV1,
  type ScheduledWorkoutV1,
  type TrainingPlanV1,
  type TrainingScheduleMutationOperationV1,
} from '../../../shared/training-plans';
import { parseWorkoutStructureV1 } from '../../../shared/planned-workout';
import { PLANNED_WORKOUT_PROVIDER_IDS, type PlannedWorkoutProviderId } from '../../../shared/planned-workout-providers';
import { deliverySettingsId, normalizeDeliveryTimeZone, trainingDeliveryLocalDate, TrainingDeliveryContractError,
  type TrainingDeliveryAction, type TrainingDeliveryPreviewV1 } from '../../../shared/training-provider-delivery';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { assertNoTrainingPlanDeletionInProgress } from '../training-plans/deletion-lock';
import { applyTrainingScheduleMutation, createEmptyTrainingPlanState, TrainingScheduleMutationError,
  type TrainingScheduleSnapshotV1 } from '../training-plans/mutation';
import { mutateTrainingScheduleForUser } from '../training-plans/persistence';
import { trainingDeliveryCommand } from '../training-plans/delivery/commands';
import { productionDeliveryRuntime } from '../training-plans/delivery/runtime';
import type { DeliveryRuntime } from '../training-plans/delivery/contracts';
import { decodeOpaqueValue, encodeOpaqueValue, McpDataError } from './data.service';
import {
  TRAINING_CHANGE_SCHEMA,
  TRAINING_DELIVERY_WRITE_SCOPE,
  TRAINING_PLANS_SCOPE,
  TRAINING_PLANS_WRITE_SCOPE,
  TRAINING_WRITE_INPUTS,
  TRAINING_WRITE_OUTPUTS,
} from './training-plans.schemas';

const PROPOSALS = 'trainingMcpProposals';
const PROPOSAL_LIFETIME_MS = 15 * 60 * 1000;
const PROPOSAL_RESULT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const APPLY_LEASE_MS = 2 * 60 * 1000;
const MAX_INPUT_BYTES = 256 * 1024;
const entityId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const referencePayload = z.strictObject({ kind: z.enum(['plan', 'workout']), id: entityId,
  createdAtMs: z.number().int().nonnegative().safe() });
const proposalPayload = z.strictObject({ kind: z.literal('proposal'), id: entityId,
  createdAtMs: z.number().int().nonnegative().safe() });

type TrainingChange = z.infer<typeof TRAINING_CHANGE_SCHEMA>;
type PreviewResult = z.infer<typeof TRAINING_WRITE_OUTPUTS.preview_training_changes>;
type ApplyResult = z.infer<typeof TRAINING_WRITE_OUTPUTS.apply_training_changes>;

interface StoredProviderOperation {
  index: number;
  provider: PlannedWorkoutProviderId;
  targetType: 'plan' | 'workout';
  targetId: string;
  action: 'enable' | 'send' | 'resume' | 'stop' | 'retry' | 'check' | 'approve';
  timeZone?: string;
  expectedScheduleRevision: number;
  expectedScopeRevision: number;
  expectedSettingsRevision: number;
  approvalDigest?: string;
}

type ProviderOperationDraft = Omit<StoredProviderOperation,
  'expectedScheduleRevision' | 'expectedScopeRevision' | 'expectedSettingsRevision'>;

interface StoredScheduleOperation {
  index: number;
  request: MutateTrainingScheduleRequestV1;
}

interface StoredProposal {
  schemaVersion: 1;
  uid: string;
  connectionId: string;
  accessGeneration: string;
  requiredScopes: string[];
  createdAtMs: number;
  expiresAtMs: number;
  expireAt: Timestamp;
  status: 'pending' | 'applying' | 'applied' | 'partially_applied';
  leaseUntilMs: number | null;
  nextScheduleOperation: number;
  scheduleRequests: StoredScheduleOperation[];
  providerOperations: StoredProviderOperation[];
  localEntities: Array<{ localKey: string; kind: 'plan' | 'workout'; id: string }>;
  preview: PreviewResult;
  changeResults: ApplyResult['changes'];
  providerResults: ApplyResult['providers'];
  result?: ApplyResult;
}

export interface TrainingWriteInput {
  uid: string;
  connectionId: string;
  scopes: readonly string[];
  arguments: unknown;
}

export interface TrainingWriteDependencies {
  db: FirebaseFirestore.Firestore;
  runtime: DeliveryRuntime;
  now(): number;
  randomId(): string;
}

function defaultDependencies(): TrainingWriteDependencies {
  const db = admin.firestore();
  return { db, runtime: productionDeliveryRuntime(db), now: Date.now, randomId: randomUUID };
}

function invalid(message: string): never {
  throw new McpDataError('invalid_request', message);
}

function unavailable(message = 'Training changes cannot be prepared safely. Try again later.'): never {
  throw new McpDataError('temporarily_unavailable', message);
}

function publicErrorMessage(error: unknown): string | null {
  if (error instanceof McpDataError || error instanceof TrainingScheduleMutationError
    || error instanceof TrainingDeliveryContractError || error instanceof HttpsError) {
    return error.message.slice(0, 500);
  }
  return null;
}

function assertBytes(value: unknown): void {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_INPUT_BYTES) {
    throw new McpDataError('query_too_large', 'The Training proposal exceeds the 256 KiB input limit. Split it into smaller changes.');
  }
}

function requiredScopes(changes: readonly TrainingChange[]): string[] {
  const result = [TRAINING_PLANS_SCOPE];
  if (changes.some(change => change.kind !== 'provider-delivery')) result.push(TRAINING_PLANS_WRITE_SCOPE);
  if (changes.some(change => change.kind === 'provider-delivery')) result.push(TRAINING_DELIVERY_WRITE_SCOPE);
  return result;
}

function permissionMode(required: readonly string[]): 'schedule' | 'delivery' | 'combined' {
  const schedule = required.includes(TRAINING_PLANS_WRITE_SCOPE);
  const delivery = required.includes(TRAINING_DELIVERY_WRITE_SCOPE);
  return schedule && delivery ? 'combined' : schedule ? 'schedule' : 'delivery';
}

function assertProviderActionsLast(changes: readonly TrainingChange[]): void {
  let providerActionSeen = false;
  for (const change of changes) {
    if (change.kind === 'provider-delivery') providerActionSeen = true;
    else if (providerActionSeen) {
      invalid('Provider delivery actions must follow all plan and workout changes so the confirmation order stays exact.');
    }
  }
}

function assertScopes(granted: readonly string[], required: readonly string[]): void {
  const missing = required.filter(scope => !granted.includes(scope));
  if (missing.length) invalid(`Missing required permission: ${missing.join(', ')}. Reauthorize this connection.`);
}

function accessGeneration(data: FirebaseFirestore.DocumentData): string {
  return JSON.stringify([data.grantId ?? null, data.createdAtMs ?? null, [...(Array.isArray(data.scopes) ? data.scopes : [])].sort()]);
}

async function assertAuthorityInTransaction(
  deps: TrainingWriteDependencies,
  tx: FirebaseFirestore.Transaction,
  uid: string,
  connectionId: string,
  required: readonly string[],
  expectedGeneration?: string,
  expectedAssistantProposalRef?: string,
): Promise<string> {
  const user = deps.db.collection('users').doc(uid);
  if ((await getUserDeletionGuardStateInTransaction(deps.db, tx, uid, deps.now())).shouldSkip) {
    invalid('This account is unavailable or being deleted.');
  }
  const stateRef = user.collection('trainingPlanState').doc('current');
  await assertNoTrainingPlanDeletionInProgress(tx, stateRef);
  if (connectionId.startsWith('first-party-assistant-v1:')) {
    const conversationId = connectionId.slice('first-party-assistant-v1:'.length);
    if (!conversationId) invalid('The Assistant Training permission generation is unavailable.');
    const conversation = await tx.get(user.collection('assistantConversations').doc('active'));
    const data = conversation.data() ?? {};
    const authorized = conversation.exists
      && data.conversationId === conversationId
      && data.trainingPlansEnabled === true
      && (!required.includes(TRAINING_PLANS_WRITE_SCOPE) || data.trainingPlanChangesEnabled === true)
      && (!required.includes(TRAINING_DELIVERY_WRITE_SCOPE) || data.trainingDeliveryEnabled === true);
    if (!authorized) invalid('The Assistant Training permissions changed. Review the proposal again.');
    if (expectedAssistantProposalRef
      && data.pendingTrainingProposal?.proposalRef !== expectedAssistantProposalRef) {
      invalid('This Assistant Training proposal is no longer current. Review the latest proposal.');
    }
    const generation = JSON.stringify([conversationId, data.trainingPlanChangesEnabled === true,
      data.trainingDeliveryEnabled === true]);
    if (expectedGeneration !== undefined && generation !== expectedGeneration) {
      invalid('The Assistant Training permissions changed. Review the proposal again.');
    }
    return generation;
  }
  if (connectionId === 'first-party-assistant-v1') {
    invalid('The Assistant Training permission generation is unavailable.');
  }
  const connection = await tx.get(user.collection('mcpConnections').doc(connectionId));
  const data = connection.data() ?? {};
  if (!connection.exists || data.revokedAtMs != null || ![undefined, 'active'].includes(data.status)
    || !Array.isArray(data.scopes) || required.some(scope => !data.scopes.includes(scope))) {
    invalid('This MCP connection no longer has the required Training permissions.');
  }
  const generation = accessGeneration(data);
  if (expectedGeneration !== undefined && generation !== expectedGeneration) {
    invalid('The MCP permission grant changed. Prepare the Training change again.');
  }
  return generation;
}

async function loadSnapshot(
  deps: TrainingWriteDependencies,
  uid: string,
  connectionId: string,
  required: readonly string[],
): Promise<{ snapshot: TrainingScheduleSnapshotV1; accessGeneration: string }> {
  const user = deps.db.collection('users').doc(uid);
  return deps.db.runTransaction(async tx => {
    const generation = await assertAuthorityInTransaction(deps, tx, uid, connectionId, required);
    const [stateDoc, plansDocs, workoutsDocs] = await Promise.all([
      tx.get(user.collection('trainingPlanState').doc('current')),
      tx.get(user.collection('trainingPlans')),
      tx.get(user.collection('scheduledWorkouts').where('lifecycle', 'in', ['planned', 'skipped'])),
    ]);
    const plans = new Map<string, TrainingPlanV1>();
    plansDocs.docs.forEach(doc => {
      const plan = parseTrainingPlanV1(doc.data());
      if (plan.id !== doc.id) unavailable();
      plans.set(plan.id, plan);
    });
    const workouts = new Map<string, ScheduledWorkoutV1>();
    workoutsDocs.docs.forEach(doc => {
      const workout = parseScheduledWorkoutV1(doc.data());
      if (workout.id !== doc.id) unavailable();
      workouts.set(workout.id, workout);
    });
    return { accessGeneration: generation, snapshot: {
      state: stateDoc.exists ? parseTrainingPlanStateV1(stateDoc.data()) : createEmptyTrainingPlanState(),
      plans, workouts,
    } };
  }, { readOnly: true });
}

function safeEntityId(prefix: 'plan' | 'workout', randomId: string): string {
  return `${prefix}-mcp-${randomId.replace(/[^A-Za-z0-9_-]/g, '')}`.slice(0, 128);
}

function resolveReference(
  target: { ref: string } | { localKey: string },
  expectedKind: 'plan' | 'workout',
  input: Pick<TrainingWriteInput, 'uid' | 'connectionId'>,
  snapshot: TrainingScheduleSnapshotV1,
  locals: Map<string, { kind: 'plan' | 'workout'; id: string }>,
): string {
  if ('localKey' in target) {
    const local = locals.get(target.localKey);
    if (!local || local.kind !== expectedKind) invalid(`Unknown ${expectedKind} localKey ${target.localKey}.`);
    return local.id;
  }
  let decoded: Record<string, unknown>;
  try { decoded = decodeOpaqueValue('training_read', target.ref, input.uid, input.connectionId, 'Training reference'); }
  catch { invalid('A Training reference is invalid for this connection.'); }
  const parsed = referencePayload.safeParse(decoded!);
  if (!parsed.success || parsed.data.kind !== expectedKind) invalid(`Expected a ${expectedKind} reference.`);
  const entity = expectedKind === 'plan' ? snapshot.plans.get(parsed.data.id) : snapshot.workouts.get(parsed.data.id);
  if (!entity || entity.createdAtMs !== parsed.data.createdAtMs) invalid(`The referenced ${expectedKind} is no longer available.`);
  return parsed.data.id;
}

function expectedRevisions(snapshot: TrainingScheduleSnapshotV1, operation: TrainingScheduleMutationOperationV1): ExpectedTrainingScheduleRevision[] {
  const expected: ExpectedTrainingScheduleRevision[] = [{ scope: 'state', id: 'current', revision: snapshot.state.revision }];
  const addPlan = (planId: string | null | undefined) => {
    if (!planId || expected.some(item => item.scope === 'plan' && item.id === planId)) return;
    const plan = snapshot.plans.get(planId);
    if (plan) expected.push({ scope: 'plan', id: planId, revision: plan.revision });
  };
  const addWorkout = (workoutId: string) => {
    const workout = snapshot.workouts.get(workoutId);
    if (workout) expected.push({ scope: 'workout', id: workoutId, revision: workout.revision });
    return workout;
  };
  switch (operation.kind) {
    case 'create-plan': if (operation.activate) addPlan(snapshot.state.activePlanId); break;
    case 'rename-plan': case 'set-plan-color': case 'shift-plan': addPlan(operation.planId); break;
    case 'set-plan-lifecycle': addPlan(operation.planId); if (operation.lifecycle === 'active') addPlan(snapshot.state.activePlanId); break;
    case 'create-workout': addPlan(operation.planId); break;
    case 'update-workout': case 'move-workout': {
      const current = addWorkout(operation.workoutId); addPlan(current?.planId); addPlan(operation.planId); break;
    }
    case 'copy-workout': addWorkout(operation.sourceWorkoutId); addPlan(operation.planId); break;
    case 'set-workout-lifecycle': case 'delete-workout': case 'permanently-delete-workout': {
      const current = addWorkout(operation.workoutId); addPlan(current?.planId); break;
    }
  }
  if (expected.length > 4) invalid('This change touches too many revision scopes. Split it into smaller operations.');
  return expected;
}

function describeOperation(operation: TrainingScheduleMutationOperationV1): string {
  switch (operation.kind) {
    case 'create-plan': return `Create plan “${operation.name}” from ${operation.startLocalDate} to ${operation.endLocalDate}${operation.activate ? ' and make it active' : ''}.`;
    case 'rename-plan': return `Rename a plan to “${operation.name}”.`;
    case 'set-plan-color': return `Change the plan color to ${operation.color}.`;
    case 'set-plan-lifecycle': return `${operation.lifecycle === 'active' ? 'Activate' : operation.lifecycle === 'paused' ? 'Pause' : 'Archive'} the plan.`;
    case 'shift-plan': return `Shift the plan ${Math.abs(operation.days)} day${Math.abs(operation.days) === 1 ? '' : 's'} ${operation.days > 0 ? 'later' : 'earlier'}.`;
    case 'create-workout': return `Create “${operation.title}” on ${operation.localDate}${operation.planId ? ' in the selected plan' : ' as a standalone workout'}.`;
    case 'update-workout': return `Update “${operation.title}” and schedule it for ${operation.localDate}.`;
    case 'move-workout': return `Move the workout to ${operation.localDate}${operation.planId ? ' in the selected plan' : ' as a standalone workout'}.`;
    case 'copy-workout': return `Copy the workout to ${operation.localDate}${operation.planId ? ' in the selected plan' : ' as a standalone workout'}.`;
    case 'set-workout-lifecycle': return `${operation.lifecycle === 'skipped' ? 'Mark' : 'Restore'} the workout ${operation.lifecycle === 'skipped' ? 'as skipped' : 'to planned'}.`;
    case 'delete-workout': return 'Move the workout to recoverable history.';
    case 'permanently-delete-workout': return 'Permanently delete the workout.';
  }
}

function describeScheduleEffects(
  operation: TrainingScheduleMutationOperationV1,
  before: TrainingScheduleSnapshotV1,
  after: TrainingScheduleSnapshotV1,
): string {
  const details: string[] = [];
  const activatedPlanId = operation.kind === 'create-plan' && operation.activate
    ? operation.planId
    : operation.kind === 'set-plan-lifecycle' && operation.lifecycle === 'active'
      ? operation.planId
      : null;
  if (activatedPlanId && before.state.activePlanId && before.state.activePlanId !== activatedPlanId) {
    details.push('The previously active plan will be paused.');
  }
  if (operation.kind === 'shift-plan') {
    const shifted = [...before.workouts.values()].filter(workout => workout.planId === operation.planId).length;
    const plan = after.plans.get(operation.planId);
    if (plan) details.push(`${shifted} associated workout${shifted === 1 ? '' : 's'} will move with the plan; its range becomes ${plan.startLocalDate} to ${plan.endLocalDate}.`);
  }
  const workoutId = operation.kind === 'create-workout' || operation.kind === 'copy-workout'
    ? operation.workoutId
    : operation.kind === 'update-workout' || operation.kind === 'move-workout'
      ? operation.workoutId
      : null;
  if (workoutId) {
    const workout = after.workouts.get(workoutId);
    const planId = workout?.planId ?? null;
    const priorPlan = planId ? before.plans.get(planId) : null;
    const nextPlan = planId ? after.plans.get(planId) : null;
    if (priorPlan && nextPlan
      && (priorPlan.startLocalDate !== nextPlan.startLocalDate || priorPlan.endLocalDate !== nextPlan.endLocalDate)) {
      details.push(`The destination plan range will extend to ${nextPlan.startLocalDate} through ${nextPlan.endLocalDate}.`);
    }
  }
  return [describeOperation(operation), ...details].join(' ');
}

function resolveScheduleOperation(
  change: Exclude<TrainingChange, { kind: 'provider-delivery' }>,
  input: Pick<TrainingWriteInput, 'uid' | 'connectionId'>,
  snapshot: TrainingScheduleSnapshotV1,
  locals: Map<string, { kind: 'plan' | 'workout'; id: string }>,
  randomId: () => string,
): TrainingScheduleMutationOperationV1 {
  const plan = (target: { ref: string } | { localKey: string } | null) => target
    ? resolveReference(target, 'plan', input, snapshot, locals) : null;
  const workout = (target: { ref: string } | { localKey: string }) => resolveReference(target, 'workout', input, snapshot, locals);
  switch (change.kind) {
    case 'create-plan': {
      if (locals.has(change.localKey)) invalid(`Duplicate localKey ${change.localKey}.`);
      const planId = safeEntityId('plan', randomId()); locals.set(change.localKey, { kind: 'plan', id: planId });
      return { kind: change.kind, planId, name: change.name, ...(change.color ? { color: change.color } : {}),
        startLocalDate: change.startDate, endLocalDate: change.endDate, activate: change.activate };
    }
    case 'rename-plan': return { kind: change.kind, planId: plan(change.plan)!, name: change.name };
    case 'set-plan-color': return { kind: change.kind, planId: plan(change.plan)!, color: change.color };
    case 'set-plan-lifecycle': return { kind: change.kind, planId: plan(change.plan)!, lifecycle: change.lifecycle };
    case 'shift-plan': return { kind: change.kind, planId: plan(change.plan)!, days: change.days };
    case 'create-workout': {
      if (locals.has(change.localKey)) invalid(`Duplicate localKey ${change.localKey}.`);
      const workoutId = safeEntityId('workout', randomId()); locals.set(change.localKey, { kind: 'workout', id: workoutId });
      return { kind: change.kind, workoutId, planId: plan(change.plan), localDate: change.localDate,
        title: change.title, structure: parseWorkoutStructureV1(change.structure), confirmPlanRangeExtension: true };
    }
    case 'update-workout': return { kind: change.kind, workoutId: workout(change.workout), planId: plan(change.plan),
      localDate: change.localDate, title: change.title, structure: parseWorkoutStructureV1(change.structure), confirmPlanRangeExtension: true };
    case 'move-workout': return { kind: change.kind, workoutId: workout(change.workout), planId: plan(change.plan),
      localDate: change.localDate, confirmPlanRangeExtension: true };
    case 'copy-workout': {
      if (locals.has(change.localKey)) invalid(`Duplicate localKey ${change.localKey}.`);
      const workoutId = safeEntityId('workout', randomId()); locals.set(change.localKey, { kind: 'workout', id: workoutId });
      return { kind: change.kind, sourceWorkoutId: workout(change.sourceWorkout), workoutId,
        planId: plan(change.plan), localDate: change.localDate, confirmPlanRangeExtension: true };
    }
    case 'set-workout-lifecycle': return { kind: change.kind, workoutId: workout(change.workout), lifecycle: change.lifecycle };
    case 'delete-workout': return { kind: change.kind, workoutId: workout(change.workout) };
  }
}

function mapDeliveryAction(operation: Pick<StoredProviderOperation, 'action'>): TrainingDeliveryAction {
  if (operation.action === 'enable') return 'configure';
  return operation.action;
}

function deliveryAvailability(preview: TrainingDeliveryPreviewV1): 'ready' | 'unavailable' | 'reconnect_required' | 'connection_repair' | 'pro_required' {
  if (!preview.hasPro && preview.effect !== 'remove-future-copies') return 'pro_required';
  if (!preview.available) return 'unavailable';
  if (preview.connection !== 'connected') return preview.connection;
  return 'ready';
}

function providerSummary(provider: PlannedWorkoutProviderId, action: StoredProviderOperation['action'], preview: TrainingDeliveryPreviewV1): string {
  const availability = deliveryAvailability(preview);
  if (availability === 'pro_required') return `${provider} delivery requires Pro.`;
  if (availability === 'unavailable') return `${provider} workout delivery is not enabled for this account.`;
  if (availability === 'reconnect_required') return `${provider} must be reconnected before delivery can change.`;
  if (availability === 'connection_repair') return `${provider} connection access must be repaired before delivery can change.`;
  const effect = action === 'stop' ? 'stop sync and withdraw eligible future copies'
    : action === 'check' ? 'queue a remote-copy check'
      : action === 'retry' ? 'retry the current delivery state'
        : action === 'approve' ? 'approve the current workout mapping differences'
          : 'enable ongoing workout delivery';
  return `${provider}: ${effect}; ${preview.eligibleCount} currently eligible, ${preview.warningCount} with mapping warnings.`;
}

async function previewProviderOperation(
  deps: TrainingWriteDependencies,
  uid: string,
  operation: ProviderOperationDraft,
  scheduleRevision: number,
  snapshot: TrainingScheduleSnapshotV1,
): Promise<{ preview: TrainingDeliveryPreviewV1; publicPreview: PreviewResult['providerPreviews'][number] }> {
  const scope = operation.targetType === 'plan' ? snapshot.plans.get(operation.targetId) : snapshot.workouts.get(operation.targetId);
  if (!scope) invalid(`The provider target for change ${operation.index + 1} is unavailable.`);
  const setting = await deps.db.collection('users').doc(uid).collection('trainingDeliverySettings')
    .doc(deliverySettingsId(operation.targetType, operation.targetId, operation.provider)).get();
  const command = {
    schemaVersion: 1 as const,
    mutationId: `mcp-preview-${operation.index}-${operation.provider}`,
    scope: operation.targetType,
    scopeId: operation.targetId,
    provider: operation.provider,
    action: mapDeliveryAction(operation),
    expectedScheduleRevision: scheduleRevision,
    expectedScopeRevision: scope.revision,
    expectedSettingsRevision: setting.exists ? Number(setting.get('revision') ?? 0) : 0,
    ...(operation.timeZone ? { timeZone: operation.timeZone } : {}),
    ...(operation.action === 'approve' ? { approvalDigest: '0'.repeat(64) } : {}),
  };
  let preview: TrainingDeliveryPreviewV1;
  try {
    preview = await trainingDeliveryCommand(deps.runtime, uid, command, true) as TrainingDeliveryPreviewV1;
  } catch (error) {
    const message = publicErrorMessage(error);
    if (message) invalid(message);
    unavailable('Provider delivery cannot be previewed safely right now. Try again later.');
  }
  return { preview: preview!, publicPreview: { index: operation.index, provider: operation.provider,
    targetType: operation.targetType, action: operation.action, availability: deliveryAvailability(preview!),
    timeZone: preview!.timeZone || null, eligibleCount: preview!.eligibleCount, warningCount: preview!.warningCount,
    summary: providerSummary(operation.provider, operation.action, preview!) } };
}

async function previewSimulatedProviderAvailability(
  deps: TrainingWriteDependencies,
  uid: string,
  operation: ProviderOperationDraft,
  snapshot: TrainingScheduleSnapshotV1,
): Promise<{ ready: boolean; settingsRevision: number; approvalDigest: string | null;
  publicPreview: PreviewResult['providerPreviews'][number] }> {
  const target = operation.targetType === 'plan'
    ? snapshot.plans.get(operation.targetId)
    : snapshot.workouts.get(operation.targetId);
  if (!target) invalid(`The provider target for change ${operation.index + 1} is unavailable.`);
  const user = deps.db.collection('users').doc(uid);
  const workout = operation.targetType === 'workout'
    ? snapshot.workouts.get(operation.targetId) ?? null
    : null;
  const [hasPro, connection, setting, inheritedPlanSetting] = await Promise.all([
    deps.runtime.hasPro(uid),
    deps.db.runTransaction(tx => deps.runtime.connection(tx, uid, operation.provider), { readOnly: true }),
    user.collection('trainingDeliverySettings')
      .doc(deliverySettingsId(operation.targetType, operation.targetId, operation.provider)).get(),
    workout?.planId
      ? user.collection('trainingDeliverySettings').doc(deliverySettingsId('plan', workout.planId, operation.provider)).get()
      : Promise.resolve(null),
  ]);
  const transport = deps.runtime.transport(operation.provider, uid);
  const inspectionAvailable = operation.action !== 'check'
    || (!!transport?.inspection && transport.inspection.policy.mode !== 'unavailable');
  const availability = !hasPro && !['stop'].includes(operation.action) ? 'pro_required'
    : !transport || !inspectionAvailable ? 'unavailable'
      : connection.state;
  const ready = availability === 'connected';
  const previous = setting.data() ?? {};
  const inherited = inheritedPlanSetting?.data() ?? {};
  const timeZone = workout?.planId
    ? String(inherited.timeZone ?? 'UTC')
    : operation.timeZone ?? String(previous.timeZone ?? 'UTC');
  const workouts = operation.targetType === 'workout'
    ? [workout!]
    : [...snapshot.workouts.values()].filter(item => item.planId === operation.targetId);
  const assessments = workouts.map(item => transport?.assess(item, connection.destinationKey, timeZone));
  const warningCount = assessments.filter(item => item && item.level !== 'exact').length;
  const today = trainingDeliveryLocalDate(deps.now(), timeZone);
  const eligibleCount = workouts.filter(item => item.lifecycle === 'planned' && item.localDate >= today
    && (!transport || (Date.parse(item.localDate) - Date.parse(today)) / 86_400_000 <= transport.horizonDays)).length;
  const preview: TrainingDeliveryPreviewV1 = {
    schemaVersion: 1,
    available: !!transport && inspectionAvailable,
    connection: connection.state,
    hasPro,
    timeZone,
    effect: operation.action === 'stop' ? 'remove-future-copies'
      : operation.action === 'retry' ? 'retry'
        : operation.action === 'approve' ? 'approve' : 'enable',
    settingsRevision: Number(previous.revision ?? 0),
    eligibleCount,
    warningCount,
    issues: assessments.flatMap(item => item?.issues ?? []).slice(0, 20),
    approvalDigest: operation.targetType === 'workout' && assessments[0]?.level === 'degraded'
      ? assessments[0].digest : null,
  };
  return { ready, settingsRevision: Number(previous.revision ?? 0), approvalDigest: preview.approvalDigest,
    publicPreview: { index: operation.index, provider: operation.provider,
    targetType: operation.targetType, action: operation.action,
    availability: ready ? 'ready' : availability,
    timeZone, eligibleCount, warningCount, summary: providerSummary(operation.provider, operation.action, preview) } };
}

function proposalRef(id: string, createdAtMs: number, uid: string, connectionId: string): string {
  return encodeOpaqueValue('training_proposal', { kind: 'proposal', id, createdAtMs }, uid, connectionId);
}

function decodeProposalRef(value: string, uid: string, connectionId: string): { id: string; createdAtMs: number } {
  let decoded: Record<string, unknown>;
  try { decoded = decodeOpaqueValue('training_proposal', value, uid, connectionId, 'Training proposal'); }
  catch { invalid('This Training proposal is invalid for the current connection.'); }
  const parsed = proposalPayload.safeParse(decoded!);
  if (!parsed.success) invalid('This Training proposal is invalid.');
  return { id: parsed.data.id, createdAtMs: parsed.data.createdAtMs };
}

export async function previewTrainingChanges(
  input: TrainingWriteInput,
  provided?: TrainingWriteDependencies,
): Promise<PreviewResult> {
  const deps = provided ?? defaultDependencies();
  assertBytes(input.arguments);
  const parsed = TRAINING_WRITE_INPUTS.preview_training_changes.safeParse(input.arguments);
  if (!parsed.success) invalid('Invalid Training change proposal. Use the advertised operation schema and at most 25 changes.');
  assertProviderActionsLast(parsed.data.changes);
  const required = requiredScopes(parsed.data.changes);
  assertScopes(input.scopes, required);
  const loaded = await loadSnapshot(deps, input.uid, input.connectionId, required);
  if (loaded.snapshot.state.revision !== parsed.data.expectedScheduleRevision) {
    invalid('The Training schedule changed. Read it again before preparing changes.');
  }
  const locals = new Map<string, { kind: 'plan' | 'workout'; id: string }>();
  const scheduleRequests: StoredScheduleOperation[] = [];
  const providerTemplates: Array<{ index: number; change: Extract<TrainingChange, { kind: 'provider-delivery' }> }> = [];
  let simulated = loaded.snapshot;
  const publicChanges: PreviewResult['changes'] = [];
  parsed.data.changes.forEach((change, index) => {
    if (change.kind === 'provider-delivery') {
      providerTemplates.push({ index, change });
      publicChanges.push({ index, kind: change.kind, summary: `${change.action} ${change.targetType} delivery.` });
      return;
    }
    const operation = resolveScheduleOperation(change, input, simulated, locals, deps.randomId);
    const request = parseMutateTrainingScheduleRequestV1({ mutationId: `mcp-proposal-${index}-${deps.randomId()}`,
      expectedRevisions: expectedRevisions(simulated, operation), operation });
    const before = simulated;
    try { simulated = applyTrainingScheduleMutation(simulated, request, deps.now() + index).after; }
    catch (error) { invalid(publicErrorMessage(error) ?? `Training change ${index + 1} is invalid.`); }
    scheduleRequests.push({ index, request });
    publicChanges.push({ index, kind: operation.kind, summary: describeScheduleEffects(operation, before, simulated) });
  });

  const providerOperations: StoredProviderOperation[] = [];
  const providerPreviews: PreviewResult['providerPreviews'] = [];
  const providerDestinations = new Set<string>();
  for (const template of providerTemplates) {
    const targetId = resolveReference(template.change.target, template.change.targetType, input, simulated, locals);
    if (template.change.targetType === 'plan' && ['send', 'resume', 'approve'].includes(template.change.action)) {
      invalid(`${template.change.action} is a workout-only delivery action.`);
    }
    if (template.change.targetType === 'workout' && template.change.action === 'enable') {
      invalid('Use send or resume for a workout; enable is for a plan.');
    }
    if (['enable', 'send'].includes(template.change.action) && !template.change.timeZone) {
      invalid('Initial provider delivery consent requires an IANA time zone.');
    }
    if (template.change.action === 'check' && template.change.timeZone) {
      invalid('A remote-copy check does not change the delivery time zone.');
    }
    let normalizedTimeZone: string | undefined;
    if (template.change.timeZone) {
      try { normalizedTimeZone = normalizeDeliveryTimeZone(template.change.timeZone); }
      catch (error) { invalid(error instanceof Error ? error.message : 'Choose a valid IANA time zone.'); }
    }
    const selected = template.change.providers === 'all_connected'
      ? [...PLANNED_WORKOUT_PROVIDER_IDS] : template.change.providers;
    let readyCount = 0;
    for (const provider of selected) {
      const operation: ProviderOperationDraft = { index: template.index, provider,
        targetType: template.change.targetType, targetId, action: template.change.action,
        ...(normalizedTimeZone ? { timeZone: normalizedTimeZone } : {}) };
      const destination = `${operation.targetType}:${operation.targetId}:${provider}`;
      if (providerDestinations.has(destination)) {
        invalid('One proposal cannot change the same workout or plan provider setting more than once.');
      }
      providerDestinations.add(destination);
      const originalTarget = operation.targetType === 'plan'
        ? loaded.snapshot.plans.get(targetId)
        : loaded.snapshot.workouts.get(targetId);
      const simulatedTarget = operation.targetType === 'plan'
        ? simulated.plans.get(targetId)
        : simulated.workouts.get(targetId);
      // Preview changed/new targets against the simulated authored result, never stale Firestore content.
      if (!originalTarget || JSON.stringify(originalTarget) !== JSON.stringify(simulatedTarget)
        || operation.action === 'check') {
        let assessed: Awaited<ReturnType<typeof previewSimulatedProviderAvailability>>;
        try {
          assessed = await previewSimulatedProviderAvailability(deps, input.uid, operation, simulated);
        } catch (error) {
          const message = publicErrorMessage(error);
          if (message) invalid(message);
          unavailable('Provider delivery cannot be previewed safely right now. Try again later.');
        }
        providerPreviews.push(assessed.publicPreview);
        if (operation.action === 'approve' && !assessed.approvalDigest) {
          invalid('The current workout mapping no longer needs or permits approval.');
        }
        if (assessed.ready || template.change.providers !== 'all_connected') providerOperations.push({ ...operation,
          expectedScheduleRevision: simulated.state.revision,
          expectedScopeRevision: simulatedTarget!.revision,
          expectedSettingsRevision: assessed.settingsRevision,
          ...(assessed.approvalDigest ? { approvalDigest: assessed.approvalDigest } : {}) });
        if (assessed.ready) readyCount += 1;
        continue;
      }
      const previewed = await previewProviderOperation(deps, input.uid, operation, loaded.snapshot.state.revision, loaded.snapshot);
      providerPreviews.push(previewed.publicPreview);
      const storedOperation: StoredProviderOperation = { ...operation,
        expectedScheduleRevision: simulated.state.revision,
        expectedScopeRevision: simulatedTarget!.revision,
        expectedSettingsRevision: previewed.preview.settingsRevision,
        ...(previewed.preview.approvalDigest ? { approvalDigest: previewed.preview.approvalDigest } : {}) };
      if (operation.action === 'approve' && !storedOperation.approvalDigest) {
        invalid('The current workout mapping no longer needs or permits approval.');
      }
      if (deliveryAvailability(previewed.preview) === 'ready') { providerOperations.push(storedOperation); readyCount += 1; }
      else if (template.change.providers !== 'all_connected') providerOperations.push(storedOperation);
    }
    if (template.change.providers === 'all_connected' && readyCount === 0) {
      invalid('No connected, rollout-enabled provider is currently eligible for this delivery action.');
    }
  }

  const createdAtMs = deps.now();
  const expiresAtMs = createdAtMs + PROPOSAL_LIFETIME_MS;
  const proposalId = `proposal-${deps.randomId().replace(/[^A-Za-z0-9_-]/g, '')}`.slice(0, 128);
  const ref = proposalRef(proposalId, createdAtMs, input.uid, input.connectionId);
  const preview: PreviewResult = { proposalRef: ref, expiresAtMs, permissionMode: permissionMode(required),
    scheduleRevision: loaded.snapshot.state.revision,
    summary: `${publicChanges.length} proposed Training change${publicChanges.length === 1 ? '' : 's'} will be applied in order after confirmation. Provider results are independent.`,
    requiresConfirmation: true, changes: publicChanges, providerPreviews };
  TRAINING_WRITE_OUTPUTS.preview_training_changes.parse(preview);
  const stored: StoredProposal = { schemaVersion: 1, uid: input.uid, connectionId: input.connectionId,
    accessGeneration: loaded.accessGeneration, requiredScopes: required, createdAtMs, expiresAtMs,
    expireAt: Timestamp.fromMillis(expiresAtMs), status: 'pending', leaseUntilMs: null, nextScheduleOperation: 0,
    scheduleRequests, providerOperations, localEntities: [...locals].map(([localKey, value]) => ({ localKey, ...value })),
    preview, changeResults: [], providerResults: [] };
  await deps.db.runTransaction(async tx => {
    const generation = await assertAuthorityInTransaction(deps, tx, input.uid, input.connectionId, required, loaded.accessGeneration);
    if (generation !== loaded.accessGeneration) invalid('The MCP permission grant changed. Prepare the Training change again.');
    const state = await tx.get(deps.db.collection('users').doc(input.uid).collection('trainingPlanState').doc('current'));
    if ((state.get('revision') ?? 0) !== loaded.snapshot.state.revision) invalid('The Training schedule changed. Prepare the change again.');
    tx.create(deps.db.collection('users').doc(input.uid).collection(PROPOSALS).doc(proposalId), stored);
  });
  return preview;
}

/**
 * Focused single-workout authoring entry point. The server owns the proposal-local
 * key so clients only need to describe the workout they actually want to create.
 */
export async function previewCreatePlannedWorkout(
  input: TrainingWriteInput,
  provided?: TrainingWriteDependencies,
): Promise<PreviewResult> {
  assertBytes(input.arguments);
  const parsed = TRAINING_WRITE_INPUTS.preview_create_planned_workout.safeParse(input.arguments);
  if (!parsed.success) {
    invalid('Invalid planned workout. Provide the schedule revision, date, title, optional plan reference, and complete advertised workout structure.');
  }
  return previewTrainingChanges({
    ...input,
    arguments: {
      expectedScheduleRevision: parsed.data.expectedScheduleRevision,
      changes: [{
        kind: 'create-workout',
        localKey: 'created_workout',
        plan: parsed.data.planRef ? { ref: parsed.data.planRef } : null,
        localDate: parsed.data.localDate,
        title: parsed.data.title,
        structure: parsed.data.structure,
      }, ...(parsed.data.delivery ? [{
        kind: 'provider-delivery' as const,
        targetType: 'workout' as const,
        target: { localKey: 'created_workout' },
        providers: parsed.data.delivery.providers,
        action: 'send' as const,
        timeZone: parsed.data.delivery.timeZone,
      }] : [])],
    },
  }, provided);
}

async function readProposal(input: TrainingWriteInput, deps: TrainingWriteDependencies): Promise<{ ref: string; id: string; proposal: StoredProposal }> {
  const args = TRAINING_WRITE_INPUTS.apply_training_changes.safeParse(input.arguments);
  if (!args.success) invalid('A valid Training proposal reference is required.');
  const decoded = decodeProposalRef(args.data.proposalRef, input.uid, input.connectionId);
  const snapshot = await deps.db.collection('users').doc(input.uid).collection(PROPOSALS).doc(decoded.id).get();
  const proposal = snapshot.data() as StoredProposal | undefined;
  if (!snapshot.exists || !proposal || proposal.schemaVersion !== 1 || proposal.uid !== input.uid
    || proposal.connectionId !== input.connectionId || proposal.createdAtMs !== decoded.createdAtMs) {
    invalid('This Training proposal is unavailable. Prepare it again.');
  }
  assertScopes(input.scopes, proposal.requiredScopes);
  if (args.data.permissionMode !== permissionMode(proposal.requiredScopes)) {
    invalid('The proposal permission mode does not match. Prepare it again.');
  }
  return { ref: args.data.proposalRef, id: decoded.id, proposal };
}

export async function getTrainingProposalConfirmation(
  input: TrainingWriteInput,
  provided?: TrainingWriteDependencies,
): Promise<{ message: string; proposal: PreviewResult }> {
  const deps = provided ?? defaultDependencies();
  const current = await readProposal(input, deps);
  if (current.proposal.status === 'applied' || current.proposal.status === 'partially_applied') {
    return { message: 'This Training proposal was already applied.', proposal: current.proposal.preview };
  }
  if (current.proposal.expiresAtMs <= deps.now()) invalid('This Training proposal expired. Prepare it again.');
  return { message: `${current.proposal.preview.summary} Confirm only if the displayed plan, workout and provider changes are correct.`,
    proposal: current.proposal.preview };
}

async function currentDeliveryCommand(
  deps: TrainingWriteDependencies,
  uid: string,
  connectionId: string,
  requiredScopes: readonly string[],
  expectedAccessGeneration: string,
  assistantProposalRef: string,
  operation: StoredProviderOperation,
  mutationId: string,
): Promise<Record<string, unknown>> {
  const action = mapDeliveryAction(operation);
  const base = { schemaVersion: 1 as const, mutationId, scope: operation.targetType, scopeId: operation.targetId,
    provider: operation.provider, action, expectedScheduleRevision: operation.expectedScheduleRevision,
    expectedScopeRevision: operation.expectedScopeRevision, expectedSettingsRevision: operation.expectedSettingsRevision,
    ...(operation.timeZone ? { timeZone: operation.timeZone } : {}),
    ...(operation.approvalDigest ? { approvalDigest: operation.approvalDigest } : {}) };
  if (action === 'check') {
    return await trainingDeliveryCommand(deps.runtime, uid, base, false,
      tx => assertAuthorityInTransaction(deps, tx, uid, connectionId, requiredScopes, expectedAccessGeneration,
        connectionId.startsWith('first-party-assistant-v1:') ? assistantProposalRef : undefined)
        .then(() => undefined)) as unknown as Record<string, unknown>;
  }
  if (action === 'approve' && !operation.approvalDigest) invalid('The confirmed compatibility approval is unavailable. Prepare it again.');
  return await trainingDeliveryCommand(deps.runtime, uid, base, false,
    tx => assertAuthorityInTransaction(deps, tx, uid, connectionId, requiredScopes, expectedAccessGeneration,
      connectionId.startsWith('first-party-assistant-v1:') ? assistantProposalRef : undefined)
      .then(() => undefined)) as unknown as Record<string, unknown>;
}

export async function applyTrainingChanges(
  input: TrainingWriteInput,
  provided?: TrainingWriteDependencies,
): Promise<ApplyResult> {
  const deps = provided ?? defaultDependencies();
  const current = await readProposal(input, deps);
  const ref = current.ref;
  const proposalRefDoc = deps.db.collection('users').doc(input.uid).collection(PROPOSALS).doc(current.id);
  let proposal = await deps.db.runTransaction(async tx => {
    await assertAuthorityInTransaction(deps, tx, input.uid, input.connectionId, current.proposal.requiredScopes,
      current.proposal.accessGeneration,
      input.connectionId.startsWith('first-party-assistant-v1:') ? current.ref : undefined);
    const snapshot = await tx.get(proposalRefDoc);
    const value = snapshot.data() as StoredProposal | undefined;
    if (!value || value.createdAtMs !== current.proposal.createdAtMs) invalid('This Training proposal is unavailable.');
    if (value.result) return value;
    const now = deps.now();
    if (value.expiresAtMs <= now && value.status === 'pending') invalid('This Training proposal expired. Prepare it again.');
    if (value.status === 'applying' && (value.leaseUntilMs ?? 0) > now) invalid('This Training proposal is already being applied.');
    const next = { ...value, status: 'applying' as const, leaseUntilMs: now + APPLY_LEASE_MS };
    tx.update(proposalRefDoc, { status: next.status, leaseUntilMs: next.leaseUntilMs });
    return next;
  });
  if (proposal.result) return TRAINING_WRITE_OUTPUTS.apply_training_changes.parse(proposal.result);

  const changeResults = [...proposal.changeResults];
  for (let index = proposal.nextScheduleOperation; index < proposal.scheduleRequests.length; index += 1) {
    const storedOperation = proposal.scheduleRequests[index];
    const request = storedOperation.request;
    try {
      await deps.db.runTransaction(tx => assertAuthorityInTransaction(deps, tx, input.uid, input.connectionId,
        proposal.requiredScopes, proposal.accessGeneration,
        input.connectionId.startsWith('first-party-assistant-v1:') ? current.ref : undefined), { readOnly: true });
      await mutateTrainingScheduleForUser(input.uid, request, {
        db: deps.db,
        nowMs: proposal.createdAtMs + index,
        transactionPrecondition: tx => assertAuthorityInTransaction(deps, tx, input.uid, input.connectionId,
          proposal.requiredScopes, proposal.accessGeneration,
          input.connectionId.startsWith('first-party-assistant-v1:') ? current.ref : undefined).then(() => undefined),
      });
      changeResults.push({ index: storedOperation.index,
        kind: request.operation.kind, status: 'applied', message: describeOperation(request.operation) });
      await proposalRefDoc.update({ nextScheduleOperation: index + 1, changeResults,
        leaseUntilMs: deps.now() + APPLY_LEASE_MS });
    } catch (error) {
      changeResults.push({ index: storedOperation.index, kind: request.operation.kind, status: 'failed',
        message: publicErrorMessage(error) ?? 'The schedule change could not be applied safely. Read the latest schedule and prepare it again.' });
      break;
    }
  }

  const completedSchedule = changeResults.filter(item => item.status !== 'failed').length >= proposal.scheduleRequests.length;
  const providerResults = [...proposal.providerResults];
  if (completedSchedule) {
    for (let index = providerResults.length; index < proposal.providerOperations.length; index += 1) {
      const operation = proposal.providerOperations[index];
      try {
        await deps.db.runTransaction(tx => assertAuthorityInTransaction(deps, tx, input.uid, input.connectionId,
          proposal.requiredScopes, proposal.accessGeneration,
          input.connectionId.startsWith('first-party-assistant-v1:') ? current.ref : undefined), { readOnly: true });
        await currentDeliveryCommand(deps, input.uid, input.connectionId, proposal.requiredScopes,
          proposal.accessGeneration, current.ref, operation, `mcp-${current.id}-${index}`.slice(0, 128));
        providerResults.push({ index: operation.index, provider: operation.provider,
          status: operation.action === 'check' ? 'queued' : 'applied',
          message: operation.action === 'check' ? 'Remote-copy verification was queued.' : 'Delivery preferences were updated and reconciliation was queued.' });
      } catch (error) {
        providerResults.push({ index: operation.index, provider: operation.provider, status: 'blocked',
          message: publicErrorMessage(error) ?? 'Provider delivery is currently unavailable. Review its connection and try again.' });
      }
      await proposalRefDoc.update({ providerResults, leaseUntilMs: deps.now() + APPLY_LEASE_MS });
    }
  }

  const state = await deps.db.collection('users').doc(input.uid).collection('trainingPlanState').doc('current').get();
  const createdReferences: ApplyResult['createdReferences'] = [];
  for (const local of proposal.localEntities) {
    const doc = await deps.db.collection('users').doc(input.uid)
      .collection(local.kind === 'plan' ? 'trainingPlans' : 'scheduledWorkouts').doc(local.id).get();
    if (doc.exists) createdReferences.push({ localKey: local.localKey, kind: local.kind,
      reference: encodeOpaqueValue('training_read', { kind: local.kind, id: local.id,
        createdAtMs: Number(doc.get('createdAtMs')) }, input.uid, input.connectionId) });
  }
  const partial = changeResults.some(item => item.status === 'failed') || providerResults.some(item => ['blocked', 'failed'].includes(item.status));
  const result: ApplyResult = { proposalRef: ref, status: partial ? 'partially_applied' : 'applied',
    scheduleRevision: Number(state.get('revision') ?? 0), changes: changeResults,
    providers: providerResults, createdReferences };
  TRAINING_WRITE_OUTPUTS.apply_training_changes.parse(result);
  proposal = { ...proposal, status: result.status, result, changeResults, providerResults,
    leaseUntilMs: null, expireAt: Timestamp.fromMillis(deps.now() + PROPOSAL_RESULT_LIFETIME_MS) };
  await proposalRefDoc.set({ status: proposal.status, result, changeResults, providerResults, leaseUntilMs: null,
    expireAt: proposal.expireAt }, { merge: true });
  await deps.db.runTransaction(tx => assertAuthorityInTransaction(deps, tx, input.uid, input.connectionId,
    proposal.requiredScopes, proposal.accessGeneration,
    input.connectionId.startsWith('first-party-assistant-v1:') ? current.ref : undefined), { readOnly: true });
  return result;
}
