import * as admin from 'firebase-admin';

import { getEventTags } from '../../../shared/event-tags';
import { ensureEventTagCatalogEntries } from '../events/event-tag-catalog';

export interface EventTagCatalogBackfillOptions {
  execute: boolean;
  uid?: string;
  startAfter?: string;
  limitUsers: number;
}

export interface EventTagCatalogBackfillSummary {
  dryRun: boolean;
  usersScanned: number;
  tagFieldsRead: number;
  uniqueTags: number;
  missingEntries: number;
  existingEntries: number;
  skippedUserDeletion: number;
  nextStartAfter: string | null;
  complete: boolean;
}

export function parseEventTagCatalogBackfillOptions(argv: string[]): EventTagCatalogBackfillOptions {
  const values = new Map<string, string>();
  let execute = false;
  for (let index = 0; index < argv.length; index++) {
    const [name, inlineValue] = argv[index].split('=', 2);
    if (name === '--execute' && inlineValue === undefined && !execute) {
      execute = true;
      continue;
    }
    if (!['--uid', '--start-after', '--limit-users'].includes(name) || values.has(name)) {
      throw new Error(`Unknown or duplicate backfill option: ${argv[index]}`);
    }
    const value = inlineValue === undefined ? argv[++index] : inlineValue;
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
    values.set(name, value);
  }
  const uid = values.get('--uid');
  const startAfter = values.get('--start-after');
  const limitValue = values.get('--limit-users');
  const limitUsers = limitValue === undefined ? 100 : Number(limitValue);
  if (!Number.isInteger(limitUsers) || limitUsers < 1 || limitUsers > 500) {
    throw new Error('--limit-users must be an integer from 1 to 500.');
  }
  if (uid && startAfter) throw new Error('Use either --uid or --start-after, not both.');
  return { execute, uid, startAfter, limitUsers };
}

async function collectUserTags(
  db: admin.firestore.Firestore,
  uid: string,
): Promise<{ tags: string[]; tagFieldsRead: number }> {
  const events = db.collection('users').doc(uid).collection('events');
  const tagsByKey = new Map<string, string>();
  let tagFieldsRead = 0;
  for (const field of ['tags', 'benchmarkReviewTags']) {
    const documents = events.orderBy(field).select('tags', 'benchmarkReviewTags')
      .stream() as AsyncIterable<admin.firestore.QueryDocumentSnapshot>;
    for await (const document of documents) {
      tagFieldsRead += 1;
      for (const tag of getEventTags(document.data())) {
        const key = tag.toLowerCase();
        if (!tagsByKey.has(key)) tagsByKey.set(key, tag);
      }
    }
  }
  return { tags: [...tagsByKey.values()], tagFieldsRead };
}

export async function backfillEventTagCatalog(
  db: admin.firestore.Firestore,
  options: EventTagCatalogBackfillOptions,
): Promise<EventTagCatalogBackfillSummary> {
  const users = options.uid
    ? [{ id: options.uid }]
    : (await (() => {
      let query = db.collection('users')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(options.limitUsers + 1);
      if (options.startAfter) query = query.startAfter(options.startAfter);
      return query.get();
    })()).docs;
  const hasMore = !options.uid && users.length > options.limitUsers;
  const page = users.slice(0, options.limitUsers);
  const summary: EventTagCatalogBackfillSummary = {
    dryRun: !options.execute,
    usersScanned: 0,
    tagFieldsRead: 0,
    uniqueTags: 0,
    missingEntries: 0,
    existingEntries: 0,
    skippedUserDeletion: 0,
    nextStartAfter: null,
    complete: !hasMore,
  };
  for (const user of page) {
    const { tags, tagFieldsRead } = await collectUserTags(db, user.id);
    const result = await ensureEventTagCatalogEntries(db, user.id, tags, !options.execute);
    summary.usersScanned += 1;
    summary.tagFieldsRead += tagFieldsRead;
    summary.uniqueTags += tags.length;
    summary.missingEntries += result.created;
    summary.existingEntries += result.existing;
    if (result.skippedUserDeletion) summary.skippedUserDeletion += 1;
    summary.nextStartAfter = user.id;
  }
  if (!hasMore) summary.nextStartAfter = null;
  return summary;
}

if (require.main === module) {
  if (!admin.apps.length) admin.initializeApp();
  backfillEventTagCatalog(admin.firestore(), parseEventTagCatalogBackfillOptions(process.argv.slice(2)))
    .then(summary => {
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      if (!summary.complete) {
        process.stdout.write(`Resume with --start-after ${summary.nextStartAfter}\n`);
      }
    })
    .catch(error => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
