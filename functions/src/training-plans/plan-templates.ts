import { planAttributionSchema } from './plan-attribution.schema';
import { createHash, randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { TRAINING_PLAN_CATALOG, scheduleTemplate, templateScheduleMode, type PlanTemplate, type TemplateScheduleOptions } from '../../../shared/training-plan-templates';
import { type MutateTrainingScheduleRequestV1, countTrainingPlanDays, normalizeTrainingLocalDate, TRAINING_PLAN_MAX_CURRENT_WORKOUTS } from '../../../shared/training-plans';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { assertTrainingMutationFitsTransaction, mutateTrainingScheduleForUser, readTrainingScheduleSnapshotInTransaction } from './persistence';
import { assertNoTrainingPlanDeletionInProgress } from './deletion-lock';

export const templateId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const sourceSchema = z.enum(['catalog', 'private']);
export const scheduleOptions = z.strictObject({ anchor: z.enum(['start', 'finish']), date: z.string().length(10).refine(v => {
  try { return normalizeTrainingLocalDate(v) === v; } catch { return false; }
}), longDay: z.number().int().min(0).max(6), pattern: z.enum(['standard', 'early']) });
type Tx = FirebaseFirestore.Transaction;
type Source = PlanTemplate['source'];
export interface TemplateAccess {
  uid: string;
  connectionId: string;
  check(tx: Tx, source: Source, generation?: string, apply?: boolean): Promise<string>;
}
const state = (uid: string) => admin.firestore().doc(`users/${uid}/trainingPlanState/current`);
const library = (uid: string) => state(uid).collection('planTemplates');
const proposals = (uid: string) => state(uid).collection('planEnrollmentProposals');
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
function reject(message: string): never { throw new HttpsError('failed-precondition', message); }
export function ownerAccess(uid: string): TemplateAccess {
  return { uid, connectionId: 'app', check: async tx => {
    if ((await getUserDeletionGuardStateInTransaction(admin.firestore(), tx, uid)).shouldSkip) reject('Account unavailable.');
    return 'app';
  } };
}
export async function assistantPrivateTemplateAccess(uid: string, conversationId: string, enabled?: boolean) {
  const db = admin.firestore();
  return db.runTransaction(async tx => {
    await ownerAccess(uid).check(tx, 'private');
    const active = await tx.get(db.doc('users/' + uid + '/assistantConversations/active'));
    if (active.get('conversationId') !== conversationId || active.get('trainingPlansEnabled') !== true) return false;
    const ref = state(uid).collection('planTemplateAccess').doc('assistant');
    const prior = await tx.get(ref);
    if (enabled === undefined) return prior.get('conversationId') === conversationId && prior.get('enabled') === true;
    tx.set(ref, { conversationId, enabled, revision: (prior.get('revision') ?? 0) + 1 });
    return enabled;
  });
}
async function readTemplate(tx: Tx, uid: string, source: Source, id: string): Promise<PlanTemplate> {
  const item = source === 'catalog' ? TRAINING_PLAN_CATALOG.find(t => t.id === id)
    : (await tx.get(library(uid).doc(templateId.parse(id)))).data() as PlanTemplate | undefined;
  if (!item || item.source !== source || item.id !== id) reject('Template unavailable.');
  return item;
}
export function summarizeTemplate(item: PlanTemplate) {
  return { id: item.id, version: item.version, source: item.source, name: item.name, description: item.description,
    ...(item.attribution ? { attribution: planAttributionSchema.parse(item.attribution) } : {}),
    scheduleMode: templateScheduleMode(item), author: item.author, sport: item.sport, days: item.days, workoutCount: item.sessions.length };
}
export async function listTemplates(access: TemplateAccess, source: Source) {
  return admin.firestore().runTransaction(async tx => {
    await access.check(tx, source);
    if (source === 'catalog') return TRAINING_PLAN_CATALOG.map(summarizeTemplate);
    const snapshot = await tx.get(library(access.uid).select('id','version','source','name','description','author','sport','days','workoutCount','attribution').limit(100));
    return snapshot.docs.map(doc => {
      const { id, version, name, description, author, sport, days, workoutCount, attribution } = doc.data();
      return { id, version, source, name, description, author, sport, days, workoutCount, scheduleMode: templateScheduleMode({ source }),
        ...(attribution ? { attribution: planAttributionSchema.parse(attribution) } : {}) } as ReturnType<typeof summarizeTemplate>;
    });
  });
}
export async function getTemplate(access: TemplateAccess, source: Source, id: string) {
  return admin.firestore().runTransaction(async tx => { await access.check(tx, source); return readTemplate(tx, access.uid, source, id); });
}
/** A dated plan's public credit is independent of access to the private template library. */
export async function readPlanAttribution(access: TemplateAccess, id: string, createdAtMs: number) {
  const plan = admin.firestore().doc('users/' + access.uid + '/trainingPlans/' + templateId.parse(id));
  return admin.firestore().runTransaction(async tx => {
    await access.check(tx, 'catalog');
    if ((await tx.get(plan)).get('createdAtMs') !== createdAtMs) reject('The training plan is unavailable.');
    const credit = (await tx.get(plan.collection('templateOrigin').doc('current'))).get('attribution');
    return { attribution: credit ? planAttributionSchema.parse(credit) : null };
  });
}
export async function savePrivateTemplate(uid: string, planId: string, revision: number) {
  const db = admin.firestore();
  return db.runTransaction(async tx => {
    await ownerAccess(uid).check(tx, 'private');
    await assertNoTrainingPlanDeletionInProgress(tx, state(uid));
    const id = hash(planId + ':' + revision);
    const ref = library(uid).doc(id);
    if ((await tx.get(ref)).exists) return { id };
    const snapshot = await readTrainingScheduleSnapshotInTransaction(tx, db.doc('users/' + uid), []);
    const plan = snapshot.plans.get(planId);
    if (!plan || plan.revision !== revision) reject('The plan changed. Review its current version.');
    if ((await tx.get(library(uid).limit(100).select())).size >= 100) reject('The private plan template library is full.');
    const offset = (date: string) => countTrainingPlanDays(plan.startLocalDate, date) - 1;
    const sessions: PlanTemplate['sessions'] = [];
    for (const w of snapshot.workouts.values()) {
      if (w.planId !== planId || w.lifecycle !== 'planned') continue;
      const details = snapshot.strengthDetails?.get(w.id);
      sessions.push({ day: offset(w.localDate), title: w.title, structure: w.structure,
        ...(details ? { strength: { version: details.version, exercises: details.exercises } } : {}) });
    }
    sessions.sort((a,b) => a.day - b.day);
    if (!sessions.length) reject('Add a planned workout before saving a template.');
    const origin = await tx.get(db.doc('users/' + uid + '/trainingPlans/' + planId + '/templateOrigin/current'));
    const credit = origin.get('attribution');
    const attribution = credit ? { ...planAttributionSchema.parse(credit), privateCopy: true as const } : undefined;
    const template: PlanTemplate = { ...(attribution ? { attribution } : {}), id, version: revision, source: 'private', name: plan.name,
      description: 'Saved from your training plan.', author: attribution?.originalAuthor ?? 'You', sport: new Set(sessions.map(s => s.structure.sport)).size === 1 ? sessions[0].structure.sport : 'Multisport',
      days: countTrainingPlanDays(plan.startLocalDate, plan.endLocalDate), sessions, rest: (plan.restDays ?? []).map(offset),
      phases: (plan.phases?.items ?? []).map(({ startLocalDate, endLocalDate, ...phase }) => ({ ...phase, start: offset(startLocalDate), end: offset(endLocalDate) })) };
    if (Buffer.byteLength(JSON.stringify(template)) > 700000) reject('The template exceeds the supported prescription size.');
    tx.create(ref, { ...template, workoutCount: sessions.length });
    return { id };
  });
}
interface SavedProposal {
  source: Source; templateId: string; version: number; options: TemplateScheduleOptions; revision: number;
  connectionId: string; generation: string; expiresAt: number; createdAt: number; conflicts: string[];
  result?: { planId: string; createdAtMs: number; scheduleRevision: number };
}
async function conflicts(tx: Tx, uid: string, workouts: string[], incomingRest: string[]) {
  const dates = [...new Set([...workouts, ...incomingRest])].sort();
  const user = admin.firestore().doc('users/' + uid);
  const [scheduled, rest, current] = await Promise.all([tx.get(user.collection('scheduledWorkouts').where('lifecycle','==','planned').select('localDate','planId')),
    tx.get(user.collection('trainingRestDays').where('localDate','>=',dates[0]).where('localDate','<=',dates[dates.length - 1]).select('localDate','isRestDay')),
    tx.get(state(uid))]);
  const active = current.get('activePlanId');
  const plan = active ? await tx.get(user.collection('trainingPlans').doc(active)) : undefined;
  const booked = new Set(scheduled.docs.filter(d => !d.get('planId') || d.get('planId') === active).map(d => d.get('localDate')));
  const restDates = new Set([...rest.docs.filter(d => d.get('isRestDay')).map(d => d.get('localDate')), ...(plan?.get('restDays') ?? [])]);
  const incomingWorkouts = new Set(workouts);
  return dates.filter(date => booked.has(date) || (incomingWorkouts.has(date) && restDates.has(date)));
}
function enrollmentRequest(id: string, name: string, schedule: ReturnType<typeof scheduleTemplate>, revision: number): MutateTrainingScheduleRequestV1 {
  const planId = 'enroll-' + id;
  return { mutationId: planId, expectedRevisions: [{ scope: 'state', id: 'current', revision }],
    operation: { kind: 'create-plan', planId, name, startLocalDate: schedule.start, endLocalDate: schedule.end, activate: false,
      enrollment: { phases: schedule.phases, restDays: schedule.restDays, sessions: schedule.sessions.map((s, index) => ({
        ...s, workoutId: planId + '-' + index })) } } };
}
export async function previewEnrollment(access: TemplateAccess, source: Source, id: string, version: number, options: TemplateScheduleOptions) {
  const ref = proposals(access.uid).doc(randomUUID()), now = Date.now();
  return admin.firestore().runTransaction(async tx => {
    const generation = await access.check(tx, source);
    const item = await readTemplate(tx, access.uid, source, id);
    if (item.version !== version) reject('The template changed. Preview its current edition.');
    let schedule: ReturnType<typeof scheduleTemplate>;
    try { schedule = scheduleTemplate(item, options); }
    catch (error) { throw new HttpsError('invalid-argument', error instanceof Error ? error.message : 'Invalid schedule options.'); }
    const current = await tx.get(state(access.uid));
    if (schedule.sessions.length + (current.get('currentWorkoutCount') ?? 0) > TRAINING_PLAN_MAX_CURRENT_WORKOUTS) reject('The plan exceeds the remaining schedule capacity.');
    const occupied = await conflicts(tx, access.uid, schedule.sessions.map(s => s.localDate), schedule.restDays);
    const proposal: SavedProposal = { source, templateId: id, version, options, connectionId: access.connectionId, generation,
      revision: current.get('revision') ?? 0, expiresAt: now + 900000, createdAt: now, conflicts: occupied };
    const request = enrollmentRequest(ref.id, item.name, schedule, proposal.revision);
    const snapshot = await readTrainingScheduleSnapshotInTransaction(tx, admin.firestore().doc('users/' + access.uid), [request]);
    assertTrainingMutationFitsTransaction(snapshot, request, now, 2);
    tx.create(ref, { ...proposal, expireAt: Timestamp.fromMillis(now + 30 * 86400000) });
    return { id: ref.id, name: item.name, attribution: item.attribution ?? null, scheduleMode: templateScheduleMode(item), scheduleRevision: proposal.revision, expiresAtMs: proposal.expiresAt,
      start: schedule.start, end: schedule.end, dates: schedule.sessions.map(w => w.localDate), restDays: schedule.restDays, conflicts: occupied };
  });
}
export async function applyEnrollment(access: TemplateAccess, id: string) {
  const db = admin.firestore(), ref = proposals(access.uid).doc(templateId.parse(id));
  const read = async (tx: Tx) => {
    const data = (await tx.get(ref)).data() as SavedProposal | undefined;
    if (!data || data.connectionId !== access.connectionId) reject('The enrollment proposal is unavailable.');
    await access.check(tx, data.source, data.generation, true);
    if (!data.result && data.expiresAt <= Date.now()) reject('Enrollment preview expired.');
    return data;
  };
  const p = await db.runTransaction(read);
  if (p.result) return p.result;
  const template = await getTemplate(access, p.source, p.templateId);
  if (template.version !== p.version) reject('Template edition changed.');
  const schedule = scheduleTemplate(template, p.options);
  const request = enrollmentRequest(id, template.name, schedule, p.revision);
  const planId = request.mutationId;
  const response = await mutateTrainingScheduleForUser(access.uid, request, {
    db, nowMs: p.createdAt, additionalWriteBudget: 2,
    transactionPrecondition: async tx => {
      const reviewed = await read(tx);
      if (reviewed.result) return;
      if ((await readTemplate(tx, access.uid, p.source, p.templateId)).version !== p.version) reject('Template edition changed.');
      const occupied = await conflicts(tx, access.uid, schedule.sessions.map(s => s.localDate), schedule.restDays);
      if (JSON.stringify(occupied) !== JSON.stringify(p.conflicts)) reject('Calendar conflicts changed. Preview the plan again.');
    },
    transactionPostcondition: (tx, [result]) => {
      tx.set(db.doc('users/' + access.uid + '/trainingPlans/' + planId + '/templateOrigin/current'), {
        source: p.source, templateId: p.templateId, edition: p.version, options: p.options,
        ...(template.attribution ? { attribution: planAttributionSchema.parse(template.attribution) } : {}),
      });
      tx.update(ref, { result: { planId, createdAtMs: p.createdAt, scheduleRevision: result.state.revision } }); },
  });
  return { planId, createdAtMs: p.createdAt, scheduleRevision: response.state.revision };
}
