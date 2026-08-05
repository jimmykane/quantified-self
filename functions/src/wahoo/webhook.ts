import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as logger from 'firebase-functions/logger';
import * as functions from 'firebase-functions/v1';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { config } from '../config';
import { generateIDFromParts, hasProAccess } from '../utils';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';
import { isServiceDisconnectPendingForUser } from '../service-disconnect-pending';
import {
  WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME,
} from './constants';
import { upsertWahooWorkoutQueueItem } from './queue-store';
import { parseWahooWorkout } from './workout-payload';
import { getWahooErrorLogDetails } from './error-details';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';

export function secureTokenMatches(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string') return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function resolveActiveWahooOwner(wahooUserID: string): Promise<string | null> {
  const normalizedWahooUserID = `${wahooUserID || ''}`.trim();
  if (!normalizedWahooUserID) return null;

  const db = admin.firestore();
  const tokenMatches = await db.collectionGroup('tokens')
    .where('wahooUserID', '==', normalizedWahooUserID)
    .where('serviceName', '==', ServiceNames.WahooAPI)
    .limit(2)
    .get();

  if (tokenMatches.docs.length === 0) return null;
  if (tokenMatches.docs.length !== 1) {
    throw new Error(`Wahoo account ${normalizedWahooUserID} has multiple active token owners.`);
  }

  const token = tokenMatches.docs[0];
  const tokenRoot = token.ref.parent.parent;
  const firebaseUserID = `${tokenRoot?.id || ''}`.trim();
  const isExpectedTokenPath = token.id === normalizedWahooUserID
    && token.ref.parent.id === 'tokens'
    && tokenRoot?.parent.id === WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME;
  if (!firebaseUserID || !isExpectedTokenPath) {
    throw new Error(`Wahoo account ${normalizedWahooUserID} resolved to an invalid token path.`);
  }

  const deletionGuard = await getUserDeletionGuardState(db, firebaseUserID);
  if (deletionGuard.shouldSkip || await isServiceDisconnectPendingForUser(firebaseUserID, ServiceNames.WahooAPI)) return null;
  return (await hasProAccess(firebaseUserID)) ? firebaseUserID : null;
}

export const wahooAPIWebhook = functions.region('europe-west2').runWith({
  timeoutSeconds: 60,
  memory: '256MB',
  secrets: FUNCTION_SECRET_BINDINGS.wahooAPIWebhook,
}).https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send();
    return;
  }
  if (!`${req.get('content-type') || ''}`.toLowerCase().includes('application/json')) {
    res.status(415).send();
    return;
  }
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  if (!secureTokenMatches(body.webhook_token, config.wahooapi.webhook_token)) {
    logger.warn('Rejected Wahoo webhook with an invalid token');
    res.status(401).send();
    return;
  }
  if (body.event_type !== 'workout_summary') {
    res.status(200).send();
    return;
  }
  const user = body.user && typeof body.user === 'object' ? body.user as Record<string, unknown> : {};
  const summary = body.workout_summary && typeof body.workout_summary === 'object'
    ? body.workout_summary as Record<string, unknown>
    : {};
  const parsed = parseWahooWorkout(user.id, summary.workout, summary);
  if (!parsed) {
    logger.info('Skipped Wahoo workout summary without an importable FIT file');
    res.status(200).send();
    return;
  }
  try {
    const firebaseUserID = await resolveActiveWahooOwner(parsed.wahooUserID);
    if (!firebaseUserID) {
      logger.info('Skipped Wahoo webhook for an inactive or unknown connection');
      res.status(200).send();
      return;
    }
    const id = await generateIDFromParts([parsed.wahooUserID, parsed.workoutID]);
    await upsertWahooWorkoutQueueItem({
      ...parsed,
      id,
      firebaseUserID,
    }, 'immediate');
    res.status(200).send();
  } catch (error) {
    logger.error('Could not durably queue Wahoo webhook', getWahooErrorLogDetails(error));
    res.status(500).send();
  }
});
