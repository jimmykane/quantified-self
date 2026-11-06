import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { automaticPushConfiguration } from './history-consent';
import { admitDeliveryNotification } from './delivery-service';
import { completedSend, automaticDeliveryFailure, type DeliveryCandidate } from './delivery-policy';

const options = { region: 'europe-west2', memory: '256MiB' as const, timeoutSeconds: 60,
  minInstances: 0, maxInstances: 2, concurrency: 10, retry: true };
async function admit(uid: string, candidate: DeliveryCandidate): Promise<void> {
  try { await admitDeliveryNotification(uid, candidate, { db: getFirestore(), now: Date.now,
    configuration: () => automaticPushConfiguration('web_push_activity_delivery_enabled') }); }
  catch {
    logger.error('[ActivityDeliveryPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' });
    throw new Error('Activity delivery notification admission failed.');
  }
}
export const queueActivitySendNotification = onDocumentWritten({ ...options, document: 'users/{uid}/activitySends/{batchId}' }, async event => {
  const after = event.data?.after.data();
  if (!completedSend(after) || completedSend(event.data?.before.data())) return;
  await admit(event.params.uid, { kind: 'manual', id: event.params.batchId, createdAt: after!.createdAt, completedAt: after!.updatedAt });
});
export const queueAutomaticDeliveryNotification = onDocumentWritten({ ...options, document: 'failed_jobs/{jobId}' }, async event => {
  const after = event.data?.after.data();
  if (!automaticDeliveryFailure(after) || typeof after!.userID !== 'string'
    || event.data?.before.data()?.failedAt === after!.failedAt) return;
  await admit(after!.userID, { kind: 'automatic', id: event.params.jobId, createdAt: after!.dateCreated, completedAt: after!.failedAt });
});
