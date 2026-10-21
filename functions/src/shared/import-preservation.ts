import type * as admin from 'firebase-admin';
import type { EventInterface } from '@sports-alliance/sports-lib';
import { getActivityCreatorNameCarryover } from '../../../shared/activity-creator-name';
import { preserveEventTagsOnRewrite } from '../../../shared/event-tags';
import { sanitizeActivityFirestoreWritePayload, sanitizeEventFirestoreWritePayload } from '../../../shared/firestore-write-sanitizer';
import { resolveActivityIdentityAssignments, type ActivityIdentityLike } from './activity-identity-matcher';
import { prepareTrainingLoadMetadata } from '../training-load/training-load-metadata';
import type { PreparedTrainingLoadWrite } from '../training-load/training-load-source-write';
import { applyActivityAscentCorrection, applyCorrectedEventAscent, isTerrainAscentActivity, readAscentCorrection,
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
  if (readAscentCorrection(existing?.ascentCorrection) && !readAscentCorrection(incoming.ascentCorrection))
    throw new Error('A saved ascent correction was not safely matched. Reload the recording before reimporting.');
  const name = getActivityCreatorNameCarryover(existing?.creator?.name, incoming.creator?.name);
  return sanitizeActivityFirestoreWritePayload({ ...incoming,
    ...(name ? { creator: { ...incoming.creator, name } } : {}),
    ...(existing?.sourceActivityKey ? { sourceActivityKey: existing.sourceActivityKey } : {}),
  });
}

/** Bind corrections only to strict source identities, never the device-name fallback. */
function prepareAscentCarryover(event: EventInterface,
  documents: Array<Pick<admin.firestore.QueryDocumentSnapshot, 'id' | 'data'>>): () => void {
  const corrected = documents.map((document, index) => ({ index, correction: readAscentCorrection(document.data().ascentCorrection) }))
    .filter(item => item.correction !== null);
  if (!corrected.length) return () => undefined;
  const matches = resolveActivityIdentityAssignments(documents.map(document => storedIdentity(document.data())),
    event.getActivities() as ActivityIdentityLike[], { requireStrictMatch: true });
  const assignments = corrected.map(item => {
    const match = [...matches.assignments].find(([, existingIndex]) => existingIndex === item.index);
    if (!match || !isTerrainAscentActivity(event.getActivities()[match[0]].type))
      throw new Error('Cannot safely match a saved ascent correction. Reset it before changing the source activities.');
    return { parsedIndex: match[0], correction: item.correction };
  });
  return () => {
    assignments.forEach(({ parsedIndex, correction }) =>
      applyActivityAscentCorrection(event.getActivities()[parsedIndex] as AscentCorrectedActivity, correction, true));
    applyCorrectedEventAscent(event);
  };
}

/** Read live corrections inside the existing source reservation, including edits made during a long file parse. */
export async function prepareReparsedEventWrite(uid: string, event: EventInterface): Promise<PreparedTrainingLoadWrite> {
  let prepared = false;
  let apply: () => void = () => undefined;
  const finish = await prepareTrainingLoadMetadata(uid, event, async (db, transaction) => {
    if (prepared) return;
    const children = await transaction.get(db.collection(`users/${uid}/activities`)
      .where('eventID', '==', event.getID()).limit(101));
    if (children.size > 100) throw new Error('Ascent correction matching supports at most 100 activities.');
    apply = prepareAscentCarryover(event, children.docs);
  });
  prepared = true;
  apply();
  return finish;
}

function storedIdentity(data: admin.firestore.DocumentData): ActivityIdentityLike {
  return { startDate: data.startDate, endDate: data.endDate, type: data.type, sourceActivityKey: data.sourceActivityKey,
    getStat: type => {
      const raw = data.stats?.[type];
      const value = raw && typeof raw === 'object' ? raw.value ?? raw.rawValue ?? raw._value : raw;
      const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
      return Number.isFinite(number) ? { getValue: () => number } : null;
    },
  };
}

/** Validate identities in the reservation transaction, before it can mark saved load pending. */
export async function prepareImportedEventWrite(
  uid: string, event: EventInterface,
  authorize?: (db: admin.firestore.Firestore, transaction: admin.firestore.Transaction) => Promise<void>,
): Promise<PreparedTrainingLoadWrite> {
  let prepared = false;
  let applyIdentities: () => void = () => undefined;
  const finish = await prepareTrainingLoadMetadata(uid, event, async (db, transaction) => {
    await authorize?.(db, transaction);
    // The authorization callback also runs during finalization; identity preparation must not.
    if (!prepared) applyIdentities = await prepareImportedActivityIdentities(uid, event, db, transaction);
  });
  prepared = true;
  // Firestore can retry preparation. Only the committed attempt may change the parsed IDs/keys.
  applyIdentities();
  return finish;
}

/** Reuse persisted IDs, rather than adding legacy index IDs beside a prior reparse's source IDs. */
async function prepareImportedActivityIdentities(
  uid: string, event: EventInterface, db: admin.firestore.Firestore, transaction: admin.firestore.Transaction,
): Promise<() => void> {
  const eventId = event.getID();
  if (!eventId) throw new Error('Import requires an event identity.');
  const parent = await transaction.get(db.doc(`users/${uid}/events/${eventId}`));
  const metadata = await transaction.get(db.doc(`users/${uid}/events/${eventId}/metaData/trainingLoad`));
  const snapshot = await transaction.get(db.collection(`users/${uid}/activities`).where('eventID', '==', eventId)
    .select('startDate', 'endDate', 'type', 'sourceActivityKey', 'stats.Duration', 'stats.Distance', 'ascentCorrection').limit(101));
  if (snapshot.size > 100) throw new Error('Import supports at most 100 stored activities per event.');
  const documents = snapshot.docs;
  const applyAscent = prepareAscentCarryover(event, documents);
  const firstImport = !parent.exists || metadata.data()?.sourceFirstImport === true;
  if (!documents.length) return () => undefined;

  const activities = event.getActivities();
  const matches = resolveActivityIdentityAssignments(documents.map(document => storedIdentity(document.data())), activities as ActivityIdentityLike[]);
  // A retry of an interrupted first import may still need to write missing legs. An existing
  // saved event must match completely; ambiguity is not permission to append or discard rows.
  if (matches.unmatchedExistingIndexes.length || (!firstImport && matches.unmatchedParsedIndexes.length)) {
    throw new Error('Cannot safely match the saved activities for this import. Reprocess the saved event first.');
  }
  const ids = activities.map((activity, index) => {
    const existing = matches.assignments.get(index);
    return existing === undefined ? activity.getID() : documents[existing].id;
  });
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
    throw new Error('Cannot safely reuse activity identities for this import.');
  }
  return () => {
    matches.assignments.forEach((existingIndex, parsedIndex) => {
      const document = documents[existingIndex];
      activities[parsedIndex].setID(document.id);
      const key = document.data().sourceActivityKey;
      if (key) (activities[parsedIndex] as ActivityIdentityLike).sourceActivityKey = key;
    });
    applyAscent();
  };
}
