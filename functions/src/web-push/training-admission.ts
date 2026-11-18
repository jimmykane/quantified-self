import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { automaticPushConfiguration } from './history-consent';
import { trainingAttention, trainingRecovered } from './training-policy';
import { observeTrainingNotification } from './training-service';
import { observeTrainingSend, sendTrainingSendResult } from './training-send-service';
import { pushDependencies } from './runtime';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';

export const queueTrainingSyncNotification = onDocumentWritten({
  document: 'users/{uid}/trainingDeliveryStatuses/{deliveryId}', region: 'europe-west2', memory: '256MiB',
  timeoutSeconds: 60, minInstances: 0, maxInstances: 2, concurrency: 10, retry: true,
  secrets: FUNCTION_SECRET_BINDINGS.queueTrainingSyncNotification,
}, async event => {
  const after = event.data?.after?.data(), before = event.data?.before?.data();
  if (!after) return;
  let covered = false;
  if (before?.status !== after.status || before?.updatedAtMs !== after.updatedAtMs) {
    try {
      const deps = pushDependencies('trainingSend');
      covered = await observeTrainingSend(event.params.uid, after, { db: deps.db, now: deps.now,
        sendReady: id => sendTrainingSendResult(event.params.uid, id, deps) });
    }
    catch {
      logger.error('[TrainingSendPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' });
      throw new Error('Training send notification admission failed.');
    }
  }
  if (!after || before?.status === after.status || !trainingAttention(after.status) && !trainingRecovered(after.status)) return;
  // A captured explicit request owns its failures; recovery must still close existing attention receipts.
  if (covered && !trainingRecovered(after.status)) return;
  try {
    await observeTrainingNotification(event.params.uid, { id: event.params.deliveryId, status: after.status, observedAt: after.updatedAtMs }, {
      db: getFirestore(), now: Date.now, configuration: () => automaticPushConfiguration('web_push_training_sync_enabled'),
    });
  } catch {
    logger.error('[TrainingSyncPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' });
    throw new Error('Training sync notification admission failed.');
  }
});
