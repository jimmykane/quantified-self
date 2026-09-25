import { createHash } from 'node:crypto';
import * as admin from 'firebase-admin';

import { normalizeEventTags, normalizeEventTagSuggestions } from '../../../shared/event-tags';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';

export const EVENT_TAG_CATALOG_COLLECTION = 'eventTagCatalog';
const MAX_TAGS_PER_TRANSACTION = 50;

export function eventTagCatalogKey(tag: string): string {
  const [normalized] = normalizeEventTagSuggestions([tag]);
  if (!normalized) throw new Error('An event tag is required for a catalog key.');
  return createHash('sha256').update(normalized.toLowerCase(), 'utf8').digest('hex');
}

export function storedEventTagNames(event: unknown): string[] {
  const fields = event as { tags?: unknown; benchmarkReviewTags?: unknown } | null | undefined;
  return normalizeEventTagSuggestions([
    ...normalizeEventTags(fields?.tags),
    ...normalizeEventTags(fields?.benchmarkReviewTags),
  ]);
}

export function newlyAssignedEventTags(before: unknown, after: unknown): string[] {
  const previous = new Set(storedEventTagNames(before).map(tag => tag.toLowerCase()));
  return storedEventTagNames(after)
    .filter(tag => !previous.has(tag.toLowerCase()));
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
      const collection = db.collection('users').doc(uid).collection(EVENT_TAG_CATALOG_COLLECTION);
      const refs = chunk.map(tag => collection.doc(eventTagCatalogKey(tag)));
      const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
      let missing = 0;
      snapshots.forEach((snapshot, index) => {
        if (snapshot.exists) return;
        missing += 1;
        if (!dryRun) transaction.create(refs[index], { name: chunk[index] });
      });
      return { created: missing, existing: chunk.length - missing, skippedUserDeletion: false };
    });
    if (result.skippedUserDeletion) {
      return { created, existing, skippedUserDeletion: true };
    }
    created += result.created;
    existing += result.existing;
  }
  return { created, existing, skippedUserDeletion: false };
}
