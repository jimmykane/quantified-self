import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { DataDistance, DataDuration } from '@sports-alliance/sports-lib/metrics';
import { formatUnitAwareDataValue } from '../../../shared/unit-aware-display';
import { parseTrainingGoalFields, parseTrainingGoalV1, TRAINING_GOAL_FIELDS, TRAINING_GOALS_COLLECTION,
  TRAINING_GOALS_LIMIT, TRAINING_GOAL_STATE_PATH, type TrainingGoalV1 } from '../../../shared/training-goals';
import { readTrainingGoalSnapshot, readTrainingGoalsProgress } from '../training-goals/read';
import { decodeOpaqueValue, encodeOpaqueValue, McpDataError } from './data.service';
import { assertAuthorityInTransaction, type TrainingWriteInput } from './training-plans-write.service';
import { GOAL_INPUTS, GOAL_OUTPUTS, type GOAL_READ_TOOLS } from './training-goals.schemas';

const READ = ['training-plans:read'] as const;
const WRITE = [...READ, 'training-plans:write'] as const;
const PROPOSALS = 'trainingGoalProposals';
const reference = z.strictObject({ kind: z.enum(['goal', 'plan', 'goal-proposal']),
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/), createdAtMs: z.number().int().nonnegative().safe() });
type Preview = z.infer<typeof GOAL_OUTPUTS.preview_training_goal_change>;
type Applied = z.infer<typeof GOAL_OUTPUTS.apply_training_goal_change>;
type PublicGoal = z.infer<typeof GOAL_OUTPUTS.get_training_goal>['goal'];
export interface GoalDependencies { db: FirebaseFirestore.Firestore; now(): number; randomId(): string }
const defaults = (): GoalDependencies => ({ db: admin.firestore(), now: Date.now, randomId: randomUUID });
function invalid(message: string): never { throw new McpDataError('invalid_request', message); }
function scope(input: TrainingWriteInput, required: readonly string[]) {
  if (required.some(item => !input.scopes.includes(item))) invalid('The required Training or activity metrics permission is missing.');
}
function encode(input: TrainingWriteInput, kind: 'goal' | 'plan' | 'goal-proposal', id: string, createdAtMs: number): string {
  return encodeOpaqueValue(kind === 'goal-proposal' ? 'training_proposal' : 'training_read', { kind, id, createdAtMs }, input.uid, input.connectionId);
}
function decode(input: TrainingWriteInput, value: string, kind: 'goal' | 'plan' | 'goal-proposal') {
  try {
    const result = reference.parse(decodeOpaqueValue(kind === 'goal-proposal' ? 'training_proposal' : 'training_read',
      value, input.uid, input.connectionId, 'Training goal reference'));
    if (result.kind !== kind) invalid('Choose the correct current goal reference.');
    return result;
  } catch { return invalid('This reference is unavailable on the current connection.'); }
}
export function isTrainingGoalProposal(input: TrainingWriteInput, value: string): boolean {
  try { decode(input, value, 'goal-proposal'); return true; } catch { return false; }
}
function fields(goal: TrainingGoalV1) {
  return Object.fromEntries(TRAINING_GOAL_FIELDS.map(key => [key, goal[key]]));
}
async function projectGoal(input: TrainingWriteInput, goal: TrainingGoalV1, db: FirebaseFirestore.Firestore,
  tx?: FirebaseFirestore.Transaction): Promise<PublicGoal> {
  const { planId, ...authored } = parseTrainingGoalFields(fields(goal));
  let planName: string | null = null, planCreatedAt = 0, linkedPlanAvailable = false;
  if (planId) {
    const [plan] = await (tx ?? db).getAll(db.doc(`users/${input.uid}/trainingPlans/${planId}`),
      { fieldMask: ['name', 'createdAtMs'] });
    if (plan.exists && typeof plan.get('name') === 'string' && plan.get('name').length <= 120
      && Number.isSafeInteger(plan.get('createdAtMs'))) {
      planName = plan.get('name'); planCreatedAt = plan.get('createdAtMs'); linkedPlanAvailable = true;
    }
  }
  return { ...authored, goalRef: encode(input, 'goal', goal.id, goal.createdAtMs), revision: goal.revision,
    planRef: planId ? encode(input, 'plan', planId, planCreatedAt) : null, planName, linkedPlanAvailable };
}
export async function readTrainingGoals(input: TrainingWriteInput & { tool: typeof GOAL_READ_TOOLS[number] }, provided?: GoalDependencies) {
  const deps = provided ?? defaults();
  const required = input.tool === 'get_training_goals_progress' ? [...READ, 'metrics:read'] : READ;
  scope(input, required);
  const generation = await deps.db.runTransaction(tx => assertAuthorityInTransaction(deps, tx, input.uid, input.connectionId, required));
  let result: unknown;
  if (input.tool === 'get_training_goals_progress') {
    const args = GOAL_INPUTS.get_training_goals_progress.parse(input.arguments);
    const selected = args.goalRefs.map(ref => decode(input, ref, 'goal'));
    const data = await readTrainingGoalsProgress(input.uid, args, deps.db);
    if (selected.some(ref => !data.goals.some(goal => goal.id === ref.id && goal.createdAtMs === ref.createdAtMs))) invalid('A selected goal changed or is unavailable.');
    const settings = await deps.db.doc(`users/${input.uid}/config/settings`).get();
    const units = settings.get('unitSettings') ?? null;
    result = { goalsRevision: data.revision, localDate: args.localDate, timeZone: args.timeZone, weekStartsOn: data.weekStartsOn,
      complete: data.complete, progress: data.progress.filter(row => selected.some(ref => ref.id === row.goalId)).map(row => {
        const { goalId, ...progress } = row;
        const goal = data.goals.find(goal => goal.id === goalId)!;
        const display = (value: number) => row.kind === 'duration' || row.kind === 'distance'
          ? formatUnitAwareDataValue(row.kind === 'duration' ? DataDuration.type : DataDistance.type, value, units) ?? 'Unavailable'
          : `${value} ${row.kind === 'days' ? 'training days' : 'workouts'}`;
        return { ...progress, goalRef: encode(input, 'goal', goal.id, goal.createdAtMs), displayValue: display(row.value), displayTarget: display(row.target) };
      }) };
  } else {
    const snapshot = await readTrainingGoalSnapshot(input.uid, deps.db);
    if (input.tool === 'get_training_goal') {
      const args = GOAL_INPUTS.get_training_goal.parse(input.arguments), ref = decode(input, args.goalRef, 'goal');
      const goal = snapshot.goals.find(goal => goal.id === ref.id && goal.createdAtMs === ref.createdAtMs);
      if (!goal) invalid('The goal is unavailable.');
      result = { goalsRevision: snapshot.revision, goal: await projectGoal(input, goal, deps.db) };
    } else {
      const args = GOAL_INPUTS.list_training_goals.parse(input.arguments);
      const cursorSchema = z.strictObject({ kind: z.literal('goals-page'), revision: z.number().int().nonnegative(), scope: z.string(), after: z.string(), expiresAtMs: z.number() });
      let after = '';
      if (args.cursor) {
        let cursor: z.infer<typeof cursorSchema>;
        try { cursor = cursorSchema.parse(decodeOpaqueValue('training_read', args.cursor, input.uid, input.connectionId, 'Goals cursor')); }
        catch { invalid('The goals cursor is invalid.'); }
        if (cursor.revision !== snapshot.revision || cursor.scope !== args.scope || cursor.expiresAtMs <= deps.now()) invalid('Goals changed. Restart without a cursor.');
        after = cursor.after;
      }
      const matching = snapshot.goals.filter(goal => goal.id > after && (args.scope === 'all'
        || (args.scope === 'archived' ? goal.lifecycle === 'archived' : goal.lifecycle !== 'archived'))).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const page = matching.slice(0, 25);
      result = { goalsRevision: snapshot.revision, goals: await Promise.all(page.map(goal => projectGoal(input, goal, deps.db))),
        nextCursor: matching.length > 25 ? encodeOpaqueValue('training_read', { kind: 'goals-page', revision: snapshot.revision,
          scope: args.scope, after: page[24].id, expiresAtMs: deps.now() + 15 * 60000 }, input.uid, input.connectionId) : null };
    }
  }
  await deps.db.runTransaction(tx => assertAuthorityInTransaction(deps, tx, input.uid, input.connectionId, required, generation));
  return GOAL_OUTPUTS[input.tool].parse(result);
}

interface StoredProposal {
  uid: string; connectionId: string; accessGeneration: string; createdAtMs: number; expiresAtMs: number;
  goal: TrainingGoalV1; linkedPlanCreatedAtMs: number | null; beforeRevision: number; preview: Preview; result?: Applied;
}
export async function previewTrainingGoalChange(input: TrainingWriteInput, provided?: GoalDependencies): Promise<Preview> {
  const deps = provided ?? defaults(); scope(input, WRITE);
  const args = GOAL_INPUTS.preview_training_goal_change.parse(input.arguments);
  const now = deps.now(), proposalId = `goal-${deps.randomId()}`, proposalRef = encode(input, 'goal-proposal', proposalId, now);
  return deps.db.runTransaction(async tx => {
    const generation = await assertAuthorityInTransaction(deps, tx, input.uid, input.connectionId, WRITE);
    const user = deps.db.collection('users').doc(input.uid);
    let previous: TrainingGoalV1 | null = null;
    if (args.goalRef) {
      const ref = decode(input, args.goalRef, 'goal'), doc = await tx.get(user.collection(TRAINING_GOALS_COLLECTION).doc(ref.id));
      if (!doc.exists) invalid('The goal is unavailable.');
      previous = parseTrainingGoalV1(doc.data(), ref.id);
      if (previous.createdAtMs !== ref.createdAtMs) invalid('The goal changed. Read it again.');
    }
    if ((previous?.revision ?? 0) !== args.expectedRevision) invalid('The goal changed. Read its current revision and preview again.');
    let planId: string | null = null, linkedPlanCreatedAtMs: number | null = null;
    const { planRef, ...authored } = args.goal;
    if (planRef) {
      const ref = decode(input, planRef, 'plan'), doc = await tx.get(user.collection('trainingPlans').doc(ref.id));
      if ((!doc.exists || doc.get('createdAtMs') !== ref.createdAtMs) && !(previous?.planId === ref.id && !doc.exists && ref.createdAtMs === 0)) invalid('The linked plan is unavailable.');
      planId = ref.id; linkedPlanCreatedAtMs = doc.exists ? ref.createdAtMs : null;
    }
    const state = await tx.get(deps.db.doc(`users/${input.uid}/${TRAINING_GOAL_STATE_PATH}`));
    if (!previous && Number(state.get('goalCount') ?? 0) >= TRAINING_GOALS_LIMIT) invalid('The goal limit has been reached.');
    const goal = parseTrainingGoalV1({ ...parseTrainingGoalFields({ ...authored, planId }), schemaVersion: 1,
      id: previous?.id ?? `goal-${deps.randomId()}`, revision: args.expectedRevision + 1, createdAtMs: previous?.createdAtMs ?? now, updatedAtMs: now });
    const reviewFields = (value: PublicGoal) => {
      const { goalRef: _ref, revision: _revision, planRef: _plan, linkedPlanAvailable: _available, ...fields } = value;
      return fields;
    };
    const summary = `${previous ? 'Update' : 'Create'} goal: ${goal.name}`;
    const preview: Preview = { proposalRef, permissionMode: 'schedule', expiresAtMs: now + 15 * 60000, scheduleRevision: 0,
      summary, requiresConfirmation: true, changes: [{ index: 0, kind: 'set-training-goal', summary }], providerPreviews: [],
      goalReview: { before: previous ? reviewFields(await projectGoal(input, previous, deps.db, tx)) : null,
        after: reviewFields(await projectGoal(input, goal, deps.db, tx)) } };
    tx.create(user.collection(PROPOSALS).doc(proposalId), { uid: input.uid, connectionId: input.connectionId, accessGeneration: generation,
      createdAtMs: now, expiresAtMs: preview.expiresAtMs, expireAt: Timestamp.fromMillis(now + 30 * 86400000),
      goal, linkedPlanCreatedAtMs, beforeRevision: args.expectedRevision, preview });
    return GOAL_OUTPUTS.preview_training_goal_change.parse(preview);
  });
}
export async function applyTrainingGoalChange(input: TrainingWriteInput, provided?: GoalDependencies): Promise<Applied> {
  const deps = provided ?? defaults(); scope(input, WRITE);
  const args = GOAL_INPUTS.apply_training_goal_change.parse(input.arguments), ref = decode(input, args.proposalRef, 'goal-proposal');
  return deps.db.runTransaction(async tx => {
    const user = deps.db.collection('users').doc(input.uid), proposalRef = user.collection(PROPOSALS).doc(ref.id);
    const proposal = (await tx.get(proposalRef)).data() as StoredProposal | undefined;
    if (!proposal || proposal.uid !== input.uid || proposal.connectionId !== input.connectionId || proposal.createdAtMs !== ref.createdAtMs) invalid('The goal proposal is unavailable.');
    await assertAuthorityInTransaction(deps, tx, input.uid, input.connectionId, WRITE, proposal.accessGeneration, args.proposalRef);
    if (proposal.result) return GOAL_OUTPUTS.apply_training_goal_change.parse(proposal.result);
    if (proposal.expiresAtMs <= deps.now()) invalid('This goal proposal expired. Preview it again.');
    const goal = parseTrainingGoalV1(proposal.goal);
    const target = user.collection(TRAINING_GOALS_COLLECTION).doc(goal.id), stateRef = deps.db.doc(`users/${input.uid}/${TRAINING_GOAL_STATE_PATH}`);
    const [before, state] = await Promise.all([tx.get(target), tx.get(stateRef)]);
    if ((before.exists ? parseTrainingGoalV1(before.data(), goal.id).revision : 0) !== proposal.beforeRevision) invalid('The goal changed. Preview it again.');
    const goalCount = Number(state.get('goalCount') ?? 0) + (before.exists ? 0 : 1);
    const goalsRevision = Number(state.get('revision') ?? 0) + 1;
    if (!Number.isSafeInteger(goalCount) || goalCount > TRAINING_GOALS_LIMIT || !Number.isSafeInteger(goalsRevision)) invalid('The goals state is unavailable.');
    const saved = parseTrainingGoalV1({ ...goal, updatedAtMs: Math.max(deps.now(), goal.updatedAtMs) });
    if (saved.planId && proposal.linkedPlanCreatedAtMs !== null) {
      const linkedPlan = await tx.get(user.collection('trainingPlans').doc(saved.planId));
      if (!linkedPlan.exists || linkedPlan.get('createdAtMs') !== proposal.linkedPlanCreatedAtMs) invalid('The linked plan changed. Preview the goal again.');
    }
    const projected = await projectGoal(input, saved, deps.db, tx);
    if (saved.planId && saved.planId !== before.get('planId') && !projected.linkedPlanAvailable) invalid('The chosen plan is no longer available.');
    const result: Applied = { status: 'applied', goalsRevision, goal: projected };
    tx.set(target, saved);
    tx.set(stateRef, { schemaVersion: 1, revision: goalsRevision, goalCount, lastGoalId: goal.id });
    tx.update(proposalRef, { result });
    return GOAL_OUTPUTS.apply_training_goal_change.parse(result);
  });
}
