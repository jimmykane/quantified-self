import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { createHash } from 'node:crypto';
import type { EventInterface } from '@sports-alliance/sports-lib';
import { defaultAppliedTrainingLoadPolicy, recordedTrainingStressScore, unresolvedTrainingLoadLegs,
  type TrainingLoadControl, type TrainingLoadLeg, type TrainingLoadMetadata } from '../../../shared/training-load-policy';
import { canonicalTrainingLoadValue as canonical, trainingLoadTimeMs } from '../../../shared/training-load-source';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { derivedMetricSourceProjection } from '../derived-metrics/derived-metrics-source-change';
import { prepareTrainingLoadCacheWrite, summarizeTrainingLoad, trainingLoadSourceFingerprint,
  trainingLoadWriteTime } from '../training-load/training-load-cache';
import { mergedActivityId } from './merge-recorded-events';

export interface MergeTrainingLoadSource {
  eventId: string;
  parent: Record<string, unknown>;
  activities: Array<{ id: string; data: Record<string, unknown> }>;
}

const changedSource = () => new HttpsError('failed-precondition',
  'A selected workout changed or its Training load needs review. Refresh or reparse it before merging.');

/** Compare downloaded-source references too; Training fingerprints intentionally omit file metadata. */
function originalFilesSnapshot(parent: Record<string, unknown>): string {
  const normalize = (value: unknown): unknown => {
    if (value instanceof Date) {
      const seconds = Math.floor(value.getTime() / 1000);
      return ['timestamp', seconds, (value.getTime() - seconds * 1000) * 1_000_000];
    }
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      const timestamp = value as { seconds?: unknown; nanoseconds?: unknown; toMillis?: unknown };
      if (typeof timestamp.toMillis === 'function' && typeof timestamp.seconds === 'number' && typeof timestamp.nanoseconds === 'number')
        return ['timestamp', timestamp.seconds, timestamp.nanoseconds];
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
    }
    return value;
  };
  return JSON.stringify(canonical(normalize({ originalFile: parent.originalFile, originalFiles: parent.originalFiles })));
}

/** Copy source snapshots, never recompute candidates from streamless stored activities. */
export function mergedTrainingLoadLegs(resultId: string,
  sources: Array<MergeTrainingLoadSource & { metadata: TrainingLoadMetadata | null }>,
): Pick<TrainingLoadMetadata, 'legs' | 'controls'> {
  const legs: Record<string, TrainingLoadLeg> = {};
  const controls: Record<string, TrainingLoadControl> = {};
  for (const source of sources) {
    const metadata = source.metadata;
    if (metadata?.sourceWritePending || (metadata && unresolvedTrainingLoadLegs(metadata).length) ||
      (metadata?.parentFingerprint && metadata.parentFingerprint !== trainingLoadSourceFingerprint(source.parent))) throw changedSource();
    if (metadata && !metadata.legs) {
      const sourceIds = new Set(source.activities.map(activity => activity.id));
      const associations = Object.values(metadata.controls).flatMap(control => control.activityId ? [control.activityId] : []);
      if (new Set(associations).size !== associations.length || Object.entries(metadata.controls).some(([key, control]) =>
        !control.dismissed && !sourceIds.has(control.activityId ?? key))) throw changedSource();
    }
    const liveLegs = Object.values(metadata?.legs ?? {}).filter(leg => leg.activityId);
    if (metadata?.legs && (liveLegs.length !== source.activities.length ||
      new Set(liveLegs.map(leg => leg.activityId)).size !== liveLegs.length)) throw changedSource();
    for (const activity of source.activities) {
      const entry = Object.entries(metadata?.legs ?? {}).find(([, leg]) => leg.activityId === activity.id);
      if (metadata?.legs && !entry) throw changedSource();
      if (entry?.[1].sourceFingerprint && entry[1].sourceFingerprint !== trainingLoadSourceFingerprint(activity.data)) throw changedSource();
      const association = Object.entries(metadata?.controls ?? {}).find(([, control]) => control.activityId === activity.id);
      const sourceKey = association?.[0] ?? entry?.[0] ?? activity.id;
      const policy = metadata?.legs?.[sourceKey]?.policy ?? entry?.[1].policy ?? defaultAppliedTrainingLoadPolicy(activity.data.type);
      const sourceControl = metadata?.controls[sourceKey];
      const id = mergedActivityId(resultId, source.eventId, activity.id);
      const stat = (type: string): number | null => {
        const stats = activity.data.stats as Record<string, unknown> | undefined;
        const raw = stats?.[type];
        const wrapped = raw as { value?: unknown; rawValue?: unknown; _value?: unknown } | undefined;
        const value = typeof raw === 'number' ? raw : wrapped?.value ?? wrapped?.rawValue ?? wrapped?._value;
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
      };
      legs[id] = { activityId: id, identity: { startMs: trainingLoadTimeMs(activity.data.startDate),
        endMs: trainingLoadTimeMs(activity.data.endDate), type: `${activity.data.type}`,
        duration: stat('Duration'), distance: stat('Distance') },
        recordedTss: recordedTrainingStressScore(activity.data), evaluations: entry?.[1].evaluations ?? null,
        policy: { ...policy } };
      // Explicit source association is already resolved by the mapping above. Never copy source IDs into controls.
      const control: TrainingLoadControl = {};
      if (sourceControl?.method !== undefined) control.method = sourceControl.method;
      if (sourceControl?.override !== undefined) control.override = sourceControl.override;
      if (sourceControl?.included !== undefined) control.included = sourceControl.included;
      if (metadata?.excluded) control.included = false;
      if (Object.keys(control).length) controls[id] = control;
    }
  }
  if (!Object.keys(legs).length || Object.keys(legs).length > 100) throw new HttpsError('failed-precondition', 'Merge supports at most 100 activities.');
  return { legs, controls };
}

/** Freeze one consistent source snapshot before writing, then certify the result and cache after source writes. */
export async function prepareMergedTrainingLoad(uid: string, event: EventInterface,
  sources: MergeTrainingLoadSource[]): Promise<() => Promise<void>> {
  const db = admin.firestore();
  const resultId = event.getID()!;
  const resultRef = db.doc(`users/${uid}/events/${resultId}`);
  const metaRef = resultRef.collection('metaData').doc('trainingLoad');
  const parentFingerprint = trainingLoadSourceFingerprint(event.toJSON());
  const activityFingerprints = new Map(event.getActivities().map(activity =>
    [activity.getID()!, trainingLoadSourceFingerprint(activity.toJSON())]));
  const sourceRefs = sources.flatMap(source => [db.doc(`users/${uid}/events/${source.eventId}`),
    db.doc(`users/${uid}/events/${source.eventId}/metaData/trainingLoad`)]);
  await db.runTransaction(async transaction => {
    if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid)).shouldSkip)
      throw new HttpsError('failed-precondition', 'Account deletion blocks merging.');
    const [target, previousSnapshot, ...snapshots] = await transaction.getAll(resultRef, metaRef, ...sourceRefs);
    const previous = previousSnapshot.data() as TrainingLoadMetadata | undefined;
    const currentSources: Array<MergeTrainingLoadSource & { metadata: TrainingLoadMetadata | null }> = [];
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      const parent = snapshots[i * 2];
      if (!parent.exists || trainingLoadSourceFingerprint(parent.data()!) !== trainingLoadSourceFingerprint(source.parent) ||
        originalFilesSnapshot(parent.data()!) !== originalFilesSnapshot(source.parent)) throw changedSource();
      const children = await transaction.get(db.collection(`users/${uid}/activities`).where('eventID', '==', source.eventId).limit(101));
      const expected = new Map(source.activities.map(activity => [activity.id, trainingLoadSourceFingerprint(activity.data)]));
      if (children.size !== expected.size || children.docs.some(child =>
        expected.get(child.id) !== trainingLoadSourceFingerprint(child.data()))) throw changedSource();
      currentSources.push({ ...source, metadata: snapshots[i * 2 + 1].data() as TrainingLoadMetadata ?? null });
    }
    const copied = mergedTrainingLoadLegs(resultId, currentSources);
    // A retry must never replace edits made on a partially written result. Stable IDs also prevent orphaned children.
    if (previous?.legs && (Object.keys(previous.legs).length !== Object.keys(copied.legs!).length ||
      Object.entries(previous.legs).some(([key, leg]) => !copied.legs![key] || leg.activityId !== key))) throw changedSource();
    if (target.exists && (!previous ||
      (previous.parentFingerprint && previous.parentFingerprint !== parentFingerprint) ||
      trainingLoadSourceFingerprint(target.data()!) !== parentFingerprint)) throw changedSource();
    for (const [id, leg] of Object.entries(copied.legs!)) {
      leg.sourceFingerprint = activityFingerprints.get(id);
      if (!leg.sourceFingerprint) throw changedSource();
      if (previous?.legs?.[id]) leg.policy = previous.legs[id].policy;
    }
    const pending: TrainingLoadMetadata = { version: 1, revision: (previous?.revision ?? 0) + 1,
      excluded: previous?.excluded ?? false, legs: copied.legs, controls: previous?.controls ?? copied.controls,
      parentFingerprint, sourceWritePending: true, sourceFirstImport: true,
      ...(previous?.updatedAt !== undefined ? { updatedAt: previous.updatedAt } : {}),
      ...(previous?.sourceDigest ? { sourceDigest: previous.sourceDigest } : {}),
      sourceRevision: previous?.sourceRevision ?? 0, loadRevision: previous?.loadRevision ?? 0 };
    const cache = await prepareTrainingLoadCacheWrite(db, transaction, uid, resultId,
      summarizeTrainingLoad(resultId, target.data() ?? {}, pending));
    transaction.set(metaRef, pending);
    cache.write();
  });
  return async () => db.runTransaction(async transaction => {
    if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid)).shouldSkip)
      throw new HttpsError('failed-precondition', 'Account deletion blocks merging.');
    const ids = [...activityFingerprints.keys()];
    const [parent, savedMetadata, ...activities] = await transaction.getAll(resultRef, metaRef,
      ...ids.map(id => db.doc(`users/${uid}/activities/${id}`)));
    const previous = savedMetadata.data() as TrainingLoadMetadata | undefined;
    if (!parent.exists || !previous?.legs || previous.parentFingerprint !== parentFingerprint ||
      trainingLoadSourceFingerprint(parent.data()!) !== parentFingerprint || Object.keys(previous.legs).length !== ids.length ||
      activities.some((activity, index) => !activity.exists || activity.data()?.eventID !== resultId ||
        trainingLoadSourceFingerprint(activity.data()!) !== activityFingerprints.get(ids[index]) ||
        previous.legs?.[ids[index]]?.sourceFingerprint !== activityFingerprints.get(ids[index]))) throw changedSource();
    const sourceDigest = createHash('sha256').update(JSON.stringify(canonical({
      event: derivedMetricSourceProjection('event', parent.data()),
      activities: activities.map(doc => ({ id: doc.id, data: derivedMetricSourceProjection('activity', doc.data()) }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    }))).digest('hex');
    const { sourceFirstImport: _first, ...retained } = previous;
    const next: TrainingLoadMetadata = { ...retained, sourceWritePending: false,
      sourceWriteTimes: Object.fromEntries([['event', trainingLoadWriteTime(parent.updateTime)],
        ...activities.map(activity => [`activity:${activity.id}`, trainingLoadWriteTime(activity.updateTime)])]),
      sourceDigest, sourceRevision: (previous.sourceRevision ?? 0) + (sourceDigest === previous.sourceDigest ? 0 : 1) };
    const cache = await prepareTrainingLoadCacheWrite(db, transaction, uid, resultId,
      summarizeTrainingLoad(resultId, parent.data()!, next));
    const changed = previous.sourceWritePending || cache.changed || sourceDigest !== previous.sourceDigest;
    if (changed) {
      next.revision = previous.revision + 1;
      next.updatedAt = FieldValue.serverTimestamp();
      next.loadRevision = (previous.loadRevision ?? 0) + (cache.changed ? 1 : 0);
      transaction.set(metaRef, next);
    }
    cache.write();
  });
}
