import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { resolveEffectiveTrainingLoad, unresolvedTrainingLoadLegs, type EffectiveTrainingLoad,
  type TrainingLoadActivity, type TrainingLoadMetadata } from '../../../shared/training-load-policy';
import { canonicalTrainingLoadValue, serializeTrainingLoadSource } from '../../../shared/training-load-source';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';

export const TRAINING_LOAD_CACHE_VERSION = 1;
export const TRAINING_LOAD_CACHE_MAX_ENTRIES = 100;
const MAX_BUCKET_BYTES = 400_000;
const MAX_ENTRY_BYTES = 100_000;
export interface TrainingLoadSummary {
  eventId: string;
  parentFingerprint: string;
  excluded: boolean;
  load: EffectiveTrainingLoad;
  missingLeg: EffectiveTrainingLoad;
  legs: Record<string, { fingerprint: string | null; load: EffectiveTrainingLoad }>;
}
interface Bucket { version: 1; leaf: boolean; entries: Record<string, TrainingLoadSummary>; }
export const trainingLoadSourceFingerprint = (data: Parameters<typeof serializeTrainingLoadSource>[0]): string =>
  createHash('sha256').update(serializeTrainingLoadSource(data)).digest('hex');
export const trainingLoadWriteTime = (time: { seconds: number; nanoseconds: number } | undefined): string =>
  time ? `${time.seconds}:${time.nanoseconds}` : '';
export const trainingLoadCacheKey = (eventId: string): string => createHash('sha256').update(eventId).digest('hex');
const bucketRef = (db: admin.firestore.Firestore, uid: string, prefix: string) =>
  db.doc(`users/${uid}/trainingLoadCache/b_${prefix}`);
export const unavailableTrainingLoad = (): EffectiveTrainingLoad => ({ score: null, status: 'unavailable', method: null,
  estimated: false, reasons: ['source-updating'] });

/** Only resolved results and source guards enter the cache; policies/controls remain in event metadata. */
export function summarizeTrainingLoad(eventId: string, parent: Record<string, unknown>, metadata: TrainingLoadMetadata | null,
  legacyActivities: readonly (TrainingLoadActivity & Record<string, unknown>)[] = []): TrainingLoadSummary | null {
  if (metadata?.sourceWritePending) {
    const load = resolveEffectiveTrainingLoad(parent, metadata);
    // No source revision is certified while the import is pending. Keep retry writes idempotent.
    return { eventId, parentFingerprint: '', excluded: metadata.excluded,
      load, missingLeg: load, legs: {} };
  }
  if (!metadata || (!metadata.legs && !metadata.excluded && !Object.keys(metadata.controls).length)) return null;
  const unresolved = unresolvedTrainingLoadLegs(metadata).length > 0;
  const activities = metadata.legs
    ? Object.values(metadata.legs).flatMap(leg => leg.activityId ? [{ id: leg.activityId, fingerprint: leg.sourceFingerprint ?? null }] : [])
    : legacyActivities.map(activity => ({ id: activity.id, fingerprint: trainingLoadSourceFingerprint(activity) }));
  return { eventId, excluded: metadata.excluded,
    parentFingerprint: metadata.parentFingerprint ?? trainingLoadSourceFingerprint(parent),
    load: resolveEffectiveTrainingLoad(parent, metadata, legacyActivities),
    missingLeg: metadata.excluded || unresolved ? resolveEffectiveTrainingLoad({}, metadata) : unavailableTrainingLoad(),
    legs: Object.fromEntries(activities.map(activity => [activity.id, { fingerprint: activity.fingerprint,
      load: resolveEffectiveTrainingLoad({}, metadata, legacyActivities, activity.id) }])) };
}

/** Flat hash-prefix buckets split transactionally at both entry and byte bounds. */
export function splitTrainingLoadBucket(prefix: string, entries: Bucket['entries']): Map<string, Bucket> {
  const bucket: Bucket = { version: 1, leaf: true, entries };
  if (Object.keys(entries).length <= TRAINING_LOAD_CACHE_MAX_ENTRIES && Buffer.byteLength(JSON.stringify(bucket)) <= MAX_BUCKET_BYTES)
    return new Map([[prefix, bucket]]);
  if (prefix.length >= 64) throw new Error('Training load cache bucket exceeds its bound.');
  const result = new Map<string, Bucket>([[prefix, { version: 1, leaf: false, entries: {} }]]);
  const groups = new Map<string, Bucket['entries']>();
  for (const [key, value] of Object.entries(entries)) {
    const child = key.slice(0, prefix.length + 1);
    if (!groups.has(child)) groups.set(child, {});
    groups.get(child)![key] = value;
  }
  for (const [child, values] of groups) for (const [key, value] of splitTrainingLoadBucket(child, values)) result.set(key, value);
  return result;
}

/** Read phase first: callers can atomically commit source metadata and its summary after all transaction reads. */
export async function prepareTrainingLoadCacheWrite(db: admin.firestore.Firestore, transaction: admin.firestore.Transaction,
  uid: string, eventId: string, summary: TrainingLoadSummary | null): Promise<{ changed: boolean; write(): void }> {
  if (summary && Buffer.byteLength(JSON.stringify(summary)) > MAX_ENTRY_BYTES) throw new Error('Training load summary exceeds its bound.');
  const key = trainingLoadCacheKey(eventId);
  for (let depth = 1; depth <= 64; depth++) {
    const prefix = key.slice(0, depth);
    const snapshot = await transaction.get(bucketRef(db, uid, prefix));
    const bucket = snapshot.data() as Bucket | undefined;
    if (bucket && bucket.version !== TRAINING_LOAD_CACHE_VERSION) throw new Error('Unsupported Training load cache version.');
    if (bucket?.leaf === false) continue;
    const entries = { ...bucket?.entries };
    if (JSON.stringify(canonicalTrainingLoadValue(entries[key] ?? null)) === JSON.stringify(canonicalTrainingLoadValue(summary))) return { changed: false, write: () => {} };
    if (summary) entries[key] = summary; else delete entries[key];
    if (!Object.keys(entries).length) {
      // Buckets are flat documents with no descendants; deleting an empty leaf cannot orphan children.
      return { changed: true, write: () => { transaction.delete(bucketRef(db, uid, prefix)); } };
    }
    const writes = splitTrainingLoadBucket(prefix, entries);
    return { changed: true, write: () => { for (const [id, data] of writes) transaction.set(bucketRef(db, uid, id), data); } };
  }
  throw new Error('Invalid Training load cache tree.');
}

/** Triggers reread current records in the transaction: delayed deliveries cannot overwrite newer owner edits. */
export async function refreshTrainingLoadSummary(uid: string, eventId: string): Promise<void> {
  const db = admin.firestore();
  await db.runTransaction(async transaction => {
    const guard = await getUserDeletionGuardStateInTransaction(db, transaction, uid);
    if (guard.shouldSkip) return;
    const [parent, snapshot] = await transaction.getAll(db.doc(`users/${uid}/events/${eventId}`),
      db.doc(`users/${uid}/events/${eventId}/metaData/trainingLoad`));
    const metadata = snapshot.data() as TrainingLoadMetadata | undefined;
    let activities: (TrainingLoadActivity & Record<string, unknown>)[] = [];
    if (parent.exists && metadata && !metadata.sourceWritePending && !metadata.legs && Object.keys(metadata.controls).length) {
      const children = await transaction.get(db.collection(`users/${uid}/activities`).where('eventID', '==', eventId).limit(101));
      if (children.size > 100) throw new Error('Training load leg bound exceeded.');
      activities = children.docs.map(child => ({ id: child.id, ...child.data() }));
    }
    const write = await prepareTrainingLoadCacheWrite(db, transaction, uid, eventId,
      parent.exists ? summarizeTrainingLoad(eventId, parent.data()!, metadata ?? null, activities) : null);
    write.write();
  });
}

/** One state read plus one read per populated leaf, independent of the number of legacy workouts without controls. */
export async function readTrainingLoadSummaries(uid: string, db = admin.firestore()): Promise<Map<string, TrainingLoadSummary> | null> {
  const state = await db.doc(`users/${uid}/trainingLoadCache/state`).get();
  if (state.data()?.version !== TRAINING_LOAD_CACHE_VERSION || state.data()?.ready !== true) return null;
  const buckets = await db.collection(`users/${uid}/trainingLoadCache`).where('leaf', '==', true).get();
  const summaries = new Map<string, TrainingLoadSummary>();
  for (const document of buckets.docs) {
    const bucket = document.data() as Bucket;
    if (bucket.version !== TRAINING_LOAD_CACHE_VERSION) throw new Error('Unsupported Training load cache version.');
    for (const summary of Object.values(bucket.entries)) summaries.set(summary.eventId, summary);
  }
  return summaries;
}

/** The first full-history build warms existing metadata once; subsequent builds never repeat that join. */
export async function completeTrainingLoadCacheWarmup(uid: string): Promise<void> {
  const db = admin.firestore();
  await db.runTransaction(async transaction => {
    const guard = await getUserDeletionGuardStateInTransaction(db, transaction, uid);
    if (!guard.shouldSkip) transaction.set(db.doc(`users/${uid}/trainingLoadCache/state`), { version: TRAINING_LOAD_CACHE_VERSION, ready: true });
  });
}
