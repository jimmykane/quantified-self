import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
import { ActivityUtilities, type EventInterface } from '@sports-alliance/sports-lib';
import { defaultAppliedTrainingLoadPolicy, isTrainingLoadMethod, recordedTrainingStressScore,
  type AppliedTrainingLoadPolicy, type TrainingLoadLeg, type TrainingLoadMetadata } from '../../../shared/training-load-policy';
import { resolveActivityIdentityAssignments } from '../shared/activity-identity-matcher';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';

export function trainingLoadTimeMs(value: any): number {
  return value instanceof Date ? value.getTime() : typeof value?.toMillis === 'function' ? value.toMillis()
    : typeof value === 'number' ? value : Date.parse(value);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
/** Does not include user-edited titles/tags, IDs, or load controls. */
export function trainingLoadSourceFingerprint(data: any): string {
  return createHash('sha256').update(JSON.stringify(canonical({
    startMs: trainingLoadTimeMs(data.startDate), endMs: trainingLoadTimeMs(data.endDate),
    type: data.type ?? null, stats: data.stats ?? {},
  }))).digest('hex');
}
function identity(data: any): TrainingLoadLeg['identity'] {
  const stat = (type: string): number | null => {
    const raw = data.stats?.[type];
    const value = typeof raw === 'number' ? raw : raw?.value ?? raw?.rawValue ?? raw?._value;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  return { startMs: trainingLoadTimeMs(data.startDate), endMs: trainingLoadTimeMs(data.endDate),
    type: `${data.type}`, duration: stat('Duration'), distance: stat('Distance') };
}
function matchable(leg: TrainingLoadLeg) {
  return { startDate: leg.identity.startMs, endDate: leg.identity.endMs, type: leg.identity.type,
    getStat: (type: string) => ({ getValue: () => type === 'Duration' ? leg.identity.duration : leg.identity.distance }) };
}

/** Pure reconciliation: TSS and permissive unmatched-leg fallbacks never participate in identity. */
export function reconcileTrainingLoadLegs(
  previous: TrainingLoadMetadata | null, candidates: TrainingLoadLeg[],
): Pick<TrainingLoadMetadata, 'legs' | 'controls'> {
  const controls = { ...previous?.controls };
  const priorLegs = { ...previous?.legs };
  // Finalize explicit owner associations before matching the next source revision.
  // The target placeholder supplies identity/candidates; the retained leg owns its saved policy.
  for (const [key, leg] of Object.entries(priorLegs)) {
    if (leg.activityId) continue;
    const control = controls[key];
    if (control?.dismissed || previous?.resetUnmatched) {
      delete priorLegs[key]; delete controls[key]; continue;
    }
    if (!control?.activityId || Object.values(controls).filter(item => item.activityId === control.activityId).length !== 1) continue;
    const target = Object.entries(priorLegs).find(([, item]) => item.activityId === control.activityId);
    if (!target) continue;
    priorLegs[key] = { ...target[1], policy: leg.policy };
    delete priorLegs[target[0]]; delete controls[target[0]];
    const { activityId: _association, ...preferences } = control;
    controls[key] = preferences;
  }
  const previousEntries = Object.entries(priorLegs);
  const matches = resolveActivityIdentityAssignments(previousEntries.map(([, leg]) => matchable(leg)), candidates.map(matchable));
  const legs: Record<string, TrainingLoadLeg> = {};
  candidates.forEach((candidate, index) => {
    const oldIndex = matches.assignments.get(index);
    const old = oldIndex === undefined ? undefined : previousEntries[oldIndex];
    const proposedKey = candidate.activityId ?? randomUUID();
    const key = old?.[0] ?? (previous?.legs?.[proposedKey] ? randomUUID() : proposedKey);
    legs[key] = { ...candidate, policy: old?.[1].policy ?? candidate.policy };
  });
  matches.unmatchedExistingIndexes.forEach(index => {
    const [key, leg] = previousEntries[index];
    // Keep the entire unmatched policy/control record for an explicit owner decision.
    legs[key] = { ...leg, activityId: null };
  });
  if (Object.keys(legs).length > 200) throw new Error('Review unmatched Training load legs before reparsing again.');
  return { legs, controls };
}

async function policyAt(
  db: admin.firestore.Firestore, transaction: admin.firestore.Transaction, uid: string, leg: TrainingLoadLeg,
): Promise<AppliedTrainingLoadPolicy> {
  const fallback = defaultAppliedTrainingLoadPolicy(leg.identity.type);
  if (!fallback.family || !Number.isFinite(leg.identity.startMs)) return fallback;
  const result = await transaction.get(db.doc(`users/${uid}/trainingLoadPolicies/${fallback.family}`)
    .collection('revisions').where('effectiveAt', '<=', Timestamp.fromMillis(leg.identity.startMs))
    .orderBy('effectiveAt', 'desc').limit(1));
  const data = result.docs[0]?.data();
  return data && isTrainingLoadMethod(data.method) && typeof data.included === 'boolean'
    ? { family: fallback.family, revision: data.revision, method: data.method, included: data.included,
      effectiveAtMs: trainingLoadTimeMs(data.effectiveAt) } : fallback;
}

/** Called by all backend writers while parse-time candidates remain available. */
export async function persistTrainingLoadMetadata(
  uid: string, event: EventInterface,
  authorize?: (db: admin.firestore.Firestore, transaction: admin.firestore.Transaction) => Promise<void>,
): Promise<void> {
  const db = admin.firestore();
  const eventId = event.getID();
  if (!eventId) throw new Error('Training load requires a persisted event identity.');
  const activities = event.getActivities();
  if (activities.length > 100) throw new Error('Training load supports at most 100 legs per workout.');
  const candidates: TrainingLoadLeg[] = activities.map(activity => ({
    activityId: activity.getID() as string, identity: identity(activity.toJSON()),
    recordedTss: recordedTrainingStressScore(activity),
    evaluations: ActivityUtilities.getTrainingStressScoreEvaluations(activity),
    policy: defaultAppliedTrainingLoadPolicy(activity.type), sourceFingerprint: trainingLoadSourceFingerprint(activity.toJSON()),
  }));
  const eventRef = db.doc(`users/${uid}/events/${eventId}`);
  const metaRef = eventRef.collection('metaData').doc('trainingLoad');
  const parentFingerprint = trainingLoadSourceFingerprint(event.toJSON());
  await db.runTransaction(async transaction => {
    const guard = await getUserDeletionGuardStateInTransaction(db, transaction, uid);
    if (guard.shouldSkip) throw new Error('Training load write blocked by account deletion.');
    if (authorize) await authorize(db, transaction);
    const [parent, snapshot, ...savedActivities] = await transaction.getAll(eventRef, metaRef,
      ...candidates.map(leg => db.doc(`users/${uid}/activities/${leg.activityId}`)));
    if (!parent.exists || trainingLoadSourceFingerprint(parent.data()) !== parentFingerprint ||
      candidates.some((leg, index) => !savedActivities[index]?.exists ||
        savedActivities[index].data()?.eventID !== eventId ||
        trainingLoadSourceFingerprint(savedActivities[index].data()) !== leg.sourceFingerprint)) {
      throw new Error('Training load source changed during import; retry the source write.');
    }
    let previous = snapshot.exists ? snapshot.data() as TrainingLoadMetadata : null;
    // A legacy owner edit may predate the first calculated cache. Read its exact old
    // activities before reparse removes stale IDs; never attach it by array position.
    if (previous && !previous.legs && Object.keys(previous.controls).length) {
      const ids = Object.keys(previous.controls);
      const documents = await transaction.getAll(...ids.map(id => db.doc(`users/${uid}/activities/${id}`)));
      const legs: Record<string, TrainingLoadLeg> = {};
      documents.forEach((document, index) => {
        const data = document.data();
        if (document.exists && data?.eventID === eventId) legs[ids[index]] = {
          activityId: ids[index], identity: identity(data), recordedTss: recordedTrainingStressScore(data),
          evaluations: null, policy: defaultAppliedTrainingLoadPolicy(data.type),
        };
      });
      if (Object.keys(legs).length !== ids.length) throw new Error('A legacy load control needs review before reparse.');
      previous = { ...previous, legs };
    }
    const datedCandidates: TrainingLoadLeg[] = [];
    for (const candidate of candidates) datedCandidates.push({ ...candidate, policy: await policyAt(db, transaction, uid, candidate) });
    const reconciled = reconcileTrainingLoadLegs(previous, datedCandidates);
    const next: TrainingLoadMetadata = { version: 1, revision: (previous?.revision ?? 0) + 1,
      excluded: previous?.excluded ?? false, ...reconciled, parentFingerprint, updatedAt: FieldValue.serverTimestamp() };
    const loadContent = (value: TrainingLoadMetadata) => canonical({ excluded: value.excluded,
      legs: value.legs ?? {}, controls: value.controls, parentFingerprint: value.parentFingerprint ?? null,
      resetUnmatched: value.resetUnmatched ?? false });
    // Timestamp-only writes would leave impact waiting for a rebuild that the
    // semantic-change trigger correctly skips. Refresh only changed candidates/controls.
    if (!previous || JSON.stringify(loadContent(previous)) !== JSON.stringify(loadContent(next))) transaction.set(metaRef, next);
  });
}
