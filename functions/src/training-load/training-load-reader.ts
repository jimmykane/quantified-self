import * as admin from 'firebase-admin';
import { attachEffectiveTrainingLoad, resolveEffectiveTrainingLoad, type TrainingLoadMetadata } from '../../../shared/training-load-policy';
import { trainingLoadSourceFingerprint, readTrainingLoadSummaries, refreshTrainingLoadSummary, completeTrainingLoadCacheWarmup, unavailableTrainingLoad, type TrainingLoadSummary } from './training-load-cache';

const contexts = new WeakMap<object, { summary: TrainingLoadSummary | null; stale: boolean }>();
type SourceDocument = { id: string; data(): admin.firestore.DocumentData | undefined };

/** At most 100 exact owner-scoped metadata documents per read; no metadata history scan. */
export async function fetchTrainingLoadMetadata(
  uid: string, eventIds: readonly string[], db = admin.firestore(),
): Promise<Map<string, TrainingLoadMetadata>> {
  const unique = [...new Set(eventIds)];
  const results = new Map<string, TrainingLoadMetadata>();
  for (let offset = 0; offset < unique.length; offset += 100) {
    const batch = unique.slice(offset, offset + 100);
    const documents = await db.getAll(...batch.map(id => db.doc(`users/${uid}/events/${id}/metaData/trainingLoad`)));
    documents.forEach((document, index) => {
      const data = document.data();
      if (document.exists && data?.version === 1) results.set(batch[index], data as TrainingLoadMetadata);
    });
  }
  return results;
}

/** Full-history projections only: the first build warms existing private metadata once. */
export async function attachEventTrainingLoads<T extends SourceDocument>(uid: string, documents: readonly T[]): Promise<T[]> {
  let summaries = await readTrainingLoadSummaries(uid);
  if (!summaries) {
    const metadata = await fetchTrainingLoadMetadata(uid, documents.map(document => document.id));
    // Bound concurrency and reread current records transactionally; never publish a stale scan result.
    const ids = [...metadata.keys()];
    for (let offset = 0; offset < ids.length; offset += 4)
      await Promise.all(ids.slice(offset, offset + 4).map(id => refreshTrainingLoadSummary(uid, id)));
    await completeTrainingLoadCacheWarmup(uid);
    summaries = await readTrainingLoadSummaries(uid);
    if (!summaries) throw new Error('Training load cache warmup did not complete.');
  }
  return documents.map(document => {
    const data = document.data() ?? {};
    const summary = summaries!.get(document.id) ?? null;
    const stale = !!summary && !summary.excluded && summary.parentFingerprint !== trainingLoadSourceFingerprint(data);
    contexts.set(data, { summary, stale });
    attachEffectiveTrainingLoad(data, stale ? unavailableTrainingLoad() : summary?.load ?? resolveEffectiveTrainingLoad(data, null));
    // Firestore data() can return a new object each call. Keep one canonical projection.
    return { ...document, id: document.id, data: () => data } as T;
  });
}

export function attachActivityTrainingLoad(activityId: string, data: Record<string, unknown>, parent: object): void {
  const context = contexts.get(parent);
  if (!context) return;
  const { summary } = context;
  const leg = summary?.legs[activityId];
  const stale = !summary?.excluded && (context.stale ||
    (!!leg?.fingerprint && leg.fingerprint !== trainingLoadSourceFingerprint(data)));
  attachEffectiveTrainingLoad(data, stale ? unavailableTrainingLoad() : leg?.load ?? summary?.missingLeg ??
    resolveEffectiveTrainingLoad({}, null, [{ id: activityId, ...data }], activityId));
}
