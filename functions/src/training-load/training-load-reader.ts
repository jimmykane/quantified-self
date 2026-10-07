import * as admin from 'firebase-admin';
import { attachEffectiveTrainingLoad, resolveEffectiveTrainingLoad, type TrainingLoadActivity,
  type TrainingLoadMetadata, type EffectiveTrainingLoad } from '../../../shared/training-load-policy';
import { trainingLoadSourceFingerprint } from './training-load-metadata';

const contexts = new WeakMap<object, { metadata: TrainingLoadMetadata | null; activities: TrainingLoadActivity[]; stale: boolean }>();
type SourceDocument = { id: string; data(): admin.firestore.DocumentData | undefined };
const staleLoad = (): EffectiveTrainingLoad => ({ score: null, status: 'unavailable', method: null,
  estimated: false, reasons: ['source-updating'] });

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

/** Decorates in-memory projections only; recorded stats and persisted source documents remain untouched. */
export async function attachEventTrainingLoads<T extends SourceDocument>(uid: string, documents: readonly T[]): Promise<T[]> {
  const metadataById = await fetchTrainingLoadMetadata(uid, documents.map(document => document.id));
  const result: T[] = [];
  for (const document of documents) {
    const data = document.data() ?? {};
    const metadata = metadataById.get(document.id) ?? null;
    let activities: TrainingLoadActivity[] = [];
    if (metadata && !metadata.legs && Object.keys(metadata.controls).length) {
      // Only legacy workouts with an immediate owner override need this bounded join.
      const children = await admin.firestore().collection(`users/${uid}/activities`)
        .where('eventID', '==', document.id).select('type', 'stats').limit(101).get();
      if (children.size > 100) throw new Error('Training load leg bound exceeded.');
      activities = children.docs.map(child => ({ id: child.id, ...child.data() }));
    }
    const stale = !metadata?.excluded && !!metadata?.parentFingerprint && metadata.parentFingerprint !== trainingLoadSourceFingerprint(data);
    contexts.set(data, { metadata, activities, stale });
    attachEffectiveTrainingLoad(data, stale ? staleLoad() : resolveEffectiveTrainingLoad(data, metadata, activities));
    // Firestore data() can return a new object each call. Keep one canonical projection.
    result.push({ ...document, id: document.id, data: () => data } as T);
  }
  return result;
}

export function attachActivityTrainingLoad(activityId: string, data: Record<string, unknown>, parent: object): void {
  const context = contexts.get(parent);
  if (!context) return;
  const leg = Object.values(context.metadata?.legs ?? {}).find(candidate => candidate.activityId === activityId);
  const stale = !context.metadata?.excluded && (context.stale ||
    (!!leg?.sourceFingerprint && leg.sourceFingerprint !== trainingLoadSourceFingerprint(data)));
  attachEffectiveTrainingLoad(data, stale ? staleLoad() : resolveEffectiveTrainingLoad({}, context.metadata,
    [{ id: activityId, ...data }], activityId));
}
