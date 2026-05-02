import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import { addToQueueForSuunto } from '../queue';

import { config } from '../config';
import { verifySuuntoWebhookSignature } from './webhook-signature';

type ExternalRecord = Record<string, unknown>;

function asRecord(value: unknown): ExternalRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ExternalRecord
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getRequestHeader(req: functions.https.Request, headerName: string): string | null {
  const headerValue = typeof req.get === 'function' ? req.get(headerName) : req.headers[headerName.toLowerCase()];
  if (Array.isArray(headerValue)) {
    return asString(headerValue[0]);
  }
  return asString(headerValue);
}

function isSuuntoJsonNotificationRequest(req: functions.https.Request): boolean {
  const contentType = getRequestHeader(req, 'Content-Type')?.toLowerCase() || '';
  return contentType.includes('application/json');
}

function getLegacyWorkoutNotification(req: functions.https.Request): { userName: string | null, workoutID: string | null } {
  const query = asRecord(req.query);
  const body = asRecord(req.body);
  return {
    userName: asString(query.username) || asString(body.username),
    workoutID: asString(query.workoutid) || asString(body.workoutid) || asString(body.workoutID) || asString(body.workoutId),
  };
}

function getJsonWorkoutNotification(body: unknown): { userName: string | null, workoutID: string | null } {
  const payload = asRecord(body);
  const workout = asRecord(payload.workout);
  return {
    userName: asString(payload.username),
    workoutID: asString(workout.workoutKey),
  };
}

async function enqueueSuuntoWorkout(userName: string, workoutID: string, res: functions.Response): Promise<void> {
  logger.info(`Inserting to queue or processing ${workoutID} for ${userName}`);
  try {
    const queueItemDocumentReference = await addToQueueForSuunto({
      userName,
      workoutID,
    });
    logger.info(`Inserted to queue ${queueItemDocumentReference.id} for workoutID ${workoutID} and userName ${userName}`);
    res.status(200).send();
  } catch (e: any) {
    logger.error(e);
    res.status(500).send();
  }
}

export const insertSuuntoAppActivityToQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: 60,
  memory: '256MB',
}).https.onRequest(async (req, res) => {
  if (isSuuntoJsonNotificationRequest(req)) {
    const signature = getRequestHeader(req, 'X-HMAC-SHA256-Signature');
    if (!verifySuuntoWebhookSignature(req.rawBody, signature)) {
      logger.warn('Invalid Suunto workout webhook signature');
      res.status(403).send();
      return;
    }

    const body = asRecord(req.body);
    if (body.type !== 'WORKOUT_CREATED') {
      res.status(200).send();
      return;
    }

    const { userName, workoutID } = getJsonWorkoutNotification(body);
    if (!userName || !workoutID) {
      logger.warn('Suunto workout webhook missing username or workout.workoutKey');
      res.status(400).send();
      return;
    }

    await enqueueSuuntoWorkout(userName, workoutID, res);
    return;
  }

  const authentication = `Basic ${Buffer.from(`${config.suuntoapp.client_id}:${config.suuntoapp.client_secret}`).toString('base64')}`;
  if (authentication !== getRequestHeader(req, 'Authorization')) {
    logger.error(new Error('Not authorised to post to Suunto workout queue'));
    res.status(403).send();
    return;
  }

  const { userName, workoutID } = getLegacyWorkoutNotification(req);
  if (!userName || !workoutID) {
    logger.warn('Legacy Suunto workout webhook missing username or workoutid');
    res.status(400).send();
    return;
  }

  await enqueueSuuntoWorkout(userName, workoutID, res);
});
