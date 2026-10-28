import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { activityElevationMetric, isTerrainAscentActivity, readActivityAscent, readAscentCorrection, validActivityAscent,
  type ActivityAscentEdit, type ActivityAscentUpdate, type ActivityElevationEdit, type ActivityElevationUpdate } from '../../../shared/activity-ascent';
import { isBenchmarkEvent } from '../../../shared/event-classification';
import { sanitizeActivityFirestoreWritePayload, sanitizeEventFirestoreWritePayload } from '../../../shared/firestore-write-sanitizer';
import type { TrainingLoadMetadata } from '../../../shared/training-load-policy';
import { getUserDeletionGuardedDocumentsInTransaction } from '../shared/user-deletion-guard';
import { prepareTrainingLoadCacheWrite, summarizeTrainingLoad, trainingLoadSourceFingerprint } from '../training-load/training-load-cache';
import { trainingLoadSourceSnapshot } from '../training-load/training-load-source-snapshot';

function stats(data: admin.firestore.DocumentData): Record<string, unknown> {
  return data.stats && typeof data.stats === 'object' && !Array.isArray(data.stats) ? { ...data.stats } : {};
}

function documentId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    && !value.includes('/') && value !== '.' && value !== '..';
}

export function validateActivityAscentEdit(eventId: string, input: unknown): ActivityAscentEdit {
  const data = input as Partial<ActivityAscentEdit> | null;
  if (!documentId(eventId) || !data || typeof data !== 'object' || Array.isArray(data)
    || Object.keys(data).some(key => !['activityId', 'ascent', 'expectedSourceFingerprint', 'expectedCorrection'].includes(key))
    || !documentId(data.activityId) || !(data.ascent === null || validActivityAscent(data.ascent))
    || typeof data.expectedSourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(data.expectedSourceFingerprint)
    || !(data.expectedCorrection === null || readAscentCorrection(data.expectedCorrection))) {
    throw new HttpsError('invalid-argument', 'Enter a valid elevation correction and reload the activity before saving.');
  }
  return data as ActivityAscentEdit;
}

/** Strict app-only elevation contract; the legacy ascent request stays supported. */
export function validateActivityElevationEdit(eventId: string, input: unknown): ActivityElevationEdit {
  const data = input as Partial<ActivityElevationEdit> | null;
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || (data.metric !== 'ascent' && data.metric !== 'descent')
    || Object.keys(data).some(key => !['activityId', 'metric', 'value', 'expectedSourceFingerprint', 'expectedCorrection'].includes(key)))
    throw new HttpsError('invalid-argument', 'Enter a valid ascent or descent correction.');
  validateActivityAscentEdit(eventId, { activityId: data.activityId, ascent: data.value,
    expectedSourceFingerprint: data.expectedSourceFingerprint, expectedCorrection: data.expectedCorrection });
  return data as ActivityElevationEdit;
}

export async function updateActivityAscent(uid: string, eventId: string, request: unknown): Promise<ActivityAscentUpdate> {
  const { ascent, ...input } = validateActivityAscentEdit(eventId, request);
  const saved = await saveActivityElevation(uid, eventId, { ...input, metric: 'ascent', value: ascent });
  return { activityId: saved.activityId, ascent: saved.value, eventAscent: saved.eventValue, correction: saved.correction };
}

export function updateActivityElevation(uid: string, eventId: string, request: unknown): Promise<ActivityElevationUpdate> {
  return saveActivityElevation(uid, eventId, validateActivityElevationEdit(eventId, request));
}

/**
 * Reuses the activity-processing callable because source fingerprints and the Training cache are server-owned.
 * One transaction checks the live source reservation, saves the activity and parent total, and certifies unchanged
 * load evaluations against the new summary. A client-only stat patch cannot update that private cache safely.
 */
async function saveActivityElevation(uid: string, eventId: string, input: ActivityElevationEdit): Promise<ActivityElevationUpdate> {
  const { metric } = input;
  const { type, field } = activityElevationMetric(metric);
  const db = admin.firestore();
  const eventRef = db.doc(`users/${uid}/events/${eventId}`);
  const metadataRef = eventRef.collection('metaData').doc('trainingLoad');
  return db.runTransaction(async transaction => {
    const { guard, snapshots: [parent, metadataDoc] } = await getUserDeletionGuardedDocumentsInTransaction(
      db, transaction, uid, [eventRef, metadataRef]);
    if (guard.shouldSkip) throw new HttpsError('failed-precondition', 'This account is being deleted.');
    if (!parent.exists) throw new HttpsError('not-found', 'This activity no longer exists.');
    const parentData = parent.data()!;
    const metadata = metadataDoc.data() as TrainingLoadMetadata | undefined;
    if (isBenchmarkEvent(parentData)) throw new HttpsError('failed-precondition', 'Comparison recordings are read-only.');
    if (metadata?.sourceWritePending || parentData.benchmarkSourceWritePending)
      throw new HttpsError('failed-precondition', `The recording is updating. Reload it before editing ${metric}.`);
    const children = await transaction.get(db.collection(`users/${uid}/activities`).where('eventID', '==', eventId).limit(101));
    if (children.size > 100) throw new HttpsError('failed-precondition', 'This recording has too many activities to edit.');
    const target = children.docs.find(child => child.id === input.activityId);
    if (!target) throw new HttpsError('not-found', 'This activity no longer belongs to the recording.');
    const source = target.data();
    if (!isTerrainAscentActivity(source.type)) throw new HttpsError('failed-precondition', `Terrain ${metric} is unavailable for this activity.`);
    const correction = readAscentCorrection(source[field]);
    if (trainingLoadSourceFingerprint(source) !== input.expectedSourceFingerprint
      || JSON.stringify(correction) !== JSON.stringify(readAscentCorrection(input.expectedCorrection)))
      throw new HttpsError('aborted', `The activity changed. Reload it before saving ${metric}.`);
    const original = correction ? correction.sourceValue : readActivityAscent(source.stats, metric);
    if (input.value === null && !correction) return { activityId: target.id, metric, value: original,
      eventValue: readActivityAscent(parentData.stats, metric), correction: null };
    if (metadata?.parentFingerprint && metadata.parentFingerprint !== trainingLoadSourceFingerprint(parentData))
      throw new HttpsError('failed-precondition', `The recording is updating. Reload it before editing ${metric}.`);
    const byId = new Map(children.docs.map(child => [child.id, child]));
    for (const leg of Object.values(metadata?.legs ?? {})) {
      if (!leg.activityId) continue;
      const child = byId.get(leg.activityId);
      if (!child || (leg.sourceFingerprint && leg.sourceFingerprint !== trainingLoadSourceFingerprint(child.data())))
        throw new HttpsError('failed-precondition', `The recording is updating. Reload it before editing ${metric}.`);
    }
    const nextStats = stats(source);
    const value = input.value === null ? original : input.value;
    if (value === null) delete nextStats[type];
    else nextStats[type] = value;
    const nextCorrection = input.value === null ? null : { value: input.value, sourceValue: original };
    const nextSource: admin.firestore.DocumentData = { ...source, stats: nextStats, [field]: nextCorrection };
    const nextChildren = children.docs.map(child => ({ id: child.id, updateTime: child.updateTime,
      data: () => child.id === target.id ? nextSource : child.data() }));
    const elevations = nextChildren.filter(child => isTerrainAscentActivity(child.data().type))
      .map(child => readActivityAscent(child.data().stats, metric)).filter((value): value is number => value !== null);
    const parentStats = stats(parentData);
    if (elevations.length) parentStats[type] = elevations.reduce((total, value) => total + value, 0);
    else delete parentStats[type];
    const nextParent = { ...parentData, stats: parentStats };
    let nextMetadata = metadata;
    if (metadata) {
      const legs = metadata.legs ? Object.fromEntries(Object.entries(metadata.legs).map(([key, leg]) => [key,
        leg.activityId === target.id ? { ...leg, sourceFingerprint: trainingLoadSourceFingerprint(nextSource) } : leg])) : undefined;
      const { sourceDigest } = trainingLoadSourceSnapshot({ id: parent.id, updateTime: parent.updateTime, data: () => nextParent }, nextChildren);
      nextMetadata = { ...metadata, ...(legs ? { legs } : {}), parentFingerprint: trainingLoadSourceFingerprint(nextParent),
        revision: metadata.revision + 1, sourceRevision: (metadata.sourceRevision ?? 0) + 1,
        sourceDigest, sourceWriteTimes: {}, updatedAt: FieldValue.serverTimestamp() };
    }
    const cache = await prepareTrainingLoadCacheWrite(db, transaction, uid, eventId, summarizeTrainingLoad(eventId,
      nextParent, nextMetadata ?? null, nextChildren.map(child => ({ id: child.id, ...child.data() }))));
    transaction.update(target.ref, sanitizeActivityFirestoreWritePayload({ stats: nextStats,
      [field]: nextCorrection ?? FieldValue.delete() }));
    transaction.update(eventRef, sanitizeEventFirestoreWritePayload({ stats: parentStats }));
    if (nextMetadata) transaction.set(metadataRef, nextMetadata);
    cache.write();
    return { activityId: target.id, metric, value, eventValue: readActivityAscent(parentStats, metric), correction: nextCorrection };
  });
}
