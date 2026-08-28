import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { addToQueueForSuunto } from '../queue';
import { isProviderQueueSkippedWithoutRetryError } from '../queue/provider-queue-errors';

import { config } from '../config';
import { verifySuuntoWebhookSignature } from './webhook-signature';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import { resolveActiveSuuntoWebhookUserIDs } from './health-webhook-binding-lifecycle';
import { SUUNTO_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH } from './health';

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
  try {
    if (userName.length > SUUNTO_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH) {
      logger.warn('Dropping authenticated Suunto workout webhook with invalid provider account identifier.');
      res.status(200).send();
      return;
    }
    const firebaseUserIDs = await resolveActiveSuuntoWebhookUserIDs(
      admin.firestore(),
      userName,
    );
    if (firebaseUserIDs.length === 0) {
      logger.info('Skipping Suunto workout webhook without an active bound connection.');
      res.status(200).send();
      return;
    }
    const queueResults = await Promise.allSettled(firebaseUserIDs.map(async firebaseUserID => {
      try {
        await addToQueueForSuunto({
          userName,
          workoutID,
          firebaseUserID,
        });
        return 'queued' as const;
      } catch (error) {
        if (isProviderQueueSkippedWithoutRetryError(error)) return 'skipped' as const;
        throw error;
      }
    }));
    const failedResult = queueResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failedResult) throw failedResult.reason;
    const queuedConnectionCount = queueResults.filter(
      result => result.status === 'fulfilled' && result.value === 'queued',
    ).length;
    logger.info('Fanned out Suunto workout webhook.', {
      queuedConnectionCount,
      skippedConnectionCount: queueResults.length - queuedConnectionCount,
    });
    res.status(200).send();
  } catch (e: unknown) {
    if (isProviderQueueSkippedWithoutRetryError(e)) {
      logger.warn('Skipping Suunto workout webhook because no local token/user is connected or the user is being deleted.', {
        provider: 'Suunto',
        reason: (e as { code?: string }).code,
        workoutID,
      });
      res.status(200).send();
      return;
    }
    logger.error('Failed to fan out Suunto workout webhook.', {
      errorName: e instanceof Error ? e.name : 'UnknownError',
    });
    res.status(500).send();
  }
}

export const insertSuuntoAppActivityToQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: 60,
  memory: '256MB',
  secrets: FUNCTION_SECRET_BINDINGS.insertSuuntoAppActivityToQueue,
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
      logger.info('Ignoring non-workout Suunto JSON notification', {
        format: 'json_hmac',
        notificationType: asString(body.type) || 'unknown',
      });
      res.status(200).send();
      return;
    }

    const { userName, workoutID } = getJsonWorkoutNotification(body);
    if (!userName || !workoutID) {
      logger.warn('Suunto workout webhook missing username or workout.workoutKey');
      res.status(200).send();
      return;
    }

    logger.info('Suunto workout webhook routed', {
      format: 'json_hmac',
      notificationType: 'WORKOUT_CREATED',
    });
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

  logger.info('Suunto workout webhook routed', {
    format: 'legacy_basic',
  });
  await enqueueSuuntoWorkout(userName, workoutID, res);
});
