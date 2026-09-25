import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { getEventTags } from '../../../shared/event-tags';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';

/** Read only the two persisted tag fields, regardless of dashboard date filters. */
export const listEventTags = onCall({
  region: FUNCTIONS_MANIFEST.listEventTags.region,
  cors: ALLOWED_CORS_ORIGINS,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to list activity tags.');
  }
  enforceAppCheck(request);

  const userID = request.auth.uid;
  try {
    const events = admin.firestore().collection(`users/${userID}/events`);
    const tagsByKey = new Map<string, string>();
    // Ordering by a tag field skips events where that field is absent. Read both
    // the canonical and legacy fields so older tagged events remain discoverable.
    for (const field of ['tags', 'benchmarkReviewTags']) {
      const documents = events.orderBy(field)
        .select('tags', 'benchmarkReviewTags')
        .stream() as AsyncIterable<QueryDocumentSnapshot>;
      for await (const document of documents) {
        for (const tag of getEventTags(document.data())) {
          const key = tag.toLowerCase();
          if (!tagsByKey.has(key)) {
            tagsByKey.set(key, tag);
          }
        }
      }
    }
    return { tags: [...tagsByKey.values()].sort((first, second) => first.localeCompare(second)) };
  } catch (error) {
    logger.error('[listEventTags] Failed to list event tags.', { userID, error });
    throw new HttpsError('internal', 'Could not list activity tags.');
  }
});
