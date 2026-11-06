import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { automaticPushConfiguration } from './history-consent';
import { trainingAttention, trainingRecovered } from './training-policy';
import { observeTrainingNotification } from './training-service';

export const queueTrainingSyncNotification = onDocumentWritten({
  document: 'users/{uid}/trainingDeliveryStatuses/{deliveryId}', region: 'europe-west2', memory: '256MiB',
  timeoutSeconds: 60, minInstances: 0, maxInstances: 2, concurrency: 10, retry: true,
}, async event => {
  const after = event.data?.after?.data(), before = event.data?.before?.data();
  if (!after || before?.status === after.status || !trainingAttention(after.status) && !trainingRecovered(after.status)) return;
  try {
    await observeTrainingNotification(event.params.uid, { id: event.params.deliveryId, status: after.status, observedAt: after.updatedAtMs }, {
      db: getFirestore(), now: Date.now, configuration: () => automaticPushConfiguration('web_push_training_sync_enabled'),
    });
  } catch {
    logger.error('[TrainingSyncPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' });
    throw new Error('Training sync notification admission failed.');
  }
});
