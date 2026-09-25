import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { getEventTags, normalizeEventTagSuggestions } from '../../../shared/event-tags';
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
    const snapshot = await admin.firestore()
      .collection(`users/${userID}/events`)
      .select('tags', 'benchmarkReviewTags')
      .get();
    const tags = normalizeEventTagSuggestions(
      snapshot.docs.flatMap(document => getEventTags(document.data())),
    ).sort((first, second) => first.localeCompare(second));
    return { tags };
  } catch (error) {
    logger.error('[listEventTags] Failed to list event tags.', { userID, error });
    throw new HttpsError('internal', 'Could not list activity tags.');
  }
});
