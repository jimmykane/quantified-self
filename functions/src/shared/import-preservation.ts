import * as admin from 'firebase-admin';
import type { EventInterface } from '@sports-alliance/sports-lib';
import { getActivityCreatorNameCarryover } from '../../../shared/activity-creator-name';
import { preserveEventTagsOnRewrite } from '../../../shared/event-tags';
import { sanitizeActivityFirestoreWritePayload, sanitizeEventFirestoreWritePayload } from '../../../shared/firestore-write-sanitizer';
import { resolveActivityIdentityAssignments, type ActivityIdentityLike } from './activity-identity-matcher';

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
  const name = getActivityCreatorNameCarryover(existing?.creator?.name, incoming.creator?.name);
  return sanitizeActivityFirestoreWritePayload({ ...incoming,
    ...(name ? { creator: { ...incoming.creator, name } } : {}),
    ...(existing?.sourceActivityKey ? { sourceActivityKey: existing.sourceActivityKey } : {}),
  });
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

/** Reuse persisted IDs, rather than adding legacy index IDs beside a prior reparse's source IDs. */
export async function preserveImportedActivityIdentities(
  uid: string, event: EventInterface,
  assertCurrent: (db: admin.firestore.Firestore, transaction: admin.firestore.Transaction) => Promise<void>,
): Promise<void> {
  const db = admin.firestore();
  const eventId = event.getID();
  if (!eventId) throw new Error('Import requires an event identity.');
  // Read after acquiring the existing source-write reservation. A superseding reparse/import
  // cannot lend obsolete IDs to this attempt; every later source write rechecks that reservation.
  const { documents, firstImport } = await db.runTransaction(async transaction => {
    await assertCurrent(db, transaction);
    const metadata = await transaction.get(db.doc(`users/${uid}/events/${eventId}/metaData/trainingLoad`));
    const snapshot = await transaction.get(db.collection(`users/${uid}/activities`).where('eventID', '==', eventId)
      .select('startDate', 'endDate', 'type', 'sourceActivityKey', 'stats.Duration', 'stats.Distance').limit(101));
    if (snapshot.size > 100) throw new Error('Import supports at most 100 stored activities per event.');
    return { documents: snapshot.docs, firstImport: metadata.data()?.sourceFirstImport === true };
  }, { readOnly: true });
  if (!documents.length) return;

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
  matches.assignments.forEach((existingIndex, parsedIndex) => {
    const document = documents[existingIndex];
    activities[parsedIndex].setID(document.id);
    const key = document.data().sourceActivityKey;
    if (key) (activities[parsedIndex] as ActivityIdentityLike).sourceActivityKey = key;
  });
}
