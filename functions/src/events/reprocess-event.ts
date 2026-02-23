import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';
import { reparseEventFromOriginalFiles } from '../reparse/sports-lib-reparse.service';
import { FUNCTIONS_MANIFEST } from '../../../src/shared/functions-manifest';

type ReprocessMode = 'reimport' | 'regenerate';

interface ReprocessEventRequest {
  eventId: string;
  mode: ReprocessMode;
}

export const reprocessEvent = onCall({
  region: FUNCTIONS_MANIFEST.reprocessEvent.region,
  cors: ALLOWED_CORS_ORIGINS,
  timeoutSeconds: 540,
  maxInstances: 20,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  enforceAppCheck(request);

  const userID = request.auth.uid;
  const eventId = `${(request.data as ReprocessEventRequest | undefined)?.eventId || ''}`.trim();
  const mode = (request.data as ReprocessEventRequest | undefined)?.mode;

  if (!eventId) {
    throw new HttpsError('invalid-argument', 'eventId is required.');
  }

  if (mode !== 'reimport' && mode !== 'regenerate') {
    throw new HttpsError('invalid-argument', 'mode must be either "reimport" or "regenerate".');
  }

  const eventSnapshot = await admin.firestore().doc(`users/${userID}/events/${eventId}`).get();
  if (!eventSnapshot.exists) {
    throw new HttpsError('not-found', `Event ${eventId} was not found for this user.`);
  }

  try {
    const result = await reparseEventFromOriginalFiles(userID, eventId, { mode });
    return {
      eventId,
      mode,
      status: result.status,
      reason: result.reason,
      sourceFilesCount: result.sourceFilesCount,
      parsedActivitiesCount: result.parsedActivitiesCount,
      staleActivitiesDeleted: result.staleActivitiesDeleted,
    };
  } catch (error) {
    logger.error('[reprocessEvent] Failed to reprocess event', { userID, eventId, mode, error });
    throw new HttpsError('internal', 'Could not reprocess event.');
  }
});
