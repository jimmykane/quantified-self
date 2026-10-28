import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';
import { reparseEventFromOriginalFiles } from '../reparse/sports-lib-reparse.service';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { REPARSE_PROCESSING_HTTPS_RUNTIME_OPTIONS } from '../shared/activity-processing-config';
import { updateActivityAscent, updateActivityElevation } from './activity-ascent.service';

type ReprocessMode = 'reimport' | 'regenerate' | 'correct_ascent' | 'correct_elevation';

interface ReprocessEventRequest {
  eventId: string;
  mode: ReprocessMode;
  edit?: unknown;
  expectedOwner?: string;
}

export const reprocessEvent = onCall({
  region: FUNCTIONS_MANIFEST.reprocessEvent.region,
  ...REPARSE_PROCESSING_HTTPS_RUNTIME_OPTIONS,
  cors: ALLOWED_CORS_ORIGINS,
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

  if (mode === 'correct_ascent' || mode === 'correct_elevation') {
    const data = request.data as ReprocessEventRequest;
    if (data.expectedOwner !== userID) throw new HttpsError('permission-denied', 'The recording owner changed. Sign in again.');
    if (Object.keys(data).some(key => !['eventId', 'mode', 'edit', 'expectedOwner'].includes(key)))
      throw new HttpsError('invalid-argument', 'Unexpected elevation correction fields.');
    if (mode === 'correct_elevation') {
      const elevation = await updateActivityElevation(userID, eventId, data.edit);
      return { eventId, mode, status: 'completed', elevation };
    }
    const ascent = await updateActivityAscent(userID, eventId, data.edit);
    return { eventId, mode, status: 'completed', ascent };
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
