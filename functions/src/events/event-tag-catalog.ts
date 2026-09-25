import { createHash } from 'node:crypto';
import * as admin from 'firebase-admin';

import { normalizeEventTagSuggestions } from '../../../shared/event-tags';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';

export { newlyAssignedEventTags, storedEventTagNames } from '../../../shared/event-tags';

export const EVENT_TAG_CATALOG_COLLECTION = 'eventTagCatalog';
const MAX_TAGS_PER_TRANSACTION = 50;

export function eventTagCatalogKey(tag: string): string {
  const [normalized] = normalizeEventTagSuggestions([tag]);
  if (!normalized) throw new Error('An event tag is required for a catalog key.');
  return createHash('sha256').update(normalized.toLowerCase(), 'utf8').digest('hex');
}

/** Call after all other transaction reads and before any event write. */
export async function createMissingEventTagCatalogEntriesInTransaction(
  db: admin.firestore.Firestore,
  transaction: admin.firestore.Transaction,
  uid: string,
  values: readonly string[],
  dryRun = false,
): Promise<{ created: number; existing: number }> {
  const tags = normalizeEventTagSuggestions([...values]);
  const collection = db.collection('users').doc(uid).collection(EVENT_TAG_CATALOG_COLLECTION);
  const refs = tags.map(tag => collection.doc(eventTagCatalogKey(tag)));
  const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
  let created = 0;
  snapshots.forEach((snapshot, index) => {
    if (snapshot.exists) return;
    created += 1;
    if (!dryRun) transaction.create(refs[index], { name: tags[index] });
  });
  return { created, existing: tags.length - created };
}

export async function ensureEventTagCatalogEntries(
  db: admin.firestore.Firestore,
  uid: string,
  values: readonly string[],
  dryRun = false,
): Promise<{ created: number; existing: number; skippedUserDeletion: boolean }> {
  const tags = normalizeEventTagSuggestions([...values]);
  let created = 0;
  let existing = 0;
  for (let offset = 0; offset < tags.length; offset += MAX_TAGS_PER_TRANSACTION) {
    const chunk = tags.slice(offset, offset + MAX_TAGS_PER_TRANSACTION);
    const result = await db.runTransaction(async transaction => {
      const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid);
      if (deletionGuard.shouldSkip) {
        return { created: 0, existing: 0, skippedUserDeletion: true };
      }
      return {
        ...await createMissingEventTagCatalogEntriesInTransaction(db, transaction, uid, chunk, dryRun),
        skippedUserDeletion: false,
      };
    });
    if (result.skippedUserDeletion) {
      return { created, existing, skippedUserDeletion: true };
    }
    created += result.created;
    existing += result.existing;
  }
  return { created, existing, skippedUserDeletion: false };
}
