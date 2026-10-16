import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { canonicalTrainingLoadValue } from '../../../shared/training-load-source';
import { derivedMetricSourceProjection } from '../derived-metrics/derived-metrics-source-change';
import { trainingLoadWriteTime } from './training-load-cache';

type SourceSnapshot = Pick<DocumentSnapshot, 'id' | 'data' | 'updateTime'>;

/** Shared bookkeeping after import/merge finalizers have validated their persisted sources. */
export function trainingLoadSourceSnapshot(parent: SourceSnapshot, activities: readonly SourceSnapshot[]) {
  const sourceDigest = createHash('sha256').update(JSON.stringify(canonicalTrainingLoadValue({
    event: derivedMetricSourceProjection('event', parent.data()),
    activities: activities.map(doc => ({ id: doc.id, data: derivedMetricSourceProjection('activity', doc.data()) }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  }))).digest('hex');
  const sourceWriteTimes = Object.fromEntries([['event', trainingLoadWriteTime(parent.updateTime)],
    ...activities.map(doc => [`activity:${doc.id}`, trainingLoadWriteTime(doc.updateTime)])]);
  return { sourceDigest, sourceWriteTimes };
}
