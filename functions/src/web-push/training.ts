import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import webpush from 'web-push';
import { FUNCTION_SECRET_BINDINGS, SECRET_PARAMS } from '../secrets';
import { automaticPushConfiguration } from './history-consent';
import { TRAINING_PUSH } from './training-policy';
import { sendTrainingNotification, type TrainingPushDependencies } from './training-service';
import { parseVapidKeyPair } from './vapid';
import { notificationConfigurationFailureDetails, notificationSweepErrorCode, type NotificationSweepStage } from './sweep-diagnostics';

export const sendTrainingSyncNotifications = onSchedule({
  schedule: '* * * * *', timeZone: 'UTC', region: 'europe-west2', memory: '256MiB',
  timeoutSeconds: 120, minInstances: 0, maxInstances: 1, concurrency: 1, retryCount: 0,
  secrets: FUNCTION_SECRET_BINDINGS.sendTrainingSyncNotifications,
}, async () => {
  let failureStage: NotificationSweepStage = 'initialization';
  const startedAtMs = Date.now();
  try {
    const db = getFirestore(); const now = Date.now();
    failureStage = 'configuration';
    const config = await automaticPushConfiguration('web_push_training_sync_enabled');
    failureStage = 'signing_key';
    const pair = config.enabled ? parseVapidKeyPair(SECRET_PARAMS.WEB_PUSH_VAPID_KEYPAIR.value()) : null;
    if (pair && pair.publicKey !== config.publicKey) throw new Error('Notification key mismatch.');
    failureStage = 'due_query';
    const due = await db.collectionGroup('pushState').where('trainingDueAt', '<=', now).orderBy('trainingDueAt')
      .limit(TRAINING_PUSH.sweepLimit).select('trainingDueAt').get();
    const deps: TrainingPushDependencies = { db, now: Date.now, configuration: async () => config,
      send: (registration, payload) => webpush.sendNotification(registration, payload, {
        vapidDetails: { subject: 'mailto:support@quantified-self.io', ...pair! }, TTL: 600, timeout: 5000,
        urgency: 'low', topic: 'qs-training-sync',
        ...(new URL(registration.endpoint).hostname.endsWith('.notify.windows.com')
          ? { headers: { 'X-WNS-Type': 'wns/raw', 'X-WNS-TTL': '600' } } : {}),
      }),
      outcome: outcome => logger[outcome === 'failed' ? 'error' : 'info']('[TrainingSyncPush]', { telemetryVersion: 1, phase: 'send', outcome }),
    };
    failureStage = 'account_processing';
    let failed = false; let preparationError: unknown;
    for (let offset = 0; offset < due.docs.length; offset += 5) {
      const results = await Promise.allSettled(due.docs.slice(offset, offset + 5).map(doc => {
        const match = /^users\/([^/]+)\/pushState\/trainingSync$/.exec(doc.ref.path);
        return match ? sendTrainingNotification(match[1], deps) : Promise.resolve();
      }));
      for (const result of results) {
        if (result.status === 'rejected') {
          if (!failed) preparationError = result.reason;
          failed = true;
        }
      }
    }
    if (failed) throw preparationError;
    // Probe only the oldest due field after this bounded sweep; no global account scan.
    failureStage = 'backlog_probe';
    const remaining = await db.collectionGroup('pushState').where('trainingDueAt', '<=', now).orderBy('trainingDueAt').limit(1).select('trainingDueAt').get();
    logger.info('[TrainingSyncPushSweep]', { telemetryVersion: 1, enabled: config.enabled,
      oldestDueAgeSeconds: remaining.empty ? 0 : Math.max(0, Math.floor((now - Number(remaining.docs[0].data().trainingDueAt)) / 1000)) });
  } catch (error) {
    logger.error('[TrainingSyncPush]', { telemetryVersion: 1, phase: 'sweep', outcome: 'failed',
      failureStage, errorCode: notificationSweepErrorCode(error),
      ...(failureStage === 'configuration' ? notificationConfigurationFailureDetails(error, Date.now() - startedAtMs) : {}) });
    throw new Error('Training sync notification sweep failed.');
  }
});
