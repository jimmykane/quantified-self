import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { ActivityUtilities, type EventInterface } from '@sports-alliance/sports-lib';
import { defaultAppliedTrainingLoadPolicy, validTrainingLoadPolicy, recordedTrainingStressScore,
  type AppliedTrainingLoadPolicy, type TrainingLoadLeg, type TrainingLoadMetadata } from '../../../shared/training-load-policy';
import { resolveActivityIdentityAssignments } from '../shared/activity-identity-matcher';
import { getUserDeletionGuardedDocumentsInTransaction } from '../shared/user-deletion-guard';
import { canonicalTrainingLoadValue as canonical, trainingLoadTimeMs } from '../../../shared/training-load-source';
import { prepareTrainingLoadCacheWrite, summarizeTrainingLoad, trainingLoadSourceFingerprint } from './training-load-cache';
import { trainingLoadSourceSnapshot } from './training-load-source-snapshot';
import type { PreparedTrainingLoadWrite } from './training-load-source-write';
export { trainingLoadSourceFingerprint } from './training-load-cache';
export { trainingLoadTimeMs } from '../../../shared/training-load-source';

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
  return { getID: () => leg.activityId, startDate: leg.identity.startMs, endDate: leg.identity.endMs, type: leg.identity.type,
    getStat: (type: string) => ({ getValue: () => type === 'Duration' ? leg.identity.duration : leg.identity.distance }) };
}

/** Pure reconciliation: TSS and permissive unmatched-leg fallbacks never participate in identity. */
export function reconcileTrainingLoadLegs(
  previous: TrainingLoadMetadata | null, candidates: TrainingLoadLeg[],
  verifiedActivityIds?: ReadonlySet<string>,
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
  // Retained identities require an owner decision even if a later source happens
  // to match again. Only current legs (including explicit associations above)
  // may participate in automatic reconciliation.
  const previousEntries = Object.entries(priorLegs).filter(([, leg]) => leg.activityId);
  const retainedEntries = Object.entries(priorLegs).filter(([, leg]) => !leg.activityId);
  // Uncontrolled legacy legs still disambiguate identity: omitting them can move
  // a removed leg's override to a similar surviving leg. They supply matching
  // context only, not saved policies or unmatched records requiring owner review.
  const legacyContext = Object.entries(previous?.legacyLegs ?? {})
    .filter(([key, leg]) => leg.activityId && !Object.prototype.hasOwnProperty.call(priorLegs, key));
  const matches = resolveActivityIdentityAssignments(
    [...previousEntries, ...legacyContext].map(([, leg]) => matchable(leg)), candidates.map(matchable), { verifiedActivityIds });
  const legs: Record<string, TrainingLoadLeg> = {};
  candidates.forEach((candidate, index) => {
    const oldIndex = matches.assignments.get(index);
    const old = oldIndex === undefined ? undefined : previousEntries[oldIndex];
    const proposedKey = candidate.activityId ?? randomUUID();
    const key = old?.[0] ?? (previous?.legs?.[proposedKey] ? randomUUID() : proposedKey);
    legs[key] = { ...candidate, policy: old?.[1].policy ?? candidate.policy };
  });
  matches.unmatchedExistingIndexes.forEach(index => {
    const entry = previousEntries[index];
    if (!entry) return; // Uncontrolled legacy context has no saved policy/control to retain.
    const [key, leg] = entry;
    // Keep the entire unmatched policy/control record for an explicit owner decision.
    legs[key] = { ...leg, activityId: null };
  });
  for (const [key, leg] of retainedEntries) legs[key] = leg;
  if (Object.keys(legs).length > 200) throw new Error('Review unmatched Training load legs before reparsing again.');
  return { legs, controls };
}

async function policyAt(
  db: admin.firestore.Firestore, transaction: admin.firestore.Transaction, uid: string, leg: TrainingLoadLeg,
): Promise<AppliedTrainingLoadPolicy> {
  const fallback = defaultAppliedTrainingLoadPolicy(leg.identity.type);
  if (!fallback.family || typeof leg.identity.startMs !== 'number' || !Number.isFinite(leg.identity.startMs)) return fallback;
  const result = await transaction.get(db.doc(`users/${uid}/trainingLoadPolicies/${fallback.family}`)
    .collection('revisions').where('effectiveAt', '<=', Timestamp.fromMillis(leg.identity.startMs))
    .orderBy('effectiveAt', 'desc').limit(1));
  const data = result.docs[0]?.data();
  return data && validTrainingLoadPolicy(fallback.family, data as AppliedTrainingLoadPolicy)
    ? { family: fallback.family, revision: data.revision, method: data.method, included: data.included,
      effectiveAtMs: trainingLoadTimeMs(data.effectiveAt),
      ...(data.swimThresholdSpeed !== undefined ? { swimThresholdSpeed: data.swimThresholdSpeed } : {}) } : fallback;
}

/** Freeze legacy identities durably before any source overwrite, including retries after a partial write. */
export async function prepareTrainingLoadMetadata(
  uid: string, event: EventInterface,
  authorize?: (db: admin.firestore.Firestore, transaction: admin.firestore.Transaction) => Promise<ReadonlySet<string> | void>,
): Promise<PreparedTrainingLoadWrite> {
  const db = admin.firestore();
  const eventId = event.getID();
  if (!eventId) throw new Error('Training load requires a persisted event identity.');
  const activities = event.getActivities();
  if (activities.length > 100) throw new Error('Training load supports at most 100 legs per workout.');
  const eventRef = db.doc(`users/${uid}/events/${eventId}`);
  const metaRef = eventRef.collection('metaData').doc('trainingLoad');
  const sourceWriteId = randomUUID();
  // Native JSON imports may not have parse-time evaluations yet. Power evaluation
  // can derive stats, so finish it before EventWriter snapshots source documents.
  // The final metadata transaction then reads the cached, non-mutating results.
  activities.forEach(activity => ActivityUtilities.getTrainingStressScoreEvaluations(activity));
  const reservation = await db.runTransaction(async transaction => {
    const { guard, snapshots: [parent, snapshot] } = await getUserDeletionGuardedDocumentsInTransaction(
      db, transaction, uid, [eventRef, metaRef]);
    if (guard.shouldSkip) throw new Error('Training load write blocked by account deletion.');
    const verifiedActivityIds = await authorize?.(db, transaction);
    const previous = snapshot.data() as TrainingLoadMetadata | undefined;
    const prepare = async (fields: Partial<TrainingLoadMetadata>) => {
      const pending: TrainingLoadMetadata = { version: 1, excluded: false, controls: {}, revision: 1, ...previous, ...fields };
      const cacheWrite = await prepareTrainingLoadCacheWrite(db, transaction, uid, eventId,
        summarizeTrainingLoad(eventId, parent.data() ?? {}, pending));
      if (snapshot.exists) transaction.update(metaRef, fields);
      else transaction.set(metaRef, pending);
      cacheWrite.write();
    };
    if (!parent.exists || previous?.legs || previous?.legacyLegs) {
      const pending = { sourceWritePending: true, sourceWriteId, ...(!parent.exists ? { sourceFirstImport: true } : {}),
        revision: (previous?.revision ?? 0) + 1 };
      await prepare(pending);
      return { firstImport: previous?.sourceFirstImport === true || !parent.exists, verifiedActivityIds };
    }
    // A partial first import can already have owner controls. Freeze its current
    // identities before a retry overwrites/reuses their IDs, just like legacy data.
    const children = await transaction.get(db.collection(`users/${uid}/activities`)
      .where('eventID', '==', eventId).limit(101));
    if (children.size > 100) throw new Error('Training load supports at most 100 legs per workout.');
    const legacyLegs = Object.fromEntries(children.docs.map(document => {
      const data = document.data();
      return [document.id, { activityId: document.id, identity: identity(data),
        recordedTss: recordedTrainingStressScore(data), evaluations: null,
        policy: defaultAppliedTrainingLoadPolicy(data.type) } satisfies TrainingLoadLeg];
    }));
    const frozen = { legacyLegs, sourceWritePending: true, sourceWriteId, revision: (previous?.revision ?? 0) + 1 };
    // Pending reads are unavailable; finalization advances freshness and owns invalidation.
    await prepare(frozen);
    return { firstImport: previous?.sourceFirstImport === true, verifiedActivityIds };
  });
  return Object.assign(() => finalizeTrainingLoadMetadata(uid, event, sourceWriteId, reservation.firstImport,
    authorize, reservation.verifiedActivityIds || undefined), { sourceWriteId });
}

/** Only the prepared attempt can finalize its persisted source and cached candidates. */
async function finalizeTrainingLoadMetadata(
  uid: string, event: EventInterface, expectedSourceWriteId: string, firstImport: boolean,
  authorize?: (db: admin.firestore.Firestore, transaction: admin.firestore.Transaction) => Promise<ReadonlySet<string> | void>,
  verifiedActivityIds?: ReadonlySet<string>,
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
    const { guard, snapshots: [parent, snapshot, ...savedActivities] } = await getUserDeletionGuardedDocumentsInTransaction(
      db, transaction, uid, [eventRef, metaRef,
        ...candidates.map(leg => db.doc(`users/${uid}/activities/${leg.activityId}`))]);
    if (guard.shouldSkip) throw new Error('Training load write blocked by account deletion.');
    if (authorize) await authorize(db, transaction);
    if (!parent.exists || trainingLoadSourceFingerprint(parent.data() ?? {}) !== parentFingerprint ||
      candidates.some((leg, index) => !savedActivities[index]?.exists ||
        savedActivities[index].data()?.eventID !== eventId ||
        trainingLoadSourceFingerprint(savedActivities[index].data() ?? {}) !== leg.sourceFingerprint)) {
      throw new Error('Training load source changed during import; retry the source write.');
    }
    let previous = snapshot.exists ? snapshot.data() as TrainingLoadMetadata : null;
    // Parent totals and individual child values can be identical across different
    // leg sets. They prove source consistency, not ownership of this finalization.
    if (previous?.sourceWriteId !== expectedSourceWriteId)
      throw new Error('Training load source write was superseded; retry the source import.');
    // Old documents may already have been overwritten using reused IDs. Only
    // pre-write evidence can associate a legacy control with its original leg.
    if (previous && !previous.legs && Object.keys(previous.controls).length) {
      const ids = Object.keys(previous.controls);
      const legs: Record<string, TrainingLoadLeg> = {};
      for (const id of ids) {
        const saved = previous.legacyLegs ? previous.legacyLegs[id]
          : firstImport ? candidates.find(leg => leg.activityId === id) : undefined;
        // Missing old source evidence is an unmatched control, never permission
        // to infer its identity from the newly written activity with that ID.
        // No policy was finalized for an interrupted first import. Select it from
        // the original leg, even if that leg now requires explicit reassociation.
        legs[id] = saved ? { ...saved, policy: firstImport ? await policyAt(db, transaction, uid, saved) : saved.policy }
          : { activityId: null, identity: { startMs: null, endMs: null, type: 'Unknown',
          duration: null, distance: null }, recordedTss: null, evaluations: null,
          policy: defaultAppliedTrainingLoadPolicy(null) };
      }
      previous = { ...previous, legs };
    }
    const reconciled = reconcileTrainingLoadLegs(previous, candidates, verifiedActivityIds);
    // Matched legs already own an immutable dated policy. Only genuinely new legs query history.
    for (const [key, leg] of Object.entries(reconciled.legs ?? {})) {
      if (leg.activityId && !previous?.legs?.[key])
        leg.policy = await policyAt(db, transaction, uid, leg);
      if (leg.activityId && leg.policy.family === 'swimming' && leg.policy.swimThresholdSpeed !== undefined) {
        const activity = activities.find(activity => activity.getID() === leg.activityId);
        if (activity && defaultAppliedTrainingLoadPolicy(activity.type).family === 'swimming')
          leg.evaluations = ActivityUtilities.evaluateTrainingStressScoreWithSwimThreshold(activity, leg.policy.swimThresholdSpeed);
      }
    }
    const { sourceDigest, sourceWriteTimes } = trainingLoadSourceSnapshot(parent, savedActivities);
    const next: TrainingLoadMetadata = { version: 1, revision: (previous?.revision ?? 0) + 1,
      excluded: previous?.excluded ?? false, ...reconciled, parentFingerprint,
      ...(previous?.sourceWriteId ? { sourceWriteId: previous.sourceWriteId } : {}),
      sourceWritePending: false, sourceWriteTimes, sourceDigest,
      sourceRevision: (previous?.sourceRevision ?? 0) + (previous?.sourceDigest === sourceDigest ? 0 : 1), updatedAt: FieldValue.serverTimestamp() };
    const loadContent = (value: TrainingLoadMetadata) => canonical({ excluded: value.excluded,
      legs: value.legs ?? {}, controls: value.controls, parentFingerprint: value.parentFingerprint ?? null,
      resetUnmatched: value.resetUnmatched ?? false });
    // Timestamp-only writes would leave impact waiting for a rebuild that the
    // semantic-change trigger correctly skips. Refresh only changed candidates/controls.
    const loadChanged = !previous || JSON.stringify(loadContent(previous)) !== JSON.stringify(loadContent(next));
    const sourceChanged = previous?.sourceDigest !== sourceDigest;
    const cacheWrite = await prepareTrainingLoadCacheWrite(db, transaction, uid, eventId,
      summarizeTrainingLoad(eventId, parent.data()!, next));
    const changed = loadChanged || sourceChanged || cacheWrite.changed;
    if (!loadChanged && !cacheWrite.changed && previous?.updatedAt !== undefined) next.updatedAt = previous.updatedAt;
    if (!changed) next.revision = previous!.revision;
    // A control can change while the source is pending without changing parser candidates.
    // Carry a server revision so finalization still invalidates that newly resolved load.
    next.loadRevision = (previous?.loadRevision ?? 0) + (cacheWrite.changed ? 1 : 0);
    if (changed || previous?.sourceWritePending || JSON.stringify(previous?.sourceWriteTimes) !== JSON.stringify(sourceWriteTimes))
      transaction.set(metaRef, next);
    cacheWrite.write();
  });
}
