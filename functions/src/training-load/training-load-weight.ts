import { FieldPath, type Firestore, type Transaction, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { HEALTH_SOURCE_RECORD_KINDS, HEALTH_SOURCE_RECORDS_COLLECTION_ID, HEALTH_METRIC_IDS, HEALTH_UNITS,
  type HealthSourceRecord } from '../../../shared/health';
import { decodeHealthMetricSportsLibData, SportsLibDataValidationError } from '../../../shared/sports-lib-health-data';
import type { TrainingLoadHealthWeight } from '../../../shared/training-load-policy';

const MAX_RECORDS = 64;

/** Actual point measurements only. Workout profile context and future measurements are ineligible. */
export function trainingLoadWeightCandidates(uid: string, atMs: number,
  docs: ReadonlyArray<{ id: string; data(): FirebaseFirestore.DocumentData }>): Extract<TrainingLoadHealthWeight, { status: 'available' }>[] {
  const weights: Extract<TrainingLoadHealthWeight, { status: 'available' }>[] = [];
  for (const doc of docs) {
    const record = doc.data() as HealthSourceRecord;
    if (record.userID !== uid || record.kind !== HEALTH_SOURCE_RECORD_KINDS.PointMeasurement
      || !Number.isSafeInteger(record.endTimeMs) || !Number.isFinite(new Date(record.endTimeMs).getTime())
      || record.endTimeMs > atMs || !Array.isArray(record.metrics)
      || typeof record.source?.revision?.digest !== 'string') continue;
    for (const stored of record.metrics) {
      if (stored?.metricId !== HEALTH_METRIC_IDS.BodyWeight) continue;
      let entry;
      try { entry = decodeHealthMetricSportsLibData(stored); }
      catch (error) { if (error instanceof SportsLibDataValidationError) continue; throw error; }
      if (entry.kind !== 'value' || entry.metricId !== HEALTH_METRIC_IDS.BodyWeight
        || entry.aggregation !== 'measurement' || entry.semanticVariant !== 'point'
        || entry.normalizationStatus !== 'canonical' || entry.canonical?.unit !== HEALTH_UNITS.Kilogram
        || typeof entry.canonical.value !== 'number' || !Number.isFinite(entry.canonical.value) || entry.canonical.value <= 0) continue;
      weights.push({ status: 'available', kilograms: entry.canonical.value, observedAtMs: record.endTimeMs,
        sourceRecordId: doc.id, sourceRevision: record.source.revision.digest });
    }
  }
  return weights;
}

/** Bounded latest-prior lookup; equal-time conflicts are unavailable rather than provider-selected or averaged.
 * There is deliberately no age limit. Query failures propagate so an import can retry.
 */
export async function readTrainingLoadWeight(db: Firestore, transaction: Transaction, uid: string,
  atMs: number): Promise<Exclude<TrainingLoadHealthWeight, null>> {
  const base = db.collection(`users/${uid}/${HEALTH_SOURCE_RECORDS_COLLECTION_ID}`)
    .where('kind', '==', HEALTH_SOURCE_RECORD_KINDS.PointMeasurement)
    .where('metricIds', 'array-contains', HEALTH_METRIC_IDS.BodyWeight).where('endTimeMs', '<=', atMs)
    .orderBy('endTimeMs', 'desc').orderBy(FieldPath.documentId(), 'desc')
    .select('userID', 'kind', 'endTimeMs', 'metrics', 'source.revision.digest');
  let scanned = 0, cursor: QueryDocumentSnapshot | undefined;
  let latest: Extract<TrainingLoadHealthWeight, { status: 'available' }> | undefined;
  while (scanned < MAX_RECORDS) {
    const limit = Math.min(scanned ? 8 : 2, MAX_RECORDS - scanned);
    const page = await transaction.get((cursor ? base.startAfter(cursor) : base).limit(limit));
    scanned += page.size;
    for (const candidate of trainingLoadWeightCandidates(uid, atMs, page.docs)) {
      if (!latest || candidate.observedAtMs > latest.observedAtMs) latest = candidate;
      else if (candidate.observedAtMs === latest.observedAtMs && candidate.kilograms !== latest.kilograms)
        return { status: 'unavailable', reason: 'conflicting' };
    }
    const last = page.docs[page.docs.length - 1];
    if (page.size < limit || latest && last && last.get('endTimeMs') < latest.observedAtMs)
      return latest ?? { status: 'unavailable', reason: 'missing' };
    cursor = last;
  }
  return { status: 'unavailable', reason: 'scan-limit' };
}
