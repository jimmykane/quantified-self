import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { TimelineNoteValidationError } from '../../../shared/timeline-notes';
import { enforceAppCheck } from '../utils';
import { saveTimelineNote, deleteTimelineNote, TimelineNoteConflictError, TimelineNoteNotFoundError, TimelineNoteUnavailableError } from './mutations';

function mutation<T>(name: 'saveTimelineNote' | 'deleteTimelineNote', action: (uid: string, data: unknown) => Promise<T>) {
  return onCall({ region: FUNCTIONS_MANIFEST[name].region, cors: true, timeoutSeconds: 30, memory: '256MiB', maxInstances: 100 }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to use Timeline notes.');
    enforceAppCheck(request);
    const data: unknown = request.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || !('expectedUserID' in data)
      || typeof data.expectedUserID !== 'string' || !data.expectedUserID) throw new HttpsError('invalid-argument', 'The originating account is required.');
    const { expectedUserID, ...fields } = data;
    if (expectedUserID !== request.auth.uid) throw new HttpsError('failed-precondition', 'Your account changed. Reopen Timeline notes.');
    try { return await action(request.auth.uid, fields); } catch (error) {
      if (error instanceof TimelineNoteValidationError) throw new HttpsError('invalid-argument', error.message);
      if (error instanceof TimelineNoteConflictError) throw new HttpsError('aborted', 'This note changed. Reload it before saving again.');
      if (error instanceof TimelineNoteNotFoundError) throw new HttpsError('not-found', 'This note no longer exists.');
      if (error instanceof TimelineNoteUnavailableError) throw new HttpsError('failed-precondition', 'Notes cannot be changed while your account is unavailable.');
      logger.error('[TimelineNotes] Owner-scoped mutation failed.');
      throw new HttpsError('internal', 'Could not update the note. Please try again.');
    }
  });
}
export const saveTimelineNoteCallable = mutation('saveTimelineNote', saveTimelineNote);
export const deleteTimelineNoteCallable = mutation('deleteTimelineNote', deleteTimelineNote);
