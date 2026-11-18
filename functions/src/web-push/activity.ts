import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import { ACTIVITY_PUSH } from './activity-policy';
import { sendActivityNotification } from './activity-service';
import { sendSleepNotification } from './sleep-service';
import { sendConnectionNotification } from './connection-service';
import { sendTrainingSendResult } from './training-send-service';
import { sendDeliveryNotification } from './delivery-service';
import { sendTrainingNotification } from './training-service';
import { pushDependencies, type PushType } from './runtime';
import { notificationSweepErrorCode } from './sweep-diagnostics';

/** Deferred categories share pushState.dueAt and this one minute worker. */
export const sendActivitySyncNotifications = onSchedule({
  schedule: '* * * * *', timeZone: 'UTC', region: 'europe-west2', memory: '256MiB',
  timeoutSeconds: 120, minInstances: 0, maxInstances: 1, concurrency: 1, retryCount: 0,
  secrets: FUNCTION_SECRET_BINDINGS.sendActivitySyncNotifications,
}, async () => {
  let failureStage = 'initialization';
  try {
    const db = getFirestore(), now = Date.now();
    const dependencies = new Map<PushType, ReturnType<typeof pushDependencies>>();
    const deps = (type: PushType) => {
      if (!dependencies.has(type)) dependencies.set(type, pushDependencies(type, db));
      return dependencies.get(type)!;
    };
    failureStage = 'due_query';
    const queue = db.collectionGroup('pushState').where('dueAt', '<=', now).orderBy('dueAt');
    const due = await queue.limit(ACTIVITY_PUSH.sweepLimit).select('dueAt').get();
    failureStage = 'account_processing';
    let failed = false; let firstError: unknown;
    for (let offset = 0; offset < due.docs.length; offset += 5) {
      const results = await Promise.allSettled(due.docs.slice(offset, offset + 5).map(async doc => {
        const match = /^users\/([^/]+)\/pushState\/([^/]+)$/.exec(doc.ref.path);
        if (!match) throw new Error('Invalid notification queue path.');
        const [, uid, name] = match;
        if (name === 'activitySync') return sendActivityNotification(uid, deps('activity'));
        if (name === 'activityDelivery') return sendDeliveryNotification(uid, deps('delivery'));
        if (name === 'trainingSync') return sendTrainingNotification(uid, deps('training'));
        if (name === 'connectionAttention') return sendConnectionNotification(uid, deps('connection'));
        // Drain older ready records during rollout. New Sleep/Training results send in their existing handlers.
        if (name === 'sleepReady') return sendSleepNotification(uid, deps('sleep'));
        if (/^trainingSend_[a-zA-Z0-9_-]+$/.test(name)) return sendTrainingSendResult(uid, name, deps('trainingSend'));
        throw new Error('Unknown notification queue entry.');
      }));
      for (const result of results) if (result.status === 'rejected') {
        if (!failed) firstError = result.reason;
        failed = true;
      }
    }
    if (failed) throw firstError;
    failureStage = 'backlog_probe';
    const remaining = due.empty ? due : await queue.limit(1).select('dueAt').get();
    logger.info('[ActivitySyncPushSweep]', { telemetryVersion: 1,
      oldestDueAgeSeconds: remaining.empty ? 0 : Math.max(0, Math.floor((now - Number(remaining.docs[0].data().dueAt)) / 1000)) });
  } catch (error) {
    logger.error('[ActivitySyncPush]', { telemetryVersion: 1, phase: 'sweep', outcome: 'failed', failureStage, errorCode: notificationSweepErrorCode(error) });
    throw new Error('Notification sweep failed.');
  }
});
