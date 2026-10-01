import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import {
  parseMutateWorkoutLibraryRequestV1,
  parsePlaceWorkoutLibraryRequestV1,
  parseWorkoutLibraryItemV1,
  WORKOUT_LIBRARY_MAX_ITEMS,
  WorkoutLibraryContractError,
  type MutateWorkoutLibraryRequestV1,
  type PlaceWorkoutLibraryRequestV1,
} from '../../../shared/workout-library';
import { parseScheduledWorkoutV1, parseTrainingPlanV1,
  TRAINING_PLAN_MAX_CURRENT_WORKOUTS } from '../../../shared/training-plans';
import { parseStrengthWorkoutDetailsV1, strengthProjectionMatchesDetails } from '../../../shared/strength-workout';
import { mutateWorkoutLibraryForUser, placeWorkoutLibraryForUser } from '../training-plans/workout-library';
import { TrainingScheduleMutationError } from '../training-plans/mutation';
import { decodeOpaqueValue, encodeOpaqueValue, McpDataError } from './data.service';
import { TRAINING_PLANS_SCOPE, TRAINING_PLANS_WRITE_SCOPE, TRAINING_WRITE_INPUTS,
  TRAINING_WRITE_OUTPUTS } from './training-plans.schemas';
import { assertAuthorityInTransaction, type TrainingWriteInput } from './training-plans-write.service';

const PROPOSALS = 'trainingMcpLibraryProposals';
const PROPOSAL_TTL_MS = 15 * 60 * 1000;
const RESULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REQUIRED_SCOPES = [TRAINING_PLANS_SCOPE, TRAINING_PLANS_WRITE_SCOPE] as const;
const reference = z.strictObject({ kind: z.enum(['saved-workout', 'workout', 'plan']),
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  createdAtMs: z.number().int().nonnegative().safe() });
const proposalReference = z.strictObject({ kind: z.literal('library-proposal'),
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  createdAtMs: z.number().int().nonnegative().safe() });
type Preview = z.infer<typeof TRAINING_WRITE_OUTPUTS.preview_saved_workout_change>;
type Result = z.infer<typeof TRAINING_WRITE_OUTPUTS.apply_saved_workout_change>;
type Request = MutateWorkoutLibraryRequestV1 | PlaceWorkoutLibraryRequestV1;

interface StoredLibraryProposal {
  schemaVersion: 1;
  uid: string;
  connectionId: string;
  accessGeneration: string;
  createdAtMs: number;
  expiresAtMs: number;
  expireAt: Timestamp;
  expectedScheduleRevision: number;
  expectedLibraryRevision: number;
  kind: Result['kind'];
  request: Request;
  savedItemCreatedAtMs: number | null;
  preview: Preview;
  result?: Result;
}

export interface LibraryWriteDependencies {
  db: FirebaseFirestore.Firestore;
  now(): number;
  randomId(): string;
}

function defaultDependencies(): LibraryWriteDependencies {
  return { db: admin.firestore(), now: Date.now, randomId: randomUUID };
}

function invalid(message: string): never { throw new McpDataError('invalid_request', message); }

function decodeReference(value: string, kind: 'saved-workout' | 'workout' | 'plan', input: TrainingWriteInput) {
  let decoded: Record<string, unknown>;
  try { decoded = decodeOpaqueValue('training_read', value, input.uid, input.connectionId, 'Training reference'); }
  catch { invalid('This Training reference does not belong to the current connection.'); }
  const parsed = reference.safeParse(decoded!);
  if (!parsed.success || parsed.data.kind !== kind) invalid(`Expected a current ${kind} reference.`);
  return parsed.data;
}

function encodeReference(kind: 'saved-workout' | 'workout', id: string, createdAtMs: number,
  input: TrainingWriteInput): string {
  return encodeOpaqueValue('training_read', { kind, id, createdAtMs }, input.uid, input.connectionId);
}

function proposalRef(id: string, createdAtMs: number, input: TrainingWriteInput): string {
  return encodeOpaqueValue('training_proposal', { kind: 'library-proposal', id, createdAtMs },
    input.uid, input.connectionId);
}

export function isWorkoutLibraryProposalRef(input: TrainingWriteInput, value: string): boolean {
  try {
    return proposalReference.safeParse(decodeOpaqueValue('training_proposal', value,
      input.uid, input.connectionId, 'Training proposal')).success;
  } catch { return false; }
}

export async function previewSavedWorkoutChange(input: TrainingWriteInput,
  provided?: LibraryWriteDependencies): Promise<Preview> {
  const deps = provided ?? defaultDependencies();
  const encodedArguments = JSON.stringify(input.arguments);
  if (typeof encodedArguments !== 'string') invalid('Provide one valid saved-workout change.');
  if (Buffer.byteLength(encodedArguments, 'utf8') > 256 * 1024) invalid('The library proposal is too large.');
  const parsed = TRAINING_WRITE_INPUTS.preview_saved_workout_change.safeParse(input.arguments);
  if (!parsed.success) invalid('Provide one valid saved-workout change, exact revisions, and explicit dates when placing it.');
  if (REQUIRED_SCOPES.some(scope => !input.scopes.includes(scope))) invalid('Training plan read and write permission is required.');
  const user = deps.db.collection('users').doc(input.uid);
  const stateRef = user.collection('trainingPlanState').doc('current');
  const libraryStateRef = stateRef.collection('workoutLibraryState').doc('current');
  const change = parsed.data.change;
  const nowMs = deps.now();
  const id = `library-proposal-${deps.randomId()}`;
  const ref = proposalRef(id, nowMs, input);
  try { return await deps.db.runTransaction(async tx => {
    const generation = await assertAuthorityInTransaction(deps, tx, input.uid, input.connectionId, REQUIRED_SCOPES);
    const [state, libraryState] = await Promise.all([tx.get(stateRef), tx.get(libraryStateRef)]);
    const scheduleRevision = Number(state.get('revision') ?? 0);
    const libraryRevision = Number(libraryState.get('revision') ?? 0);
    if (scheduleRevision !== parsed.data.expectedScheduleRevision
      || libraryRevision !== parsed.data.expectedLibraryRevision) {
      invalid('The Training schedule or workout library changed. Read the current records and preview again.');
    }
    if (change.kind === 'create' || change.kind === 'save-workout' || change.kind === 'copy') {
      const existing = await tx.get(user.collection('workoutLibrary').limit(WORKOUT_LIBRARY_MAX_ITEMS));
      if (existing.size >= WORKOUT_LIBRARY_MAX_ITEMS) invalid('The saved-workout library is full. Remove an entry first.');
    }
    if (change.kind === 'place') {
      const currentWorkoutCount = Number(state.get('currentWorkoutCount') ?? 0);
      if (!Number.isSafeInteger(currentWorkoutCount) || currentWorkoutCount < 0) {
        invalid('The Training schedule state is invalid. Reload it before placing workouts.');
      }
      if (currentWorkoutCount + change.dates.length > TRAINING_PLAN_MAX_CURRENT_WORKOUTS) {
        invalid('These dates would exceed the 400-workout schedule limit. Choose fewer dates.');
      }
    }
    let savedItemId = `lib-mcp-${deps.randomId()}`;
    let savedItemCreatedAtMs: number | null = null;
    let sourceWorkoutId: string | null = null;
    let planId: string | null = null;
    let expectedPlanRevision: number | null = null;
    let planRangePreview: string | null = null;
    let title = '';
    if ('savedWorkoutRef' in change) {
      const target = decodeReference(change.savedWorkoutRef, 'saved-workout', input);
      const snapshot = await tx.get(user.collection('workoutLibrary').doc(target.id));
      if (!snapshot.exists) invalid('The saved workout is no longer available.');
      const item = parseWorkoutLibraryItemV1(snapshot.data());
      if (item.id !== target.id || item.createdAtMs !== target.createdAtMs
        || item.revision !== change.expectedRevision) invalid('The saved workout changed. Read it again.');
      if (change.kind === 'place' && item.status !== 'active') invalid('Archived workouts cannot be placed.');
      savedItemId = item.id;
      savedItemCreatedAtMs = item.createdAtMs;
      title = item.title;
    }
    if (change.kind === 'save-workout') {
      const target = decodeReference(change.workoutRef, 'workout', input);
      const workoutRef = user.collection('scheduledWorkouts').doc(target.id);
      const snapshot = await tx.get(workoutRef);
      if (!snapshot.exists) invalid('The source workout is no longer available.');
      const workout = parseScheduledWorkoutV1(snapshot.data());
      if (workout.id !== target.id || workout.createdAtMs !== target.createdAtMs
        || workout.revision !== change.expectedWorkoutRevision || workout.lifecycle === 'deleted') {
        invalid('The source workout changed. Read it again.');
      }
      if (workout.structure.sport === ActivityTypes.StrengthTraining) {
        const detailsDoc = await tx.get(workoutRef.collection('strengthDetails').doc('current'));
        if (!detailsDoc.exists) invalid('The source workout has incomplete strength details.');
        const details = parseStrengthWorkoutDetailsV1(detailsDoc.data());
        if (details.workoutId !== workout.id || !strengthProjectionMatchesDetails(workout.structure, details)) {
          invalid('The source workout has inconsistent strength details.');
        }
      }
      sourceWorkoutId = workout.id;
      title = workout.title;
    }
    if (change.kind === 'create' || change.kind === 'update') title = change.title;
    if (change.kind === 'place' && change.planRef !== null) {
      const target = decodeReference(change.planRef, 'plan', input);
      const planDoc = await tx.get(user.collection('trainingPlans').doc(target.id));
      if (!planDoc.exists) invalid('The destination plan is no longer available.');
      const plan = parseTrainingPlanV1(planDoc.data());
      if (plan.id !== target.id || plan.createdAtMs !== target.createdAtMs
        || plan.revision !== change.expectedPlanRevision || plan.lifecycle === 'archived') {
        invalid('The destination plan changed. Read it again.');
      }
      planId = plan.id;
      expectedPlanRevision = plan.revision;
      const start = change.dates[0] < plan.startLocalDate ? change.dates[0] : plan.startLocalDate;
      const end = change.dates[change.dates.length - 1] > plan.endLocalDate
        ? change.dates[change.dates.length - 1] : plan.endLocalDate;
      if (start !== plan.startLocalDate || end !== plan.endLocalDate) planRangePreview = `${start}–${end}`;
      if ((start !== plan.startLocalDate || end !== plan.endLocalDate) && !change.confirmPlanRangeExtension) {
        invalid(`Placing these workouts would extend the plan to ${start}–${end}. Confirm that range and preview again.`);
      }
      const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
      if (days > 366) invalid('The destination plan would exceed 366 days.');
    } else if (change.kind === 'place' && change.expectedPlanRevision !== null) {
      invalid('Standalone placement has no plan revision.');
    }
    const request: Request = change.kind === 'place'
      ? parsePlaceWorkoutLibraryRequestV1({ mutationId: `mcp-${id}`, itemId: savedItemId,
        expectedTemplateRevision: change.expectedRevision, expectedStateRevision: scheduleRevision,
        planId, expectedPlanRevision, dates: change.dates,
        confirmPlanRangeExtension: change.confirmPlanRangeExtension })
      : parseMutateWorkoutLibraryRequestV1({ mutationId: `mcp-${id}`, operation: (() => {
        switch (change.kind) {
          case 'create': return { kind: 'create', itemId: savedItemId, title: change.title,
            structure: change.structure, ...(change.strength ? { strength: change.strength } : {}) };
          case 'save-workout': return { kind: 'save-workout', itemId: savedItemId,
            sourceWorkoutId: sourceWorkoutId!, expectedSourceRevision: change.expectedWorkoutRevision };
          case 'copy': return { kind: 'copy', itemId: `lib-mcp-${deps.randomId()}`,
            sourceItemId: savedItemId, expectedSourceRevision: change.expectedRevision };
          case 'update': return { kind: 'update', itemId: savedItemId, expectedRevision: change.expectedRevision,
            title: change.title, structure: change.structure,
            ...(change.strength ? { strength: change.strength } : {}) };
          case 'set-status': return { kind: 'set-status', itemId: savedItemId,
            expectedRevision: change.expectedRevision, status: change.status };
          case 'delete': return { kind: 'delete', itemId: savedItemId,
            expectedRevision: change.expectedRevision, confirmDeletion: true };
        }
      })() });
    const summary = change.kind === 'place'
      ? `Place “${title}” on ${change.dates.length} explicit date${change.dates.length === 1 ? '' : 's'} in ${planId ? 'the selected plan' : 'Standalone'}.${planRangePreview ? ` Extend the plan range to ${planRangePreview}.` : ''} The copies have independent identities and no completion links. Existing plan sync preferences may send plan copies; standalone copies are not opted in.`
      : change.kind === 'delete'
        ? `Permanently remove “${title}” from the saved-workout library. Already scheduled workouts and their history stay unchanged.`
        : `${change.kind === 'set-status' ? change.status === 'active' ? 'Restore' : 'Archive' : change.kind === 'save-workout' ? 'Save the scheduled workout as a' : change.kind === 'copy' ? 'Duplicate the' : change.kind === 'update' ? 'Update the' : 'Create a'} saved workout “${title}”. Already scheduled workouts are independent and will not change.`;
    const changes: Preview['changes'] = change.kind === 'place'
      ? Array.from({ length: Math.ceil(change.dates.length / 20) }, (_, index) => ({
        index, kind: 'place', summary: `Dates ${index * 20 + 1}–${Math.min((index + 1) * 20, change.dates.length)}: ${change.dates.slice(index * 20, (index + 1) * 20).join(', ')}`,
      }))
      : [{ index: 0, kind: change.kind, summary: summary.slice(0, 500) }];
    const preview: Preview = { proposalRef: ref, expiresAtMs: nowMs + PROPOSAL_TTL_MS,
      permissionMode: 'schedule', scheduleRevision, summary: summary.slice(0, 1000),
      requiresConfirmation: true, changes,
      providerPreviews: [] };
    TRAINING_WRITE_OUTPUTS.preview_saved_workout_change.parse(preview);
    const stored: StoredLibraryProposal = { schemaVersion: 1, uid: input.uid, connectionId: input.connectionId,
      accessGeneration: generation, createdAtMs: nowMs, expiresAtMs: nowMs + PROPOSAL_TTL_MS,
      expireAt: Timestamp.fromMillis(nowMs + PROPOSAL_TTL_MS), expectedScheduleRevision: scheduleRevision,
      expectedLibraryRevision: libraryRevision, kind: change.kind, request, savedItemCreatedAtMs, preview };
    tx.create(user.collection(PROPOSALS).doc(id), stored);
    return preview;
  }); } catch (error) {
    if (error instanceof WorkoutLibraryContractError) {
      invalid('The saved-workout recipe or placement is invalid. Review the current records and preview again.');
    }
    throw error;
  }
}

class AlreadyApplied extends Error { constructor(readonly result: Result) { super('already applied'); } }

export async function applySavedWorkoutChange(input: TrainingWriteInput,
  provided?: LibraryWriteDependencies): Promise<Result> {
  const deps = provided ?? defaultDependencies();
  const args = TRAINING_WRITE_INPUTS.apply_saved_workout_change.safeParse(input.arguments);
  if (!args.success) invalid('A valid saved-workout proposal reference is required.');
  if (REQUIRED_SCOPES.some(scope => !input.scopes.includes(scope))) invalid('Training plan read and write permission is required.');
  const decoded = proposalReference.safeParse(decodeOpaqueValue('training_proposal', args.data.proposalRef,
    input.uid, input.connectionId, 'Saved-workout proposal'));
  if (!decoded.success) invalid('This is not a saved-workout proposal.');
  const user = deps.db.collection('users').doc(input.uid);
  const proposalDoc = user.collection(PROPOSALS).doc(decoded.data.id);
  const storedDoc = await proposalDoc.get();
  const stored = storedDoc.data() as StoredLibraryProposal | undefined;
  if (!stored || stored.schemaVersion !== 1 || stored.uid !== input.uid
    || stored.connectionId !== input.connectionId || stored.createdAtMs !== decoded.data.createdAtMs
    || typeof stored.accessGeneration !== 'string' || !stored.accessGeneration
    || !Number.isSafeInteger(stored.expiresAtMs) || stored.expiresAtMs < stored.createdAtMs
    || !Number.isSafeInteger(stored.expectedScheduleRevision) || stored.expectedScheduleRevision < 0
    || !Number.isSafeInteger(stored.expectedLibraryRevision) || stored.expectedLibraryRevision < 0
    || !stored.request || typeof stored.request !== 'object') {
    invalid('This saved-workout proposal is unavailable. Preview it again.');
  }
  let request: Request;
  try {
    request = 'operation' in stored.request
      ? parseMutateWorkoutLibraryRequestV1(stored.request)
      : parsePlaceWorkoutLibraryRequestV1(stored.request);
  } catch {
    invalid('This saved-workout proposal is invalid. Preview it again.');
  }
  if (request.mutationId !== `mcp-${decoded.data.id}`) {
    invalid('This saved-workout proposal is invalid. Preview it again.');
  }
  if (('operation' in request && request.operation.kind !== stored.kind)
    || (!('operation' in request) && (stored.kind !== 'place'
      || !Number.isSafeInteger(stored.savedItemCreatedAtMs)))) {
    invalid('This saved-workout proposal is invalid. Preview it again.');
  }
  const precondition = async (tx: FirebaseFirestore.Transaction): Promise<void> => {
    await assertAuthorityInTransaction(deps, tx, input.uid, input.connectionId, REQUIRED_SCOPES,
      stored.accessGeneration, input.connectionId.startsWith('first-party-assistant-v1:')
        ? args.data.proposalRef : undefined);
    const current = await tx.get(proposalDoc);
    const proposal = current.data() as StoredLibraryProposal | undefined;
    if (!proposal || proposal.createdAtMs !== stored.createdAtMs
      || proposal.uid !== stored.uid || proposal.connectionId !== stored.connectionId
      || proposal.accessGeneration !== stored.accessGeneration || proposal.kind !== stored.kind
      || proposal.expectedScheduleRevision !== stored.expectedScheduleRevision
      || proposal.expectedLibraryRevision !== stored.expectedLibraryRevision
      || proposal.savedItemCreatedAtMs !== stored.savedItemCreatedAtMs
      || JSON.stringify(proposal.request) !== JSON.stringify(stored.request)) {
      invalid('This proposal changed. Preview it again.');
    }
    if (proposal.result) {
      const result = TRAINING_WRITE_OUTPUTS.apply_saved_workout_change.parse(proposal.result);
      if (result.proposalRef !== args.data.proposalRef) invalid('The saved-workout proposal result is invalid.');
      throw new AlreadyApplied(result);
    }
    if (proposal.expiresAtMs <= deps.now()) invalid('This proposal expired. Preview it again.');
    const [schedule, library] = await Promise.all([
      tx.get(user.collection('trainingPlanState').doc('current')),
      tx.get(user.collection('trainingPlanState').doc('current').collection('workoutLibraryState').doc('current')),
    ]);
    if (Number(schedule.get('revision') ?? 0) !== proposal.expectedScheduleRevision
      || Number(library.get('revision') ?? 0) !== proposal.expectedLibraryRevision) {
      invalid('The Training schedule or workout library changed. Read the current records and preview again.');
    }
  };
  const resultFor = (libraryRevision: number, scheduleRevision: number,
    itemId: string | null, itemCreatedAtMs: number | null,
    workoutIds: readonly string[], workoutCreatedAtMs: number): Result => ({
    proposalRef: args.data.proposalRef, status: 'applied', kind: stored.kind,
    libraryRevision, scheduleRevision,
    savedWorkoutRef: itemId && itemCreatedAtMs !== null
      ? encodeReference('saved-workout', itemId, itemCreatedAtMs, input) : null,
    workoutRefs: workoutIds.map(id => encodeReference('workout', id, workoutCreatedAtMs, input)),
  });
  const committedResult = () => deps.db.runTransaction(async tx => {
    await assertAuthorityInTransaction(deps, tx, input.uid, input.connectionId, REQUIRED_SCOPES,
      stored.accessGeneration, input.connectionId.startsWith('first-party-assistant-v1:')
        ? args.data.proposalRef : undefined);
    const latest = (await tx.get(proposalDoc)).data() as StoredLibraryProposal | undefined;
    if (!latest?.result) invalid('The saved-workout result is unavailable. Read the current records before retrying.');
    const result = TRAINING_WRITE_OUTPUTS.apply_saved_workout_change.parse(latest.result);
    if (result.proposalRef !== args.data.proposalRef) invalid('The saved-workout proposal result is invalid.');
    return result;
  }, { readOnly: true });
  try {
    if ('operation' in request) {
      let result!: Result;
      await mutateWorkoutLibraryForUser(input.uid, request, { db: deps.db, nowMs: deps.now(),
        transactionPrecondition: precondition,
        transactionPostcondition: (tx, response) => {
          const item = response.item;
          result = resultFor(stored.expectedLibraryRevision + 1, stored.expectedScheduleRevision,
            item?.id ?? null, item?.createdAtMs ?? null, [], 0);
          tx.update(proposalDoc, { result, expireAt: Timestamp.fromMillis(deps.now() + RESULT_TTL_MS) });
        } });
      return result ? TRAINING_WRITE_OUTPUTS.apply_saved_workout_change.parse(result) : committedResult();
    }
    let result!: Result;
    const createdAtMs = deps.now();
    const placementRequest = request;
    await placeWorkoutLibraryForUser(input.uid, placementRequest, { db: deps.db, nowMs: createdAtMs,
      transactionPrecondition: precondition,
      transactionPostcondition: (tx, response) => {
        result = resultFor(stored.expectedLibraryRevision, response.stateRevision,
          placementRequest.itemId, stored.savedItemCreatedAtMs, response.workoutIds, createdAtMs);
        tx.update(proposalDoc, { result, expireAt: Timestamp.fromMillis(deps.now() + RESULT_TTL_MS) });
      } });
    return result ? TRAINING_WRITE_OUTPUTS.apply_saved_workout_change.parse(result) : committedResult();
  } catch (error) {
    if (error instanceof AlreadyApplied) return error.result;
    if (error instanceof TrainingScheduleMutationError) {
      if (error.code === 'limit-exceeded') {
        invalid('This change exceeds the current library or schedule limit. Choose fewer dates or remove an entry.');
      }
      invalid('The saved workout or schedule changed. Read the current records and preview again.');
    }
    throw error;
  }
}
