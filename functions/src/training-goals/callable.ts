import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { enforceAppCheck, ALLOWED_CORS_ORIGINS } from '../utils';
import { GOAL_PROGRESS_REQUEST } from './schemas';
import { readTrainingGoalsProgress } from './read';

export const getTrainingGoalsProgress = onCall({ region: FUNCTIONS_MANIFEST.getTrainingGoalsProgress.region,
  cors: ALLOWED_CORS_ORIGINS, timeoutSeconds: 30, memory: '256MiB', maxInstances: 100 }, async request => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to view your goals.');
  enforceAppCheck(request);
  const input = GOAL_PROGRESS_REQUEST.safeParse(request.data);
  if (!input.success) throw new HttpsError('invalid-argument', 'Choose a valid goal progress date and time zone.');
  try {
    const { revision, progress, weekStartsOn, complete } = await readTrainingGoalsProgress(request.auth.uid, input.data);
    return { goalsRevision: revision, progress, weekStartsOn, complete };
  } catch (error) {
    logger.warn('[TrainingGoals] Progress read failed.', { errorName: error instanceof Error ? error.name : 'UnknownError' });
    throw new HttpsError('unavailable', 'Goal progress is unavailable. Try again.');
  }
});
