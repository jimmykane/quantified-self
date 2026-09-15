import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { formatWorkoutStepV1, parseWorkoutStructureV1 } from '../../../shared/planned-workout';
import { buildTrainingDeliverySummaries } from '../../../shared/training-delivery-summary';
import { PLANNED_WORKOUT_PROVIDER_IDS } from '../../../shared/planned-workout-providers';
import { isUserDeletionTombstoneActive } from '../shared/user-deletion-guard';
import { TRAINING_PLANS_SCOPE, TRAINING_READ_INPUTS, TRAINING_READ_OUTPUTS, TRAINING_RECIPE_SCHEMA,
  trainingDate, type TrainingReadResult, type TrainingReadTool } from './training-plans.schemas';

export const TRAINING_READ_LIMITS = { page: 25, scan: 1000, inputBytes: 2 * 1024 * 1024,
  responseBytes: 256 * 1024, singleRecordBytes: 128 * 1024, syncRecords: 1600 } as const;
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const count = z.number().int().nonnegative().safe();
const planSchema = z.strictObject({ schemaVersion: z.literal(1), name: z.string().min(1).max(120),
  lifecycle: z.enum(['active', 'paused', 'archived']), startLocalDate: trainingDate, endLocalDate: trainingDate,
  revision: count, workoutCount: count.max(400), color: z.string().max(32).optional(), createdAtMs: count, updatedAtMs: count });
const workoutSchema = z.strictObject({ schemaVersion: z.literal(1), planId: id.nullable(), localDate: trainingDate,
  lifecycle: z.enum(['planned', 'skipped', 'deleted']), title: z.string().min(1).max(120), revision: count,
  createdAtMs: count, updatedAtMs: count });
const settingSchema = z.strictObject({ scope: z.enum(['plan', 'workout']), scopeId: id,
  provider: z.enum(PLANNED_WORKOUT_PROVIDER_IDS), enabled: z.boolean(), suppressed: z.boolean(),
  timeZone: z.string().max(100), destinationKey: z.string().min(1).max(256), associationPlanId: id.nullable(), updatedAtMs: count });
const statusSchema = z.strictObject({ workoutId: id, planId: id.nullable(), provider: z.enum(PLANNED_WORKOUT_PROVIDER_IDS),
  status: z.enum(['pending', 'delivered', 'removed', 'stopped', 'paused_plan', 'paused_pro', 'provider_unavailable',
    'reconnect_required', 'connection_repair', 'fresh_consent_required', 'outside_horizon', 'past', 'completed',
    'unsupported', 'approval_required', 'retrying', 'needs_attention', 'failed']),
  differsFromQS: z.boolean(), hasRemoteCopy: z.boolean(), timeZone: z.string().max(100),
  lastAttemptAtMs: count.nullable(), lastAcceptedAtMs: count.nullable(), updatedAtMs: count });
type Collection = 'trainingPlans' | 'scheduledWorkouts' | 'trainingDeliverySettings' | 'trainingDeliveryStatuses';
const MASKS: Record<Collection, string[]> = { trainingPlans: Object.keys(planSchema.shape),
  scheduledWorkouts: Object.keys(workoutSchema.shape), trainingDeliverySettings: Object.keys(settingSchema.shape),
  trainingDeliveryStatuses: Object.keys(statusSchema.shape) };
interface Document { id: string; data: Record<string, unknown> }
type Filter = { field: 'planId' | 'workoutId' | 'scopeId' | 'associationPlanId'; value: string | null };
interface State { revision: number; activePlanId: string | null; accessGeneration?: string }
export interface TrainingReadView {
  get(collection: Collection, id: string, structure?: boolean): Promise<Document | null>;
  page(collection: Collection, after: string | null, limit: number, filter?: Filter): Promise<Document[]>;
  units(): Promise<UserUnitSettingsInterface | null>;
}
export interface TrainingReads {
  /** Fresh, masked deletion + plan-deletion fence and schedule revision. */
  state(uid: string, connectionId: string): Promise<State>;
  snapshot<T>(uid: string, read: (view: TrainingReadView) => Promise<T>): Promise<T>;
}
export interface TrainingReadCodec {
  encode(value: Record<string, unknown>, uid: string, connectionId: string): string;
  decode(value: string, uid: string, connectionId: string): Record<string, unknown>;
}
export class TrainingReadError extends Error {
  constructor(readonly code: 'invalid_request' | 'temporarily_unavailable' | 'query_too_large', message: string) { super(message); }
}
const unavailable = () => new TrainingReadError('temporarily_unavailable', 'Training records cannot be read safely. Try again later.');
const stale = () => new TrainingReadError('invalid_request', 'The schedule changed. Restart the query without a cursor.');
export function createFirestoreTrainingReads(database: () => FirebaseFirestore.Firestore = () => admin.firestore()): TrainingReads { return {
  async state(uid, connectionId) {
    const db = database();
    const user = db.collection('users').doc(uid);
    const [owner, tombstone, state] = await db.getAll(user, db.collection('userDeletionTombstones').doc(uid),
      user.collection('trainingPlanState').doc('current'), { fieldMask: ['expireAt', 'revision', 'activePlanId'] });
    const lock = await user.collection('trainingPlanState').doc('current').collection('planDeletionLocks').select().limit(1).get();
    if (!owner.exists || (tombstone.exists && isUserDeletionTombstoneActive(tombstone.data())) || !lock.empty) throw unavailable();
    // Only the internal Assistant session uses this reserved identity. Its live generation consent is checked
    // by the callable/runtime on both sides of every tool read; public connection IDs are server-generated hashes.
    let accessGeneration: string | undefined;
    if (connectionId !== 'first-party-assistant-v1') {
      const [connection] = await db.getAll(user.collection('mcpConnections').doc(connectionId),
        { fieldMask: ['scopes', 'status', 'revokedAtMs', 'grantId', 'createdAtMs'] });
      if (!connection.exists || connection.get('revokedAtMs') != null
        || ![undefined, 'active'].includes(connection.get('status'))
        || !Array.isArray(connection.get('scopes')) || !connection.get('scopes').includes(TRAINING_PLANS_SCOPE)) throw unavailable();
      accessGeneration = JSON.stringify([connection.get('grantId') ?? null, connection.get('createdAtMs') ?? null]);
    }
    return { ...(state.exists ? z.strictObject({ revision: count, activePlanId: id.nullable() }).parse(state.data())
      : { revision: 0, activePlanId: null }), accessGeneration };
  },
  async snapshot(uid, read) {
    const db = database();
    const user = db.collection('users').doc(uid);
    return db.runTransaction(async transaction => read({
      async get(collection, documentId, structure = false) {
        const fields = [...MASKS[collection], ...(structure ? ['structure'] : [])];
        const [doc] = await transaction.getAll(user.collection(collection).doc(documentId), { fieldMask: fields });
        return doc.exists ? { id: doc.id, data: doc.data()! } : null;
      },
      async page(collection, after, limit, filter) {
        let query = user.collection(collection).orderBy(FieldPath.documentId()).select(...MASKS[collection]).limit(limit);
        if (filter) query = query.where(filter.field, '==', filter.value);
        if (after) query = query.startAfter(after);
        return (await transaction.get(query)).docs.map(doc => ({ id: doc.id, data: doc.data() }));
      },
      async units() {
        const [owner] = await transaction.getAll(user, { fieldMask: ['settings.unitSettings'] });
        return owner.get('settings.unitSettings') ?? null;
      },
    }), { readOnly: true });
  },
}; }
export const firestoreTrainingReads = createFirestoreTrainingReads();

export interface TrainingReadInput { tool: TrainingReadTool; arguments: unknown; uid: string; connectionId: string; scopes: readonly string[] }
const refSchema = z.strictObject({ kind: z.enum(['plan', 'workout']), id, createdAtMs: count });
const cursorSchema = z.strictObject({ kind: z.literal('cursor'), query: z.string().max(4096), revision: count, after: id.nullable() });

/** Dedicated owner-authorized projections: no mutation API, delivery worker or provider import is reachable here. */
export async function readTrainingPlans(input: TrainingReadInput, reads: TrainingReads,
  codec: TrainingReadCodec, nowMs = Date.now()): Promise<TrainingReadResult> {
  if (!input.scopes.includes(TRAINING_PLANS_SCOPE)) throw new TrainingReadError('invalid_request', 'Training plans permission is required. Reauthorize to enable it.');
  const args = TRAINING_READ_INPUTS[input.tool].safeParse(input.arguments);
  if (!args.success) throw new TrainingReadError('invalid_request', 'Invalid Training read arguments.');
  const state = await reads.state(input.uid, input.connectionId);
  const encode = (value: Record<string, unknown>) => codec.encode(value, input.uid, input.connectionId);
  const decode = (value: string) => {
    try { return codec.decode(value, input.uid, input.connectionId); }
    catch { throw new TrainingReadError('invalid_request', 'Invalid reference or cursor for this connection.'); }
  };
  let inputBytes = 0;
  const measure = (document: Document) => {
    const bytes = Buffer.byteLength(JSON.stringify(document.data));
    inputBytes += bytes;
    if (bytes > TRAINING_READ_LIMITS.singleRecordBytes || inputBytes > TRAINING_READ_LIMITS.inputBytes)
      throw new TrainingReadError('query_too_large', 'Training records exceed the safe read size. No instructions were truncated.');
  };
  const reference = (kind: 'plan' | 'workout', doc: Document) => encode({ kind, id: id.parse(doc.id), createdAtMs: count.parse(doc.data.createdAtMs) });
  const projectPlan = (doc: Document) => {
    measure(doc); const plan = planSchema.parse(doc.data);
    if (plan.endLocalDate < plan.startLocalDate || Date.parse(plan.endLocalDate) - Date.parse(plan.startLocalDate) > 365 * 86400000) throw unavailable();
    return { planRef: reference('plan', doc), name: plan.name, lifecycle: plan.lifecycle,
      startDate: plan.startLocalDate, endDate: plan.endLocalDate, revision: plan.revision, currentWorkoutCount: plan.workoutCount,
      color: plan.color ?? null, createdAtMs: plan.createdAtMs, updatedAtMs: plan.updatedAtMs };
  };
  const result = await reads.snapshot(input.uid, async view => {
    const plans = new Map<string, Document>();
    const getPlan = async (planId: string) => {
      let doc = plans.get(planId);
      if (!doc) { doc = await view.get('trainingPlans', planId) ?? undefined; if (!doc) throw unavailable(); projectPlan(doc); plans.set(planId, doc); }
      return doc;
    };
    const resolve = async (token: string, kind: 'plan' | 'workout', structure = false) => {
      const parsed = refSchema.safeParse(decode(token));
      if (!parsed.success || parsed.data.kind !== kind) throw new TrainingReadError('invalid_request', 'Invalid Training reference.');
      const doc = await view.get(kind === 'plan' ? 'trainingPlans' : 'scheduledWorkouts', parsed.data.id, structure);
      if (!doc || doc.data.createdAtMs !== parsed.data.createdAtMs || doc.data.lifecycle === 'deleted')
        throw new TrainingReadError('invalid_request', 'This Training record is no longer available. Query the current schedule again.');
      return doc;
    };
    const projectWorkout = async (doc: Document) => {
      measure(doc); const { structure: _structure, ...summary } = doc.data;
      const workout = workoutSchema.parse(summary);
      if (workout.lifecycle === 'deleted') throw unavailable();
      return { workoutRef: reference('workout', doc), planRef: workout.planId ? reference('plan', await getPlan(workout.planId)) : null,
        title: workout.title, localDate: workout.localDate, lifecycle: workout.lifecycle,
        revision: workout.revision, createdAtMs: workout.createdAtMs, updatedAtMs: workout.updatedAtMs };
    };
    if (input.tool === 'get_training_plan') {
      const a = TRAINING_READ_INPUTS.get_training_plan.parse(args.data);
      return { scheduleRevision: state.revision, plan: projectPlan(await resolve(a.planRef, 'plan')) };
    }
    if (input.tool === 'get_planned_workout') {
      const a = TRAINING_READ_INPUTS.get_planned_workout.parse(args.data);
      const doc = await resolve(a.workoutRef, 'workout', true);
      const summary = await projectWorkout(doc);
      const structure = TRAINING_RECIPE_SCHEMA.parse(parseWorkoutStructureV1(doc.data.structure));
      const units = await view.units();
      measure({ id: 'units', data: { units } });
      const displaySteps = structure.nodes.flatMap(node => node.kind === 'step'
        ? [{ nodeId: node.id, text: formatWorkoutStepV1(node, units) }]
        : [{ nodeId: node.id, text: `Repeat ${node.count} times` }, ...node.steps.map(step => ({ nodeId: step.id, text: formatWorkoutStepV1(step, units) }))]);
      return { scheduleRevision: state.revision, workout: { ...summary, structure, displaySteps } };
    }
    if (input.tool === 'get_training_sync_status') {
      const a = TRAINING_READ_INPUTS.get_training_sync_status.parse(args.data);
      const doc = await resolve(a.reference, a.scope); measure(doc);
      let complete = true;
      const collect = async (collection: Collection, filter: Filter, cap: number) => {
        const documents: Document[] = []; let after: string | null = null;
        while (documents.length <= cap) {
          const size = Math.min(25, cap + 1 - documents.length);
          const page = await view.page(collection, after, size, filter);
          page.forEach(measure); documents.push(...page);
          if (page.length < size) break;
          after = page[page.length - 1].id;
        }
        if (documents.length > cap) { complete = false; documents.length = cap; }
        return documents;
      };
      const plan = a.scope === 'plan' ? doc : doc.data.planId ? await getPlan(id.parse(doc.data.planId)) : null;
      if (plan) projectPlan(plan);
      const workoutDocs = a.scope === 'workout' ? [doc] : await collect('scheduledWorkouts', { field: 'planId', value: doc.id }, 1000);
      const workouts = workoutDocs.map(d => ({ id: d.id, ...workoutSchema.parse(d.data) })).filter(w => w.lifecycle !== 'deleted');
      if (workouts.length > 400) throw unavailable();
      const settingScopeId = plan?.id ?? doc.id;
      const settings = await collect('trainingDeliverySettings', { field: 'scopeId', value: settingScopeId }, 1600);
      if (a.scope === 'plan') settings.push(...await collect('trainingDeliverySettings', { field: 'associationPlanId', value: doc.id }, 1600));
      else if (plan) settings.push(...await collect('trainingDeliverySettings', { field: 'scopeId', value: doc.id }, 1600));
      const statuses = await collect('trainingDeliveryStatuses', { field: a.scope === 'plan' ? 'planId' : 'workoutId', value: doc.id }, 1600);
      // The authored count is authoritative. Bounded historical scans must not imply full confirmation.
      if (a.scope === 'plan' && workouts.length !== planSchema.parse(doc.data).workoutCount) complete = false;
      const summaries = await buildTrainingDeliverySummaries({ uid: input.uid, scope: a.scope, id: doc.id,
        plan: plan ? planSchema.parse(plan.data) : null, workouts, complete,
        settings: settings.map(d => settingSchema.parse(d.data)), statuses: statuses.map(d => ({ id: d.id, ...statusSchema.parse(d.data) })) });
      return { scheduleRevision: state.revision, scope: a.scope, reference: a.reference, scanComplete: complete,
        checkedAtMs: nowMs, services: summaries.map(summary => summary.projection) };
    }
    const isPlans = input.tool === 'list_training_plans';
    const a = isPlans ? TRAINING_READ_INPUTS.list_training_plans.parse(args.data) : TRAINING_READ_INPUTS.query_planned_workouts.parse(args.data);
    const queryArgs = !isPlans ? TRAINING_READ_INPUTS.query_planned_workouts.parse(a) : null;
    let selectedPlan: string | null = null;
    if (queryArgs) {
      if (queryArgs.endDate < queryArgs.startDate || Date.parse(queryArgs.endDate) - Date.parse(queryArgs.startDate) > 365 * 86400000
        || (queryArgs.scope === 'plan') !== !!queryArgs.planRef)
        throw new TrainingReadError('invalid_request', 'Choose at most 366 inclusive days; supply planRef only for the plan scope.');
      if (queryArgs.planRef) selectedPlan = (await resolve(queryArgs.planRef, 'plan')).id;
    }
    const { cursor: _cursor, ...filters } = a;
    const query = JSON.stringify({ tool: input.tool, ...filters });
    let after: string | null = null;
    if (a.cursor) {
      const cursor = cursorSchema.safeParse(decode(a.cursor));
      if (!cursor.success || cursor.data.query !== query) throw new TrainingReadError('invalid_request', 'Repeat the original query filters with this cursor.');
      if (cursor.data.revision !== state.revision) throw stale();
      after = cursor.data.after;
    }
    const items: unknown[] = []; let scanned = 0, done = false;
    const limits: ('limit' | 'scan' | 'bytes')[] = [];
    outer: while (scanned < TRAINING_READ_LIMITS.scan) {
      const page = await view.page(isPlans ? 'trainingPlans' : 'scheduledWorkouts', after, 25);
      for (const doc of page) {
        measure(doc); scanned++;
        let match = false;
        if (isPlans) {
          const p = planSchema.parse(doc.data); const f = TRAINING_READ_INPUTS.list_training_plans.parse(a);
          match = (!f.lifecycle || p.lifecycle === f.lifecycle) && (!f.search || p.name.toLocaleLowerCase('en').includes(f.search.toLocaleLowerCase('en')));
        } else {
          const w = workoutSchema.parse(doc.data), f = queryArgs!;
          match = w.lifecycle !== 'deleted' && w.localDate >= f.startDate && w.localDate <= f.endDate &&
            (f.scope === 'all' || (f.scope === 'plan' ? w.planId === selectedPlan : f.scope === 'standalone' ? w.planId === null
              : w.planId === null || w.planId === state.activePlanId));
        }
        if (match) {
          if (items.length === a.limit) { limits.push('limit'); break outer; }
          items.push(isPlans ? projectPlan(doc) : await projectWorkout(doc));
        }
        after = id.parse(doc.id);
      }
      if (page.length < 25) { done = true; break; }
    }
    if (!done && !limits.length) limits.push('scan');
    const envelope = { scheduleRevision: state.revision, scanComplete: done, recordsScanned: scanned,
      nextCursor: done ? null : encode({ kind: 'cursor', query, revision: state.revision, after }), limitsReached: limits };
    return isPlans ? { ...envelope, plans: items } : { ...envelope, startDate: queryArgs!.startDate,
      endDate: queryArgs!.endDate, scope: queryArgs!.scope, workouts: items };
  });
  const checked = TRAINING_READ_OUTPUTS[input.tool].parse(result);
  // Count both representations and their JSON escaping, not just the structured payload.
  if (Buffer.byteLength(JSON.stringify({ structuredContent: checked, content: [{ type: 'text', text: JSON.stringify(checked) }] })) > TRAINING_READ_LIMITS.responseBytes)
    throw new TrainingReadError('query_too_large', 'Training results exceed the safe response size. Use a smaller limit. No instructions were truncated.');
  const current = await reads.state(input.uid, input.connectionId);
  if (current.revision !== state.revision) throw stale();
  if (current.accessGeneration !== state.accessGeneration) throw unavailable();
  return checked;
}
