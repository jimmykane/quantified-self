import type * as admin from 'firebase-admin';
import type { EventInterface } from '@sports-alliance/sports-lib';
import { getActivityCreatorNameCarryover } from '../../../shared/activity-creator-name';
import { preserveEventTagsOnRewrite } from '../../../shared/event-tags';
import { sanitizeActivityFirestoreWritePayload, sanitizeEventFirestoreWritePayload } from '../../../shared/firestore-write-sanitizer';
import { getActivitySourceWindow } from './activity-identity-matcher';
import { readActivitySourceIdentity } from '../../../shared/activity-source-identity';
import { prepareActivitySourceBindings, savedActivityIdentity, type SavedActivitySource, type ActivityBindingPlan } from './activity-source-binding';
import { ActivityIdentityConflictError } from './activity-identity-conflict';
import { isSameProviderRecording, providerRecordingService } from './provider-recording-identity';
import { retainedSourceRevision } from './retained-activity-source';
import { prepareTrainingLoadMetadata } from '../training-load/training-load-metadata';
import { EventWriteSkippedForDeletedEventError, type PreparedTrainingLoadWrite } from '../training-load/training-load-source-write';
import type { TrainingLoadMetadata } from '../../../shared/training-load-policy';
import { ACTIVITY_ELEVATION_METRICS, activityElevationMetric, applyActivityAscentCorrection, applyCorrectedEventAscent, isTerrainAscentActivity, readAscentCorrection,
  type AscentCorrectedActivity } from '../../../shared/activity-ascent';

export const IMPORTED_EVENT_EDIT_FIELDS = ['name', 'description', 'privacy', 'notes', 'rpe', 'feeling'] as const;

/** Apply to the live document inside the existing guarded write transaction. */
export function preserveImportedEventEdits(incoming: admin.firestore.DocumentData, existing: admin.firestore.DocumentData | null): admin.firestore.DocumentData {
  const result = preserveEventTagsOnRewrite(incoming, existing);
  for (const field of IMPORTED_EVENT_EDIT_FIELDS) {
    if (existing && Object.prototype.hasOwnProperty.call(existing, field)) result[field] = existing[field];
  }
  if (existing && (incoming.stats || existing.stats)) {
    const stats = { ...incoming.stats };
    for (const type of ['Feeling', 'Rated Perceived Exertion']) {
      if (Object.prototype.hasOwnProperty.call(existing.stats ?? {}, type)) stats[type] = existing.stats[type];
      else delete stats[type]; // A cleared rating must not return from the original file.
    }
    result.stats = stats;
  }
  return sanitizeEventFirestoreWritePayload(result);
}

export function preserveImportedActivityEdits(incoming: admin.firestore.DocumentData, existing: admin.firestore.DocumentData | null): admin.firestore.DocumentData {
  for (const metric of ACTIVITY_ELEVATION_METRICS) {
    const { field } = activityElevationMetric(metric);
    if (readAscentCorrection(existing?.[field]) && !readAscentCorrection(incoming[field]))
      throw new Error(`A saved ${metric} correction was not safely matched. Reload the recording before reimporting.`);
    if (readAscentCorrection(incoming[field]) && !isTerrainAscentActivity(incoming.type)) throw new ActivityIdentityConflictError();
  }
  const name = getActivityCreatorNameCarryover(existing?.creator?.name, incoming.creator?.name);
  return sanitizeActivityFirestoreWritePayload({ ...incoming,
    ...(name ? { creator: { ...incoming.creator, name } } : {}),
    ...(existing?.sourceActivityKey ? { sourceActivityKey: existing.sourceActivityKey } : {}),
  });
}

/** Bind corrections only to strict source identities, never the device-name fallback. */
function prepareAscentCarryover(event: EventInterface,
  documents: Array<Pick<admin.firestore.QueryDocumentSnapshot, 'id' | 'data'>>,
  binding: ActivityBindingPlan): () => void {
  const corrected = documents.flatMap((document, index) => ACTIVITY_ELEVATION_METRICS.map(metric => ({
    index, metric, correction: readAscentCorrection(document.data()[activityElevationMetric(metric).field]),
  }))).filter(item => item.correction !== null);
  if (!corrected.length) return () => undefined;
  const assignments = corrected.map(item => {
    const match = [...binding.strictAssignments].find(([, existingIndex]) => existingIndex === item.index);
    if (!match || !isTerrainAscentActivity(binding.activityTypes[match[0]]))
      throw new ActivityIdentityConflictError();
    return { parsedIndex: match[0], metric: item.metric, correction: item.correction };
  });
  return () => {
    assignments.forEach(({ parsedIndex, metric, correction }) =>
      applyActivityAscentCorrection(event.getActivities()[parsedIndex] as AscentCorrectedActivity, correction, true, metric));
    applyCorrectedEventAscent(event);
  };
}

function assertLegacyPendingSources(metadata: TrainingLoadMetadata | undefined, documents: SavedActivitySource[]): void {
  if (!metadata?.sourceWritePending) return;
  const frozen = new Map(Object.values(metadata.legs ?? metadata.legacyLegs ?? {})
    .filter(leg => leg.activityId).map(leg => [leg.activityId, leg]));
  for (const document of documents) {
    if (readActivitySourceIdentity(document.data().sourceIdentity, document.id)) continue;
    const leg = frozen.get(document.id);
    if (!leg) {
      if (Object.prototype.hasOwnProperty.call(metadata.controls ?? {}, document.id)) throw new ActivityIdentityConflictError();
      continue;
    }
    // An older interrupted writer could reuse an ID for a different leg. The live document alone cannot certify it.
    const window = getActivitySourceWindow(savedActivityIdentity(document));
    if (!window || window.startMs !== leg.identity?.startMs || window.endMs !== leg.identity?.endMs)
      throw new ActivityIdentityConflictError();
  }
}

/** Read live corrections inside the existing source reservation, including edits made during a long file parse. */
export async function prepareReparsedEventWrite(uid: string, event: EventInterface,
  expectedSourceRevision?: string): Promise<PreparedTrainingLoadWrite> {
  let prepared = false;
  let apply: () => void = () => undefined;
  let verifiedActivityIds: ReadonlySet<string> = new Set();
  const finish = await prepareTrainingLoadMetadata(uid, event, async (db, transaction) => {
    if (prepared) return verifiedActivityIds;
    const parentRef = db.doc(`users/${uid}/events/${event.getID()}`);
    const [parent, metadataDoc] = await transaction.getAll(parentRef, parentRef.collection('metaData').doc('trainingLoad'));
    if (!parent.exists) throw new EventWriteSkippedForDeletedEventError(uid, event.getID()!);
    if (expectedSourceRevision !== undefined && expectedSourceRevision !== retainedSourceRevision(parent.data() ?? {}))
      throw new Error('Recording source changed while reparsing; retry from the current original files.');
    const metadata = metadataDoc.data() as TrainingLoadMetadata | undefined;
    const recovering = metadata?.sourceWritePending || parent.data()?.benchmarkSourceWritePending;
    const activeIds = recovering ? [...new Set(Object.values(metadata?.legs ?? metadata?.legacyLegs ?? {})
      .flatMap(leg => leg.activityId ? [leg.activityId] : []))] : [];
    if (activeIds.length > 100) throw new Error('Elevation correction matching supports at most 100 activities.');
    let sourceDocs: SavedActivitySource[];
    if (activeIds.length) {
      // An interrupted reparse can leave both old and new IDs. The server-owned leg snapshot
      // identifies the active source; partial copies must not make its correction ambiguous.
      const children = await transaction.getAll(...activeIds.map(id => db.doc(`users/${uid}/activities/${id}`)));
      sourceDocs = children.map(child => {
        const data = child.data();
        if (!data || data.eventID !== event.getID())
          throw new ActivityIdentityConflictError();
        return { id: child.id, data: () => data };
      });
    } else {
      const children = await transaction.get(db.collection(`users/${uid}/activities`)
        .where('eventID', '==', event.getID()).limit(101));
      if (children.size > 100) throw new Error('Elevation correction matching supports at most 100 activities.');
      sourceDocs = children.docs;
    }
    assertLegacyPendingSources(metadata, sourceDocs);
    const plan = prepareActivitySourceBindings(event, sourceDocs, {
      allowSourceWindowMatch: true, allowNewActivities: true, allowRemovedActivities: true,
    });
    const corrected = prepareAscentCarryover(event, sourceDocs, plan);
    verifiedActivityIds = plan.verifiedActivityIds;
    apply = () => { plan.apply(); corrected(); };
    return verifiedActivityIds;
  });
  prepared = true;
  apply();
  return finish;
}

/** Validate identities in the reservation transaction, before it can mark saved load pending. */
export async function prepareImportedEventWrite(
  uid: string, event: EventInterface,
  authorize?: (db: admin.firestore.Firestore, transaction: admin.firestore.Transaction) => Promise<void>,
  providerMetadata?: Record<string, unknown>,
): Promise<PreparedTrainingLoadWrite> {
  let prepared = false;
  let applyIdentities: () => void = () => undefined;
  let verifiedActivityIds: ReadonlySet<string> = new Set();
  const finish = await prepareTrainingLoadMetadata(uid, event, async (db, transaction) => {
    await authorize?.(db, transaction);
    if (!prepared) {
      const result = await prepareImportedActivityIdentities(uid, event, db, transaction, providerMetadata);
      applyIdentities = result.apply;
      verifiedActivityIds = result.verifiedActivityIds;
    }
    return verifiedActivityIds;
  });
  prepared = true;
  // Firestore can retry preparation. Only the committed attempt may change the parsed IDs/keys.
  applyIdentities();
  return finish;
}

/** Reuse persisted IDs, rather than adding legacy index IDs beside a prior reparse's source IDs. */
async function prepareImportedActivityIdentities(
  uid: string, event: EventInterface, db: admin.firestore.Firestore, transaction: admin.firestore.Transaction,
  providerMetadata: Record<string, unknown> | undefined,
): Promise<ReturnType<typeof prepareActivitySourceBindings>> {
  const eventId = event.getID();
  if (!eventId) throw new Error('Import requires an event identity.');
  const parent = await transaction.get(db.doc(`users/${uid}/events/${eventId}`));
  const metadata = await transaction.get(db.doc(`users/${uid}/events/${eventId}/metaData/trainingLoad`));
  const snapshot = await transaction.get(db.collection(`users/${uid}/activities`).where('eventID', '==', eventId)
    .select('startDate', 'endDate', 'type', 'sourceActivityKey', 'sourceIdentity', 'stats.Duration', 'stats.Distance', 'ascentCorrection', 'descentCorrection').limit(101));
  if (snapshot.size > 100) throw new Error('Import supports at most 100 stored activities per event.');
  const documents = snapshot.docs;
  assertLegacyPendingSources(metadata.data() as TrainingLoadMetadata | undefined, documents);
  const firstImport = !parent.exists || metadata.data()?.sourceFirstImport === true;
  const service = providerMetadata && providerRecordingService(providerMetadata);
  const provider = service && documents.length ? await transaction.get(db.doc(`users/${uid}/events/${eventId}/metaData/${service}`)) : null;
  const verifiedProvider = !!providerMetadata && isSameProviderRecording(provider?.data(), providerMetadata);
  const plan = prepareActivitySourceBindings(event, documents, { allowSourceWindowMatch: verifiedProvider,
    allowNewActivities: firstImport || !documents.length });
  const applyAscent = prepareAscentCarryover(event, documents, plan);
  return { ...plan, apply: () => { plan.apply(); applyAscent(); } };
}
